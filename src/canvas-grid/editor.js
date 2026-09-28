// A DOM cell editor positioned over the canvas cell being edited.

const SELECT_EDITORS = new Set(['agSelectCellEditor', 'agRichSelectCellEditor']);

export class CellEditor {
  constructor(layer) {
    this.layer = layer;
    this.el = null;
    this.cell = null;
  }

  get active() {
    return !!this.el;
  }

  start(cell, initialText) {
    const { layer } = this;
    this.commit();
    const { node, column } = cell;
    const colDef = column.getColDef();
    const rect = layer.cellRect(node.rowIndex, column);
    if (!rect) return;

    const raw = layer.getRawValue(node, column);
    const values = colDef.cellEditorParams?.values;
    const useSelect = SELECT_EDITORS.has(colDef.cellEditor) && Array.isArray(values);
    const el = document.createElement(useSelect ? 'select' : 'input');
    el.className = 'cg-editor';

    if (useSelect) {
      for (const v of values) el.add(new Option(String(v), String(v)));
      el.value = raw == null ? '' : String(raw);
      el.addEventListener('change', () => this.commit());
    } else {
      el.type = 'text';
      el.spellcheck = false;
      el.value = initialText ?? (raw == null ? '' : String(raw));
      if (typeof raw === 'number') el.inputMode = 'decimal';
    }

    const t = layer.theme;
    Object.assign(el.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      font: `${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`,
      paddingLeft: `${t.cellPadding - 2}px`,
      paddingRight: `${t.cellPadding - 2}px`,
      color: t.text,
      background: t.background,
      borderColor: t.accent,
      textAlign: typeof raw === 'number' ? 'right' : 'left',
    });

    el.addEventListener('keydown', (e) => this.onKeyDown(e));
    el.addEventListener('blur', () => this.commit(), { once: true });
    layer.overlay.appendChild(el);
    this.el = el;
    this.cell = { node, column, raw };
    el.focus();
    if (!useSelect && initialText == null) el.select();
    if (useSelect && typeof el.showPicker === 'function') {
      try {
        el.showPicker();
      } catch {
        // showPicker needs a user gesture in some browsers; the select still works on click.
      }
    }
  }

  onKeyDown(e) {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.cancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.commit();
      this.layer.moveFocus(e.shiftKey ? -1 : 1, 0);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.commit();
      this.layer.moveFocus(0, e.shiftKey ? -1 : 1);
    }
  }

  commit() {
    if (!this.el) return;
    const { el, cell } = this;
    this.el = null;
    const text = el.value;
    el.remove();
    const newValue = this.layer.parseValue(cell.node, cell.column, cell.raw, text);
    this.layer.applyChanges([{ node: cell.node, column: cell.column, value: newValue }]);
    this.layer.host.focus({ preventScroll: true });
  }

  cancel() {
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    el.remove();
    this.layer.host.focus({ preventScroll: true });
    this.layer.requestDraw();
  }
}
