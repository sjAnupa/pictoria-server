import { Types } from 'mongoose'
import { Book } from '../models/Book.model'
import { BookLike } from '../models/BookLike.model'
import { SavedBook } from '../models/SavedBook.model'
import { normalizeMediaUrl } from '../config/storage'

export type BookEngagementState = {
  liked: boolean
  saved: boolean
}

export type ShelfBookItem = {
  bookId: string
  slug: string
  title: string
  author: string
  coverImageUrl: string
  genre: string
  pages: number
  rating: number
  savedAt?: string
  likedAt?: string
}

export async function getBookEngagement(
  userId: string,
  bookId: string,
): Promise<BookEngagementState> {
  const uid = new Types.ObjectId(userId)
  const bid = new Types.ObjectId(bookId)

  const [liked, saved] = await Promise.all([
    BookLike.exists({ userId: uid, bookId: bid }),
    SavedBook.exists({ userId: uid, bookId: bid }),
  ])

  return { liked: Boolean(liked), saved: Boolean(saved) }
}

/**
 * Set (or toggle when `desired` is omitted) a like. At most two sequential
 * round trips: the idempotent write, then the counter bump only if it changed.
 */
export async function setBookLike(
  userId: string,
  bookId: string,
  desired?: boolean,
): Promise<BookEngagementState> {
  const uid = new Types.ObjectId(userId)
  const bid = new Types.ObjectId(bookId)
  const savedPromise = SavedBook.exists({ userId: uid, bookId: bid })

  const target = desired ?? !(await BookLike.exists({ userId: uid, bookId: bid }))

  if (target) {
    const result = await BookLike.updateOne(
      { userId: uid, bookId: bid },
      { $setOnInsert: { likedAt: new Date() } },
      { upsert: true },
    )
    if (result.upsertedCount > 0) {
      const bump = await Book.updateOne({ _id: bid }, { $inc: { 'stats.totalLikes': 1 } })
      if (bump.matchedCount === 0) {
        await BookLike.deleteOne({ userId: uid, bookId: bid })
        throw new Error('BOOK_NOT_FOUND')
      }
    }
  } else {
    const result = await BookLike.deleteOne({ userId: uid, bookId: bid })
    if (result.deletedCount > 0) {
      await Book.updateOne(
        { _id: bid, 'stats.totalLikes': { $gt: 0 } },
        { $inc: { 'stats.totalLikes': -1 } },
      )
    }
  }

  return { liked: target, saved: Boolean(await savedPromise) }
}

/** Set (or toggle when `desired` is omitted) a saved-shelf entry. */
export async function setSavedBook(
  userId: string,
  bookId: string,
  desired?: boolean,
): Promise<BookEngagementState> {
  const uid = new Types.ObjectId(userId)
  const bid = new Types.ObjectId(bookId)
  const likedPromise = BookLike.exists({ userId: uid, bookId: bid })

  const target = desired ?? !(await SavedBook.exists({ userId: uid, bookId: bid }))

  if (target) {
    const [bookExists] = await Promise.all([
      Book.exists({ _id: bid }),
      SavedBook.updateOne(
        { userId: uid, bookId: bid },
        { $setOnInsert: { savedAt: new Date() } },
        { upsert: true },
      ),
    ])
    if (!bookExists) {
      await SavedBook.deleteOne({ userId: uid, bookId: bid })
      throw new Error('BOOK_NOT_FOUND')
    }
  } else {
    await SavedBook.deleteOne({ userId: uid, bookId: bid })
  }

  return { liked: Boolean(await likedPromise), saved: target }
}

async function buildShelfItems(
  rows: Array<{ bookId: Types.ObjectId; savedAt?: Date; likedAt?: Date }>,
  dateField: 'savedAt' | 'likedAt',
): Promise<ShelfBookItem[]> {
  if (!rows.length) return []

  const bookIds = rows.map((r) => r.bookId)
  const books = await Book.find({ _id: { $in: bookIds } }).lean()
  const bookMap = new Map(books.map((b) => [String(b._id), b]))

  const items: ShelfBookItem[] = []
  for (const row of rows) {
    const book = bookMap.get(String(row.bookId))
    if (!book) continue
    const date = row[dateField]
    items.push({
      bookId: String(book._id),
      slug: book.slug,
      title: book.title,
      author: book.author,
      coverImageUrl: normalizeMediaUrl(book.coverImageUrl) ?? '',
      genre: book.genres?.[0] ?? 'General',
      pages: book.pageCount ?? 0,
      rating: book.stats?.averageRating ?? 0,
      ...(dateField === 'savedAt'
        ? { savedAt: date?.toISOString() }
        : { likedAt: date?.toISOString() }),
    })
  }
  return items
}

export async function getSavedBooks(userId: string): Promise<ShelfBookItem[]> {
  const uid = new Types.ObjectId(userId)
  const rows = await SavedBook.find({ userId: uid }).sort({ savedAt: -1 }).lean()
  return buildShelfItems(rows, 'savedAt')
}

export async function getLikedBooks(userId: string): Promise<ShelfBookItem[]> {
  const uid = new Types.ObjectId(userId)
  const rows = await BookLike.find({ userId: uid }).sort({ likedAt: -1 }).lean()
  return buildShelfItems(rows, 'likedAt')
}
