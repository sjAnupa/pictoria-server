const DASHBOARD_CACHE_TTL_MS = 60_000

type CacheEntry = { value: unknown; expiresAt: number }

let dashboardCache: CacheEntry | null = null
let dashboardInFlight: Promise<unknown> | null = null

export function invalidateAdminDashboardCache(): void {
  dashboardCache = null
}

/** Cached for 60s; concurrent callers share one computation. */
export function withDashboardCache<T>(options: { fresh?: boolean }, compute: () => Promise<T>): Promise<T> {
  if (!options.fresh && dashboardCache && dashboardCache.expiresAt > Date.now()) {
    return Promise.resolve(dashboardCache.value as T)
  }
  if (!dashboardInFlight) {
    dashboardInFlight = compute()
      .then((value) => {
        dashboardCache = { value, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS }
        return value
      })
      .finally(() => {
        dashboardInFlight = null
      })
  }
  return dashboardInFlight as Promise<T>
}
