import { readFileSync } from 'fs'
import { join } from 'path'
import mongoose from 'mongoose'
import { User } from '../src/models/User.model'
import { Book } from '../src/models/Book.model'
import { BookLike } from '../src/models/BookLike.model'
import { SavedBook } from '../src/models/SavedBook.model'
import { ReadingProgress } from '../src/models/ReadingProgress.model'
import { ReadingEvent } from '../src/models/ReadingEvent.model'
import { signAuthToken } from '../src/utils/authToken'
import { invalidateAdminDashboardCache } from '../src/services/admin.service'
import { invalidateAuthUser } from '../src/middleware/auth.middleware'

function memoryUri(): string {
  return readFileSync(join(__dirname, '.mongo-uri'), 'utf8').trim()
}

export async function startTestDb(): Promise<void> {
  if (mongoose.connection.readyState === 1) return
  await mongoose.connect(memoryUri())
}

export async function stopTestDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect()
  }
}

export async function resetCollections(): Promise<void> {
  await Promise.all([
    User.deleteMany({}),
    Book.deleteMany({}),
    BookLike.deleteMany({}),
    SavedBook.deleteMany({}),
    ReadingProgress.deleteMany({}),
    ReadingEvent.deleteMany({}),
  ])
  invalidateAdminDashboardCache()
}

export async function seedReader(overrides: Partial<{ name: string; email: string }> = {}) {
  const user = await User.create({
    name: overrides.name ?? 'Reader One',
    email: overrides.email ?? `reader-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    googleId: `google-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    authProviders: ['google'],
    role: 'user',
    is_admin: false,
    is_super_admin: false,
  })
  invalidateAuthUser(String(user._id))
  return { user, token: signAuthToken(user) }
}

export async function seedAdmin() {
  const user = await User.create({
    name: 'Admin One',
    email: `admin-${Date.now()}@example.com`,
    googleId: `google-admin-${Date.now()}`,
    authProviders: ['google'],
    role: 'admin',
    is_admin: true,
    is_super_admin: false,
  })
  invalidateAuthUser(String(user._id))
  return { user, token: signAuthToken(user) }
}

export async function seedBook(uploadedBy: string, overrides: Partial<{ title: string; slug: string }> = {}) {
  return Book.create({
    title: overrides.title ?? 'Test Book',
    slug: overrides.slug ?? `test-book-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    author: 'Author',
    publisher: 'Pub',
    description: 'A short description',
    coverImageUrl: '/uploads/covers/books/test/cover.webp',
    genres: ['Romance'],
    tags: [],
    status: 'published',
    uploadedBy,
    stats: { totalReads: 0, averageRating: 0, totalReviews: 0, totalLikes: 0, totalViews: 0 },
  })
}
