"use client";

import { Button } from "@/components/ui/button";

/** Reloads the address the member asked for; this page stands in for it while offline. */
export function TryAgainButton() {
  return (
    <Button size="lg" className="h-11 w-full px-5 text-base" onClick={() => location.reload()}>
      Try again
    </Button>
  );
}
