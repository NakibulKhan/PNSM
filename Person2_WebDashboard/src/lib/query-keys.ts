/** Centralised TanStack Query keys. Prevents typo-driven cache misses. */

export const queryKeys = {
  session: ['session'] as const,
  kpis: ['dashboard', 'kpis'] as const,
  trend: (days: number) => ['dashboard', 'trend', days] as const,
  feed: ['attendance', 'feed'] as const,
  attendance: (query: Record<string, unknown>) => ['attendance', 'list', query] as const,
  flagged: ['attendance', 'flagged'] as const,
  employees: (search?: string, page?: number) => ['employees', { search, page }] as const,
  employee: (id: string) => ['employees', id] as const,
  employeeLogs: (id: string) => ['employees', id, 'logs'] as const,
  offices: ['offices'] as const,
  geofences: ['geofences'] as const,
  leave: (status?: string) => ['leave', { status }] as const,
  notifications: ['notifications'] as const,
  audit: ['audit'] as const,
  spoofAlerts: ['spoof-alerts'] as const,
  liveMap: ['live-map'] as const,
  admins: ['admins'] as const,
} as const;
