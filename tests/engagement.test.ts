import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../src/app'
import { BookLike } from '../src/models/BookLike.model'
import { Book } from '../src/models/Book.model'
import { resetCollections, seedBook, seedReader, startTestDb, stopTestDb } from './helpers'

beforeAll(async () => {
  await startTestDb()
})

afterAll(async () => {
  await stopTestDb()
})

beforeEach(async () => {
  await resetCollections()
})

describe('engagement like/save', () => {
  it('sets an explicit like and bumps the counter once', async () => {
    const { user, token } = await seedReader()
    const book = await seedBook(String(user._id))

    const liked = await request(app)
      .put(`/api/engagement/book/${book._id}/like`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true })
      .expect(200)

    expect(liked.body.data).toEqual({ liked: true, saved: false })
    expect(await BookLike.countDocuments({ bookId: book._id })).toBe(1)
    expect((await Book.findById(book._id))!.stats.totalLikes).toBe(1)

    const again = await request(app)
      .put(`/api/engagement/book/${book._id}/like`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true })
      .expect(200)

    expect(again.body.data.liked).toBe(true)
    expect((await Book.findById(book._id))!.stats.totalLikes).toBe(1)

    const unliked = await request(app)
      .put(`/api/engagement/book/${book._id}/like`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: false })
      .expect(200)

    expect(unliked.body.data).toEqual({ liked: false, saved: false })
    expect(await BookLike.countDocuments()).toBe(0)
    expect((await Book.findById(book._id))!.stats.totalLikes).toBe(0)
  })

  it('sets save independently of like', async () => {
    const { user, token } = await seedReader()
    const book = await seedBook(String(user._id))

    await request(app)
      .put(`/api/engagement/book/${book._id}/like`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true })
      .expect(200)

    const saved = await request(app)
      .put(`/api/engagement/book/${book._id}/save`)
      .set('Authorization', `Bearer ${token}`)
      .send({ saved: true })
      .expect(200)

    expect(saved.body.data).toEqual({ liked: true, saved: true })

    const unsaved = await request(app)
      .put(`/api/engagement/book/${book._id}/save`)
      .set('Authorization', `Bearer ${token}`)
      .send({ saved: false })
      .expect(200)

    expect(unsaved.body.data).toEqual({ liked: true, saved: false })
  })

  it('toggles when no desired flag is sent (legacy clients)', async () => {
    const { user, token } = await seedReader()
    const book = await seedBook(String(user._id))

    const first = await request(app)
      .put(`/api/engagement/book/${book._id}/like`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(first.body.data.liked).toBe(true)

    const second = await request(app)
      .put(`/api/engagement/book/${book._id}/like`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(second.body.data.liked).toBe(false)
  })
})
