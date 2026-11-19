#!/usr/bin/env node
/**
 * Live latency probe for public Pictoriya endpoints.
 * Usage: node scripts/check-api-speed.mjs [baseUrl]
 * Example: node scripts/check-api-speed.mjs https://api.pictoriya.com
 */
const base = (process.argv[2] || process.env.API_BASE_URL || 'https://api.pictoriya.com').replace(/\/$/, '')

const paths = ['/api/health', '/api/health/db', '/api/books?limit=1&page=1', '/api/books/catalog-stats']

async function timeOne(path) {
  const started = Date.now()
  try {
    const res = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } })
    const ms = Date.now() - started
    const serverTiming = res.headers.get('server-timing') || ''
    let bodyPreview = ''
    try {
      const json = await res.json()
      bodyPreview = JSON.stringify(json).slice(0, 120)
    } catch {
      bodyPreview = '(non-json)'
    }
    return { path, status: res.status, ms, serverTiming, bodyPreview }
  } catch (err) {
    return { path, status: 'ERR', ms: Date.now() - started, serverTiming: '', bodyPreview: String(err) }
  }
}

const rows = []
for (const path of paths) {
  rows.push(await timeOne(path))
}

console.log(`API speed check → ${base}`)
console.log('path | status | total_ms | server-timing | body')
for (const row of rows) {
  console.log(`${row.path} | ${row.status} | ${row.ms}ms | ${row.serverTiming || '-'} | ${row.bodyPreview}`)
}

const health = rows.find((r) => r.path === '/api/health')
const db = rows.find((r) => r.path === '/api/health/db')
if (health && db && typeof db.bodyPreview === 'string' && db.bodyPreview.includes('pingMs')) {
  const ping = Number(JSON.parse(db.bodyPreview).pingMs)
  const networkish = Math.max(0, health.ms - 50)
  console.log(
    `\nHint: /api/health ≈ origin+network (${health.ms}ms). /api/health/db pingMs=${ping}ms is Atlas RTT from the API host.`,
  )
  if (ping > 200) {
    console.log('Atlas looks far from the API host — colocate the cluster with the VPS region if you can.')
  }
  if (networkish > 800) {
    console.log('Origin/network latency is high even without DB work — check VPS region and Cloudflare routing.')
  }
}
