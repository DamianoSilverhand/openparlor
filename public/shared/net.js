// WebSocket with automatic reconnect.
export function connect({ onMessage, onOpen, onClose }) {
  let ws;
  let delay = 400;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => {
      delay = 400;
      onOpen && onOpen();
    };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      onClose && onClose();
      setTimeout(open, delay);
      delay = Math.min(delay * 1.6, 4000);
    };
  };
  open();
  return {
    send(obj) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    },
  };
}
