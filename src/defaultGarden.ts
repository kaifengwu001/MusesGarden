// A build for a garden of its own (VITE_DEFAULT_GARDEN=/api/muses/<id> vite build) opens on that garden: an address
// that names no garden, visit, studio or dev tools is given `?garden=` before anything reads it, so the page is the
// owner's view of that Muse's garden and travels from it as any garden page does. Imported first in main.ts.
const garden: unknown = import.meta.env.VITE_DEFAULT_GARDEN;
if (typeof garden === 'string' && garden) {
  const q = new URLSearchParams(location.search);
  if (!['garden', 'visit', 'studio', 'dev'].some((k) => q.has(k))) {
    const rest = q.toString();
    history.replaceState(history.state, '', `${location.pathname}?garden=${garden}${rest ? `&${rest}` : ''}${location.hash}`);
  }
}
