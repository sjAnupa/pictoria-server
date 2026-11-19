import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config/env'
import { User } from '../models/User.model'
import { errorResponse } from '../utils/apiResponse'

interface JwtPayload {
  _id: string
}

type AuthUserRecord = {
  role: string
  is_admin: boolean
  is_super_admin: boolean
  isActive: boolean
}

/**
 * Role flags are re-read from MongoDB so admin changes apply without re-login,
 * but cached briefly: against a remote Atlas region each lookup is a full
 * round trip on every authenticated request.
 */
const AUTH_CACHE_TTL_MS = 30_000
const AUTH_CACHE_MAX = 5_000
const authCache = new Map<string, { record: AuthUserRecord | null; expiresAt: number }>()

export function invalidateAuthUser(userId: string): void {
  authCache.delete(String(userId))
}

export async function loadAuthUser(userId: string): Promise<AuthUserRecord | null> {
  const cached = authCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.record

  const user = await User.findById(userId).select('role is_admin is_super_admin isActive').lean()
  const record: AuthUserRecord | null = user
    ? {
        role: user.role,
        is_admin: Boolean(user.is_admin),
        is_super_admin: Boolean(user.is_super_admin),
        isActive: user.isActive !== false,
      }
    : null

  if (authCache.size >= AUTH_CACHE_MAX) {
    const oldest = authCache.keys().next().value
    if (oldest !== undefined) authCache.delete(oldest)
  }
  authCache.set(userId, { record, expiresAt: Date.now() + AUTH_CACHE_TTL_MS })
  return record
}

/** Verifies JWT, then loads current role flags (briefly cached). */
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    errorResponse(res, 'Authentication required', 401)
    return
  }

  const token = authHeader.split(' ')[1]

  let decoded: JwtPayload
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload
  } catch {
    errorResponse(res, 'Invalid or expired token', 401)
    return
  }

  const user = await loadAuthUser(String(decoded._id))

  if (!user) {
    errorResponse(res, 'User not found', 401)
    return
  }

  if (!user.isActive) {
    errorResponse(res, 'Account is deactivated', 403)
    return
  }

  req.user = {
    _id: String(decoded._id),
    role: user.role,
    is_admin: user.is_admin,
    is_super_admin: user.is_super_admin,
  }
  next()
}
