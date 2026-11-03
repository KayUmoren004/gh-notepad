import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { TryAgainButton } from "./try-again-button";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

/**
 * Precached by the service worker (app/sw.ts) and shown in place of any page
 * that can't open without a connection.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-safe">
      <div className="flex w-full max-w-sm animate-enter flex-col items-center gap-6 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <WifiOff className="size-5" aria-hidden="true" />
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-balance">You&apos;re offline</h1>
          <p className="text-pretty text-muted-foreground">
            This page needs a connection. Once you&apos;ve opened your notes on this device while online, they open
            without one too.
          </p>
        </div>

        <TryAgainButton />
      </div>
    </main>
  );
}
