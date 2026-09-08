/**
 * Fetch every attendance row matching a filter, across as many pages as it takes.
 *
 * WHY THIS EXISTS — a real bug the final master audit caught:
 *
 * Both export paths (the Reports builder and the Attendance Logs CSV/PDF export)
 * used to ask for `pageSize: 5000` in a single request. Person 3 caps that
 * parameter at 200:
 *
 *     pageSize: z.coerce.number().int().min(1).max(200).default(20)
 *     — Person3_BackendAPI/src/validation/attendanceSchemas.ts
 *
 * so every one of those requests failed validation with a 422. Because
 * `reports-view.tsx` has no other query, the entire Reports screen rendered
 * empty in production, and CSV/PDF export failed everywhere. It was invisible
 * in demo mode: the in-process mock adapter does not run Zod validation.
 *
 * The fix is client-side pagination rather than raising the server cap. The cap
 * is doing its job — this project's Atlas cluster is an M0 free tier (512 MB,
 * shared), and pulling 5000 documents in one query is exactly the kind of
 * request that tier is not built to serve.
 *
 * Both call sites go through this one helper specifically so they cannot drift
 * apart again — the previous bug existed twice, in two files, with two slightly
 * different parameter shapes.
 */
import { api } from '@/api/client';
import type { QueryParams } from '@/api/client';
import type { AttendanceLog } from '@/types/models';

/** The server's own hard maximum. Asking for more is a 422, not a slow query. */
export const MAX_SERVER_PAGE_SIZE = 200;

/**
 * Safety stop. At 200 rows/page this is 20,000 records — far beyond any real
 * export, and enough to guarantee we exit even if `meta.total` is missing or
 * the server keeps returning full pages.
 */
const MAX_PAGES = 100;

export async function fetchAllAttendance(filter: QueryParams): Promise<AttendanceLog[]> {
  const rows: AttendanceLog[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, meta } = await api.get<AttendanceLog[]>('attendance', {
      ...filter,
      page,
      pageSize: MAX_SERVER_PAGE_SIZE,
    });

    rows.push(...data);

    // Stop on the first short page — that is the last one by definition.
    if (data.length < MAX_SERVER_PAGE_SIZE) break;
    // And stop once we have everything the server says exists, so a filter
    // returning an exact multiple of the page size doesn't cost one extra
    // empty round trip.
    if (meta && rows.length >= meta.total) break;
  }

  return rows;
}
