/**
 * Registers the service worker (src/pwa/sw.js, built to /sw.js) in production builds only: `vite dev` serves
 * no /sw.js, and a worker left over from a build would serve stale files during development.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      // The app works without it; only the offline page and the faster later visits are lost.
      console.warn('Service worker registration failed', error)
    })
  })
}
