import "server-only";

/**
 * Shared helpers for Google OAuth and Calendar/People HTTP errors: parsing
 * bodies, classifying failures, and retry/backoff for rate limits.
 */

export type GoogleIntegrationErrorCode =
  | "missing_config"
  | "not_connected"
  | "oauth_refresh"
  | "oauth_exchange"
  | "rate_limit"
  | "auth"
  | "google_api"
  | "unknown";

/** Thrown when the OAuth token endpoint returns a fatal error (e.g. invalid_grant). */
export class GoogleOAuthTokenError extends Error {
  constructor(
    message: string,
    readonly oauthError: string,
    /** When true, stored refresh token is unusable — user must reconnect. */
    readonly shouldClearStoredToken: boolean,
    readonly userFacingCode: GoogleIntegrationErrorCode,
  ) {
    super(message);
    this.name = "GoogleOAuthTokenError";
  }
}

export interface ClassifiedGoogleError {
  code: GoogleIntegrationErrorCode;
  /** Safe to show in UI / API responses */
  message: string;
  httpStatus?: number;
  retryAfterMs?: number;
}

function randomJitterMs(max = 400): number {
  return Math.floor(Math.random() * max);
}

export function parseRetryAfterHeader(res: Response): number | undefined {
  const raw = res.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : undefined;
  }
  return undefined;
}

/** OAuth token endpoint returns JSON: { error, error_description }. */
export function parseOAuthTokenErrorBody(body: string): { error: string; description: string } {
  const trimmed = body.trim();
  if (!trimmed) return { error: "unknown", description: "Empty response from Google token endpoint" };
  try {
    const j = JSON.parse(trimmed) as { error?: string; error_description?: string };
    return {
      error: j.error ?? "unknown",
      description: (j.error_description ?? trimmed).slice(0, 500),
    };
  } catch {
    return { error: "parse_error", description: trimmed.slice(0, 500) };
  }
}

export function oauthTokenErrorToUserMessage(parsed: { error: string; description: string }): string {
  switch (parsed.error) {
    case "invalid_grant":
      return "Google Calendar access expired or was revoked. Disconnect and connect Google Calendar again.";
    case "invalid_client":
      return "Google OAuth client configuration is invalid. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.";
    case "unauthorized_client":
      return "This app is not allowed to refresh Google tokens. Verify OAuth client settings in Google Cloud Console.";
    case "invalid_request":
      return `Google rejected the token request: ${parsed.description}`;
    case "access_denied":
      return "Google denied access. Try connecting again and approve all requested permissions.";
    default:
      return `Google token error (${parsed.error}): ${parsed.description}`;
  }
}

export function throwIfOAuthRefreshFailed(res: Response, body: string): void {
  if (res.ok) return;
  const parsed = parseOAuthTokenErrorBody(body);
  const shouldClear = parsed.error === "invalid_grant";
  throw new GoogleOAuthTokenError(
    oauthTokenErrorToUserMessage(parsed),
    parsed.error,
    shouldClear,
    "oauth_refresh",
  );
}

export function throwIfOAuthCodeExchangeFailed(res: Response, body: string): void {
  if (res.ok) return;
  const parsed = parseOAuthTokenErrorBody(body);
  throw new GoogleOAuthTokenError(
    oauthTokenErrorToUserMessage(parsed),
    parsed.error,
    false,
    "oauth_exchange",
  );
}

/** Calendar / People APIs often return { error: { code, message, errors: [...] } }. */
export function summarizeGoogleJsonApiError(body: string, status: number): string {
  const trimmed = body.trim();
  if (!trimmed) return `Google API request failed (${status})`;
  try {
    const j = JSON.parse(trimmed) as {
      error?: { message?: string; code?: number; status?: string } | string;
      error_description?: string;
    };
    if (typeof j.error === "object" && j.error?.message) {
      return j.error.message;
    }
    if (typeof j.error === "string") {
      return j.error_description ? `${j.error}: ${j.error_description}` : j.error;
    }
  } catch {
    // fall through
  }
  return trimmed.slice(0, 400);
}

export function classifyGoogleCalendarResponse(res: Response, body: string): ClassifiedGoogleError {
  const status = res.status;
  const retryAfterMs = parseRetryAfterHeader(res);
  const summary = summarizeGoogleJsonApiError(body, status);

  if (status === 401) {
    return {
      code: "auth",
      message: "Google rejected the calendar request (session expired). Try syncing again or reconnect Google Calendar.",
      httpStatus: status,
    };
  }
  if (status === 403) {
    return {
      code: "google_api",
      message: `Google Calendar API denied access: ${summary}`,
      httpStatus: status,
    };
  }
  if (status === 429) {
    return {
      code: "rate_limit",
      message:
        "Google Calendar rate limit reached. Wait a minute and try again, or sync less often.",
      httpStatus: status,
      retryAfterMs,
    };
  }
  if (status >= 500 && status <= 599) {
    return {
      code: "google_api",
      message: `Google Calendar is temporarily unavailable (${status}). Try again shortly.`,
      httpStatus: status,
      retryAfterMs,
    };
  }
  return {
    code: "google_api",
    message: summary || `Google Calendar request failed (${status})`,
    httpStatus: status,
    retryAfterMs,
  };
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function isRetryableGoogleCalendarStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

export class GoogleCalendarHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly classified: ClassifiedGoogleError,
  ) {
    super(message);
    this.name = "GoogleCalendarHttpError";
  }
}

export interface FetchWithRetryOptions {
  maxAttempts?: number;
  /** Label for server logs */
  label?: string;
}

/**
 * GET JSON from a Google API with retries for rate limits and transient errors.
 * Does not retry 401 — caller should refresh the token and retry the whole operation.
 */
export async function fetchGoogleGetWithRetry(
  url: string,
  headers: Record<string, string>,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? 5;
  const label = options.label ?? "Google API";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });

    if (res.ok) return res;

    if (res.status === 401 || !isRetryableGoogleCalendarStatus(res.status)) {
      return res;
    }

    const bodyText = await res.text().catch(() => "");
    const retryAfterMs =
      parseRetryAfterHeader(res) ?? Math.min(60_000, 1000 * 2 ** (attempt - 1) + randomJitterMs());
    console.warn(
      `[${label}] HTTP ${res.status}, retry ${attempt}/${maxAttempts} in ${Math.round(retryAfterMs)}ms — ${bodyText.slice(0, 120)}`,
    );

    if (attempt >= maxAttempts) {
      return new Response(bodyText, { status: res.status, statusText: res.statusText, headers: res.headers });
    }

    await new Promise((r) => setTimeout(r, retryAfterMs));
  }

  return new Response("", { status: 599, statusText: "Client exhausted retries" });
}

export function throwIfCalendarErrorResponse(res: Response, body: string): void {
  if (res.ok) return;
  const classified = classifyGoogleCalendarResponse(res, body);
  throw new GoogleCalendarHttpError(classified.message, res.status, classified);
}
