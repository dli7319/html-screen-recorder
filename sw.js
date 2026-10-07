(function() {
	//#region src/sw-core.ts
	/**
	* Service worker logic, free of side effects so it can be unit tested.
	*
	* sw.ts holds the listeners and the two build-time placeholders; everything
	* with a rule worth testing lives here.
	*/
	/** Files the worker caches up front so the first offline visit works. */
	function parsePrecache(input) {
		const list = typeof input === "string" ? JSON.parse(input) : input;
		if (!Array.isArray(list) || list.length === 0) throw new Error("precache manifest is empty or not an array");
		if (!list.every((e) => typeof e === "string" && e.length > 0)) throw new Error("precache manifest must be an array of non-empty strings");
		return list;
	}
	/**
	* The cache name for a given build.
	*
	* Distinct per deploy, which is the entire mechanism for not serving last
	* month's app forever: a new build gets a new cache name, `activate` deletes
	* every other cache, and the new worker has already fetched fresh copies into
	* the new one. Old and new content never mix.
	*/
	function cacheName(version) {
		if (!version || version.includes("__")) throw new Error("cache version was not injected by build-sw.mjs");
		return `screen-recorder-${version}`;
	}
	/** True when a cached entry from a previous build should be dropped. */
	function isStaleCache(key, current) {
		return key.startsWith("screen-recorder-") && key !== current;
	}
	/**
	* Whether this worker should answer a request at all.
	*
	* Cross-origin and non-GET requests are left alone: caching a third-party
	* response would be a privacy leak, and caching a POST is meaningless.
	*/
	function shouldHandle(request) {
		if (request.method !== "GET") return false;
		try {
			const origin = request.origin ?? self.location.origin;
			if (new URL(request.url).origin !== origin) return false;
		} catch {
			return false;
		}
		return true;
	}
	//#endregion
	//#region src/sw.ts
	/**
	* Service worker.
	*
	* Two jobs: make the app work offline, and let it update. The rules live in
	* sw-core.ts so they can be unit tested; this file is the wiring.
	*
	* ## Why the cache name carries a content hash
	*
	* The shell is served cache-first, which means a stale cache is a permanently
	* stale app. Naming the cache after the hash of the files it holds makes that
	* structurally impossible rather than a matter of discipline - see cacheName()
	* in sw-core.ts. Each deploy produces a differently named cache, `activate`
	* deletes every other one, and the new worker has already fetched fresh copies
	* into its own. Old and new content never mix.
	*
	* scripts/build-sw.mjs computes the hash and swaps the two placeholders below
	* after rolldown has compiled this file. They are string literals rather than
	* free identifiers so no minifier can rename them away.
	*
	* ## Why nothing reloads automatically
	*
	* The usual polish is skipWaiting + reload on controllerchange. This is a
	* screen recorder: takes live in memory as blob URLs and an in-flight
	* recording is destroyed by a reload. pwa.ts surfaces a "new version" banner
	* instead and the user picks the moment.
	*/
	const PRECACHE_MANIFEST = ["./index.html","./index.js","./styles.css","./tailwind.css","./icons.svg","./manifest.json","./fonts/roboto-latin.woff2","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-512-maskable.png","./icons/apple-touch-icon.png"];
	const CACHE_VERSION = "85e736fe1d63";
	const PRECACHE = parsePrecache(PRECACHE_MANIFEST);
	const CACHE = cacheName(CACHE_VERSION);
	self.addEventListener("message", (event) => {
		if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
	});
	self.addEventListener("install", (event) => {
		event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
	});
	self.addEventListener("activate", (event) => {
		event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => isStaleCache(key, CACHE)).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
	});
	self.addEventListener("fetch", (event) => {
		const request = event.request;
		if (!shouldHandle({
			method: request.method,
			url: request.url
		})) return;
		if (request.mode === "navigate") {
			event.respondWith(caches.match("./index.html").then((cached) => cached ?? fetch(request)));
			return;
		}
		event.respondWith(caches.match(request).then((cached) => {
			const network = fetch(request).then((response) => {
				if (response && response.ok && response.type === "basic") {
					const copy = response.clone();
					caches.open(CACHE).then((cache) => cache.put(request, copy));
				}
				return response;
			}).catch(() => cached);
			return cached ?? network;
		}));
	});
	//#endregion
})();
