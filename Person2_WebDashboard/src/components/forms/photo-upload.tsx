/**
 * Reference-photo capture (FR-01).
 *
 * The full pipeline, in the order it must happen:
 *   1. validate type and size in the browser, so a bad file fails instantly;
 *   2. compress to under 200 KB in a web worker, so the UI never freezes and a
 *      15 MB phone photo never touches a congested uplink;
 *   3. ask Express for a presigned S3 URL, so the IAM keys stay on the server;
 *   4. PUT the compressed file straight to S3, so the image never transits the
 *      API container and no body-size limit applies;
 *   5. hand the resulting public URL up to the form, which sends it to Person 3
 *      with the rest of the employee record.
 *
 * Each step reports its own state, because on a slow link the user needs to know
 * which one they are waiting for.
 */
import { useRef, useState } from 'react';
import { UploadCloud, CheckCircle2, RefreshCw, ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { compressReferencePhoto } from '@/lib/compress';
import { putToPresignedUrl, requestUploadUrl } from '@/api/uploads';
import { validateImageFile } from '@/schemas';
import { formatBytes } from '@/lib/format';
import { MAX_UPLOAD_MB } from '@/lib/constants';
import { cn } from '@/lib/utils';

type Phase = 'idle' | 'compressing' | 'uploading' | 'done' | 'error';

export function PhotoUpload({
  value,
  onChange,
  error,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>(value ? 'done' : 'idle');
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sizes, setSizes] = useState<{ before: number; after: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    setPhase('idle');
    setMessage(null);
    setPreview(null);
    setSizes(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = async (file: File) => {
    const check = validateImageFile(file);
    if (!check.ok) {
      setPhase('error');
      setMessage(check.message);
      return;
    }

    try {
      setPhase('compressing');
      setMessage('Compressing the photo…');
      const result = await compressReferencePhoto(file);
      setSizes({ before: result.originalBytes, after: result.compressedBytes });

      if (!result.withinBudget) {
        setMessage(
          `Compressed to ${formatBytes(result.compressedBytes)}, above the ${MAX_UPLOAD_MB * 1000} KB target. Uploading anyway.`,
        );
      }

      // Local preview so HR can confirm the face is clear before saving.
      setPreview(URL.createObjectURL(result.file));

      setPhase('uploading');
      setMessage('Uploading to secure storage…');
      const presigned = await requestUploadUrl(result.file.type, result.file.size);

      if (presigned.mode === 's3' && presigned.uploadUrl) {
        await putToPresignedUrl(presigned.uploadUrl, result.file);
      }
      // In demo mode there is no bucket; the placeholder URL stands in.

      onChange(presigned.publicUrl);
      setPhase('done');
      setMessage(
        presigned.mode === 'demo'
          ? 'Stored locally for the demo. Connect the S3 bucket to upload for real.'
          : 'Uploaded to secure storage.',
      );
    } catch (uploadError) {
      setPhase('error');
      setMessage(
        uploadError instanceof Error
          ? uploadError.message
          : 'The upload did not complete. Try again.',
      );
    }
  };

  const busy = phase === 'compressing' || phase === 'uploading';

  return (
    <div>
      <span className="eyebrow mb-1.5 block">
        Reference profile photo <span className="text-rejected">*</span>
      </span>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        className={cn(
          'flex min-h-[196px] flex-col items-center justify-center gap-2 rounded-sm border border-dashed px-4 py-5 text-center transition-colors',
          dragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-canvas',
          (error || phase === 'error') && 'border-rejected bg-rejected-soft/40',
        )}
      >
        {preview ? (
          <img
            src={preview}
            alt="Reference photo preview"
            className="h-24 w-24 rounded-full border border-line object-cover"
          />
        ) : phase === 'error' ? (
          <ImageOff size={20} className="text-rejected" aria-hidden />
        ) : (
          <UploadCloud size={20} className="text-faint" aria-hidden />
        )}

        {phase === 'done' && !preview ? (
          <CheckCircle2 size={18} className="text-verified" aria-hidden />
        ) : null}

        <p className="text-[12.5px] font-semibold text-ink">
          {phase === 'done' ? 'Photo ready' : 'Upload reference profile photo'}
        </p>
        <p className="max-w-[240px] text-[11.5px] text-muted">
          {busy
            ? message
            : phase === 'done'
              ? (message ?? 'This photo becomes the biometric baseline.')
              : 'JPEG or PNG, face clearly visible and evenly lit. Compressed automatically before upload.'}
        </p>

        {sizes ? (
          <p className="tnum text-[11px] text-faint">
            {formatBytes(sizes.before)} → {formatBytes(sizes.after)}
          </p>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />

        <div className="mt-1 flex items-center gap-2">
          <Button
            type="button"
            variant={phase === 'done' ? 'secondary' : 'primary'}
            size="sm"
            loading={busy}
            onClick={() => inputRef.current?.click()}
          >
            {phase === 'done' ? 'Choose a different file' : 'Choose file'}
          </Button>
          {phase === 'done' || phase === 'error' ? (
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              <RefreshCw size={13} aria-hidden /> Clear
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mt-1 text-[11.5px] font-medium text-rejected">{error}</p> : null}
      {phase === 'error' && message ? (
        <p className="mt-1 text-[11.5px] font-medium text-rejected">{message}</p>
      ) : null}
    </div>
  );
}
