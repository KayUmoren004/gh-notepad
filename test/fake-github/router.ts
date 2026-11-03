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

/**
 * GitHub's pagination: `per_page` (default 30, at most 100) and `page` (from
 * 1) choose a slice, and a `Link` header points at the other pages in the
 * order GitHub sends them: prev, next, last, first.
 */
export function paginate<T>(items: readonly T[], url: URL): { items: T[]; headers: Headers } {
  const perPage = Math.min(100, positive(url.searchParams.get("per_page")) ?? 30);
  const page = positive(url.searchParams.get("page")) ?? 1;
  const lastPage = Math.max(1, Math.ceil(items.length / perPage));

  const link = (target: number, rel: string) => {
    const linked = new URL(url);
    linked.searchParams.set("page", String(target));
    return `<${linked}>; rel="${rel}"`;
  };
  const links = [
    ...(page > 1 ? [link(Math.min(page - 1, lastPage), "prev")] : []),
    ...(page < lastPage ? [link(page + 1, "next"), link(lastPage, "last")] : []),
    ...(page > 1 ? [link(1, "first")] : []),
  ];

  const headers = new Headers();
  if (links.length > 0) headers.set("link", links.join(", "));
  return { items: items.slice((page - 1) * perPage, page * perPage), headers };
}

function positive(value: string | null): number | undefined {
  const number = Number(value);
  return value !== null && Number.isInteger(number) && number > 0 ? number : undefined;
}
