import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../src/app'
import { ReadingProgress } from '../src/models/ReadingProgress.model'
import {
  resetCollections,
  seedAdmin,
  seedBook,
  seedReader,
  startTestDb,
  stopTestDb,
} from './helpers'
import { getAdminDashboardStats, invalidateAdminDashboardCache } from '../src/services/admin.service'

beforeAll(async () => {
  await startTestDb()
})

afterAll(async () => {
  await stopTestDb()
})

beforeEach(async () => {
  await resetCollections()
})

describe('admin dashboard', () => {
  it('returns top readers without joining the whole progress collection first', async () => {
    const { token } = await seedAdmin()
    const readerA = await seedReader({ name: 'Alice Reader', email: 'alice@example.com' })
    const readerB = await seedReader({ name: 'Bob Reader', email: 'bob@example.com' })
    const book1 = await seedBook(String(readerA.user._id), { title: 'Book One', slug: 'book-one' })
    const book2 = await seedBook(String(readerA.user._id), { title: 'Book Two', slug: 'book-two' })
    const book3 = await seedBook(String(readerB.user._id), { title: 'Book Three', slug: 'book-three' })

    await ReadingProgress.create([
      { userId: readerA.user._id, bookId: book1._id, currentChapter: 1, chaptersRead: [1], lastReadAt: new Date() },
      { userId: readerA.user._id, bookId: book2._id, currentChapter: 1, chaptersRead: [1], lastReadAt: new Date() },
      { userId: readerB.user._id, bookId: book3._id, currentChapter: 1, chaptersRead: [1], lastReadAt: new Date() },
    ])

    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.data.totals.books).toBe(3)
    expect(res.body.data.topReaders[0].name).toBe('Alice Reader')
    expect(res.body.data.topReaders[0].books).toBe(2)
  })

  it('serves a cached payload for 60s unless fresh=1', async () => {
    const { token } = await seedAdmin()
    await seedBook(String((await seedReader()).user._id))

    const first = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(first.body.data.totals.books).toBe(1)

    await seedBook(String((await seedReader()).user._id), { title: 'Extra', slug: 'extra-book' })

    const cached = await getAdminDashboardStats()
    expect(cached.totals.books).toBe(1)

    invalidateAdminDashboardCache()
    const fresh = await request(app)
      .get('/api/admin/dashboard?fresh=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(fresh.body.data.totals.books).toBe(2)
  })
})
