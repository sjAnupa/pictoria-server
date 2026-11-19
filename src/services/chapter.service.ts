import { randomBytes } from 'crypto'
import { Types } from 'mongoose'
import { Chapter, IChapter } from '../models/Chapter.model'
import { Book } from '../models/Book.model'
import { PAGES_ROOT, rewriteLegacyMediaPath } from '../config/mediaPaths'
import { deleteStoredImage, uploadChapterPage } from './storage.service'
import { isR2MediaUrl } from './r2.service'
import { invalidateAdminDashboardCache } from './dashboardCache'
import { mapWithConcurrency } from '../utils/mapWithConcurrency'
import {
  CreateChapterInput,
  PageManifestEntry,
  UpdateChapterInput,
  parsePageManifest,
} from '../validators/chapter.validator'

/** Parallel sharp + R2 uploads per request; bounded to keep memory/CPU sane. */
const PAGE_UPLOAD_CONCURRENCY = 4

/**
 * Every stored page gets a unique key. Media is served with an immutable
 * cache header, so a key must never be reused for different image bytes.
 */
function uniquePageFilename(position: number): string {
  const order = String(position).padStart(3, '0')
  return `page-${order}-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
}

function bookPagesMarker(bookSlug: string): string {
  return `/${PAGES_ROOT}/books/${bookSlug}/chapters/`
}

/** Pre-uploaded page URLs must point into this book's own pages folder. */
function isOwnedPageUrl(url: string, bookSlug: string): boolean {
  if (url.includes('..')) return false
  const hostedByUs = isR2MediaUrl(url) || url.startsWith('/uploads/')
  return hostedByUs && url.includes(bookPagesMarker(bookSlug))
}

function deleteInBackground(urls: string[]): void {
  if (urls.length === 0) return
  void mapWithConcurrency(urls, 8, (url) => deleteStoredImage(url).catch(() => undefined))
}

type StoredPage = { url: string; name: string }

function basenameFromUrl(url: string): string {
  const segment = url.split('/').pop()?.split('?')[0]
  return segment && segment.length > 0 ? segment : 'page'
}

function resolveDisplayName(
  requested: string | undefined,
  fallback: string,
): string {
  const trimmed = requested?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

function previousDisplayName(
  chapter: IChapter,
  previousUrls: string[],
  matchedUrl: string,
): string {
  const index = previousUrls.indexOf(matchedUrl)
  if (index >= 0 && chapter.pageImageNames?.[index]) {
    return chapter.pageImageNames[index]
  }
  return basenameFromUrl(matchedUrl)
}

export async function findChaptersByBookId(bookId: string) {
  if (!Types.ObjectId.isValid(bookId)) return []
  const chapters = await Chapter.find({ bookId }).sort({ chapterNumber: 1 }).lean()
  const now = new Date()

  return chapters.map(({ pageImageUrls, ...chapter }) => ({
    ...chapter,
    isNew: chapter.highlightUntil ? chapter.highlightUntil > now : false,
  }))
}

export async function findChapterById(id: string) {
  if (!Types.ObjectId.isValid(id)) return null
  const chapter = await Chapter.findById(id).lean()
  if (!chapter) return null

  const now = new Date()
  return {
    ...chapter,
    isNew: chapter.highlightUntil ? chapter.highlightUntil > now : false,
  }
}

/** Upload files in parallel (bounded), keeping their order. */
export async function uploadChapterPages(
  files: Express.Multer.File[],
  bookSlug: string,
  chapterNumber: number,
  startPosition = 1,
): Promise<string[]> {
  return mapWithConcurrency(files, PAGE_UPLOAD_CONCURRENCY, (file, i) =>
    uploadChapterPage(file, bookSlug, chapterNumber, uniquePageFilename(startPosition + i)),
  )
}

/**
 * Batched page upload for large books: stores pages and returns their URLs,
 * which the client then references from the chapter manifest as `uploaded`.
 */
export async function uploadPagesForBook(
  bookId: string,
  chapterNumber: number,
  files: Express.Multer.File[],
): Promise<Array<{ url: string; displayName: string }> | null> {
  if (!Types.ObjectId.isValid(bookId)) return null
  const book = await Book.findById(bookId).select('slug').lean()
  if (!book) return null

  const urls = await uploadChapterPages(files, book.slug, chapterNumber)
  return urls.map((url, i) => ({
    url,
    displayName: files[i]?.originalname || basenameFromUrl(url),
  }))
}

/**
 * Resolve a manifest into stored pages. New files are uploaded in parallel;
 * existing/uploaded entries are validated. Nothing is deleted here.
 */
async function resolveManifestPages(
  manifest: PageManifestEntry[],
  files: Express.Multer.File[],
  bookSlug: string,
  chapterNumber: number,
  chapter?: IChapter,
): Promise<StoredPage[]> {
  const previousUrls = chapter ? [...chapter.pageImageUrls] : []

  return mapWithConcurrency(manifest, PAGE_UPLOAD_CONCURRENCY, async (entry, i): Promise<StoredPage> => {
    if (entry.type === 'existing') {
      if (!chapter) {
        throw new Error('Invalid page manifest: new chapters cannot reference existing pages')
      }
      const matched = resolveExistingPageUrl(previousUrls, entry.url)
      if (!matched) {
        throw new Error('Invalid page manifest: unknown existing page')
      }
      return {
        url: matched,
        name: resolveDisplayName(entry.displayName, previousDisplayName(chapter, previousUrls, matched)),
      }
    }

    if (entry.type === 'uploaded') {
      const url = entry.url.trim()
      if (!isOwnedPageUrl(url, bookSlug)) {
        throw new Error('Invalid page manifest: uploaded page does not belong to this book')
      }
      return { url, name: resolveDisplayName(entry.displayName, basenameFromUrl(url)) }
    }

    const file = files[entry.fileIndex]
    if (!file) {
      throw new Error('Invalid page manifest: missing upload file')
    }
    const url = await uploadChapterPage(file, bookSlug, chapterNumber, uniquePageFilename(i + 1))
    return { url, name: resolveDisplayName(entry.displayName, file.originalname || basenameFromUrl(url)) }
  })
}

export async function createChapterRecord(
  input: CreateChapterInput,
  files: Express.Multer.File[],
) {
  const book = await Book.findById(input.bookId)
  if (!book) return null

  let pageImageUrls: string[] = []
  let pageImageNames: string[] = []

  const manifest = parsePageManifest(input.pageManifest)
  if (manifest && manifest.length > 0) {
    const pages = await resolveManifestPages(manifest, files, book.slug, input.chapterNumber)
    pageImageUrls = pages.map((p) => p.url)
    pageImageNames = pages.map((p) => p.name)
  } else if (files.length) {
    pageImageUrls = await uploadChapterPages(files, book.slug, input.chapterNumber)
    pageImageNames = files.map(
      (file, index) => file.originalname || basenameFromUrl(pageImageUrls[index] ?? ''),
    )
  }

  const highlightUntil = new Date()
  highlightUntil.setDate(highlightUntil.getDate() + 7)

  const chapter = await Chapter.create({
    bookId: book._id,
    chapterNumber: input.chapterNumber,
    title: input.title,
    pageImageUrls,
    pageImageNames,
    totalPages: pageImageUrls.length,
    highlightUntil,
  })

  await Book.updateOne({ _id: book._id }, { $inc: { totalChapters: 1 } })
  invalidateAdminDashboardCache()

  return chapter
}

function canonicalStoredUrl(url: string): string {
  return rewriteLegacyMediaPath(url.trim())
}

function resolveExistingPageUrl(previousUrls: string[], requested: string): string | undefined {
  const canon = canonicalStoredUrl(requested)
  return previousUrls.find((url) => canonicalStoredUrl(url) === canon)
}

export async function updateChapterRecord(
  chapter: IChapter,
  input: UpdateChapterInput,
  files?: Express.Multer.File[],
) {
  if (input.title !== undefined) chapter.title = input.title
  if (input.chapterNumber !== undefined) chapter.chapterNumber = input.chapterNumber
  if (input.highlightUntil !== undefined) chapter.highlightUntil = input.highlightUntil

  const manifest = parsePageManifest(input.pageManifest)
  const replacesPages = Boolean(manifest) || Boolean(files && files.length > 0)
  const previousUrls = [...chapter.pageImageUrls]

  if (replacesPages) {
    const book = await Book.findById(chapter.bookId).select('slug').lean()
    if (!book) return null

    const pages = manifest
      ? await resolveManifestPages(manifest, files ?? [], book.slug, chapter.chapterNumber, chapter)
      : (await uploadChapterPages(files!, book.slug, chapter.chapterNumber)).map((url, i) => ({
          url,
          name: files![i]?.originalname || basenameFromUrl(url),
        }))

    chapter.pageImageUrls = pages.map((p) => p.url)
    chapter.pageImageNames = pages.map((p) => p.name)
    chapter.totalPages = pages.length
  }

  await chapter.save()

  if (replacesPages) {
    const kept = new Set(chapter.pageImageUrls)
    deleteInBackground(previousUrls.filter((url) => !kept.has(url)))
  }
  return chapter
}

export async function deleteChapterRecord(chapter: IChapter) {
  const urls = [...chapter.pageImageUrls]
  await chapter.deleteOne()
  await Book.updateOne(
    { _id: chapter.bookId, totalChapters: { $gt: 0 } },
    { $inc: { totalChapters: -1 } },
  )
  invalidateAdminDashboardCache()
  deleteInBackground(urls)
}

export async function findChapterDocumentById(id: string) {
  if (!Types.ObjectId.isValid(id)) return null
  return Chapter.findById(id)
}
