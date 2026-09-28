import { themeQuartz } from 'ag-grid-community';
import { buttonsPainter, pillPainter } from '../canvas-grid/index.js';
import { getSalesData } from '../data.js';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const formatCurrency = (p) => (p.value == null ? '' : currency.format(p.value));

// Approve / Reject buttons for pending deals — shared by the DOM renderer and the canvas painter.
const DEAL_ACTIONS = [
  { label: 'Approve', action: 'approve', status: 'Won', color: '#16a34a' },
  { label: 'Reject', action: 'reject', status: 'Lost', color: '#dc2626' },
];

function decideDeal(node, action) {
  const target = DEAL_ACTIONS.find((a) => a.action === action);
  if (target && node.data?.status === 'Pending') node.setDataValue('status', target.status);
}

function dealActionsRenderer(p) {
  if (!p.data) return null;
  const el = document.createElement('div');
  el.className = 'deal-actions';
  for (const a of DEAL_ACTIONS) {
    const button = document.createElement('button');
    button.textContent = a.label;
    button.style.background = a.color;
    button.disabled = p.data.status !== 'Pending';
    button.addEventListener('click', () => decideDeal(p.node, a.action));
    el.appendChild(button);
  }
  return el;
}

const dealActionsPainter = buttonsPainter({
  buttons: (p) => DEAL_ACTIONS.map((a) => ({ ...a, disabled: p.node.data?.status !== 'Pending' })),
  onAction: ({ node, action }) => decideDeal(node, action),
  keyboardAction: ({ node }) => (node.data?.status === 'Pending' ? 'approve' : null),
});

// Notes are stored outside the row data, keyed by row id + column id. A real app would
// persist these to a backend.
function createNotesStore(seed) {
  const notes = new Map(seed);
  const key = ({ rowNode, column }) => `${rowNode.id}::${column.getColId()}`;
  return {
    getNote: (params) => notes.get(key(params)),
    setNote: (params) => {
      if (params.note) {
        notes.set(key(params), { ...params.note, updatedAt: new Date().toISOString() });
      } else {
        notes.delete(key(params));
      }
    },
  };
}

export function createSalesDemo(container, { createGrid }) {
  const rowData = getSalesData();
  let liveTimer;

  const columnDefs = [
    {
      field: 'region',
      rowGroup: true,
      hide: true,
      filter: 'agSetColumnFilter',
      enableRowGroup: true,
      enablePivot: true,
    },
    { field: 'country', filter: 'agSetColumnFilter', enableRowGroup: true, enablePivot: true },
    { field: 'product', filter: 'agSetColumnFilter', enableRowGroup: true, enablePivot: true, minWidth: 160 },
    { field: 'category', filter: 'agSetColumnFilter', enableRowGroup: true, enablePivot: true },
    {
      field: 'rep',
      headerName: 'Sales Rep',
      // Double-click the header to rename it (Column Header Edit, new in v36)
      headerNameEditable: true,
      filter: 'agMultiColumnFilter',
      enableRowGroup: true,
    },
    { field: 'date', cellDataType: 'dateString', filter: 'agDateColumnFilter' },
    {
      headerName: 'Financials',
      headerNameEditable: true,
      children: [
        { field: 'units', aggFunc: 'sum', enableValue: true, filter: 'agNumberColumnFilter', editable: true },
        {
          field: 'price',
          aggFunc: 'avg',
          enableValue: true,
          valueFormatter: formatCurrency,
          filter: 'agNumberColumnFilter',
          editable: true,
          enableCellChangeFlash: true,
        },
        {
          field: 'revenue',
          aggFunc: 'sum',
          enableValue: true,
          valueFormatter: formatCurrency,
          filter: 'agNumberColumnFilter',
          enableCellChangeFlash: true,
        },
        { field: 'cost', aggFunc: 'sum', enableValue: true, valueFormatter: formatCurrency },
        {
          // Calculated Column (new in v36): expression references other columns by colId
          colId: 'profit',
          headerName: 'Profit',
          calculatedExpression: '[revenue] - [cost]',
          aggFunc: 'sum',
          valueFormatter: formatCurrency,
          cellClassRules: { pos: (p) => p.value > 0, neg: (p) => p.value < 0 },
        },
        {
          colId: 'margin',
          headerName: 'Margin %',
          calculatedExpression: '([revenue] - [cost]) / [revenue] * 100',
          valueFormatter: (p) => (p.value == null ? '' : `${p.value.toFixed(1)}%`),
        },
      ],
    },
    {
      field: 'trend',
      headerName: '12wk Trend',
      cellRenderer: 'agSparklineCellRenderer',
      cellRendererParams: {
        sparklineOptions: {
          type: 'area',
          fill: 'rgba(37, 99, 235, 0.25)',
          stroke: '#2563eb',
          marker: { enabled: false },
        },
      },
      sortable: false,
      filter: false,
      minWidth: 140,
    },
    {
      field: 'status',
      filter: 'agSetColumnFilter',
      enableRowGroup: true,
      editable: true,
      cellEditor: 'agRichSelectCellEditor',
      cellEditorParams: { values: ['Won', 'Pending', 'Lost'] },
      cellRenderer: (p) =>
        p.value ? `<span class="status-pill status-${p.value}">${p.value}</span>` : '',
    },
    {
      colId: 'actions',
      headerName: 'Decision',
      // Depends on status so the buttons refresh when it changes
      valueGetter: (p) => p.data?.status,
      cellRenderer: dealActionsRenderer,
      pinned: 'right',
      width: 180,
      minWidth: 180,
      flex: 0,
      sortable: false,
      filter: false,
      suppressHeaderMenuButton: true,
    },
  ];

  const gridOptions = {
    theme: themeQuartz,
    columnDefs,
    rowData,
    getRowId: (p) => p.data.id,
    defaultColDef: {
      flex: 1,
      minWidth: 110,
      filter: true,
      floatingFilter: true,
    },
    autoGroupColumnDef: { minWidth: 220, pinned: 'left' },
    groupDefaultExpanded: 0,
    grandTotalRow: 'bottom',

    // Spreadsheet-like row numbers & cell range selection with fill handle
    rowNumbers: true,
    cellSelection: { handle: { mode: 'fill' } },
    enableCharts: true,
    chartThemes: ['ag-default', 'ag-default-dark', 'ag-vivid', 'ag-material'],
    undoRedoCellEditing: true,

    // Let users add their own calculated columns from the column menu
    calculatedColumns: true,

    // Cell Notes (new in v36). Right-click a cell → "Add Note".
    notesDataSource: createNotesStore([
      [
        'D-0003::revenue',
        { text: 'Discount approved by finance — see ticket FIN-221.', author: 'Ava Patel' },
      ],
      ['D-0007::status', { text: 'Customer asked to revisit in Q4.', author: 'Liam Chen' }],
    ]),

    // Quick Access Toolbar (new in v36)
    toolbar: {
      items: [
        'agRowGroupPanelToolbarItem',
        { toolbarItem: 'agFindToolbarItem', alignment: 'right' },
        { toolbarItem: 'agQuickFilterToolbarItem', alignment: 'right' },
        { toolbarItem: 'separator', alignment: 'right' },
        {
          key: 'live',
          label: 'Live updates',
          icon: 'chart',
          tooltip: 'Stream random price updates',
          alignment: 'right',
          action: ({ api }) => toggleLive(api),
        },
        {
          label: 'Chart',
          icon: 'chart',
          tooltip: 'Create an integrated chart of revenue & profit by country',
          alignment: 'right',
          action: ({ api }) => createChart(api),
        },
        {
          toolbarItem: 'agMenuToolbarItem',
          label: 'Export',
          icon: 'save',
          alignment: 'right',
          toolbarItemParams: {
            menuItems: [
              { name: 'Excel (.xlsx)', action: ({ api }) => api.exportDataAsExcel() },
              { name: 'CSV', action: ({ api }) => api.exportDataAsCsv() },
              {
                // PDF Export (new in v36)
                name: 'PDF',
                action: ({ api }) =>
                  api.exportDataAsPdf({
                    fileName: 'sales-report.pdf',
                    documentTitle: 'Sales Report 2026',
                  }),
              },
            ],
          },
        },
        {
          label: 'Reset',
          icon: 'cross',
          tooltip: 'Reset columns and filters',
          alignment: 'right',
          action: ({ api }) => {
            api.resetColumnState();
            api.setFilterModel(null);
          },
        },
      ],
    },

    sideBar: { toolPanels: ['columns', 'filters'], hiddenByDefault: false, defaultToolPanel: '' },
    statusBar: {
      statusPanels: [
        { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
        { statusPanel: 'agSelectedRowCountComponent' },
        { statusPanel: 'agAggregationComponent' },
      ],
    },
    rowSelection: { mode: 'multiRow', groupSelects: 'filteredDescendants', checkboxes: false },
  };

  const api = createGrid(container, gridOptions, {
    // Canvas equivalents of the DOM cell renderer and CSS classes used above
    painters: {
      actions: dealActionsPainter,
      status: pillPainter({
        Won: { bg: '#dcfce7', fg: '#166534' },
        Pending: { bg: '#fef3c7', fg: '#92400e' },
        Lost: { bg: '#fee2e2', fg: '#991b1b' },
      }),
    },
    classStyles: { pos: { color: '#16a34a' }, neg: { color: '#dc2626' } },
  });

  function toggleLive(gridApi) {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = undefined;
      return;
    }
    liveTimer = setInterval(() => {
      const updates = [];
      for (let i = 0; i < 25; i++) {
        const row = rowData[Math.floor(Math.random() * rowData.length)];
        row.price = Math.max(10, Math.round(row.price * (0.95 + Math.random() * 0.1)));
        row.revenue = row.units * row.price;
        updates.push(row);
      }
      gridApi.applyTransactionAsync({ update: updates });
    }, 500);
  }

  function createChart(gridApi) {
    // Charts the first 15 rows; ungroup first so the range spans leaf rows.
    gridApi.setRowGroupColumns([]);
    gridApi.createRangeChart({
      cellRange: { rowStartIndex: 0, rowEndIndex: 14, columns: ['country', 'revenue', 'profit'] },
      chartType: 'groupedColumn',
      chartThemeName: document.body.dataset.agThemeMode === 'dark' ? 'ag-default-dark' : 'ag-default',
    });
  }

  return {
    hint: `
      <strong>New in v36:</strong> Quick Access <code>toolbar</code> with Find &amp; export menu ·
      <strong>Calculated Columns</strong> (Profit, Margin %) · <strong>Cell Notes</strong> (hover the corner marker on
      D-0003 revenue, or right-click → Add Note) · <strong>PDF export</strong> · double-click a header to <strong>rename</strong> it ·
      <strong>Decision</strong> buttons approve / reject pending deals (canvas: painted buttons with hit regions).
      Also: row grouping, pivoting, set/multi filters, sparklines, fill handle, integrated charts, live updates.`,
    destroy: () => {
      clearInterval(liveTimer);
      api.destroy();
    },
  };
}
