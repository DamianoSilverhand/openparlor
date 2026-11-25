// Browser storage keys all start with "op:". Older versions used "fgn:", so on first load the old values are copied to the
// new names and the old keys are removed (the saved name, animal, level, mute setting and room seats keep working).
const OLD = 'fgn:';
const NEW = 'op:';

try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(OLD)) continue;
    const next = NEW + key.slice(OLD.length);
    if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key));
    localStorage.removeItem(key);
  }
} catch {
  // storage is blocked: nothing to migrate
}
