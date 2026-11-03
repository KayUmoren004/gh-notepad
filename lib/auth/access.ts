/**
 * Who may sign in (ADR 0004): the owner and the logins in the allow list.
 * GitHub logins are case-insensitive; a leading `@` is tolerated.
 */
export interface AccessList {
  allows: (login: string) => boolean;
}

export function accessList(owner: string, allowed: string = ""): AccessList {
  const logins = new Set([owner, ...allowed.split(/[\s,]+/)].map(normalize).filter(Boolean));
  return { allows: (login) => logins.has(normalize(login)) };
}

function normalize(login: string): string {
  return login.trim().replace(/^@/, "").toLowerCase();
}
