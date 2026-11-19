import { Request, Response } from 'express'
import { successResponse } from '../utils/apiResponse'
import { getAdminDashboardStats } from '../services/admin.service'

export const getDashboardStats = async (req: Request, res: Response): Promise<Response> => {
  const stats = await getAdminDashboardStats({ fresh: req.query.fresh === '1' })
  res.setHeader('Cache-Control', 'private, no-store')
  return successResponse(res, stats)
}
