import { setPortalToken } from './api';

/** Виджет в портале. Локальное демо этот режим не включает. */
export const widgetMode = import.meta.env.VITE_APP_MODE === 'widget';

/** Слушает токен только от origin портала. В память, не в storage. */
export function listenPortal() {
  const origin = import.meta.env.VITE_PORTAL_ORIGIN;
  if (!widgetMode || !origin || window.parent === window) return;

  window.addEventListener('message', (event) => {
    if (event.origin !== origin) return;
    const data = event.data as { type?: string; accessToken?: string } | null;
    if (!data || data.type !== 'visual-paths:auth') return;
    const token = data.accessToken;
    if (typeof token !== 'string' || token.length < 20 || token.length > 8192) return;
    setPortalToken(token);
  });

  window.parent.postMessage({ type: 'visual-paths:ready' }, origin);
}
