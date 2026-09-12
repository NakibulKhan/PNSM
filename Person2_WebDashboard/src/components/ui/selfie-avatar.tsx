/**
 * `Avatar` wired to `useSelfieUrl` (M2). A plain `useSelfieUrl()` call cannot
 * live inside a `.map()` callback or a TanStack Table `cell` render function —
 * neither gives React a stable per-row component identity, so the hook would
 * violate the rules of hooks the moment the row count changes between
 * renders. This component gives each row's Avatar its own identity via JSX
 * (`<SelfieAvatar key={log._id} .../>`), so the hook is safe to call here.
 */
import { Avatar } from './avatar';
import { useSelfieUrl } from '@/hooks/use-selfie-url';

export function SelfieAvatar({
  logId,
  selfieKey,
  name,
  size,
}: {
  logId: string;
  selfieKey: string | null | undefined;
  name: string;
  size?: number;
}) {
  const url = useSelfieUrl(logId, selfieKey);
  return <Avatar name={name} src={url} size={size} />;
}
