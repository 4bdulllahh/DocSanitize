// DocSanitize service worker: makes the whole app work offline.
// Generated into out/sw.js by scripts/build-service-worker.mjs, which fills in VERSION and PRECACHE.
//
// Every file of the build is cached on install and served cache-first, so a version's pages and
// scripts always come from the same build. A new deployment installs alongside and waits; the page
// offers a reload, which posts "skip-waiting". The worker never sees file contents: files are opened
// with the File API and processed in memory, and nothing is sent anywhere.
//
// Add-ons (large optional parts such as the HEIC decoder, under /addons/) are not precached: they
// are cached the first time a tool asks for one, in a separate cache that survives updates, and
// entries a new build no longer ships are dropped when it activates.

const VERSION = "%VERSION%";
const PRECACHE = /* %PRECACHE% */ [];
const ADDONS = /* %ADDONS% */ [];
const PREFIX = "docsanitize-";
const CACHE = PREFIX + VERSION;
const ADDON_CACHE = PREFIX + "addons";
const BATCH = 24;

self.addEventListener("install", (event) => {
  event.waitUntil(
    precache().catch(async (error) => {
      await caches.delete(CACHE);
      throw error;
    }),
  );
});

async function precache() {
  const cache = await caches.open(CACHE);
  for (let i = 0; i < PRECACHE.length; i += BATCH) {
    await Promise.all(
      PRECACHE.slice(i, i + BATCH).map(async (url) => {
        const response = await fetch(url, { cache: "no-cache" });
        if (!response.ok) throw new Error(`Couldn't cache ${url} (${response.status})`);
        // A redirected response can't answer a navigation, so keep a clean copy.
        const clean = response.redirected
          ? new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers })
          : response;
        await cache.put(url, clean);
      }),
    );
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key !== CACHE && key !== ADDON_CACHE) await caches.delete(key);
      }
      const addons = await caches.open(ADDON_CACHE);
      for (const request of await addons.keys()) {
        if (!ADDONS.includes(new URL(request.url).pathname)) await addons.delete(request);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // HEAD: Next.js checks a page exists before prefetching it.
  if (request.method !== "GET" && request.method !== "HEAD") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(ADDONS.includes(url.pathname) ? addon(request, url) : respond(request, url));
});

async function addon(request, url) {
  const cache = await caches.open(ADDON_CACHE);
  const cached = await cache.match(url.pathname, { ignoreVary: true, ignoreMethod: true });
  if (cached) return request.method === "HEAD" ? new Response(null, { status: cached.status, headers: cached.headers }) : cached;
  const response = await fetch(request);
  if (request.method === "GET" && response.ok && response.type === "basic") await cache.put(url.pathname, response.clone());
  return response;
}

async function respond(request, url) {
  const cache = await caches.open(CACHE);
  if (request.mode === "navigate") {
    // Pages are cached under their folder URL: "/tools/merge/".
    let path = url.pathname;
    if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length);
    else if (!path.endsWith("/") && !path.slice(path.lastIndexOf("/")).includes(".")) path += "/";
    const page = await cache.match(path);
    if (page) return page;
    try {
      return await fetch(request);
    } catch {
      return (await cache.match("/404.html")) ?? Response.error();
    }
  }
  // Next.js adds a cache-busting ?_rsc= to page data requests; the files themselves don't vary.
  const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true, ignoreMethod: true });
  if (cached) {
    if (request.method === "HEAD") return new Response(null, { status: cached.status, statusText: cached.statusText, headers: cached.headers });
    if (!url.search && request.destination !== "worker") return cached;
    // A worker's `location` is its response's URL, and Turbopack's workers read their settings
    // from its #params= fragment, which a cached response's URL doesn't have. A new Response
    // takes on the full requested URL instead.
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers: cached.headers });
  }
  const response = await fetch(request);
  // Anything not precached (there shouldn't be much) is kept for next time.
  if (request.method === "GET" && response.ok && response.type === "basic") await cache.put(request, response.clone());
  return response;
}
