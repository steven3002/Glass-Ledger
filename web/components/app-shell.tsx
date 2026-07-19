"use client";

/** The frame: every surface sits inside the dashboard shell — the left rail and a header. */

import type { ReactNode } from "react";

import { LoadingBar } from "./loading-bar";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Outside the header on purpose — the header's backdrop-blur would become the containing
          block for anything fixed inside it, and the bar would end up the width of the header. */}
      <LoadingBar />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
