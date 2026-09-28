# AG Grid Enterprise 36 Showcase (Vanilla JS)

A Vite + plain JavaScript app demonstrating AG Grid Enterprise **v36.2.0**, plus an experimental
canvas-based cell renderer that runs the same grids with cells painted on a `<canvas>`.

## Running the demo

**Prerequisites:** Node.js `^20.19.0` or `>=22.12.0` (required by Vite 8) and npm. A Chromium-based browser
(Chrome, Edge) is recommended — the benchmark's JS-heap and long-task stats use Chrome-only APIs.

```bash
git clone https://github.com/widgetstools/js-aggrid.git
cd js-aggrid
npm install
npm run dev
```

Open <http://localhost:5173>. The dev server reloads on file changes.

To run a production build instead:

```bash
npm run build
npm run preview
```

`npm run preview` serves the built `dist/` folder at <http://localhost:4173>.

### AG Grid Enterprise license

Without a key every Enterprise feature still works, but the grid shows a trial watermark and logs a license
message in the console. To remove it, create `.env.local` in the project root (it is git-ignored):

```
VITE_AG_GRID_LICENSE_KEY=your-key
```

Restart `npm run dev` after adding it.

### Using the app

- **Tabs** switch between the demos described below.
- **Cells: DOM / Canvas** (header, right) re-creates the current tab with the standard DOM renderer or the
  canvas renderer. The choice is remembered in `localStorage`.
- **Light / Dark** toggles the theme for the page, grid and charts.

### Running the performance comparisons

1. Open the **Benchmark** or **Stress 100k×400** tab.
2. Pick **DOM** in the header, choose rows / updates / scroll options, and press **Run benchmark** /
   **Measure 10s**.
3. Switch to **Canvas** and run the same settings again. Results for both renderers stay in the table
   (until the page is reloaded) for side-by-side comparison.

Tips for meaningful numbers:

- Keep the browser window visible and in the foreground. Background tabs and hidden panes throttle
  `requestAnimationFrame`, which makes FPS readings meaningless.
- FPS is capped at your display's refresh rate (60, 120 Hz…). When a renderer hits the cap, compare the
  **p95 frame** time and **long tasks** instead.
- The Stress tab auto-scrolls continuously while **Auto-scroll** is `vertical` / `diagonal`; set it to `off` to
  interact with the grid by hand. **Live updates** keep streaming until set to `off`.
- The 400-column Stress grid uses ~300 MB of JS heap; close other heavy tabs on low-memory machines.

## Demos

| Tab | Features |
| --- | --- |
| **Sales Analytics** (`src/demos/sales.js`) | Quick Access Toolbar, Find, Calculated Columns, Cell Notes, PDF/Excel/CSV export, Column Header Edit, row grouping, pivoting, set/multi filters, sparklines, integrated charts, fill handle, row numbers, undo/redo, side bar, status bar, live async transactions |
| **Formulas** (`src/demos/formulas.js`) | Excel-style cell formulas (`=SUM(B1:G1)`), custom `formulaFuncs`, fill handle |
| **Tree Data** (`src/demos/tree.js`) | `getDataPath` hierarchy, aggregation, Show Values As (`percentOfParentRowTotal`), group selection |
| **Stress 100k×400** (`src/demos/stress.js`) | 40M cells in a `Float32Array` via `valueGetter`/`valueSetter`, 40 column groups, 10 formatted + conditionally styled column types, heat-map `cellStyle`, data bars, `rowClassRules`, pinned columns, live updates, auto-scroll, live FPS / draw-time / heap stats |
| **Benchmark** (`src/demos/benchmark.js`) | 100k+ rows, 30 flashing columns, streaming async transactions + auto-scroll; FPS / p95 frame / long tasks per renderer |

Every feature is registered with `AllEnterpriseModule.with(AgChartsEnterpriseModule)` in `src/main.js`. Light/dark mode uses the Theming API (`themeQuartz` + `data-ag-theme-mode`).

## Canvas cell renderer (`src/canvas-grid/`)

The **Cells: DOM / Canvas** switch in the header re-creates the current demo with `createCanvasGrid()`
instead of `createGrid()`. Same grid options, same modules — only the cell area changes.

```js
import { createCanvasGrid, pillPainter } from './canvas-grid/index.js';

const api = createCanvasGrid(container, gridOptions, {
  painters: { status: pillPainter({ Won: { bg: '#dcfce7', fg: '#166534' } }) }, // replaces cellRenderer
  classStyles: { pos: { color: '#16a34a' } },                                  // replaces cellClassRules CSS
});
```

**How it works.** AG Grid keeps running as the engine: row model (sort, filter, grouping, pivot, tree data,
aggregation, formulas, calculated columns, Show Values As), header, side bar, status bar, toolbar, menus,
exports and charts. The canvas layer collapses AG Grid's scrolling row area to the header height
(`rowBuffer: 0`, so AG Grid renders ~no rows) and inserts a `<canvas>` + native scroller in its place. It reads
rows and columns through the public API (`getDisplayedRowAtIndex`, `getDisplayed{Left,Center,Right}Columns`,
`getCellValue`, `getCellRanges`, `getNote`, `findGetNumMatches`…) and redraws on any grid event.
Horizontal scrolling reuses AG Grid's own horizontal scrollbar, so the header stays in sync.

| Area | Canvas implementation |
| --- | --- |
| Rendering | Virtualised rows/columns, pinned left/right, row numbers, selection checkboxes, group/tree chevrons + counts, grand total, stripes, hover, hi-DPI, light/dark theme from Theming API CSS variables |
| Cell content | `valueFormatter`, `cellStyle`, `cellClassRules`/`rowClassRules` (via `classStyles`), sparklines (`agSparklineCellRenderer`), custom `painters`, change flashing (`enableCellChangeFlash`), note markers, Find highlights |
| Selection | Click / drag / shift / ctrl ranges → `addCellRange` (status bar aggregation, Chart Range, copy work unchanged), row selection, keyboard navigation (arrows, Tab, Page, Home/End, Ctrl+A) |
| Editing | DOM editor over the cell (text / select), Enter/F2/type-to-edit, Delete, paste (TSV), fill handle (numeric series, formula row-reference shifting), undo/redo |
| Menus & notes | AG Grid context menu via `showContextMenu`; "Add/Edit Note" and "Paste" items redirected to the canvas; note hover popup |
| Charts | Chart Range from canvas-selected ranges; chart-linked ranges drawn with the theme's chart category/series colours |
| Interactive cells | Painters can register clickable hit regions (`addHitRegion`), get hover state, and handle clicks + Enter/Space (`onAction`, `keyboardAction`) — see `buttonsPainter` and the Sales "Decision" column |

**Interactive painters.** A painter is a function `(ctx, params) => void` or an object:

```js
import { buttonsPainter } from './canvas-grid/index.js';

painters: {
  actions: buttonsPainter({
    buttons: (p) => [{ label: 'Approve', action: 'approve', color: '#16a34a', disabled: p.node.data.status !== 'Pending' }],
    onAction: ({ action, node }) => node.setDataValue('status', 'Won'),   // click, Enter or Space
    keyboardAction: ({ node }) => (node.data.status === 'Pending' ? 'approve' : null),
  }),
}
```

Custom painters call `params.addHitRegion({ x, y, width, height, action, disabled?, cursor? })` while painting and
read `params.hovered` (the hovered action in that cell) to draw hover states.

**Limitations (v1).** No full-width rows / master-detail, pinned top/bottom rows, row dragging, tooltips,
cell spanning, RTL, or HTML/framework cell renderers (write a painter instead). Relies on AG Grid v36 DOM class
names (`.ag-grid-viewport`, `.ag-header`, `.ag-body-horizontal-scroll-viewport`) — pin the AG Grid version.
Accessibility is minimal (live-region announcements of the focused cell).

**Benchmark** (headless Chrome, 1600×1000 @2x, 100k rows × 32 cols, 10 s):

| Scenario | DOM FPS / p95 frame | Canvas FPS / p95 frame |
| --- | --- | --- |
| Auto-scroll only | 59.6 / 16.8 ms | 60.0 / 16.8 ms |
| 1k updates per 100 ms + auto-scroll | 44.0 / 50.0 ms | 60.0 / 16.8 ms |
| 5k updates per 100 ms, no scroll | 59.9 / 16.8 ms | 59.9 / 16.8 ms |

**Stress test** (100k rows × 400 columns, headless Chrome 1600×1000 @2x, 10 s):

| Scenario | DOM FPS / p95 frame | Canvas FPS / p95 frame |
| --- | --- | --- |
| 1k cell updates per 100 ms + vertical scroll | 39.2 / 50.0 ms | 60.0 / 16.7 ms |
| 10k cell updates per 100 ms + diagonal scroll | 40.5 / 50.0 ms | 60.0 / 16.8 ms |
| Same, compact rows (28px) | 33.9 / 66.6 ms | 60.0 / 16.7 ms |
| Same, 4× CPU throttling | 9.8 / 216.7 ms, 3.6 s blocked | 37.9 / 83.4 ms, 2.2 s blocked |

Canvas draw time is ~1–2 ms per frame. With canvas cells, most remaining grid DOM (~4.4k of ~5k nodes) is the
side bar's Columns/Filters tool panels, which AG Grid builds for all 400 columns even while closed.
