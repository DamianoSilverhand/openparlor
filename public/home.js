const note = document.getElementById('addr');

document.getElementById('host').onclick = async () => {
  try {
    const r = await fetch('/api/room', { method: 'POST' });
    const data = await r.json();
    if (!r.ok || !data.code) {
      note.textContent = data.error || 'Could not start a room. Try again.';
      return;
    }
    location.href = '/tv?room=' + data.code;
  } catch {
    note.textContent = 'Could not reach the server. Check your connection.';
  }
};

fetch('/api/info').then((r) => r.json()).then((i) => {
  note.textContent = 'Phones can find this at ' + i.base.replace('http://', '');
}).catch(() => {});
