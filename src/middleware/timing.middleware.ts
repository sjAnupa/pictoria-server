import type { NextFunction, Request, Response } from 'express'

const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS ?? 1500)

/**
 * Adds `Server-Timing: app;dur=…` (visible in browser DevTools → Network → Timing)
 * so origin processing time can be told apart from network/proxy latency, and
 * logs requests slower than SLOW_REQUEST_MS.
 */
export function timingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint()
  const elapsedMs = () => Number(process.hrtime.bigint() - start) / 1e6

  const originalWriteHead = res.writeHead.bind(res) as (...args: unknown[]) => Response
  res.writeHead = ((...args: unknown[]) => {
    if (!res.headersSent) {
      res.setHeader('Server-Timing', `app;dur=${elapsedMs().toFixed(1)}`)
    }
    return originalWriteHead(...args)
  }) as typeof res.writeHead

  res.on('finish', () => {
    const ms = elapsedMs()
    if (ms >= SLOW_REQUEST_MS) {
      console.warn(`[slow] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`)
    }
  })

  next()
}
