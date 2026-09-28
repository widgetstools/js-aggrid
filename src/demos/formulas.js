import { themeQuartz } from 'ag-grid-community';

// A small spreadsheet-style budget. Columns are referenced by letter (A = first column)
// and rows by their row number, just like Excel.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun'];

const lines = [
  ['Salaries', [42000, 42000, 43500, 43500, 44000, 44000]],
  ['Cloud hosting', [6200, 6400, 6900, 7100, 7600, 8100]],
  ['Marketing', [9000, 12000, 8000, 15000, 11000, 9500]],
  ['Office', [3500, 3500, 3500, 3600, 3600, 3600]],
  ['Travel', [1800, 2600, 900, 3100, 2200, 1500]],
];

function buildRows() {
  const rows = lines.map(([item, values], i) => {
    const r = i + 1;
    const row = { rid: `r${r}`, item };
    MONTHS.forEach((m, j) => (row[m] = values[j]));
    // Column H = sum of B..G on the same row; I = average
    row.total = `=SUM(B${r}:G${r})`;
    row.avg = `=ROUND(AVERAGE(B${r}:G${r}), 0)`;
    // Custom function registered via `formulaFuncs`
    row.flag = `=OVERBUDGET(H${r}, 60000)`;
    return row;
  });

  const last = lines.length;
  const totalRow = { rid: 'total', item: 'Total' };
  ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].forEach((col, j) => {
    const field = [...MONTHS, 'total', 'avg'][j];
    totalRow[field] = `=SUM(${col}1:${col}${last})`;
  });
  totalRow.flag = `=IF(H${last + 1} > 400000, "Review", "OK")`;
  return [...rows, totalRow];
}

const money = (p) =>
  typeof p.value === 'number' ? p.value.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p.value;

export function createFormulasDemo(container, { createGrid }) {
  const gridOptions = {
    theme: themeQuartz,
    rowData: buildRows(),
    getRowId: (p) => p.data.rid,
    columnDefs: [
      { field: 'item', headerName: 'Line item', minWidth: 160, pinned: 'left' },
      ...MONTHS.map((m) => ({
        field: m,
        headerName: m[0].toUpperCase() + m.slice(1),
        allowFormula: true,
        valueFormatter: money,
      })),
      { field: 'total', headerName: 'H1 Total', allowFormula: true, valueFormatter: money },
      { field: 'avg', headerName: 'Monthly Avg', allowFormula: true, valueFormatter: money },
      { field: 'flag', headerName: 'Flag', allowFormula: true },
    ],
    defaultColDef: { flex: 1, minWidth: 100, editable: true, sortable: false },
    rowNumbers: true,
    cellSelection: { handle: { mode: 'fill' } },
    undoRedoCellEditing: true,
    rowClassRules: { 'budget-total': (p) => p.data?.rid === 'total' },
    formulaFuncs: {
      OVERBUDGET: {
        func: ({ args }) => {
          const [value, limit] = Array.from(args).map((a) => Number(a.value));
          return value > limit ? '⚠ Over' : '✓ Within';
        },
      },
    },
    toolbar: {
      items: [
        { toolbarItem: 'agFindToolbarItem' },
        {
          label: 'Export Excel',
          icon: 'excel',
          alignment: 'right',
          action: ({ api }) => api.exportDataAsExcel({ fileName: 'budget.xlsx' }),
        },
      ],
    },
  };

  const api = createGrid(container, gridOptions, {
    classStyles: { 'budget-total': { fontWeight: 700 } },
  });

  return {
    hint: `
      <strong>Formulas:</strong> cells starting with <code>=</code> are evaluated with Excel-style references
      (<code>=SUM(B1:G1)</code>). Edit any monthly figure and watch totals recalculate. Double-click a total to edit
      its formula, drag the fill handle to copy, and see <code>OVERBUDGET()</code> — a custom function from
      <code>formulaFuncs</code>.`,
    destroy: () => api.destroy(),
  };
}
