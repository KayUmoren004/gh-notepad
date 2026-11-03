import type { FakeState } from "./state";

/** What an endpoint handler receives. */
export interface RouteContext {
  request: Request;
  url: URL;
  /** `:name` segments of the route path, decoded; a trailing `*` is `params["*"]`. */
  params: Record<string, string>;
  state: FakeState;
}

export interface FakeRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** e.g. `/user`, `/repos/:owner/:repo/git/trees/:sha`, `/repos/:owner/:repo/contents/*` */
  path: string;
  handle: (context: RouteContext) => Response | Promise<Response>;
}

export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  const params: Record<string, string> = {};

  for (let index = 0; index < patternParts.length; index++) {
    const part = patternParts[index];
    if (part === "*") {
      params["*"] = pathParts.slice(index).map(decodeURIComponent).join("/");
      return params;
    }
    const segment = pathParts[index];
    if (segment === undefined) return null;
    if (part.startsWith(":")) params[part.slice(1)] = decodeURIComponent(segment);
    else if (part !== segment) return null;
  }

  return patternParts.length === pathParts.length ? params : null;
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** GitHub's REST error body: `{ message, documentation_url, status }`. */
export function apiError(status: number, message: string, init: ResponseInit = {}): Response {
  return json(
    { message, documentation_url: "https://docs.github.com/rest", status: String(status) },
    { ...init, status },
  );
}

export function html(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(body, { ...init, headers });
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
