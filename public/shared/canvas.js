// Drawing canvas helpers shared by the phone (drawer) and the TV (viewer).
// Strokes use normalised coordinates: x and y are both 0..1 of the canvas width and height.
export const W = 1200;
export const H = 900;
export const BG = '#fffdf7';
export const COLORS = ['#1d1a17', '#e8472b', '#f28c38', '#f2b632', '#6baa4f', '#2e9c9c', '#6fb3e0', '#3e5c99', '#f29bb5', '#8a5a3c'];
export const SIZES = [0.006, 0.014, 0.03];

export function prepare(canvas) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  blank(ctx);
  return ctx;
}

export function blank(ctx) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
}

// Draw the part of a stroke from point index `from` onwards.
export function drawStroke(ctx, st, from = 0) {
  const pts = st.p;
  if (!pts.length) return;
  ctx.strokeStyle = st.c;
  ctx.fillStyle = st.c;
  ctx.lineWidth = st.s * W;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * W, pts[0][1] * H, (st.s * W) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const start = Math.max(0, from - 1);
  if (from <= 1 && pts.length > 1) {
    // Make sure the very first point gets its round cap even for a short line.
    ctx.beginPath();
    ctx.arc(pts[0][0] * W, pts[0][1] * H, (st.s * W) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(pts[start][0] * W, pts[start][1] * H);
  for (let i = start + 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * W, pts[i][1] * H);
  ctx.stroke();
}

export function redraw(ctx, strokes) {
  blank(ctx);
  for (const st of strokes) drawStroke(ctx, st);
}
