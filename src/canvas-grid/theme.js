// Reads AG Grid's Theming API CSS variables and converts them into values the canvas can use.
// Colours are resolved through a probe element (so `color-mix()` etc. are computed by the browser)
// and normalised to rgba() by painting a single pixel.

const COLOR_VARS = {
  background: '--ag-background-color',
  foreground: '--ag-foreground-color',
  text: '--ag-cell-text-color',
  subtle: '--ag-subtle-text-color',
  border: '--ag-border-color',
  oddRow: '--ag-odd-row-background-color',
  hover: '--ag-row-hover-color',
  selectedRow: '--ag-selected-row-background-color',
  rangeBg: '--ag-range-selection-background-color',
  rangeBorder: '--ag-range-selection-border-color',
  chartRange: '--ag-range-selection-chart-background-color',
  chartCategory: '--ag-range-selection-chart-category-background-color',
  accent: '--ag-accent-color',
  chrome: '--ag-chrome-background-color',
  flash: '--ag-value-change-value-highlight-background-color',
  findMatch: '--ag-find-match-background-color',
  findActive: '--ag-find-active-match-background-color',
  checkboxChecked: '--ag-checkbox-checked-background-color',
  checkboxUnchecked: '--ag-checkbox-unchecked-border-color',
};

let pixelCtx;
function normalizeColor(color) {
  pixelCtx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  pixelCtx.clearRect(0, 0, 1, 1);
  pixelCtx.fillStyle = '#000';
  pixelCtx.fillStyle = color;
  pixelCtx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = pixelCtx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

export function resolveTheme(wrapperEl) {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;';
  wrapperEl.appendChild(probe);

  const colors = {};
  for (const [key, cssVar] of Object.entries(COLOR_VARS)) {
    probe.style.color = `var(${cssVar})`;
    colors[key] = normalizeColor(getComputedStyle(probe).color);
  }

  // Measure the real cell font and padding from a detached-looking cell inside the themed wrapper
  const row = document.createElement('div');
  row.className = 'ag-row';
  const cell = document.createElement('div');
  cell.className = 'ag-cell';
  row.appendChild(cell);
  probe.appendChild(row);
  const cellStyle = getComputedStyle(cell);

  const indentProbe = document.createElement('div');
  indentProbe.style.width = 'var(--ag-row-group-indent-size)';
  probe.appendChild(indentProbe);

  const theme = {
    ...colors,
    fontFamily: cellStyle.fontFamily,
    fontSize: parseFloat(cellStyle.fontSize) || 14,
    fontWeight: cellStyle.fontWeight || '400',
    cellPadding: parseFloat(cellStyle.paddingLeft) || 16,
    groupIndent: indentProbe.offsetWidth || 28,
  };
  probe.remove();
  return theme;
}

export function font(theme, weight = theme.fontWeight, style = 'normal') {
  return `${style} ${weight} ${theme.fontSize}px ${theme.fontFamily}`;
}
