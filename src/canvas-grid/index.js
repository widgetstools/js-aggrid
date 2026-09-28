import { createGrid } from 'ag-grid-community';
import { CanvasLayer } from './canvasLayer.js';

export { buttonsPainter, pillPainter, sparklinePainter } from './painters.js';

const layers = new WeakMap();

/** The canvas layer behind a grid created with `createCanvasGrid` (exposes `stats.lastDrawMs`). */
export function getCanvasLayer(api) {
  return layers.get(api);
}

/**
 * Drop-in replacement for `createGrid` that paints the cell area on a canvas.
 *
 * AG Grid still owns the row model, headers, side bar, status bar, toolbar, menus, exports and
 * charts. `canvasOptions`:
 *   - painters:     { [colId]: (ctx, params) => void } canvas replacements for cell renderers
 *   - classStyles:  { [className]: { color, backgroundColor, fontWeight, fontStyle, textAlign } }
 *                   styles applied when `cellClassRules` / `rowClassRules` match
 *   - noteAuthor:   author name stored on notes created from the canvas
 */
export function createCanvasGrid(container, gridOptions, canvasOptions = {}) {
  let layer;
  const userMenuItems = gridOptions.getContextMenuItems;

  const api = createGrid(container, {
    ...gridOptions,
    // Nothing is rendered in AG Grid's (collapsed) row area, so don't render buffer rows either.
    rowBuffer: 0,
    getContextMenuItems: (params) => {
      const items = userMenuItems ? userMenuItems(params) : params.defaultItems;
      return items.map((item) => {
        // Built-in note and paste items target AG Grid's DOM cells; route them to the canvas.
        if (item === 'note' && params.node && params.column) {
          const existing = params.api.getNote({ rowNode: params.node, column: params.column });
          return {
            name: existing ? 'Edit Note' : 'Add Note',
            icon: '<span style="font-size:13px">🗒</span>',
            action: () => layer.openNoteEditor(params.node, params.column),
          };
        }
        if (item === 'paste') {
          return { name: 'Paste', shortcut: 'Ctrl+V', action: () => layer.paste() };
        }
        return item;
      });
    },
  });

  layer = new CanvasLayer(api, container, canvasOptions);
  layers.set(api, layer);
  return api;
}
