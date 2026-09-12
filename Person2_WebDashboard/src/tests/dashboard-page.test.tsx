/**
 * M5 (master audit): "one migrated screen per app" — the dashboard is the
 * flagship Bento composition (PresentNowTile hero + KpiChips + LiveFeedTile),
 * and had no render coverage at all before this. Mocks the network boundary
 * (`fetchData`) and auth context rather than the Bento components themselves,
 * so this exercises the real composition, the real queries, and the real
 * a11y heading outline the M1 fix restored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DashboardKpis, TrendPoint } from '@/types/api';
import type { AttendanceLog } from '@/types/models';
import type { SessionUser } from '@/types/models';

const fetchData = vi.fn();
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchData: (path: string, params?: unknown) => fetchData(path, params),
}));

const sessionUser: SessionUser = {
  _id: 'u1',
  name: 'Syeda Senjida Malik',
  email: 'hr@pnsm.test',
  role: 'admin_hr',
  role_name: 'Admin',
  reference_photo_url: null,
};
vi.mock('@/auth/auth-context', () => ({ useSession: () => sessionUser }));

const kpis: DashboardKpis = {
  checkedInToday: 21,
  onLeave: 0,
  lateArrivals: 8,
  avgFaceMatch: 90,
  totalEmployees: 24,
  flaggedToday: 2,
};
const trend: TrendPoint[] = [{ date: '2026-09-09', count: 21, label: '09/09' }];
const feed: AttendanceLog[] = [
  {
    _id: 'log1',
    user_id: 'u2',
    geofence_id: 'g1',
    check_type: 'check_in',
    timestamp: '2026-09-09T09:06:00.000Z',
    gps_location: null,
    face_match_score: 93.6,
    selfie_url: null,
    status: 'approved',
    employee_name: 'Tasnim Sarker',
    employee_code: 'PNSM-0109',
    office_name: 'Banani Office',
  },
];

const { default: DashboardPage } = await import('@/pages/dashboard');

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DashboardPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('DashboardPage (migrated Bento screen)', () => {
  beforeEach(() => {
    fetchData.mockReset();
    fetchData.mockImplementation((path: string) => {
      if (path === 'dashboard/kpis') return Promise.resolve(kpis);
      if (path === 'dashboard/trend') return Promise.resolve(trend);
      if (path === 'attendance/feed') return Promise.resolve(feed);
      return Promise.reject(new Error(`unexpected fetchData path in test: ${path}`));
    });
  });

  it('greets the signed-in user by first name', async () => {
    renderDashboard();
    expect(await screen.findByText('Good day, Syeda')).toBeInTheDocument();
  });

  it('renders the correct a11y heading outline: one h1, one h2 hero, h3 chips and feed', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText('21')).toBeInTheDocument());

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h2s).toHaveLength(1);
    expect(h2s[0]).toHaveTextContent('Present now');

    const h3Texts = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(h3Texts).toEqual(
      expect.arrayContaining(['Late arrivals', 'On leave', 'Avg face match', 'Live check-in feed']),
    );
  });

  it('renders the KPI numbers from the real query response, not a fake decimal', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText('8')).toBeInTheDocument()); // lateArrivals
    // M9 regression: 90, never "90.0".
    expect(screen.getByText('90')).toBeInTheDocument();
    expect(screen.queryByText('90.0')).not.toBeInTheDocument();
  });

  it('renders the live feed entry once the query resolves', async () => {
    renderDashboard();
    expect(await screen.findByText('Tasnim Sarker')).toBeInTheDocument();
    expect(screen.getByText('Banani Office')).toBeInTheDocument();
  });
});

/**
 * The gap this closes: `toApiError()` (api/client.ts) already produced a
 * BACKEND_TIMEOUT ApiError for a cold Render/Koyeb free-tier backend, but
 * nothing ever checked for it — every page fell through to the generic,
 * alarm-toned ErrorState/TileError instead of WakingState's calm "the server
 * is starting" copy. Exercises the real composition end to end: WakingState
 * on the hero tile (big enough for the full component), the compact
 * accent-toned "Waking up" copy on the chips and feed (too small for the
 * full component, same underlying check).
 */
describe('DashboardPage on a cold (waking) backend', () => {
  beforeEach(async () => {
    const { ApiError } = await import('@/api/client');
    fetchData.mockReset();
    fetchData.mockImplementation((path: string) => {
      if (path === 'dashboard/kpis' || path === 'dashboard/trend' || path === 'attendance/feed') {
        return Promise.reject(new ApiError(504, 'BACKEND_TIMEOUT', 'The server did not respond in time.'));
      }
      return Promise.reject(new Error(`unexpected fetchData path in test: ${path}`));
    });
  });

  it('renders the full WakingState on the hero tile, not the generic TileError', async () => {
    renderDashboard();
    expect(await screen.findByText('Waking up the server')).toBeInTheDocument();
    expect(
      screen.getByText(/The free-tier backend sleeps when idle\. This can take up to a minute/),
    ).toBeInTheDocument();
  });

  it('renders the compact waking copy, in the accent tone, on the KPI chips', async () => {
    renderDashboard();
    const wakingChips = await screen.findAllByText('Waking up');
    // Three chips (Late arrivals, On leave, Avg face match) share the kpis query.
    expect(wakingChips.length).toBe(3);
    wakingChips.forEach((el) => expect(el).toHaveClass('text-accent'));
  });

  it('renders the compact waking copy on the live feed tile too', async () => {
    renderDashboard();
    expect(
      await screen.findByText('The free-tier backend sleeps when idle. This fills in on its own shortly.'),
    ).toBeInTheDocument();
  });
});
