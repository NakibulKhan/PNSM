/** Copy is direction, not mood — say what happened and what to do. */
export function TileEmpty({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center">
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <p className="text-[12.5px] text-ink-faint">{message}</p>
    </div>
  );
}
