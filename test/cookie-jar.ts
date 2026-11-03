/**
 * A browser's cookie store, reduced to what route-handler tests need: keep
 * what responses set, send it back on the next request, and read it the way
 * Next's `cookies()` does (`get(name)?.value`).
 */
export class CookieJar {
  private readonly cookies = new Map<string, { value: string; attributes: string[] }>();

  /** Applies a response's `Set-Cookie` headers, including deletions. */
  store(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...rest] = line.split(";").map((part) => part.trim());
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const attributes = rest.map((attribute) => attribute.toLowerCase());
      const maxAge = attributes.find((attribute) => attribute.startsWith("max-age="));
      const expires = rest.find((attribute) => attribute.toLowerCase().startsWith("expires="));
      const expired =
        value === "" ||
        (maxAge !== undefined && Number(maxAge.slice("max-age=".length)) <= 0) ||
        (expires !== undefined && Date.parse(expires.slice("expires=".length)) <= Date.now());
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, { value, attributes });
    }
  }

  /** The `Cookie` request header for everything in the jar. */
  header(): string {
    return [...this.cookies].map(([name, { value }]) => `${name}=${value}`).join("; ");
  }

  get(name: string): { name: string; value: string } | undefined {
    const cookie = this.cookies.get(name);
    return cookie && { name, value: cookie.value };
  }

  /** Every cookie as last set, with its lowercased attributes (`httponly`, `samesite=lax`, …). */
  all(): { name: string; value: string; attributes: string[] }[] {
    return [...this.cookies].map(([name, cookie]) => ({ name, ...cookie }));
  }
}
