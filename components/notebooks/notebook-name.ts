/**
 * The name of a shared notebook, as the member types it, turned into the name
 * of the repository it becomes: GitHub repository names allow letters, digits,
 * `.`, `-` and `_` only, so spaces become hyphens and the rest is dropped; it
 * is lowercased too, the way the app names notebooks everywhere. The app shows
 * the member what will be created, and explains what it can't.
 */

/** The personal notebook's repository name, which a shared notebook can't take. */
const PERSONAL = "my-notes";
const MAX_LENGTH = 100;

export interface NotebookNameCheck {
  /** The repository name the typed name becomes; `""` when nothing usable was typed. */
  slug: string;
  /** Why `slug` can't be created, for the member; `null` when it can (or nothing was typed yet). */
  problem: string | null;
}

export function notebookSlug(typed: string): string {
  return typed
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

export function checkNotebookName(typed: string): NotebookNameCheck {
  const slug = notebookSlug(typed);
  if (slug === "") {
    return { slug, problem: typed.trim() === "" ? null : "Use letters, digits, '.', '-' or '_'" };
  }
  if (slug.toLowerCase() === PERSONAL) return { slug, problem: `${PERSONAL} is your personal notebook` };
  if (slug.toLowerCase().endsWith(".git")) return { slug, problem: "A name can't end in .git" };
  if (slug.length > MAX_LENGTH) return { slug, problem: `Keep it to ${MAX_LENGTH} characters` };
  return { slug, problem: null };
}

/** GitHub's rule for a username being invited: letters, digits and single hyphens, not at either end, at most 39. */
const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** The GitHub username typed in an invite field (a leading `@` and spaces forgiven), or `null` if it can't be one. */
export function usernameToInvite(typed: string): string | null {
  const candidate = typed.trim().replace(/^@/, "");
  return USERNAME.test(candidate) ? candidate : null;
}
