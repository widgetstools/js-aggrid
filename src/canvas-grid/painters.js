// Canvas replacements for DOM cell renderers. A painter receives the 2D context (already clipped to
// the cell) and a params object: { x, y, width, height, value, text, node, column, colDef, theme }.

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Built-in replacement for `agSparklineCellRenderer`, driven by `cellRendererParams.sparklineOptions`.
export function sparklinePainter(ctx, p) {
  const values = Array.isArray(p.value) ? p.value.map(Number) : [];
  if (values.length < 2) return;
  const opts = p.colDef.cellRendererParams?.sparklineOptions ?? {};
  const type = opts.type ?? 'line';
  const stroke = opts.stroke ?? p.theme.accent;
  const padX = 6;
  const padY = Math.max(6, p.height * 0.2);
  const x0 = p.x + padX;
  const w = p.width - padX * 2;
  const y0 = p.y + padY;
  const h = p.height - padY * 2;
  const min = Math.min(0, ...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const yOf = (v) => y0 + h - ((v - min) / span) * h;

  if (type === 'bar' || type === 'column') {
    const bw = w / values.length;
    ctx.fillStyle = opts.fill ?? stroke;
    values.forEach((v, i) => {
      const top = yOf(v);
      ctx.fillRect(x0 + i * bw + 1, top, Math.max(1, bw - 2), yOf(min) - top);
    });
    return;
  }

  const step = w / (values.length - 1);
  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(x0 + i * step, yOf(v)) : ctx.moveTo(x0, yOf(v))));
  if (type === 'area') {
    ctx.save();
    ctx.lineTo(x0 + w, y0 + h);
    ctx.lineTo(x0, y0 + h);
    ctx.closePath();
    ctx.fillStyle = opts.fill ?? stroke;
    ctx.globalAlpha = opts.fill ? 1 : 0.25;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    values.forEach((v, i) => (i ? ctx.lineTo(x0 + i * step, yOf(v)) : ctx.moveTo(x0, yOf(v))));
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = opts.strokeWidth ?? 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * Interactive painter: a row of buttons with clickable hit regions.
 *   buttons(params) -> [{ label, action, color?, disabled? }]
 *   onAction({ action, node, column, data, api, event })   click / keyboard handler
 *   keyboardAction(cell) -> action | null                   what Enter / Space triggers
 */
export function buttonsPainter({ buttons, onAction, keyboardAction }) {
  return {
    onAction,
    keyboardAction,
    paint(ctx, p) {
      const list = buttons(p) ?? [];
      const h = Math.min(26, p.height - 10);
      const y = p.y + (p.height - h) / 2;
      let x = p.x + p.theme.cellPadding - 6;
      ctx.font = `600 12px ${p.theme.fontFamily}`;
      ctx.textAlign = 'center';
      for (const b of list) {
        const w = ctx.measureText(b.label).width + 22;
        const color = b.color ?? p.theme.accent;
        const hovered = p.hovered === b.action && !b.disabled;
        roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 6);
        if (b.disabled) {
          ctx.strokeStyle = p.theme.border;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = p.theme.subtle;
        } else {
          ctx.fillStyle = color;
          ctx.globalAlpha = hovered ? 1 : 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#fff';
        }
        ctx.fillText(b.label, x + w / 2, y + h / 2 + 0.5);
        p.addHitRegion({ x, y, width: w, height: h, action: b.action, disabled: !!b.disabled });
        x += w + 6;
      }
    },
  };
}

// Factory for a "pill" badge painter, e.g. status columns.
export function pillPainter(palette) {
  return (ctx, p) => {
    if (!p.text) return;
    const colors = palette[p.text] ?? { bg: p.theme.chrome, fg: p.theme.text };
    ctx.font = `500 12px ${p.theme.fontFamily}`;
    const tw = ctx.measureText(p.text).width;
    const h = 22;
    const w = tw + 20;
    const x = p.x + p.theme.cellPadding;
    const y = p.y + (p.height - h) / 2;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = colors.bg;
    ctx.fill();
    ctx.fillStyle = colors.fg;
    ctx.textAlign = 'left';
    ctx.fillText(p.text, x + 10, y + h / 2 + 0.5);
  };
}
