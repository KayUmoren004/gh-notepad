"use client";

import { useEffect, useState } from "react";
import { UpdatePrompt } from "@/components/update-prompt";

/** Served by app/serwist/[path]/route.ts from app/sw.ts. */
const SCRIPT_URL = "/serwist/sw.js";
/** Browsers look for a new version on each full page load; the app stays open for hours, so it also looks hourly. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registers the service worker that lets the app open offline, and offers each
 * new version with the update prompt. Production builds only: in development
 * any worker on this origin (say, from a local production build) is removed so
 * it can't serve stale pages. Tests that don't need it block it in the browser.
 */
export function AppServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;

    if (process.env.NODE_ENV !== "production") {
      void container.getRegistrations().then((registrations) => registrations.forEach((r) => void r.unregister()));
      return;
    }

    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    let lastCheck = Date.now();
    // A page the worker didn't serve (a first visit, or one it claimed mid-load) asks it to store the page.
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const servedByWorker = (navigation?.workerStart ?? 0) > 0;

    // An installed worker waiting behind a controlling one is a new version.
    const offerWhenWaiting = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const offer = () => {
        if (active && worker.state === "installed" && container.controller) {
          setWaiting(worker);
          setDismissed(false);
        }
      };
      worker.addEventListener("statechange", offer);
      offer();
    };

    const register = async () => {
      if (!active) return;
      // Blocked or unsupported (it fails, or, blocked by Playwright, resolves to nothing): the app still works online.
      const registered: ServiceWorkerRegistration | undefined = await container
        .register(SCRIPT_URL, { scope: "/", updateViaCache: "none" })
        .catch(() => undefined);
      if (!registered || !active) return;
      registration = registered;
      offerWhenWaiting(registered.waiting);
      offerWhenWaiting(registered.installing);
      registered.addEventListener("updatefound", () => offerWhenWaiting(registered.installing));

      if (!servedByWorker) {
        const ready = await container.ready;
        ready.active?.postMessage({ type: "CACHE_URLS", payload: { urlsToCache: [location.pathname + location.search] } });
      }
    };

    const checkForUpdate = () => {
      if (!registration || document.visibilityState !== "visible") return;
      if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
      lastCheck = Date.now();
      registration.update().catch(() => {}); // Offline: try again later.
    };

    // Registering after `load` keeps precaching from competing with the page's own requests.
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", () => void register(), { once: true });
    document.addEventListener("visibilitychange", checkForUpdate);
    const timer = setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", checkForUpdate);
      clearInterval(timer);
    };
  }, []);

  const reload = () => {
    // Another tab may have switched to the new version already.
    if (!waiting || waiting.state !== "installed") return location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  return <UpdatePrompt open={!!waiting && !dismissed} onReload={reload} onDismiss={() => setDismissed(true)} />;
}
