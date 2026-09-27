"use client";

import { useEffect } from "react";
import { toast } from "@/store/toast";

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Registers the offline service worker (out/sw.js, generated at build time; there is none in
 * development). When a new version has been downloaded, offers to reload into it.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    let reloadOnChange = false;
    let offered: ServiceWorker | null = null;
    let timer: number | undefined;

    const offerUpdate = (worker: ServiceWorker) => {
      // No controller yet means this is the first install, which isn't an update.
      if (!container.controller || offered === worker) return;
      offered = worker;
      toast(
        {
          tone: "info",
          title: "A new version of DocSanitize is ready",
          description: "Reload to start using it. Files you have open will need to be added again.",
          action: {
            label: "Reload now",
            onClick: () => {
              reloadOnChange = true;
              worker.postMessage("skip-waiting");
            },
          },
        },
        0,
      );
    };
    const onControllerChange = () => {
      if (reloadOnChange) window.location.reload();
    };
    container.addEventListener("controllerchange", onControllerChange);

    container
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (registration.waiting) offerUpdate(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed") offerUpdate(worker);
          });
        });
        // Long-lived tabs: look for a new version now and then (fails quietly when offline).
        timer = window.setInterval(() => registration.update().catch(() => {}), UPDATE_CHECK_MS);
      })
      .catch(() => {
        // Offline support is an extra; the app works the same without it.
      });

    return () => {
      container.removeEventListener("controllerchange", onControllerChange);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
