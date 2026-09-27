// Development stand-in. `npm run build` replaces this file in out/ with the real service worker
// (scripts/build-service-worker.mjs).
//
// If a production build was ever served on this origin (say `npx serve out` on localhost:3000),
// its worker would keep serving that old build over `npm run dev`. The browser picks this file up
// as an update; it clears the old caches, unregisters itself and reloads the open pages.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("docsanitize-")) await caches.delete(key);
      }
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
    })(),
  );
});
