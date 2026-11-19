import { describe, expect, it } from 'vitest'
import { parsePageManifest } from '../src/validators/chapter.validator'

describe('page manifest schema', () => {
  it('accepts existing, new, and uploaded entries', () => {
    const parsed = parsePageManifest([
      { type: 'existing', url: '/uploads/pages/books/slug/chapters/1/page-001.webp', displayName: 'a' },
      { type: 'new', fileIndex: 0, displayName: 'b' },
      { type: 'uploaded', url: '/uploads/pages/books/slug/chapters/1/page-002.webp', displayName: 'c' },
    ])
    expect(parsed).toHaveLength(3)
    expect(parsed?.[2]).toMatchObject({ type: 'uploaded' })
  })

  it('rejects invalid entries', () => {
    expect(parsePageManifest([{ type: 'uploaded' }])).toBeNull()
    expect(parsePageManifest([{ type: 'new', fileIndex: -1 }])).toBeNull()
  })
})
