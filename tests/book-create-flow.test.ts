import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../src/app'
import { Book } from '../src/models/Book.model'
import { Chapter } from '../src/models/Chapter.model'
import { UPLOADS_ROOT } from '../src/config/storage'
import { resetCollections, seedAdmin, seedReader, startTestDb, stopTestDb } from './helpers'

const createdSlugs = new Set<string>()

async function png(color: string): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: color } }).png().toBuffer()
}

async function createBookViaApi(token: string, title: string) {
  const res = await request(app)
    .post('/api/books')
    .set('Authorization', `Bearer ${token}`)
    .field('title', title)
    .field('author', 'Test Author')
    .field('publisher', 'Test Pub')
    .field('description', 'Short description')
    .field('genres', JSON.stringify(['Romance']))
    .field('tags', JSON.stringify([]))
    .field('accessType', 'free')
    .field('status', 'draft')
    .attach('image', await png('#ff0000'), { filename: 'cover.png', contentType: 'image/png' })
  if (res.body?.data?.slug) createdSlugs.add(res.body.data.slug)
  return res
}

beforeAll(async () => {
  await startTestDb()
})

afterAll(async () => {
  await stopTestDb()
  for (const slug of createdSlugs) {
    await fs.rm(path.join(UPLOADS_ROOT, 'covers', 'books', slug), { recursive: true, force: true })
    await fs.rm(path.join(UPLOADS_ROOT, 'pages', 'books', slug), { recursive: true, force: true })
  }
})

beforeEach(async () => {
  await resetCollections()
  await Chapter.deleteMany({})
})

describe('admin creates a book with a chapter (full flow)', () => {
  it('creates the book, uploads pages in a batch, then saves the chapter from uploaded URLs', async () => {
    const { token } = await seedAdmin()

    const created = await createBookViaApi(token, 'Flow Book One')
    expect(created.status).toBe(201)
    const bookId = created.body.data._id as string

    const upload = await request(app)
      .post('/api/chapters/pages/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('bookId', bookId)
      .field('chapterNumber', '1')
      .attach('pages', await png('#00ff00'), { filename: 'p1.png', contentType: 'image/png' })
      .attach('pages', await png('#0000ff'), { filename: 'p2.png', contentType: 'image/png' })
    expect(upload.status).toBe(201)
    expect(upload.body.data).toHaveLength(2)
    expect(upload.body.data[0].url).not.toBe(upload.body.data[1].url)

    const manifest = upload.body.data.map((p: { url: string; displayName: string }) => ({
      type: 'uploaded',
      url: p.url,
      displayName: p.displayName,
    }))

    const chapter = await request(app)
      .post('/api/chapters')
      .set('Authorization', `Bearer ${token}`)
      .field('bookId', bookId)
      .field('chapterNumber', '1')
      .field('title', 'Opening')
      .field('pageManifest', JSON.stringify(manifest))
    expect(chapter.status).toBe(201)
    expect(chapter.body.data._id).toBeTruthy()

    const edit = await request(app)
      .get(`/api/books/manage/${bookId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(edit.status).toBe(200)
    expect(edit.body.data.chapters).toHaveLength(1)
    expect(edit.body.data.chapters[0].title).toBe('Opening')
    expect(edit.body.data.chapters[0].pageImageUrls).toHaveLength(2)
    expect((await Book.findById(bookId))!.totalChapters).toBe(1)
  })

  it('still accepts the legacy single-request chapter upload (new entries + files)', async () => {
    const { token } = await seedAdmin()
    const created = await createBookViaApi(token, 'Flow Book Legacy')
    const bookId = created.body.data._id as string

    const res = await request(app)
      .post('/api/chapters')
      .set('Authorization', `Bearer ${token}`)
      .field('bookId', bookId)
      .field('chapterNumber', '1')
      .field('title', 'Legacy')
      .field('pageManifest', JSON.stringify([{ type: 'new', fileIndex: 0, displayName: 'a.png' }]))
      .attach('pages', await png('#123456'), { filename: 'a.png', contentType: 'image/png' })
    expect(res.status).toBe(201)
    expect(res.body.data.pageImageUrls).toHaveLength(1)
  })

  it('rejects uploaded URLs that do not belong to the book', async () => {
    const { token } = await seedAdmin()
    const created = await createBookViaApi(token, 'Flow Book Guard')
    const bookId = created.body.data._id as string

    const res = await request(app)
      .post('/api/chapters')
      .set('Authorization', `Bearer ${token}`)
      .field('bookId', bookId)
      .field('chapterNumber', '1')
      .field('title', 'Evil')
      .field(
        'pageManifest',
        JSON.stringify([{ type: 'uploaded', url: 'https://evil.example.com/pages/x.webp' }]),
      )
    expect(res.status).toBe(400)
    expect(await Chapter.countDocuments()).toBe(0)
  })

  it('answers 409 with a readable message when the same chapter number is saved twice', async () => {
    const { token } = await seedAdmin()
    const created = await createBookViaApi(token, 'Flow Book Dup')
    const bookId = created.body.data._id as string

    const send = async () =>
      request(app)
        .post('/api/chapters')
        .set('Authorization', `Bearer ${token}`)
        .field('bookId', bookId)
        .field('chapterNumber', '1')
        .field('title', 'Same')
        .field('pageManifest', JSON.stringify([{ type: 'new', fileIndex: 0 }]))
        .attach('pages', await png('#abcdef'), { filename: 'a.png', contentType: 'image/png' })

    expect((await send()).status).toBe(201)
    const second = await send()
    expect(second.status).toBe(409)
    expect(second.body.message).toMatch(/Chapter 1 already exists/)
    expect(second.body.message).not.toMatch(/E11000/)
    expect(await Chapter.countDocuments()).toBe(1)
  })

  it('does not let non-admins upload pages', async () => {
    const { token: adminToken } = await seedAdmin()
    const created = await createBookViaApi(adminToken, 'Flow Book Auth')
    const bookId = created.body.data._id as string

    const { token: readerToken } = await seedReader()
    const res = await request(app)
      .post('/api/chapters/pages/upload')
      .set('Authorization', `Bearer ${readerToken}`)
      .field('bookId', bookId)
      .field('chapterNumber', '1')
      .attach('pages', await png('#999999'), { filename: 'p.png', contentType: 'image/png' })
    expect(res.status).toBeGreaterThanOrEqual(401)
    expect(res.status).toBeLessThan(500)
  })
})
