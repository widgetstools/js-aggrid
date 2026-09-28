import { themeQuartz } from 'ag-grid-community';
import { getCanvasLayer } from '../canvas-grid/index.js';
import { heapMB, startFrameMeter } from './perf.js';

// Results survive tab / renderer switches so DOM and Canvas runs can be compared.
const results = [];

// Ten column archetypes, repeated across the grid. Values live in one Float32Array
// (rows × cols) instead of 40M object properties, read/written through valueGetter/valueSetter.
const TYPES = [
  { key: 'price', label: 'Price', width: 110, offset: 10, scale: 4990 },
  { key: 'change', label: 'Chg %', width: 90, offset: -10, scale: 20 },
  { key: 'heat', label: 'Heat', width: 80, offset: 0, scale: 100 },
  { key: 'volume', label: 'Volume', width: 95, offset: 0, scale: 5e6, int: true },
  { key: 'rating', label: 'Rating', width: 80, offset: 0, scale: 10, int: true },
  { key: 'bps', label: 'Spread', width: 90, offset: -300, scale: 600, int: true },
  { key: 'date', label: 'Maturity', width: 110, offset: 0, scale: 3650, int: true },
  { key: 'flag', label: 'Flag', width: 70, offset: 0, scale: 2, int: true },
  { key: 'bar', label: 'Fill', width: 120, offset: 0, scale: 100 },
  { key: 'ratio', label: 'Ratio', width: 85, offset: 0, scale: 3 },
];
const RATINGS = ['AAA', 'AA+', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'CC', 'D'];
const SECTORS = ['Energy', 'Materials', 'Industrials', 'Utilities', 'Healthcare', 'Financials', 'Technology', 'Telecom'];

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const HEAT = Array.from({ length: 101 }, (_, i) => `hsla(${Math.round(i * 1.2)}, 75%, 45%, 0.38)`);
const heatColor = (v) => HEAT[Math.max(0, Math.min(100, Math.round(v)))];
const DATES = Array.from({ length: 3651 }, (_, d) => new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10));

// Conditional-style classes. DOM mode styles them with CSS (style.css), canvas mode with these objects.
const CLASS_STYLES = {
  'st-strong': { fontWeight: 700 },
  'st-up': { color: '#16a34a' },
  'st-down': { color: '#dc2626' },
  'st-big': { fontWeight: 700, backgroundColor: 'rgba(245, 158, 11, 0.2)' },
  'st-band-low': { backgroundColor: 'rgba(148, 163, 184, 0.16)' },
  'st-band-high': { backgroundColor: 'rgba(37, 99, 235, 0.2)' },
  'st-good': { color: '#16a34a', fontWeight: 600 },
  'st-bad': { color: '#dc2626', fontWeight: 600 },
  'st-italic': { fontStyle: 'italic' },
  'st-muted': { color: '#94a3b8' },
  'st-row-alert': { backgroundColor: 'rgba(220, 38, 38, 0.1)' },
};

function barRenderer(p) {
  if (p.value == null) return '';
  const v = Math.round(p.value);
  return `<div class="st-bar"><span style="width:${v}%"></span><em>${v}%</em></div>`;
}

function barPainter(ctx, p) {
  if (p.value == null) return;
  const v = Math.max(0, Math.min(100, p.value));
  const barH = p.height * 0.56;
  ctx.fillStyle = 'rgba(37, 99, 235, 0.38)';
  ctx.fillRect(p.x + 4, p.y + (p.height - barH) / 2, ((p.width - 8) * v) / 100, barH);
  ctx.font = `500 13px ${p.theme.fontFamily}`;
  ctx.fillStyle = p.theme.text;
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(v)}%`, p.x + p.width - 8, p.y + p.height / 2);
}

function generate(rows, cols) {
  const store = new Float32Array(rows * cols);
  const offset = new Float32Array(cols);
  const scale = new Float32Array(cols);
  const int = new Uint8Array(cols);
  for (let c = 0; c < cols; c++) {
    const t = TYPES[c % TYPES.length];
    offset[c] = t.offset;
    scale[c] = t.scale;
    int[c] = t.int ? 1 : 0;
  }
  let seed = 0x9e3779b9;
  for (let i = 0, n = rows * cols; i < n; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const c = i % cols;
    const v = offset[c] + ((seed >>> 0) / 4294967296) * scale[c];
    store[i] = int[c] ? Math.floor(v) : v;
  }
  const rowData = new Array(rows);
  for (let i = 0; i < rows; i++) {
    rowData[i] = { id: i, name: `Instrument ${i} · ${SECTORS[i % SECTORS.length]} · Series ${String.fromCharCode(65 + (i % 26))}` };
  }
  return { store, rowData };
}

function buildColumns(ctx) {
  const { cols } = ctx;
  const get = (c) => (p) => (p.data ? ctx.store[p.data.id * cols + c] : null);
  const set = (c) => (p) => {
    const n = Number(p.newValue);
    if (Number.isNaN(n)) return false;
    ctx.store[p.data.id * cols + c] = n;
    return true;
  };

  const specific = {
    price: { valueFormatter: (p) => (p.value == null ? '' : usd.format(p.value)), cellClassRules: { 'st-strong': (p) => p.value > 4500 }, enableCellChangeFlash: true },
    change: {
      valueFormatter: (p) => (p.value == null ? '' : `${p.value > 0 ? '+' : ''}${p.value.toFixed(2)}%`),
      cellClassRules: { 'st-up': (p) => p.value > 0, 'st-down': (p) => p.value < 0, 'st-big': (p) => Math.abs(p.value) > 7 },
      enableCellChangeFlash: true,
    },
    heat: { valueFormatter: (p) => (p.value == null ? '' : p.value.toFixed(1)), cellStyle: (p) => ({ backgroundColor: heatColor(p.value) }) },
    volume: {
      valueFormatter: (p) => (p.value == null ? '' : compact.format(p.value)),
      cellClassRules: { 'st-band-low': (p) => p.value < 1e6, 'st-band-high': (p) => p.value > 4e6 },
    },
    rating: {
      valueFormatter: (p) => (p.value == null ? '' : RATINGS[p.value] ?? ''),
      cellClassRules: { 'st-good': (p) => p.value <= 2, 'st-bad': (p) => p.value >= 7 },
      cellStyle: { textAlign: 'center' },
    },
    bps: {
      valueFormatter: (p) => (p.value == null ? '' : `${p.value > 0 ? '+' : ''}${p.value} bp`),
      cellClassRules: { 'st-down': (p) => p.value < 0, 'st-italic': (p) => Math.abs(p.value) < 20 },
    },
    date: { valueFormatter: (p) => (p.value == null ? '' : DATES[p.value] ?? ''), cellClassRules: { 'st-muted': (p) => p.value < 365 } },
    flag: {
      valueFormatter: (p) => (p.value == null ? '' : p.value ? '✓' : '✗'),
      cellClassRules: { 'st-up': (p) => p.value === 1, 'st-down': (p) => p.value === 0 },
      cellStyle: { textAlign: 'center' },
    },
    bar: { cellRenderer: barRenderer },
    ratio: {
      valueFormatter: (p) => (p.value == null ? '' : `${p.value.toFixed(2)}×`),
      cellClassRules: { 'st-italic': (p) => p.value < 1, 'st-strong': (p) => p.value > 2.5 },
    },
  };

  const groups = [];
  for (let g = 0; g < cols / TYPES.length; g++) {
    const children = [];
    for (let k = 0; k < TYPES.length; k++) {
      const c = g * TYPES.length + k;
      const t = TYPES[k];
      children.push({
        colId: `c${c}`,
        headerName: `${t.label} ${g + 1}`,
        width: t.width,
        valueGetter: get(c),
        valueSetter: set(c),
        cellDataType: 'number',
        editable: t.key !== 'bar',
        ...specific[t.key],
      });
    }
    groups.push({ headerName: `Block ${g + 1} · ${SECTORS[g % SECTORS.length]}`, children });
  }

  // Score = mean of the first five heat columns, pinned right with heat colouring
  const heatCols = Array.from({ length: Math.min(5, cols / TYPES.length) }, (_, g) => g * TYPES.length + 2);
  return [
    { headerName: 'ID', valueGetter: (p) => p.data?.id, colId: 'id', pinned: 'left', width: 90, cellDataType: 'number' },
    { field: 'name', headerName: 'Instrument', pinned: 'left', width: 200, filter: 'agTextColumnFilter', cellDataType: 'text' },
    ...groups,
    {
      colId: 'score',
      headerName: 'Score',
      pinned: 'right',
      width: 90,
      cellDataType: 'number',
      valueGetter: (p) => (p.data ? heatCols.reduce((s, c) => s + ctx.store[p.data.id * cols + c], 0) / heatCols.length : null),
      valueFormatter: (p) => (p.value == null ? '' : p.value.toFixed(1)),
      cellStyle: (p) => ({ backgroundColor: heatColor(p.value), fontWeight: 600 }),
    },
  ];
}

export function createStressDemo(container, { createGrid, renderer }) {
  container.style.cssText = 'display:flex;flex-direction:column;gap:10px;height:100%';
  container.innerHTML = `
    <div class="bench-bar">
      <label>Rows <select data-k="rows"><option>10000</option><option selected>100000</option></select></label>
      <label>Columns <select data-k="cols"><option>100</option><option selected>400</option></select></label>
      <label><input type="checkbox" data-k="compact" /> Compact rows</label>
      <label>Live updates <select data-k="updates"><option value="0">off</option><option value="1000" selected>1k cells / 100ms</option><option value="10000">10k cells / 100ms</option></select></label>
      <label>Auto-scroll <select data-k="scroll"><option value="off">off</option><option value="v" selected>vertical</option><option value="d">diagonal</option></select></label>
      <button class="bench-run">Measure 10s (${renderer})</button>
    </div>
    <div class="stress-stats"></div>
    <div class="bench-grid"></div>
    <div class="bench-results-wrap"><table class="bench-results"><thead><tr>
      <th>Renderer</th><th>Size</th><th>Updates</th><th>Scroll</th><th>Avg FPS</th><th>p95 frame</th>
      <th>Long tasks</th><th>Blocked ms</th><th>JS heap</th><th>Grid DOM nodes</th>
    </tr></thead><tbody></tbody></table></div>`;

  const $ = (sel) => container.querySelector(sel);
  const setting = (k) => $(`[data-k="${k}"]`);
  const gridEl = $('.bench-grid');
  const statsEl = $('.stress-stats');
  const ctx = { store: null, cols: 0, rows: 0 };
  let api;
  let buildInfo = '';
  let updateTimer = 0;
  let measuring = null;

  function renderResults() {
    $('.bench-results tbody').innerHTML =
      results
        .map(
          (r) => `<tr class="${r.renderer === 'canvas' ? 'is-canvas' : ''}"><td>${r.renderer}</td><td>${r.size}</td>
        <td>${r.updates}</td><td>${r.scroll}</td><td><b>${r.fps.toFixed(1)}</b></td><td>${r.p95.toFixed(1)} ms</td>
        <td>${r.longTasks}</td><td>${Math.round(r.blocked)}</td><td>${r.heap ?? '–'} MB</td><td>${r.nodes.toLocaleString()}</td></tr>`,
        )
        .join('') || '<tr><td colspan="10" class="bench-empty">No runs yet — measure once with DOM and once with Canvas (switch in the header).</td></tr>';
  }

  function scrollers() {
    return {
      v: renderer === 'canvas' ? gridEl.querySelector('.cg-scroller') : gridEl.querySelector('.ag-grid-viewport'),
      h: gridEl.querySelector('.ag-body-horizontal-scroll-viewport'),
    };
  }

  const dir = { v: 1, h: 1 };
  function autoScroll() {
    const mode = setting('scroll').value;
    if (mode === 'off') return;
    const { v, h } = scrollers();
    if (v) {
      v.scrollTop += 60 * dir.v;
      if (v.scrollTop + v.clientHeight >= v.scrollHeight - 1) dir.v = -1;
      else if (v.scrollTop <= 0) dir.v = 1;
    }
    if (mode === 'd' && h) {
      h.scrollLeft += 45 * dir.h;
      if (h.scrollLeft + h.clientWidth >= h.scrollWidth - 1) dir.h = -1;
      else if (h.scrollLeft <= 0) dir.h = 1;
    }
  }

  // Always-on meter drives auto-scroll and the live stats line.
  const live = startFrameMeter(() => {
    autoScroll();
  });
  const statsTimer = setInterval(() => {
    const draw = renderer === 'canvas' && api ? getCanvasLayer(api)?.stats.lastDrawMs : null;
    const heap = heapMB();
    statsEl.innerHTML = [
      `<b>${Math.round(live.recentFps(60))}</b> fps`,
      draw != null ? `canvas draw <b>${draw.toFixed(1)}</b> ms` : null,
      heap != null ? `JS heap <b>${heap}</b> MB` : null,
      `grid DOM nodes <b>${gridEl.querySelectorAll('*').length.toLocaleString()}</b>`,
      buildInfo,
    ]
      .filter(Boolean)
      .join(' · ');
  }, 500);

  function startUpdates() {
    clearInterval(updateTimer);
    const n = Number(setting('updates').value);
    if (!n) return;
    updateTimer = setInterval(() => {
      const { store, cols, rows } = ctx;
      const touched = new Set();
      for (let i = 0; i < n; i++) {
        const r = (Math.random() * rows) | 0;
        const c = (Math.random() * cols) | 0;
        const t = TYPES[c % TYPES.length];
        const idx = r * cols + c;
        if (t.key === 'price' || t.key === 'change' || t.key === 'heat' || t.key === 'bar' || t.key === 'ratio') {
          const drift = (Math.random() - 0.5) * t.scale * 0.02;
          store[idx] = Math.min(t.offset + t.scale, Math.max(t.offset, store[idx] + drift));
        } else if (t.key === 'volume' || t.key === 'bps') {
          store[idx] = Math.round(Math.min(t.offset + t.scale, Math.max(t.offset, store[idx] + (Math.random() - 0.5) * t.scale * 0.02)));
        }
        touched.add(ctx.rowData[r]);
      }
      api.applyTransactionAsync({ update: [...touched] });
    }, 100);
  }

  function buildGrid() {
    clearInterval(updateTimer);
    api?.destroy();
    api = null;
    statsEl.textContent = 'Generating data…';
    // Let the "Generating" message paint before the synchronous generation blocks the thread.
    setTimeout(() => {
      const rows = Number(setting('rows').value);
      const cols = Number(setting('cols').value);
      const t0 = performance.now();
      const { store, rowData } = generate(rows, cols);
      Object.assign(ctx, { store, rowData, rows, cols });
      const genMs = performance.now() - t0;

      const t1 = performance.now();
      api = createGrid(
        gridEl,
        {
          theme: themeQuartz,
          columnDefs: buildColumns(ctx),
          rowData,
          getRowId: (p) => String(p.data.id),
          rowHeight: setting('compact').checked ? 28 : undefined,
          defaultColDef: { filter: 'agNumberColumnFilter', sortable: true, resizable: true },
          valueCache: true,
          asyncTransactionWaitMillis: 50,
          suppressColumnMoveAnimation: true,
          cellSelection: { handle: { mode: 'fill' } },
          rowClassRules: { 'st-row-alert': (p) => p.data && ctx.store[p.data.id * ctx.cols + 1] < -9 },
          sideBar: { toolPanels: ['columns', 'filters'], defaultToolPanel: '' },
          statusBar: {
            statusPanels: [
              { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
              { statusPanel: 'agAggregationComponent' },
            ],
          },
          onFirstDataRendered: () => {
            buildInfo = `${(rows * cols / 1e6).toFixed(0)}M cells generated in <b>${Math.round(genMs)}</b> ms · grid ready in <b>${Math.round(performance.now() - t1)}</b> ms`;
          },
        },
        {
          classStyles: CLASS_STYLES,
          painters: Object.fromEntries(
            Array.from({ length: cols / TYPES.length }, (_, g) => [`c${g * TYPES.length + 8}`, barPainter]),
          ),
        },
      );
      startUpdates();
    }, 30);
  }

  function measure() {
    if (measuring) return;
    const button = $('.bench-run');
    button.textContent = 'Measuring…';
    button.disabled = true;
    measuring = startFrameMeter((now, elapsed) => {
      if (elapsed < 10000) return;
      const stats = measuring.stop();
      measuring = null;
      results.push({
        renderer,
        size: `${(ctx.rows / 1000).toFixed(0)}k × ${ctx.cols}${setting('compact').checked ? ' compact' : ''}`,
        updates: setting('updates').selectedOptions[0].textContent,
        scroll: setting('scroll').selectedOptions[0].textContent,
        ...stats,
        heap: heapMB(),
        nodes: gridEl.querySelectorAll('*').length,
      });
      renderResults();
      button.textContent = `Measure 10s (${renderer})`;
      button.disabled = false;
    });
  }

  ['rows', 'cols', 'compact'].forEach((k) => setting(k).addEventListener('change', buildGrid));
  setting('updates').addEventListener('change', startUpdates);
  $('.bench-run').addEventListener('click', measure);
  renderResults();
  buildGrid();

  return {
    hint: `
      <strong>Stress test:</strong> up to 100k rows × 400 columns (40M cells in a <code>Float32Array</code>) across 40 column
      groups — currency, % change, heat-map <code>cellStyle</code>, compact volume bands, ratings, spreads, dates, flags, data bars
      and ratios, each with <code>cellClassRules</code>, plus a <code>rowClassRules</code> alert tint, pinned columns and live
      updates. Switch <strong>DOM / Canvas</strong> in the header and press <em>Measure</em> for each.`,
    destroy: () => {
      clearInterval(updateTimer);
      clearInterval(statsTimer);
      live.stop();
      measuring?.stop();
      api?.destroy();
    },
  };
}
