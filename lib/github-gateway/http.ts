import "server-only";

export const GITHUB_API_VERSION = "2026-03-10";

/** A GitHub failure: an HTTP status, plus GitHub's error code when it sent one. */
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** GitHub's OAuth error code, or `rate_limited`. */
    readonly code?: string,
    /** When GitHub said to try again, for rate limits. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface ApiRequest {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Media type; GitHub's JSON by default. */
  accept?: string;
  headers?: Record<string, string>;
}

/** Calls the REST API as one member; failures become `GitHubError`s. */
export type ApiCall = (path: string, request?: ApiRequest) => Promise<Response>;

export function apiCaller(send: typeof fetch, apiBase: string, accessToken: string): ApiCall {
  return async (path, request = {}) => {
    const response = await send(`${apiBase}${path}`, {
      method: request.method ?? "GET",
      headers: {
        accept: request.accept ?? "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "gh-notepad",
        "x-github-api-version": GITHUB_API_VERSION,
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
        ...request.headers,
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    if (response.ok || response.status === 304) return response;
    throw await errorFrom(response);
  };
}

/** Maps a failed response to a `GitHubError`, recognising primary and secondary rate limits. */
export async function errorFrom(response: Response): Promise<GitHubError> {
  const message = await errorMessage(response);
  const retryAfter = Number(response.headers.get("retry-after"));
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const limited =
    response.status === 429 || (response.status === 403 && (remaining === "0" || /rate limit/i.test(message)));
  if (!limited) return new GitHubError(message, response.status);
  const wait = retryAfter > 0 ? retryAfter : reset > 0 ? Math.max(1, reset - Math.floor(Date.now() / 1000)) : 60;
  return new GitHubError(message, response.status, "rate_limited", wait);
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export async function errorMessage(response: Response): Promise<string> {
  try {
    const message = record(await response.json()).message;
    if (typeof message === "string") return message;
  } catch {
    // Not JSON; fall through to the status text.
  }
  return `GitHub answered ${response.status} ${response.statusText}`.trim();
}
