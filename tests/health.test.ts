import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../src/app'
import { startTestDb, stopTestDb } from './helpers'

beforeAll(async () => {
  await startTestDb()
})

afterAll(async () => {
  await stopTestDb()
})

describe('health endpoints', () => {
  it('reports ok without hitting Mongo', async () => {
    const res = await request(app).get('/api/health').expect(200)
    expect(res.body.status).toBe('ok')
    expect(res.headers['server-timing']).toMatch(/app;dur=/)
  })

  it('pings Mongo and returns pingMs', async () => {
    const res = await request(app).get('/api/health/db').expect(200)
    expect(res.body.status).toBe('ok')
    expect(typeof res.body.pingMs).toBe('number')
  })
})
