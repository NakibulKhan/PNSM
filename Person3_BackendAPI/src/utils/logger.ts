/**
 * Deliberately dependency-free. A foundation phase shouldn't add a logging
 * library's own configuration surface on top of everything else — this can
 * be swapped for pino/winston later without touching call sites, since every
 * call site goes through this one module.
 */
type LogFields = Record<string, unknown> | undefined;

/**
 * Redacts credentials embedded in a connection-string-shaped substring
 * (e.g. `mongodb+srv://user:password@cluster...`, an R2/S3 endpoint URL
 * with inline credentials). Applied to every logged string as a blanket
 * safeguard — driver/library error messages sometimes echo back the full
 * URI they failed to connect to, and MONGODB_URI specifically carries a
 * real secret. This is defense-in-depth on top of "never log a secret
 * value directly" at each call site, not a substitute for it.
 */
function redact(value: string): string {
  return value.replace(/:\/\/([^/@\s:]+):([^/@\s]+)@/g, '://***:***@');
}

function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)]));
  }
  return value;
}

function line(level: string, message: string, fields?: LogFields): string {
  const payload = {
    level,
    time: new Date().toISOString(),
    message: redact(message),
    ...(redactDeep(fields ?? {}) as Record<string, unknown>),
  };
  return JSON.stringify(payload);
}

export const logger = {
  info(message: string, fields?: LogFields): void {
    // eslint-disable-next-line no-console
    console.log(line('info', message, fields));
  },
  warn(message: string, fields?: LogFields): void {
    // eslint-disable-next-line no-console
    console.warn(line('warn', message, fields));
  },
  error(message: string, err?: unknown, fields?: LogFields): void {
    const errFields =
      err instanceof Error
        ? { errorMessage: redact(err.message), stack: err.stack ? redact(err.stack) : undefined }
        : err !== undefined
          ? { error: redactDeep(err) }
          : {};
    // eslint-disable-next-line no-console
    console.error(line('error', message, { ...errFields, ...(fields ?? {}) }));
  },
};
