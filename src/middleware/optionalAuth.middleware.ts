import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config/env'
import { loadAuthUser } from './auth.middleware'

interface JwtPayload {
  _id: string
}

/** Attaches req.user when a valid Bearer token is present; never rejects anonymous requests. */
export const optionalAuthMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    next()
    return
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload
    const user = await loadAuthUser(String(decoded._id))

    if (user?.isActive) {
      req.user = {
        _id: String(decoded._id),
        role: user.role,
        is_admin: user.is_admin,
        is_super_admin: user.is_super_admin,
      }
    }
  } catch {
    // Invalid token — treat as anonymous for public catalog routes.
  }

  next()
}

export function isCatalogAdmin(req: Request): boolean {
  return Boolean(req.user?.is_admin || req.user?.is_super_admin)
}
