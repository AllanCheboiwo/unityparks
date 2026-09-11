import * as Sentry from "@sentry/nextjs";

export type LogContext = {
  bookingId?: string | null;
  reservationId?: string | null;
  userId?: string | null;
  route?: string;
};

/**
 * The one place errors are reported (LO-16, UNP-33). Always writes to the
 * console so Railway's log view keeps working; also sends to Sentry, which
 * is a no-op until a DSN is configured. Context is ids only. Never pass a
 * guest's email or name: the tags are searchable in Sentry and that would
 * make it a PII store.
 */
export function logError(message: string, err: unknown, context: LogContext = {}): void {
  console.error(message, context, err);
  const error = err instanceof Error ? err : new Error(String(err));
  Sentry.captureException(error, {
    tags: tagsFrom(context),
    extra: { message },
  });
}

function tagsFrom(context: LogContext): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value) tags[key] = value;
  }
  return tags;
}
