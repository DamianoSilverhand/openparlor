// Registers the service worker, but only where browsers allow one: https pages and localhost. On a plain
// http://192.168.x.x address this does nothing and the app works as before. Import it from every page's script.
if ('serviceWorker' in navigator && window.isSecureContext) {
  const register = () => navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker not registered:', err.message));
  // This module can finish loading after the page's load event, so do not wait for an event that already happened.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}
