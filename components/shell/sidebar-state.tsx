"use client";

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import { useDevicePreference } from "./device-preferences";

export interface SidebarState {
  /** Hidden on desktop; on a phone the sidebar is the home screen and is never collapsed. */
  collapsed: boolean;
  /**
   * Shows or hides the sidebar. A toggle from the keyboard is `instant`: the
   * sidebar jumps rather than slides.
   */
  toggle: (options?: { instant?: boolean }) => void;
  /** True while the last toggle was instant, so the sidebar skips its transition. */
  instant: boolean;
}

const SidebarContext = createContext<SidebarState | null>(null);

/** Holds whether the sidebar is collapsed, remembered per device. */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [stored, store] = useDevicePreference("sidebar");
  const collapsed = stored === "collapsed";
  const [instant, setInstant] = useState(false);

  const toggle = useCallback(
    ({ instant = false }: { instant?: boolean } = {}) => {
      setInstant(instant);
      store(collapsed ? null : "collapsed");
    },
    [collapsed, store],
  );

  const value = useMemo(() => ({ collapsed, toggle, instant }), [collapsed, toggle, instant]);
  return <SidebarContext value={value}>{children}</SidebarContext>;
}

export function useSidebar(): SidebarState {
  const sidebar = use(SidebarContext);
  if (!sidebar) throw new Error("useSidebar needs a SidebarProvider");
  return sidebar;
}

/** The sidebar state when there is one: the top bar shows an expand button inside the shell only. */
export function useOptionalSidebar(): SidebarState | null {
  return use(SidebarContext);
}
