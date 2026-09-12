/**
 * M2: `GET /attendance/:id/selfie-url` existed and was never called — every
 * Avatar rendering a check-in's selfie was passed `log.selfie_url` directly,
 * which is the raw S3 object key, not a URL. That renders fine against
 * nothing in demo mode (selfie_url is usually null there) and 403s against a
 * real private bucket, which is exactly the gap this closes.
 */
import { useQuery } from '@tanstack/react-query';
import { fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';

/**
 * Resolves a check-in's selfie object key to a short-lived, viewable URL.
 * Returns `undefined` while loading or when there is no selfie to resolve —
 * `Avatar` already falls back to initials for a falsy `src`, so callers don't
 * need their own null-handling.
 */
export function useSelfieUrl(logId: string, selfieKey: string | null | undefined): string | undefined {
  const { data } = useQuery({
    queryKey: queryKeys.selfieUrl(logId),
    queryFn: () => fetchData<{ url: string | null }>(`attendance/${logId}/selfie-url`),
    enabled: Boolean(selfieKey),
    // The URL is short-lived (INTEGRATION.md §4.3) — cached just long enough
    // that a re-render (a socket event, a mutation settling) doesn't refetch
    // it, not so long that a slow reviewer hits an expired link.
    staleTime: 45_000,
  });
  return data?.url ?? undefined;
}
