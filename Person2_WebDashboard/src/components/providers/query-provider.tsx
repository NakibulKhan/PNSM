/**
 * TanStack Query setup.
 *
 * Three decisions worth stating:
 *
 * 1. One QueryClient per browser session, created lazily in state so React
 *    Strict Mode's double render cannot create two caches.
 *
 * 2. The cache is persisted to IndexedDB. On an unreliable Keraniganj link — or
 *    after a load-shedding reboot — the dashboard reopens showing the last data
 *    it had instead of an empty shell, and refreshes in the background. This is
 *    the pragmatic 80% of offline support without a service worker.
 *
 * 3. M8 (master audit): that persistence used to apply to every query with no
 *    exceptions — which meant employee PII (names, phone numbers, emails) and
 *    precise per-check-in GPS coordinates sat in plaintext IndexedDB for up to
 *    24 hours, on whatever machine the browser profile belongs to. That was
 *    never a conscious trade-off, just what happened when offline resilience
 *    was added without auditing what "everything" actually contains.
 *
 *    The conscious decision: keep persistence ONLY for the aggregate,
 *    non-personal data the original rationale was actually about — dashboard
 *    KPIs/trend, offices, and geofences (an office's fixed, organisational
 *    location, not a tracked individual's). Everything with a person's name,
 *    contact details, or live/historical GPS — employees, attendance logs,
 *    the live feed, the live map, leave requests, notifications, audit
 *    entries, spoof alerts, admins, selfie URLs — is excluded via
 *    `PERSISTED_QUERY_NAMESPACES` below. Those queries still work normally
 *    from TanStack Query's in-memory cache for the life of the tab; they
 *    simply never get written to disk. A reopened tab shows the dashboard
 *    shell instantly (the resilience this was built for) and refetches
 *    everything else fresh, same as if persistence didn't exist.
 */
import * as React from 'react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { Persister } from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';

const config: QueryClientConfig = {
  defaultOptions: {
    queries: {
      // Live telemetry must not be served stale, but reference data can be.
      staleTime: 15_000,
      gcTime: 24 * 60 * 60 * 1_000,
      retry: (failureCount, error) => {
        /*
         * Never retry an auth or not-found failure. A 401 is already handled by
         * the Axios interceptor, which refreshes the token and replays the
         * request exactly once; retrying here would fight that machinery and
         * multiply the load on Person 3's /refresh endpoint.
         */
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: { retry: 0 },
  },
};

/** Top-level query-key namespaces that carry no PII and no precise location. */
const PERSISTED_QUERY_NAMESPACES = new Set(['dashboard', 'offices', 'geofences']);

function isSafeToPersist(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === 'string' && PERSISTED_QUERY_NAMESPACES.has(queryKey[0]);
}

function createIdbPersister(key = 'pnsm-admin-query-cache'): Persister {
  return {
    persistClient: async (client) => {
      try {
        await set(key, client);
      } catch {
        // Private-mode browsers can refuse IndexedDB. Losing the cache is fine.
      }
    },
    restoreClient: async () => {
      try {
        return await get(key);
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        await del(key);
      } catch {
        /* no-op */
      }
    },
  };
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient(config));
  const [persister] = React.useState(() => (typeof window === 'undefined' ? null : createIdbPersister()));

  if (!persister) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1_000,
        dehydrateOptions: {
          // Never persist an error state (a stale success is useful, a stale
          // failure is just confusing on the next visit), AND never persist a
          // query outside the non-PII namespaces above (M8).
          shouldDehydrateQuery: (query) =>
            query.state.status === 'success' && isSafeToPersist(query.queryKey),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
