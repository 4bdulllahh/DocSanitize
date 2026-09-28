"use client";

import { useEffect, useState } from "react";
import { useUnloadWarning } from "@/hooks/useFileInputs";
import { syncLocaleFromDocument } from "@/store/locale";
import { useWorkspaceStore } from "@/store/workspace";
import { Header } from "./Header";
import { ServiceWorker } from "./ServiceWorker";
import { Sidebar } from "./Sidebar";
import { Toaster } from "./Toaster";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hasOpenFiles = useWorkspaceStore((s) => s.files.length > 0);
  useUnloadWarning(hasOpenFiles);
  // Load the language LOCALE_INIT_SCRIPT chose (English needs nothing).
  useEffect(syncLocaleFromDocument, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <div className="flex flex-1">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <Toaster />
      <ServiceWorker />
    </div>
  );
}
