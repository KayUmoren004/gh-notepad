import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Pages for developing and end-to-end testing components on their own. They
 * exist in `next dev`, and in a production build only with `ENABLE_DEV_ROUTES=1`
 * (set by the Playwright run); anywhere else they are a 404.
 */
export default async function DevLayout({ children }: LayoutProps<"/dev">) {
  await connection();
  if (process.env.NODE_ENV !== "development" && process.env.ENABLE_DEV_ROUTES !== "1") notFound();
  return children;
}
