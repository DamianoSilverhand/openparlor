// WebSocket with automatic reconnect: exponential back-off with a little randomness, an immediate retry when the
// network or the page comes back (a phone waking up), a heartbeat that notices a dead connection, and a small banner so
// people know why nothing is happening.
import { t } from '/shared/i18n.js';

const MIN_DELAY = 400;
const MAX_DELAY = 5000;
const PING_EVERY = 15000;
const PONG_WITHIN = 7000;

export function connect({ onMessage, onOpen, onClose, banner = true }) {
  let ws = null;
  let delay = MIN_DELAY;
  let retryTimer = null;
  let pingTimer = null;
  let pongTimer = null;
  let everOpened = false;
  let up = false;
  let bannerEl = null;
  let bannerTimer = null;

  const showBanner = (text) => {
    if (!banner) return;
    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.className = 'net-banner';
      bannerEl.setAttribute('role', 'status');
      document.body.append(bannerEl);
    }
    bannerEl.textContent = text;
  };
  const hideBanner = () => {
    clearTimeout(bannerTimer);
    bannerTimer = null;
    if (bannerEl) bannerEl.remove();
    bannerEl = null;
  };
  // A short blip should not flash a banner, so it appears after a moment.
  const scheduleBanner = () => {
    if (!banner || bannerTimer || bannerEl) return;
    bannerTimer = setTimeout(() => {
      bannerTimer = null;
      showBanner(navigator.onLine === false ? t('net.offline') : t('net.reconnecting'));
    }, everOpened ? 1200 : 3000);
  };

  const stopHeartbeat = () => {
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
    pingTimer = pongTimer = null;
  };
  const heartbeat = () => {
    stopHeartbeat();
    pingTimer = setInterval(() => {
      if (!ws || ws.readyState !== 1) return;
      ws.send('{"t":"ping"}');
      clearTimeout(pongTimer);
      pongTimer = setTimeout(() => ws && ws.close(), PONG_WITHIN); // no answer: the connection is dead, so reconnect
    }, PING_EVERY);
  };

  const open = () => {
    clearTimeout(retryTimer);
    retryTimer = null;
    if (ws && ws.readyState <= 1) return; // already connecting or connected
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws = socket;
    socket.onopen = () => {
      delay = MIN_DELAY;
      everOpened = true;
      up = true;
      hideBanner();
      heartbeat();
      onOpen && onOpen();
    };
    socket.onmessage = (e) => {
      clearTimeout(pongTimer);
      const m = JSON.parse(e.data);
      if (m.t !== 'pong') onMessage(m);
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      stopHeartbeat();
      if (up) onClose && onClose();
      up = false;
      scheduleBanner();
      retryTimer = setTimeout(open, delay + Math.random() * 250);
      delay = Math.min(delay * 1.7, MAX_DELAY);
    };
  };

  // The network or the page is back: do not wait for the next timer.
  const retryNow = () => {
    if (ws && ws.readyState === 1) {
      ws.send('{"t":"ping"}'); // confirm the connection still works after the page was asleep
      clearTimeout(pongTimer);
      pongTimer = setTimeout(() => ws && ws.close(), PONG_WITHIN);
    } else {
      delay = MIN_DELAY;
      open();
    }
  };
  window.addEventListener('online', retryNow);
  window.addEventListener('offline', () => { if (!up) showBanner(t('net.offline')); });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && retryNow());
  window.addEventListener('pageshow', retryNow);

  open();
  return {
    send(obj) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    },
    isUp: () => up,
  };
}
