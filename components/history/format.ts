import type { Session } from "@/lib/history";

const numbers = new Intl.NumberFormat();
const plural = new Intl.PluralRules("en");
const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const sameYear = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const otherYear = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/** "Today", "Yesterday", "Mon 3 Nov" this year, "3 Nov 2025" before. */
export function dayLabel(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return at.getFullYear() === now.getFullYear() ? sameYear.format(at) : otherYear.format(at);
}

/** "14:02" (or "2:02 PM", as the device writes times). */
export function timeLabel(iso: string): string {
  return time.format(new Date(iso));
}

/** "Today 14:02". */
export function whenLabel(iso: string, now = new Date()): string {
  return `${dayLabel(iso, now)} ${timeLabel(iso)}`;
}

/** "1 change", "3 changes", "1,024 changes". */
export function changesLabel(count: number): string {
  return `${numbers.format(count)} ${plural.select(count) === "one" ? "change" : "changes"}`;
}

/** "13 unchanged lines" for a folded gap in a diff. */
export function hiddenLinesLabel(count: number): string {
  return `${numbers.format(count)} unchanged ${plural.select(count) === "one" ? "line" : "lines"}`;
}

/** The session's label in the list: when its last version was made, and how many it holds. */
export function sessionLabel(session: Session, now = new Date()): string {
  return `${whenLabel(session.latest, now)} · ${changesLabel(session.versions.length)}`;
}
