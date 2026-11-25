// Keeps the screen from turning off (a TV in the middle of a game, a phone while you play).
//
// 1. The Screen Wake Lock API, where the browser has it. It only exists on secure pages (https or localhost), so it is
//    missing on a plain http://192.168.x.x address.
// 2. Otherwise a tiny silent looping video, played from the first tap. This is the trick the NoSleep library uses. The
//    video is recorded in the browser at run time, so no video file is shipped. It is best effort: some TV browsers
//    ignore it, so also turn off the device's own screen timeout (see docs/PWA.md).
//
//   const wake = keepAwake();   wake.start();   wake.stop();   wake.mode()  // 'api', 'video' or 'none'
export function keepAwake() {
  let wanted = false;
  let lock = null;
  let video = null;
  let mode = 'none';
  let building = false;

  async function requestLock() {
    if (!('wakeLock' in navigator) || !wanted || document.visibilityState !== 'visible') return false;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
      mode = 'api';
      return true;
    } catch {
      return false;
    }
  }

  // A one second silent clip made from a canvas, played in a loop.
  async function buildVideo() {
    if (video || building || !window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return;
    building = true;
    try {
      const type = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
      if (!type) return;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const g = canvas.getContext('2d');
      const rec = new MediaRecorder(canvas.captureStream(10), { mimeType: type });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise((resolve) => (rec.onstop = resolve));
      rec.start();
      let n = 0;
      const paint = setInterval(() => { g.fillStyle = n++ % 2 ? '#000' : '#010101'; g.fillRect(0, 0, 16, 16); }, 100);
      await new Promise((r) => setTimeout(r, 1000));
      clearInterval(paint);
      rec.stop();
      await done;
      const v = document.createElement('video');
      v.setAttribute('playsinline', '');
      v.muted = true;
      v.loop = true;
      v.src = URL.createObjectURL(new Blob(chunks, { type }));
      // Not display:none: some browsers stop a hidden video, and then the screen sleeps again.
      Object.assign(v.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0.01', pointerEvents: 'none', left: '0', top: '0' });
      document.body.append(v);
      video = v;
    } catch {
      // not supported here
    } finally {
      building = false;
    }
  }

  async function playVideo() {
    if (!wanted || ('wakeLock' in navigator && lock)) return;
    await buildVideo();
    if (video && wanted) {
      try {
        await video.play();
        mode = 'video';
      } catch {
        // autoplay is blocked until the first tap: the listener below tries again
      }
    }
  }

  const retry = () => {
    if (!wanted) return;
    if (!lock) requestLock().then((ok) => ok || playVideo());
  };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && retry());
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, retry, { passive: true });

  return {
    start() {
      wanted = true;
      retry();
    },
    stop() {
      wanted = false;
      if (lock) lock.release().catch(() => {});
      lock = null;
      if (video) video.pause();
      mode = 'none';
    },
    mode: () => mode,
  };
}
