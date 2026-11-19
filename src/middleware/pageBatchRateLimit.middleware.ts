import rateLimit from 'express-rate-limit'

/** Batched chapter page uploads (a 600-page book is about 30 batches). */
export const pageBatchRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many page uploads. Try again later.', errors: [] },
})
