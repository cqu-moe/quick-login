import type { ErrorCode } from "../shared/contracts";

export class SyncError extends Error {
  constructor(
    public readonly code: ErrorCode | "COOKIE_WRITE_TRANSIENT" | "COOKIE_PERMISSION_DENIED",
    public readonly retryAfterMs: number | null = null
  ) {
    super(code);
  }
}

export async function responseError(response: Response): Promise<SyncError> {
  const body = await response.clone().json().catch(() => null) as {
    error?: { code?: ErrorCode; retryAfterMs?: number };
  } | null;
  const code = body?.error?.code ?? "TEMPORARY_UNAVAILABLE";
  const retryHeader = response.headers.get("Retry-After");
  const retryAfterMs = body?.error?.retryAfterMs ??
    (retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) * 1_000 : null);
  return new SyncError(code, retryAfterMs);
}

export function isRetryable(error: unknown): boolean {
  return error instanceof SyncError &&
    (error.code === "TEMPORARY_UNAVAILABLE" ||
     error.code === "RATE_LIMITED" ||
     error.code === "COOKIE_WRITE_TRANSIENT");
}

export async function retryBounded<T>(
  operation: () => Promise<T>,
  onWait: (nextAttemptAt: number) => Promise<void>,
  delays = [1_000, 3_000]
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || attempt >= delays.length) throw error;
      const delay = error instanceof SyncError && error.retryAfterMs !== null
        ? Math.max(error.retryAfterMs, delays[attempt])
        : delays[attempt];
      const nextAttemptAt = Date.now() + delay;
      await onWait(nextAttemptAt);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}
