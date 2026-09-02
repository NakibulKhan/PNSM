import { cn, hueFromString, initials } from '@/lib/utils';

/**
 * Identity marker. Reference photos live in S3 behind CloudFront and may be absent
 * (or unreachable on a bad link), so the fallback is deterministic: the same
 * person always gets the same tint, which makes the feed scannable.
 */
export function Avatar({
  name,
  src,
  size = 32,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const hue = hueFromString(name);

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cn('shrink-0 rounded-full border border-line object-cover', className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border font-semibold',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        backgroundColor: `hsl(${hue} 42% 93%)`,
        borderColor: `hsl(${hue} 34% 82%)`,
        color: `hsl(${hue} 46% 32%)`,
      }}
    >
      {initials(name)}
    </span>
  );
}
