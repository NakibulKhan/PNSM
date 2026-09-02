/**
 * Sign in.
 *
 * The left panel states what the system actually does, in its own vocabulary —
 * verification threshold, geofence radius, live telemetry — rather than generic
 * product copy. It is the first place the instrument-panel language appears.
 */
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn, ShieldCheck, MapPin, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { loginSchema, type LoginInput } from '@/schemas';
import { useAuth } from '@/auth/auth-context';
import { IS_DEMO } from '@/config/env';
import { FACE_MATCH_THRESHOLD } from '@/lib/constants';

const capabilities = [
  {
    icon: ShieldCheck,
    title: '1:1 face verification',
    body: `Check-ins auto-approve at ${FACE_MATCH_THRESHOLD}% cosine similarity; anything lower reaches your review queue.`,
  },
  {
    icon: MapPin,
    title: 'Per-office geofences',
    body: 'Drop a pin, set a radius in metres, and every check-in is validated against it.',
  },
  {
    icon: Radio,
    title: 'Live attendance feed',
    body: 'Check-ins arrive as they happen. No refreshing, no polling.',
  },
];

export default function LoginPage() {
  const { signIn } = useAuth();
  const location = useLocation() as { state?: { reason?: string } };
  const [serverError, setServerError] = useState<string | null>(
    location.state?.reason === 'expired'
      ? 'Your session expired. Sign in again to continue.'
      : null,
  );

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginInput) => {
    setServerError(null);
    try {
      // Navigation is handled by RedirectIfAuthenticated once state flips.
      await signIn(values.email, values.password);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not sign in. Try again.');
    }
  };

  const useDemoAccount = (email: string) => {
    setValue('email', email);
    setValue('password', 'demo1234');
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_460px]">
      <section className="relative hidden flex-col justify-between bg-ink px-10 py-12 text-white lg:flex">
        <div>
          <p className="text-[13.5px] font-semibold tracking-[-0.01em]">PNSM Command Center</p>
          <p className="mt-0.5 text-[10.5px] tracking-[0.09em] text-white/45">
            WORKFORCE ATTENDANCE &amp; MANAGEMENT
          </p>
        </div>

        <div className="max-w-md">
          <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.02em]">
            Attendance you can audit,
            <br />
            without a fingerprint reader.
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-white/60">
            The command console for HR and executives: onboard employees, configure spatial
            boundaries, and watch verified check-ins land in real time.
          </p>

          <ul className="mt-8 space-y-5">
            {capabilities.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.title} className="flex gap-3">
                  <Icon size={16} className="mt-0.5 shrink-0 text-white/50" aria-hidden />
                  <div>
                    <p className="text-[12.5px] font-semibold">{item.title}</p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-white/50">{item.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="text-[10.5px] text-white/35">
          Group 8 · CSE482L Internet and Web Technology · North South University
        </p>
      </section>

      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-7 lg:hidden">
            <p className="text-[15px] font-semibold text-ink">PNSM Command Center</p>
            <p className="mt-0.5 text-[10.5px] tracking-[0.09em] text-faint">
              WORKFORCE ATTENDANCE
            </p>
          </div>

          <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">Sign in</h2>
          <p className="mb-6 mt-1 text-[12.5px] text-muted">
            For HR and Super Admin accounts. Employees check in from the mobile app.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Field label="Work email" error={errors.email?.message}>
              <Input
                {...register('email')}
                type="email"
                autoComplete="username"
                placeholder="hr@company.com"
                invalid={!!errors.email}
              />
            </Field>

            <Field label="Password" error={errors.password?.message}>
              <Input
                {...register('password')}
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                invalid={!!errors.password}
              />
            </Field>

            {serverError ? (
              <p
                role="alert"
                className="rounded-sm border border-rejected/30 bg-rejected-soft px-3 py-2 text-[12px] font-medium text-rejected"
              >
                {serverError}
              </p>
            ) : null}

            <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
              <LogIn size={15} aria-hidden />
              Sign in
            </Button>

            {IS_DEMO ? (
              <div className="rounded-sm border border-line bg-canvas p-3">
                <p className="eyebrow mb-2">Demo accounts</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => useDemoAccount('hr@pnsm.test')}
                  >
                    HR / Admin
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => useDemoAccount('super@pnsm.test')}
                  >
                    Super Admin
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-faint">
                  Any password of six characters or more works in demo mode.
                </p>
              </div>
            ) : null}
          </form>
        </div>
      </section>
    </div>
  );
}
