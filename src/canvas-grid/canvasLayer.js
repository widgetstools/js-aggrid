import { CellEditor } from './editor.js';
import { sparklinePainter } from './painters.js';
import { font, resolveTheme } from './theme.js';

const ROW_NUMBERS_COL = 'ag-Grid-RowNumbersColumn';
const SELECTION_COL = 'ag-Grid-SelectionColumn';
const AUTO_COL_PREFIX = 'ag-Grid-AutoColumn';
const FLASH_MS = 1000;
const CHEVRON_W = 20;

// Events after which value differences are caused by re-arranging rows, not data changes.
const NO_FLASH_EVENTS = new Set([
  'sortChanged', 'filterChanged', 'columnRowGroupChanged', 'columnPivotChanged',
  'columnPivotModeChanged', 'rowGroupOpened', 'expandOrCollapseAll', 'columnValueChanged',
  'newColumnsLoaded', 'rowDataUpdated', 'displayedColumnsChanged',
]);

const CSS = `
.cg-active .ag-grid-viewport { flex: 0 0 auto !important; height: var(--cg-header-h, 48px) !important; overflow: hidden !important; }
.cg-active .ag-grid-scrolling-rows, .cg-active .ag-grid-pinned-bottom-rows, .cg-active .ag-body-vertical-scroll { display: none !important; }
.cg-host { position: relative; flex: 1 1 0; min-height: 0; overflow: hidden; outline: none; }
.cg-canvas { position: absolute; left: 0; top: 0; }
.cg-scroller { position: absolute; inset: 0; overflow-x: hidden; overflow-y: auto; }
.cg-spacer { width: 1px; }
.cg-overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.cg-overlay > * { pointer-events: auto; }
.cg-editor { position: absolute; box-sizing: border-box; border: 2px solid; border-radius: 3px; outline: none; margin: 0; }
.cg-note { position: absolute; max-width: 260px; padding: 8px 10px; border-radius: 6px; font-size: 13px; line-height: 1.4;
  box-shadow: 0 6px 20px rgba(0,0,0,.25); border: 1px solid; white-space: pre-wrap; }
.cg-note b { display: block; margin-bottom: 2px; }
.cg-note textarea { display: block; width: 240px; height: 80px; font: inherit; color: inherit; background: transparent;
  border: 1px solid; border-radius: 4px; padding: 6px; box-sizing: border-box; resize: vertical; }
.cg-note .cg-note-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }
.cg-note button { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 4px; border: 1px solid; background: transparent; color: inherit; cursor: pointer; }
.cg-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

function injectStyles() {
  if (document.getElementById('cg-styles')) return;
  const style = document.createElement('style');
  style.id = 'cg-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
}

const sumWidths = (cols) => cols.reduce((sum, c) => sum + c.getActualWidth(), 0);

// Shifts relative A1 row references (e.g. "B3" -> "B4") so filled formulas behave like Excel.
function shiftFormulaRows(formula, delta) {
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (m, colAbs, col, rowAbs, row) =>
    rowAbs ? m : `${colAbs}${col}${rowAbs}${Math.max(1, Number(row) + delta)}`,
  );
}

/**
 * Paints AG Grid's rows onto a canvas while AG Grid keeps doing everything else: row model
 * (sort, filter, group, pivot, tree data, aggregation, formulas), headers, tool panels,
 * status bar, menus, exports and charts. Interaction on the cell area is reimplemented here
 * and pushed back into AG Grid through its public API.
 */
export class CanvasLayer {
  constructor(api, container, options = {}) {
    this.api = api;
    this.container = container;
    this.painters = options.painters ?? {};
    this.classStyles = options.classStyles ?? {};
    this.noteAuthor = options.noteAuthor ?? 'You';

    this.hoverRow = -1;
    this.focus = null; // { rowIndex, colId }
    this.rangeEnd = null; // keyboard range extension end
    this.drag = null;
    this.flashes = new Map();
    this.lastText = new Map();
    this.suppressFlash = true;
    this.textWidths = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.cleanups = [];
    this.editor = new CellEditor(this);
    this.frame = 0;
    this.destroyed = false;
    this.stats = { frames: 0, lastDrawMs: 0 };

    injectStyles();
    this.mount();
  }

  // ---------------------------------------------------------------- setup

  mount() {
    if (this.destroyed) return;
    const wrapper = this.container.querySelector('.ag-root-wrapper');
    const viewport = this.container.querySelector('.ag-grid-viewport');
    const header = this.container.querySelector('.ag-header');
    const hViewport = this.container.querySelector('.ag-body-horizontal-scroll-viewport');
    if (!wrapper || !viewport || !header || !hViewport) {
      requestAnimationFrame(() => this.mount());
      return;
    }
    Object.assign(this, { wrapper, viewport, header, hViewport });

    const host = document.createElement('div');
    host.className = 'cg-host';
    host.tabIndex = 0;
    host.setAttribute('role', 'application');
    host.setAttribute('aria-label', 'Data grid (canvas). Use arrow keys to move between cells, Enter to edit.');
    host.innerHTML = `
      <canvas class="cg-canvas"></canvas>
      <div class="cg-scroller"><div class="cg-spacer"></div></div>
      <div class="cg-overlay"></div>
      <div class="cg-sr-only" aria-live="polite"></div>`;
    viewport.after(host);
    this.host = host;
    this.canvas = host.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.scroller = host.querySelector('.cg-scroller');
    this.spacer = host.querySelector('.cg-spacer');
    this.overlay = host.querySelector('.cg-overlay');
    this.live = host.querySelector('.cg-sr-only');
    this.container.classList.add('cg-active');

    this.theme = resolveTheme(wrapper);

    const syncHeaderHeight = () =>
      this.container.style.setProperty('--cg-header-h', `${header.offsetHeight}px`);
    syncHeaderHeight();
    const ro = new ResizeObserver(() => {
      syncHeaderHeight();
      this.requestDraw();
    });
    ro.observe(header);
    ro.observe(host);
    this.cleanups.push(() => ro.disconnect());

    // Theme switches (light/dark) change CSS variables: re-resolve colours.
    const mo = new MutationObserver(() => {
      this.theme = resolveTheme(wrapper);
      this.textWidths.clear();
      this.requestDraw();
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-ag-theme-mode', 'class'] });
    mo.observe(wrapper, { attributes: true, attributeFilter: ['class', 'style'] });
    this.cleanups.push(() => mo.disconnect());

    const onGridEvent = (type) => this.onGridEvent(type);
    this.api.addGlobalListener(onGridEvent);
    this.cleanups.push(() => !this.api.isDestroyed() && this.api.removeGlobalListener(onGridEvent));

    this.listen(hViewport, 'scroll', () => this.requestDraw());
    this.listen(this.scroller, 'scroll', () => {
      this.hideNote();
      if (this.editor.active) this.editor.commit();
      this.requestDraw();
    });
    this.listen(this.scroller, 'wheel', (e) => this.onWheel(e), { passive: false });
    this.listen(this.scroller, 'pointerdown', (e) => this.onPointerDown(e));
    this.listen(this.scroller, 'pointermove', (e) => this.onPointerMove(e));
    this.listen(this.scroller, 'pointerup', (e) => this.onPointerUp(e));
    this.listen(this.scroller, 'pointerleave', () => this.onPointerLeave());
    this.listen(this.scroller, 'dblclick', (e) => this.onDoubleClick(e));
    this.listen(this.scroller, 'contextmenu', (e) => this.onContextMenu(e));
    this.listen(host, 'keydown', (e) => this.onKeyDown(e));
    this.listen(host, 'focus', () => this.requestDraw());
    this.listen(host, 'blur', () => this.requestDraw());

    this.requestDraw();
  }

  listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.cleanups.forEach((fn) => fn());
    this.host?.remove();
    this.container.classList.remove('cg-active');
  }

  onGridEvent(type) {
    if (type === 'gridPreDestroyed') {
      this.destroy();
      return;
    }
    if (NO_FLASH_EVENTS.has(type)) this.suppressFlash = true;
    if (type === 'findChanged') this.revealFindMatch();
    this.requestDraw();
  }

  /** Expands collapsed ancestors of the active Find match, then scrolls it into view. */
  revealFindMatch() {
    const match = this.api.findGetActiveMatch?.();
    if (!match?.node) return;
    for (let p = match.node.parent; p && p.level >= 0; p = p.parent) {
      if (!p.expanded) p.setExpanded(true);
    }
    // Expanding re-runs the row model; the match's rowIndex is valid on the next frame.
    requestAnimationFrame(() => {
      if (match.node.rowIndex != null) this.ensureVisible(match.node.rowIndex, match.column);
    });
  }

  // ---------------------------------------------------------------- model helpers

  get cellSelectionEnabled() {
    return !!this.api.getGridOption('cellSelection');
  }

  rowCount() {
    return this.api.getDisplayedRowCount();
  }

  rowTop(node, index) {
    return node.rowTop ?? index * (node.rowHeight ?? 42);
  }

  rowHeight(node) {
    return node.rowHeight ?? 42;
  }

  totalHeight() {
    const count = this.rowCount();
    if (!count) return 0;
    const last = this.api.getDisplayedRowAtIndex(count - 1);
    return this.rowTop(last, count - 1) + this.rowHeight(last);
  }

  /** Index of the displayed row covering content-space y (binary search on rowTop). */
  rowIndexAtContentY(y) {
    let lo = 0;
    let hi = this.rowCount() - 1;
    if (hi < 0) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const node = this.api.getDisplayedRowAtIndex(mid);
      if (this.rowTop(node, mid) <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Displayed columns that take part in navigation, ranges and paste (not row numbers / checkboxes). */
  allColumns() {
    return [
      ...this.api.getDisplayedLeftColumns(),
      ...this.api.getDisplayedCenterColumns(),
      ...this.api.getDisplayedRightColumns(),
    ].filter((c) => c.getColId() !== ROW_NUMBERS_COL && c.getColId() !== SELECTION_COL);
  }

  layout() {
    const width = this.scroller.clientWidth;
    const height = this.scroller.clientHeight;
    const left = this.api.getDisplayedLeftColumns();
    const center = this.api.getDisplayedCenterColumns();
    const right = this.api.getDisplayedRightColumns();
    const leftW = sumWidths(left);
    const rightW = sumWidths(right);
    const scrollLeft = this.hViewport.scrollLeft;
    const centerW = Math.max(0, width - leftW - rightW);
    return {
      width,
      height,
      leftW,
      rightW,
      centerW,
      scrollLeft,
      sections: [
        { cols: center, x: leftW, w: centerW, offset: leftW - scrollLeft },
        { cols: left, x: 0, w: leftW, offset: 0 },
        { cols: right, x: width - rightW, w: rightW, offset: width - rightW },
      ],
    };
  }

  sectionOf(column, L = this.L) {
    const pinned = column.getPinned();
    return pinned === 'left' ? L.sections[1] : pinned === 'right' ? L.sections[2] : L.sections[0];
  }

  /** Cell rectangle in host coordinates, or null when the row isn't displayed. */
  cellRect(rowIndex, column) {
    const L = this.L ?? this.layout();
    const node = this.api.getDisplayedRowAtIndex(rowIndex);
    if (!node || !column) return null;
    const s = this.sectionOf(column, L);
    return {
      x: s.offset + column.getLeft(),
      y: this.rowTop(node, rowIndex) - this.scroller.scrollTop,
      width: column.getActualWidth(),
      height: this.rowHeight(node),
      section: s,
    };
  }

  hitTest(x, y, clamp = false) {
    const L = this.L ?? this.layout();
    const count = this.rowCount();
    if (!count) return null;
    const contentY = y + this.scroller.scrollTop;
    if (!clamp && (contentY < 0 || contentY >= this.totalHeight())) return null;
    const rowIndex = Math.min(count - 1, Math.max(0, this.rowIndexAtContentY(contentY)));
    const node = this.api.getDisplayedRowAtIndex(rowIndex);

    let section;
    if (x < L.leftW) section = L.sections[1];
    else if (x >= L.width - L.rightW && L.rightW > 0) section = L.sections[2];
    else section = L.sections[0];
    const cols = section.cols.length ? section.cols : L.sections[0].cols;
    let column = cols.find((c) => {
      const cx = section.offset + c.getLeft();
      return x >= cx && x < cx + c.getActualWidth();
    });
    if (!column && clamp) column = x < section.x + section.w / 2 ? cols[0] : cols[cols.length - 1];
    if (!column) return null;
    const rect = this.cellRect(rowIndex, column);
    return { node, rowIndex, column, rect, localX: x - rect.x };
  }

  /** Painter for a column, normalised to `{ paint, onAction?, keyboardAction? }`. */
  painterFor(column) {
    const colId = column.getColId();
    let painter = this.painters[colId];
    if (!painter && column.getColDef().cellRenderer === 'agSparklineCellRenderer') painter = sparklinePainter;
    if (!painter) return null;
    return typeof painter === 'function' ? { paint: painter } : painter;
  }

  /** Topmost clickable region painted at (x, y) in the last frame. */
  hitRegionAt(x, y) {
    const regions = this.hitRegions ?? [];
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i];
      if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return r;
    }
    return null;
  }

  runAction(painter, action, node, column, event) {
    painter.onAction?.({ action, node, column, data: node.data, api: this.api, event });
    this.requestDraw();
  }

  getRawValue(node, column) {
    const field = column.getColDef().field;
    if (field && node.data) {
      return field.split('.').reduce((obj, key) => obj?.[key], node.data);
    }
    return this.api.getCellValue({ rowNode: node, colKey: column });
  }

  isEditable(node, column) {
    if (!node.data || node.footer || (node.group && !this.api.getGridOption('treeData'))) return false;
    const editable = column.getColDef().editable;
    if (typeof editable === 'function') {
      return !!editable({ node, data: node.data, column, colDef: column.getColDef(), api: this.api, context: this.api.getGridOption('context') });
    }
    return !!editable;
  }

  parseValue(node, column, oldValue, text) {
    const colDef = column.getColDef();
    if (colDef.allowFormula && text.startsWith('=')) return text;
    const numeric = typeof oldValue === 'number' || colDef.cellDataType === 'number';
    // Clipboard text is formatted ("6,400", "$1,200.50", "12%"); strip formatting before parsing.
    const cleaned = numeric ? String(text).replace(/[,$\s%×]/g, '') : text;
    // Includes the parser AG Grid adds for inferred cell data types.
    if (typeof colDef.valueParser === 'function') {
      const parsed = colDef.valueParser({ oldValue, newValue: cleaned, data: node.data, node, colDef, column, api: this.api, context: this.api.getGridOption('context') });
      return numeric && Number.isNaN(parsed) ? oldValue : parsed;
    }
    if (text === '') return null;
    if (numeric) {
      const n = Number(cleaned);
      return Number.isNaN(n) ? oldValue : n;
    }
    if (typeof oldValue === 'boolean') return text === 'true';
    return text;
  }

  // ---------------------------------------------------------------- styles

  evalRules(rules, params) {
    const style = {};
    for (const [cls, fn] of Object.entries(rules ?? {})) {
      if (typeof fn === 'function' && fn(params)) Object.assign(style, this.classStyles[cls]);
    }
    return style;
  }

  rowStyle(node) {
    const params = { node, data: node.data, rowIndex: node.rowIndex, api: this.api, context: this.api.getGridOption('context') };
    const style = this.evalRules(this.api.getGridOption('rowClassRules'), params);
    const getRowStyle = this.api.getGridOption('getRowStyle');
    if (getRowStyle) Object.assign(style, getRowStyle(params));
    return style;
  }

  cellStyle(node, column, value, rowStyle) {
    const colDef = column.getColDef();
    const params = { value, data: node.data, node, colDef, column, rowIndex: node.rowIndex, api: this.api, context: this.api.getGridOption('context') };
    // The row background is already painted once per row; cells only inherit its text styling.
    const { backgroundColor: _rowBg, ...rowText } = rowStyle;
    const style = { ...rowText, ...this.evalRules(colDef.cellClassRules, params) };
    const cs = typeof colDef.cellStyle === 'function' ? colDef.cellStyle(params) : colDef.cellStyle;
    if (cs) Object.assign(style, cs);
    return style;
  }

  // ---------------------------------------------------------------- drawing

  requestDraw() {
    if (this.frame || this.destroyed || !this.host) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  draw() {
    const t0 = performance.now();
    const L = this.layout();
    this.L = L;
    const { width, height } = L;
    if (!width || !height) return;

    const total = this.totalHeight();
    if (this.spacer.style.height !== `${total}px`) this.spacer.style.height = `${total}px`;

    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(width * dpr);
    const ch = Math.round(height * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    const ctx = this.ctx;
    const theme = this.theme;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = 'middle';

    // Visible rows
    const scrollTop = this.scroller.scrollTop;
    const rows = [];
    const count = this.rowCount();
    if (count) {
      for (let i = Math.max(0, this.rowIndexAtContentY(scrollTop)); i < count; i++) {
        const node = this.api.getDisplayedRowAtIndex(i);
        const y = this.rowTop(node, i) - scrollTop;
        if (y >= height) break;
        rows.push({ node, index: i, y, h: this.rowHeight(node), style: this.rowStyle(node) });
      }
    }

    const ranges = this.cellSelectionEnabled
      ? (this.api.getCellRanges() ?? []).map((r) => ({
          r0: Math.min(r.startRow?.rowIndex ?? 0, r.endRow?.rowIndex ?? 0),
          r1: Math.max(r.startRow?.rowIndex ?? 0, r.endRow?.rowIndex ?? 0),
          cols: new Set(r.columns.map((c) => c.getColId())),
          columns: r.columns,
          // Ranges linked to an integrated chart carry a type: 0 = value (series), 1 = dimension (category)
          chart: r.type === 1 ? 'category' : r.type === 0 ? 'value' : null,
        }))
      : [];
    const findActive = (this.api.findGetTotalMatches?.() ?? 0) > 0 ? this.api.findGetActiveMatch() : null;
    const findOn = (this.api.findGetTotalMatches?.() ?? 0) > 0;
    const notesOn = !!this.api.getGridOption('notesDataSource');
    const frame = { now: performance.now(), ranges, findOn, findActive, notesOn, flashing: false, section: null };
    this.hitRegions = [];

    for (const section of L.sections) {
      if (section.w > 0 && section.cols.length) this.drawSection(section, rows, frame);
    }

    // Pinned section separators
    ctx.fillStyle = theme.border;
    if (L.leftW) ctx.fillRect(L.leftW - 1, 0, 1, height);
    if (L.rightW) ctx.fillRect(L.width - L.rightW, 0, 1, height);

    this.drawRanges(ranges);
    this.drawFocus();
    this.drawFillPreview();

    this.suppressFlash = false;
    if (frame.flashing) this.requestDraw();
    this.stats.frames++;
    this.stats.lastDrawMs = performance.now() - t0;
  }

  drawSection(section, rows, frame) {
    const { ctx, theme } = this;
    frame.section = section;
    ctx.save();
    ctx.beginPath();
    ctx.rect(section.x, 0, section.w, this.L.height);
    ctx.clip();

    const cols = section.cols
      .map((c) => ({ column: c, x: section.offset + c.getLeft(), w: c.getActualWidth() }))
      .filter((c) => c.x + c.w > section.x && c.x < section.x + section.w);

    for (const row of rows) {
      const { node, y, h, style } = row;
      ctx.fillStyle = style.backgroundColor ?? (row.index % 2 ? theme.oddRow : theme.background);
      ctx.fillRect(section.x, y, section.w, h);
      if (node.isSelected()) {
        ctx.fillStyle = theme.selectedRow;
        ctx.fillRect(section.x, y, section.w, h);
      }
      if (row.index === this.hoverRow) {
        ctx.fillStyle = theme.hover;
        ctx.fillRect(section.x, y, section.w, h);
      }
      for (const c of cols) this.drawCell(row, c.column, c.x, y, c.w, h, frame);
    }

    ctx.fillStyle = theme.border;
    for (const row of rows) ctx.fillRect(section.x, row.y + row.h - 1, section.w, 1);
    ctx.restore();
  }

  drawCell(row, column, x, y, w, h, frame) {
    const { ctx, theme } = this;
    const { node } = row;
    const colId = column.getColId();
    const colDef = column.getColDef();
    const pad = theme.cellPadding;
    const midY = y + h / 2;

    if (colId === ROW_NUMBERS_COL) {
      ctx.fillStyle = theme.chrome;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = theme.border;
      ctx.fillRect(x + w - 1, y, 1, h);
      ctx.font = font(theme);
      ctx.fillStyle = theme.subtle;
      ctx.textAlign = 'center';
      ctx.fillText(String(row.index + 1), x + w / 2, midY);
      return;
    }

    if (colId === SELECTION_COL) {
      const sel = this.api.getGridOption('rowSelection');
      if (sel && typeof sel === 'object' && sel.checkboxes !== false && node.selectable !== false) {
        this.drawCheckbox(x + (w - 16) / 2, midY - 8, node.isSelected());
      }
      return;
    }

    const isAuto = colId.startsWith(AUTO_COL_PREFIX);
    const raw = isAuto ? node.key : this.api.getCellValue({ rowNode: node, colKey: column, transformValues: true });
    const style = this.cellStyle(node, column, raw, row.style);
    let text;
    if (isAuto) {
      text = this.groupText(node);
    } else {
      const formatted = this.api.getCellValue({ rowNode: node, colKey: column, useFormatter: true, transformValues: true });
      text = formatted == null ? '' : typeof formatted === 'object' ? '' : String(formatted);
    }

    // Change flashing: compare with what was last painted for this cell
    const key = `${node.id}|${colId}`;
    if (colDef.enableCellChangeFlash) {
      const prev = this.lastText.get(key);
      if (prev !== undefined && prev !== text && !this.suppressFlash) this.flashes.set(key, frame.now);
      this.lastText.set(key, text);
    }

    if (style.backgroundColor) {
      ctx.fillStyle = style.backgroundColor;
      ctx.fillRect(x, y, w, h);
    }
    if (frame.findOn && this.api.findGetNumMatches({ node, column }) > 0) {
      const active = frame.findActive?.node === node && frame.findActive?.column === column;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = active ? theme.findActive : theme.findMatch;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    const flashStart = this.flashes.get(key);
    if (flashStart !== undefined) {
      const age = frame.now - flashStart;
      if (age < FLASH_MS) {
        ctx.save();
        ctx.globalAlpha = 1 - age / FLASH_MS;
        ctx.fillStyle = theme.flash;
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        frame.flashing = true;
      } else {
        this.flashes.delete(key);
      }
    }
    for (const r of frame.ranges) {
      if (row.index >= r.r0 && row.index <= r.r1 && r.cols.has(colId)) {
        ctx.fillStyle = r.chart === 'category' ? theme.chartCategory : r.chart === 'value' ? theme.chartRange : theme.rangeBg;
        ctx.fillRect(x, y, w, h);
      }
    }

    const painter = this.painterFor(column);
    if (painter && !node.group && !node.footer) {
      const s = frame.section;
      const hovered = this.hoverRegion?.key === key ? this.hoverRegion.action : null;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      painter.paint(ctx, {
        x, y, width: w, height: h, value: raw, text, node, column, colDef, theme, api: this.api, hovered,
        // Clickable area inside the cell, clipped to the visible part of its pinned section
        addHitRegion: (r) => {
          const x0 = Math.max(r.x, x, s.x);
          const x1 = Math.min(r.x + r.width, x + w, s.x + s.w);
          if (x1 > x0) this.hitRegions.push({ ...r, x: x0, width: x1 - x0, key, node, column, painter });
        },
      });
      ctx.restore();
    } else if (isAuto) {
      this.drawGroupCell(node, text, x, y, w, h, style);
    } else if (text) {
      const align = style.textAlign ?? (typeof raw === 'number' ? 'right' : 'left');
      ctx.font = font(theme, style.fontWeight ?? theme.fontWeight, style.fontStyle);
      ctx.fillStyle = style.color ?? theme.text;
      const fitted = this.fitText(text, w - pad * 2);
      ctx.textAlign = align;
      ctx.fillText(fitted, align === 'right' ? x + w - pad : align === 'center' ? x + w / 2 : x + pad, midY);
    }

    if (frame.notesOn && !node.group && this.api.getNote({ rowNode: node, column })) {
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(x + w - 9, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + 9);
      ctx.closePath();
      ctx.fill();
    }
  }

  groupText(node) {
    if (node.footer) return node.level < 0 ? 'Total' : `Total ${node.key ?? ''}`;
    if (node.group) return node.key == null || node.key === '' ? '(Blanks)' : String(node.key);
    return this.api.getGridOption('treeData') ? String(node.key ?? '') : '';
  }

  drawGroupCell(node, text, x, y, w, h, style) {
    const { ctx, theme } = this;
    const indent = Math.max(0, node.level) * theme.groupIndent;
    const midY = y + h / 2;
    let tx = x + theme.cellPadding + indent;
    const expandable = node.group && !node.footer && (node.childrenAfterFilter?.length ?? 1) > 0;
    if (expandable) {
      this.drawChevron(tx + 6, midY, node.expanded);
    }
    if (node.group || this.api.getGridOption('treeData')) tx += CHEVRON_W;
    if (!text) return;

    ctx.font = font(theme, style.fontWeight ?? (node.footer ? 600 : theme.fontWeight));
    ctx.textAlign = 'left';
    ctx.fillStyle = style.color ?? theme.text;
    const count = node.group && !node.footer ? ` (${node.allChildrenCount ?? 0})` : '';
    const avail = x + w - theme.cellPadding - tx;
    const fitted = this.fitText(text, avail);
    ctx.fillText(fitted, tx, midY);
    if (count && fitted === text) {
      const cx = tx + this.measure(text);
      ctx.fillStyle = theme.subtle;
      ctx.fillText(this.fitText(count, x + w - theme.cellPadding - cx), cx, midY);
    }
  }

  drawChevron(cx, cy, expanded) {
    const { ctx, theme } = this;
    ctx.save();
    ctx.strokeStyle = theme.foreground;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (expanded) {
      ctx.moveTo(cx - 4, cy - 2);
      ctx.lineTo(cx, cy + 2);
      ctx.lineTo(cx + 4, cy - 2);
    } else {
      ctx.moveTo(cx - 2, cy - 4);
      ctx.lineTo(cx + 2, cy);
      ctx.lineTo(cx - 2, cy + 4);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawCheckbox(x, y, checked) {
    const { ctx, theme } = this;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, 15, 15, 3);
    if (checked) {
      ctx.fillStyle = theme.checkboxChecked;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 8);
      ctx.lineTo(x + 7, y + 11);
      ctx.lineTo(x + 12, y + 5);
      ctx.stroke();
    } else {
      ctx.strokeStyle = theme.checkboxUnchecked;
      ctx.lineWidth = 1;
      ctx.stroke();
      if (checked === undefined) {
        ctx.fillStyle = theme.checkboxChecked;
        ctx.fillRect(x + 4, y + 7, 8, 2);
      }
    }
  }

  /** Outline around each cell range, split per pinned section. */
  drawRanges(ranges) {
    const { ctx, theme, L } = this;
    ctx.strokeStyle = theme.rangeBorder;
    ctx.lineWidth = 1;
    this.fillHandle = null;
    const userRanges = ranges.filter((r) => !r.chart);
    userRanges.forEach((r, i) => {
      const top = this.cellRect(r.r0, r.columns[0]);
      const bottom = this.cellRect(r.r1, r.columns[0]);
      if (!top || !bottom) return;
      const y0 = top.y;
      const y1 = bottom.y + bottom.height;
      let handleRect = null;
      for (const s of L.sections) {
        const cols = r.columns.filter((c) => this.sectionOf(c) === s);
        if (!cols.length || !s.w) continue;
        const x0 = Math.min(...cols.map((c) => s.offset + c.getLeft()));
        const x1 = Math.max(...cols.map((c) => s.offset + c.getLeft() + c.getActualWidth()));
        ctx.save();
        ctx.beginPath();
        ctx.rect(s.x, 0, s.w, L.height);
        ctx.clip();
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
        ctx.restore();
        if (s === L.sections[2] || !handleRect || x1 > handleRect.x) handleRect = { x: x1, y: y1, s };
      }
      const handleMode = this.api.getGridOption('cellSelection')?.handle?.mode;
      if (i === userRanges.length - 1 && handleMode === 'fill' && handleRect) {
        const hx = Math.min(handleRect.x, handleRect.s.x + handleRect.s.w) - 4;
        const hy = handleRect.y - 4;
        ctx.fillStyle = theme.rangeBorder;
        ctx.fillRect(hx, hy, 7, 7);
        ctx.fillStyle = theme.background;
        ctx.fillRect(hx - 1, hy - 1, 1, 8);
        ctx.fillRect(hx - 1, hy - 1, 8, 1);
        this.fillHandle = { x: hx - 3, y: hy - 3, w: 13, h: 13, range: r };
      }
    });
  }

  drawFocus() {
    if (!this.focus || document.activeElement !== this.host) return;
    const column = this.api.getColumn(this.focus.colId);
    const rect = this.cellRect(this.focus.rowIndex, column);
    if (!rect) return;
    const { ctx, L } = this;
    const s = rect.section;
    ctx.save();
    ctx.beginPath();
    ctx.rect(s.x, 0, s.w, L.height);
    ctx.clip();
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
    ctx.restore();
  }

  drawFillPreview() {
    if (this.drag?.type !== 'fill' || this.drag.target == null) return;
    const { range, target } = this.drag;
    const from = target > range.r1 ? range.r1 + 1 : target;
    const to = target > range.r1 ? target : range.r0 - 1;
    if (to < from) return;
    const first = this.cellRect(from, range.columns[0]);
    const last = this.cellRect(to, range.columns[range.columns.length - 1]);
    if (!first || !last) return;
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = this.theme.rangeBorder;
    ctx.strokeRect(first.x + 0.5, first.y + 0.5, last.x + last.width - first.x - 1, last.y + last.height - first.y - 1);
    ctx.restore();
  }

  measure(text) {
    const key = `${this.ctx.font}\u0000${text}`;
    let w = this.textWidths.get(key);
    if (w === undefined) {
      w = this.ctx.measureText(text).width;
      if (this.textWidths.size > 20000) this.textWidths.clear();
      this.textWidths.set(key, w);
    }
    return w;
  }

  fitText(text, maxWidth) {
    if (maxWidth <= 0) return '';
    if (this.measure(text) <= maxWidth) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.measure(`${text.slice(0, mid)}…`) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return lo ? `${text.slice(0, lo)}…` : '';
  }

  // ---------------------------------------------------------------- scrolling

  onWheel(e) {
    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
    if (dx) {
      this.hViewport.scrollLeft += dx;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
    }
  }

  ensureVisible(rowIndex, column) {
    const node = this.api.getDisplayedRowAtIndex(rowIndex);
    if (!node) return;
    const top = this.rowTop(node, rowIndex);
    const bottom = top + this.rowHeight(node);
    const view = this.scroller.clientHeight;
    if (top < this.scroller.scrollTop) this.scroller.scrollTop = top;
    else if (bottom > this.scroller.scrollTop + view) this.scroller.scrollTop = bottom - view;

    if (column && !column.getPinned()) {
      const L = this.layout();
      const left = column.getLeft();
      const right = left + column.getActualWidth();
      if (left < L.scrollLeft) this.hViewport.scrollLeft = left;
      else if (right > L.scrollLeft + L.centerW) this.hViewport.scrollLeft = right - L.centerW;
    }
    this.requestDraw();
  }

  // ---------------------------------------------------------------- selection

  local(e) {
    const rect = this.host.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  setFocus(rowIndex, column) {
    this.focus = { rowIndex, colId: column.getColId() };
    const node = this.api.getDisplayedRowAtIndex(rowIndex);
    const name = this.api.getDisplayNameForColumn(column, 'header');
    const value = node ? this.api.getCellValue({ rowNode: node, colKey: column, useFormatter: true }) : '';
    const painter = this.painterFor(column);
    const action = node && painter?.keyboardAction
      ? (typeof painter.keyboardAction === 'function' ? painter.keyboardAction({ node, column, rowIndex }) : painter.keyboardAction)
      : null;
    this.live.textContent = `${name}: ${value ?? ''}, row ${rowIndex + 1}${action ? `. Press Enter to ${action}` : ''}`;
  }

  /** Replace the last range (keeping `base`) with the rectangle between two cells. */
  setRange(a, b, base = []) {
    if (!this.cellSelectionEnabled) return;
    this.api.clearCellSelection();
    base.forEach((r) => this.api.addCellRange(r));
    this.api.addCellRange({
      rowStartIndex: a.rowIndex,
      rowEndIndex: b.rowIndex,
      columnStart: a.column,
      columnEnd: b.column,
    });
  }

  currentRangeParams() {
    return (this.api.getCellRanges() ?? []).map((r) => ({
      rowStartIndex: r.startRow?.rowIndex ?? null,
      rowEndIndex: r.endRow?.rowIndex ?? null,
      columns: r.columns,
    }));
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    this.host.focus({ preventScroll: true });
    const { x, y } = this.local(e);
    const fh = this.fillHandle;
    if (fh && x >= fh.x && x <= fh.x + fh.w && y >= fh.y && y <= fh.y + fh.h) {
      this.drag = { type: 'fill', range: fh.range, target: null };
      this.scroller.setPointerCapture(e.pointerId);
      return;
    }
    const hit = this.hitTest(x, y);
    if (!hit) return;
    this.editor.commit();
    const { node, column, rowIndex } = hit;

    const region = this.hitRegionAt(x, y);
    if (region) {
      this.setFocus(rowIndex, column);
      if (!region.disabled) this.runAction(region.painter, region.action, region.node, region.column, e);
      return;
    }
    const colId = column.getColId();

    if (colId.startsWith(AUTO_COL_PREFIX) && node.group && !node.footer) {
      const chevronX = this.theme.cellPadding + Math.max(0, node.level) * this.theme.groupIndent;
      if (hit.localX >= chevronX - 4 && hit.localX <= chevronX + CHEVRON_W) {
        node.setExpanded(!node.expanded);
        return;
      }
    }
    if (colId === SELECTION_COL) {
      if (node.selectable !== false) node.setSelected(!node.isSelected());
      return;
    }

    const sel = this.api.getGridOption('rowSelection');
    if (sel && typeof sel === 'object' && sel.enableClickSelection) {
      const multi = sel.mode === 'multiRow' && (e.ctrlKey || e.metaKey);
      node.setSelected(multi ? !node.isSelected() : true, !multi);
    }

    const cell = { rowIndex, column };
    if (e.shiftKey && this.focus) {
      this.setRange({ rowIndex: this.focus.rowIndex, column: this.api.getColumn(this.focus.colId) }, cell);
      this.rangeEnd = cell;
    } else {
      const base = e.ctrlKey || e.metaKey ? this.currentRangeParams() : [];
      this.setFocus(rowIndex, column);
      this.rangeEnd = null;
      this.setRange(cell, cell, base);
      this.drag = { type: 'range', anchor: cell, base };
      this.scroller.setPointerCapture(e.pointerId);
    }
    this.requestDraw();
  }

  onPointerMove(e) {
    const { x, y } = this.local(e);
    if (this.drag) {
      const h = this.scroller.clientHeight;
      if (y > h - 24) this.scroller.scrollTop += 16;
      else if (y < 24) this.scroller.scrollTop -= 16;
      const hit = this.hitTest(x, y, true);
      if (!hit) return;
      if (this.drag.type === 'range') {
        this.setRange(this.drag.anchor, hit, this.drag.base);
        this.rangeEnd = hit;
      } else {
        const { range } = this.drag;
        const target = hit.rowIndex > range.r1 || hit.rowIndex < range.r0 ? hit.rowIndex : null;
        if (target !== this.drag.target) {
          this.drag.target = target;
          this.requestDraw();
        }
      }
      return;
    }

    const fh = this.fillHandle;
    const overHandle = fh && x >= fh.x && x <= fh.x + fh.w && y >= fh.y && y <= fh.y + fh.h;
    const region = this.hitRegionAt(x, y);
    const regionKey = region ? `${region.key}|${region.action}` : null;
    if (regionKey !== (this.hoverRegion ? `${this.hoverRegion.key}|${this.hoverRegion.action}` : null)) {
      this.hoverRegion = region ? { key: region.key, action: region.action } : null;
      this.requestDraw();
    }
    this.scroller.style.cursor = overHandle
      ? 'crosshair'
      : region
        ? (region.cursor ?? (region.disabled ? 'not-allowed' : 'pointer'))
        : '';
    const hit = this.hitTest(x, y);
    const row = hit ? hit.rowIndex : -1;
    if (row !== this.hoverRow) {
      this.hoverRow = row;
      this.requestDraw();
    }
    this.scheduleNote(hit);
  }

  onPointerUp(e) {
    if (this.drag?.type === 'fill' && this.drag.target != null) this.fill(this.drag.range, this.drag.target);
    if (this.drag) {
      this.scroller.releasePointerCapture?.(e.pointerId);
      this.drag = null;
      this.requestDraw();
    }
  }

  onPointerLeave() {
    if (this.drag) return;
    this.hoverRow = -1;
    this.hoverRegion = null;
    clearTimeout(this.noteTimer);
    this.hideNote();
    this.requestDraw();
  }

  onDoubleClick(e) {
    const hit = this.hitTest(...Object.values(this.local(e)));
    if (hit && this.isEditable(hit.node, hit.column)) this.editor.start(hit);
  }

  onContextMenu(e) {
    e.preventDefault();
    const { x, y } = this.local(e);
    const hit = this.hitTest(x, y);
    if (!hit) return;
    const inRange = (this.api.getCellRanges() ?? []).some((r) => {
      const r0 = Math.min(r.startRow.rowIndex, r.endRow.rowIndex);
      const r1 = Math.max(r.startRow.rowIndex, r.endRow.rowIndex);
      return hit.rowIndex >= r0 && hit.rowIndex <= r1 && r.columns.includes(hit.column);
    });
    if (!inRange) {
      this.setFocus(hit.rowIndex, hit.column);
      this.setRange(hit, hit);
    }
    this.host.focus({ preventScroll: true });
    const wrapperRect = this.wrapper.getBoundingClientRect();
    this.api.showContextMenu({
      rowNode: hit.node,
      column: hit.column,
      value: this.api.getCellValue({ rowNode: hit.node, colKey: hit.column }),
      source: 'ui',
      x: e.clientX - wrapperRect.left,
      y: e.clientY - wrapperRect.top,
    });
  }

  // ---------------------------------------------------------------- keyboard

  moveFocus(dRow, dCol, extend = false, toEdge = false) {
    const cols = this.allColumns();
    const count = this.rowCount();
    if (!cols.length || !count) return;
    if (!this.focus) {
      this.setFocus(0, cols[0]);
      this.setRange({ rowIndex: 0, column: cols[0] }, { rowIndex: 0, column: cols[0] });
      this.ensureVisible(0, cols[0]);
      return;
    }
    const from = extend && this.rangeEnd ? { rowIndex: this.rangeEnd.rowIndex, colId: this.rangeEnd.column.getColId() } : this.focus;
    let ci = cols.findIndex((c) => c.getColId() === from.colId);
    let ri = from.rowIndex;
    if (toEdge) {
      if (dRow) ri = dRow > 0 ? count - 1 : 0;
      if (dCol) ci = dCol > 0 ? cols.length - 1 : 0;
    } else {
      ri = Math.min(count - 1, Math.max(0, ri + dRow));
      ci = Math.min(cols.length - 1, Math.max(0, ci + dCol));
    }
    const target = { rowIndex: ri, column: cols[ci] };
    if (extend) {
      this.setRange({ rowIndex: this.focus.rowIndex, column: this.api.getColumn(this.focus.colId) }, target);
      this.rangeEnd = target;
    } else {
      this.setFocus(ri, cols[ci]);
      this.rangeEnd = null;
      this.setRange(target, target);
    }
    this.ensureVisible(ri, cols[ci]);
  }

  onKeyDown(e) {
    if (this.editor.active) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const pageRows = Math.max(1, Math.floor(this.scroller.clientHeight / 42) - 1);
    let handled = true;

    if (key === 'ArrowDown') this.moveFocus(1, 0, e.shiftKey, mod);
    else if (key === 'ArrowUp') this.moveFocus(-1, 0, e.shiftKey, mod);
    else if (key === 'ArrowRight') this.moveFocus(0, 1, e.shiftKey, mod);
    else if (key === 'ArrowLeft') this.moveFocus(0, -1, e.shiftKey, mod);
    else if (key === 'Tab') this.moveFocus(0, e.shiftKey ? -1 : 1);
    else if (key === 'PageDown') this.moveFocus(pageRows, 0, e.shiftKey);
    else if (key === 'PageUp') this.moveFocus(-pageRows, 0, e.shiftKey);
    else if (key === 'Home') this.moveFocus(mod ? -Infinity : 0, -1, e.shiftKey, true);
    else if (key === 'End') this.moveFocus(mod ? Infinity : 0, 1, e.shiftKey, true);
    else if (key === 'Enter' || key === 'F2') this.editFocused();
    else if (key === 'Escape') this.api.clearCellSelection();
    else if (key === 'Delete' || key === 'Backspace') this.clearRanges();
    else if (key === ' ' && !mod) this.toggleFocusedRowSelection();
    else if (mod && key.toLowerCase() === 'c') this.copy();
    else if (mod && key.toLowerCase() === 'x') this.cut();
    else if (mod && key.toLowerCase() === 'v') this.paste();
    else if (mod && key.toLowerCase() === 'z') (e.shiftKey ? this.redo() : this.undo());
    else if (mod && key.toLowerCase() === 'y') this.redo();
    else if (mod && key.toLowerCase() === 'a') this.selectAll();
    else if (key.length === 1 && !mod && !e.altKey) this.editFocused(key);
    else handled = false;

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      this.requestDraw();
    }
  }

  focusedCell() {
    if (!this.focus) return null;
    const node = this.api.getDisplayedRowAtIndex(this.focus.rowIndex);
    const column = this.api.getColumn(this.focus.colId);
    return node && column ? { node, column, rowIndex: this.focus.rowIndex } : null;
  }

  editFocused(initialText) {
    const cell = this.focusedCell();
    if (!cell) return;
    if (initialText == null && this.activateFocused()) return;
    if (cell.node.group && cell.column.getColId().startsWith(AUTO_COL_PREFIX) && initialText == null) {
      cell.node.setExpanded(!cell.node.expanded);
      return;
    }
    if (this.isEditable(cell.node, cell.column)) this.editor.start(cell, initialText);
  }

  /** Runs the focused cell painter's keyboard action (Enter / Space); returns true if one ran. */
  activateFocused() {
    const cell = this.focusedCell();
    const painter = cell && this.painterFor(cell.column);
    if (!painter?.onAction || !painter.keyboardAction) return false;
    const action = typeof painter.keyboardAction === 'function' ? painter.keyboardAction(cell) : painter.keyboardAction;
    if (!action) return false;
    this.runAction(painter, action, cell.node, cell.column, null);
    return true;
  }

  toggleFocusedRowSelection() {
    if (this.activateFocused()) return;
    const cell = this.focusedCell();
    if (cell && this.api.getGridOption('rowSelection') && cell.node.selectable !== false) {
      cell.node.setSelected(!cell.node.isSelected());
    }
  }

  selectAll() {
    const cols = this.allColumns();
    if (!cols.length || !this.rowCount()) return;
    this.setRange({ rowIndex: 0, column: cols[0] }, { rowIndex: this.rowCount() - 1, column: cols[cols.length - 1] });
  }

  // ---------------------------------------------------------------- data changes, clipboard, undo

  /** Applies [{ node, column, value }] as one undoable batch. */
  applyChanges(changes, record = true) {
    const batch = [];
    for (const { node, column, value } of changes) {
      if (!this.isEditable(node, column)) continue;
      const oldValue = this.getRawValue(node, column);
      if (Object.is(oldValue, value)) continue;
      if (node.setDataValue(column.getColId(), value, 'canvasEdit')) batch.push({ node, column, oldValue, newValue: value });
    }
    if (record && batch.length) {
      this.undoStack.push(batch);
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
    }
    this.requestDraw();
    return batch;
  }

  undo() {
    const batch = this.undoStack.pop();
    if (!batch) return;
    batch.forEach(({ node, column, oldValue }) => node.setDataValue(column.getColId(), oldValue, 'undo'));
    this.redoStack.push(batch);
  }

  redo() {
    const batch = this.redoStack.pop();
    if (!batch) return;
    batch.forEach(({ node, column, newValue }) => node.setDataValue(column.getColId(), newValue, 'redo'));
    this.undoStack.push(batch);
  }

  rangeCells() {
    const cells = [];
    for (const r of this.api.getCellRanges() ?? []) {
      const r0 = Math.min(r.startRow.rowIndex, r.endRow.rowIndex);
      const r1 = Math.max(r.startRow.rowIndex, r.endRow.rowIndex);
      for (let i = r0; i <= r1; i++) {
        const node = this.api.getDisplayedRowAtIndex(i);
        r.columns.forEach((column) => cells.push({ node, column }));
      }
    }
    if (!cells.length && this.focusedCell()) cells.push(this.focusedCell());
    return cells;
  }

  clearRanges() {
    this.applyChanges(this.rangeCells().map((c) => ({ ...c, value: null })));
  }

  ensureRangeForClipboard() {
    if (!(this.api.getCellRanges() ?? []).length && this.focus) {
      const cell = this.focusedCell();
      this.setRange(cell, cell);
    }
  }

  copy() {
    this.ensureRangeForClipboard();
    this.api.copySelectedRangeToClipboard();
    this.host.focus({ preventScroll: true });
  }

  cut() {
    this.copy();
    this.clearRanges();
  }

  async paste() {
    const start = this.focusedCell();
    if (!start) return;
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    const rows = text.replace(/\r?\n$/, '').split(/\r?\n/).map((line) => line.split('\t'));
    const cols = this.allColumns();
    const c0 = cols.findIndex((c) => c.getColId() === start.column.getColId());
    const changes = [];
    rows.forEach((values, i) => {
      const node = this.api.getDisplayedRowAtIndex(start.rowIndex + i);
      if (!node) return;
      values.forEach((v, j) => {
        const column = cols[c0 + j];
        if (!column) return;
        changes.push({ node, column, value: this.parseValue(node, column, this.getRawValue(node, column), v) });
      });
    });
    this.applyChanges(changes);
    const endCol = cols[Math.min(cols.length - 1, c0 + rows[0].length - 1)];
    this.setRange(start, { rowIndex: Math.min(this.rowCount() - 1, start.rowIndex + rows.length - 1), column: endCol });
  }

  /** Fill handle: linear series for numbers, repeat otherwise, relative refs shifted for formulas. */
  fill(range, target) {
    const down = target > range.r1;
    const targetRows = [];
    for (let i = down ? range.r1 + 1 : target; down ? i <= target : i < range.r0; i++) targetRows.push(i);
    const n = range.r1 - range.r0 + 1;
    const changes = [];
    for (const column of range.columns) {
      const source = [];
      for (let i = range.r0; i <= range.r1; i++) source.push(this.getRawValue(this.api.getDisplayedRowAtIndex(i), column));
      const numeric = source.length > 1 && source.every((v) => typeof v === 'number');
      const step = numeric ? (source[n - 1] - source[0]) / (n - 1) : 0;
      for (const rowIndex of targetRows) {
        const node = this.api.getDisplayedRowAtIndex(rowIndex);
        const offset = rowIndex - range.r0;
        let value;
        if (numeric) {
          value = source[0] + step * offset;
        } else {
          const srcIdx = ((offset % n) + n) % n;
          value = source[srcIdx];
          if (typeof value === 'string' && value.startsWith('=')) value = shiftFormulaRows(value, rowIndex - (range.r0 + srcIdx));
        }
        changes.push({ node, column, value });
      }
    }
    this.applyChanges(changes);
    const first = range.columns[0];
    const last = range.columns[range.columns.length - 1];
    this.setRange(
      { rowIndex: down ? range.r0 : target, column: first },
      { rowIndex: down ? target : range.r1, column: last },
    );
  }

  // ---------------------------------------------------------------- notes

  scheduleNote(hit) {
    clearTimeout(this.noteTimer);
    if (this.noteEditorOpen) return;
    const note = hit && this.api.getGridOption('notesDataSource') && !hit.node.group
      ? this.api.getNote({ rowNode: hit.node, column: hit.column })
      : null;
    if (!note) {
      this.hideNote();
      return;
    }
    if (this.noteEl?.dataset.key === `${hit.node.id}|${hit.column.getColId()}`) return;
    this.noteTimer = setTimeout(() => this.showNote(hit, note), 180);
  }

  notePopup(rect) {
    this.hideNote();
    const el = document.createElement('div');
    el.className = 'cg-note';
    const t = this.theme;
    Object.assign(el.style, { background: t.chrome, color: t.text, borderColor: t.border, fontFamily: t.fontFamily });
    const left = Math.min(rect.x + rect.width + 4, this.L.width - 270);
    el.style.left = `${Math.max(4, left)}px`;
    el.style.top = `${Math.max(4, rect.y)}px`;
    this.overlay.appendChild(el);
    this.noteEl = el;
    return el;
  }

  showNote(hit, note) {
    const el = this.notePopup(hit.rect);
    el.dataset.key = `${hit.node.id}|${hit.column.getColId()}`;
    const author = document.createElement('b');
    author.textContent = note.author ?? 'Note';
    el.append(author, document.createTextNode(note.text));
  }

  hideNote() {
    if (this.noteEditorOpen) return;
    this.noteEl?.remove();
    this.noteEl = null;
  }

  openNoteEditor(node, column) {
    this.noteEditorOpen = false;
    const rect = this.cellRect(node.rowIndex, column);
    if (!rect) return;
    const existing = this.api.getNote({ rowNode: node, column });
    const el = this.notePopup(rect);
    this.noteEditorOpen = true;
    el.innerHTML = '<b></b><textarea></textarea><div class="cg-note-actions"></div>';
    el.querySelector('b').textContent = existing ? 'Edit note' : 'Add note';
    const textarea = el.querySelector('textarea');
    textarea.value = existing?.text ?? '';
    textarea.style.borderColor = this.theme.border;
    const actions = el.querySelector('.cg-note-actions');
    const close = () => {
      this.noteEditorOpen = false;
      this.hideNote();
      this.host.focus({ preventScroll: true });
      this.requestDraw();
    };
    const button = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.borderColor = this.theme.border;
      b.addEventListener('click', fn);
      actions.appendChild(b);
    };
    if (existing) button('Delete', () => (this.api.setNote({ rowNode: node, column, note: undefined }), close()));
    button('Cancel', close);
    button('Save', () => {
      const text = textarea.value.trim();
      this.api.setNote({
        rowNode: node,
        column,
        note: text ? { ...existing, text, author: existing?.author ?? this.noteAuthor, createdAt: existing?.createdAt ?? new Date().toISOString() } : undefined,
      });
      close();
    });
    textarea.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close();
    });
    textarea.focus();
  }
}
