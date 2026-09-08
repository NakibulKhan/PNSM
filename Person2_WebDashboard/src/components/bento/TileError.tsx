/** No apologies, no personality — state what failed, in the anomaly signal colour. */
export function TileError({
  title = 'Unavailable',
  message = 'This will appear once the connection returns.',
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center">
      <p className="text-[13px] font-semibold text-anomaly">{title}</p>
      <p className="text-[12.5px] text-ink-faint">{message}</p>
    </div>
  );
}
