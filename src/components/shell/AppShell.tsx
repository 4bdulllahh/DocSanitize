"use client";

import { useState } from "react";
import { useUnloadWarning } from "@/hooks/useFileInputs";
import { useWorkspaceStore } from "@/store/workspace";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { Toaster } from "./Toaster";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hasOpenFiles = useWorkspaceStore((s) => s.files.length > 0);
  useUnloadWarning(hasOpenFiles);

  return (
    <div className="flex min-h-dvh flex-col">
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <div className="flex flex-1">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
