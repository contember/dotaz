/* coi-serviceworker v0.1.7 - github.com/gzuidhof/coi-serviceworker */
/* MIT license */
/* This service worker adds Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy
   headers to every response, enabling SharedArrayBuffer (required for sqlite-wasm). */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', function(event) {
	if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') {
		return
	}

	event.respondWith(
		fetch(event.request)
			.then(function(response) {
				if (response.status === 0) {
					return response
				}

				const newHeaders = new Headers(response.headers)
				newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin')
				newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp')
				newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin')

				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: newHeaders,
				})
			})
			.catch((e) => console.error(e)),
	)
})
