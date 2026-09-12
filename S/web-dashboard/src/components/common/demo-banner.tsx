import { FlaskConical } from 'lucide-react';
import { IS_DEMO } from '@/config/env';

/**
 * Honesty banner.
 *
 * Demo mode serves seeded data from an in-process mock. It exists so the
 * console can be built and presented without Person 3's backend, but a viewer
 * must never mistake it for live data — so it says so, plainly, on every screen.
 */
export function DemoModeBanner() {
  if (!IS_DEMO) return null;

  return (
    <div className="flex items-center gap-2 border-b border-flagged/25 bg-flagged-soft px-4 py-1.5 lg:px-6">
      <FlaskConical size={13} className="shrink-0 text-flagged" aria-hidden />
      <p className="text-[11.5px] text-flagged">
        <span className="font-semibold">Demo mode.</span> Seeded data from the built-in mock backend;
        check-ins are simulated. Set <code className="tnum">VITE_DEMO_MODE=0</code> to use the live
        API.
      </p>
    </div>
  );
}
