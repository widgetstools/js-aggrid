import { themeQuartz } from 'ag-grid-community';
import { getOrgData } from '../data.js';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function createTreeDemo(container, { createGrid }) {
  const gridOptions = {
    theme: themeQuartz,
    rowData: getOrgData(),
    treeData: true,
    getDataPath: (data) => data.path,
    groupDefaultExpanded: 2,
    autoGroupColumnDef: {
      headerName: 'Employee',
      minWidth: 300,
      cellRendererParams: { suppressCount: false },
      filter: 'agGroupColumnFilter',
    },
    columnDefs: [
      { field: 'title', filter: 'agSetColumnFilter' },
      { field: 'location', filter: 'agSetColumnFilter', enableRowGroup: true },
      {
        field: 'salary',
        headerName: 'Team Payroll',
        aggFunc: 'sum',
        valueFormatter: (p) => (p.value == null ? '' : currency.format(p.value)),
        // "Show Values As" (new in v36): display payroll as % of each manager's total
        showValuesAs: 'percentOfParentRowTotal',
      },
      {
        colId: 'headcount',
        headerName: 'Headcount',
        valueGetter: (p) => (p.node.group ? p.node.allLeafChildren.length : 1),
      },
    ],
    defaultColDef: { flex: 1, minWidth: 120, filter: true },
    rowSelection: { mode: 'multiRow', groupSelects: 'descendants' },
    sideBar: 'columns',
    toolbar: {
      items: [
        { label: 'Expand all', icon: 'expanded', action: ({ api }) => api.expandAll() },
        { label: 'Collapse all', icon: 'contracted', action: ({ api }) => api.collapseAll() },
        { toolbarItem: 'agQuickFilterToolbarItem', alignment: 'right' },
      ],
    },
    statusBar: {
      statusPanels: [{ statusPanel: 'agTotalRowCountComponent' }, { statusPanel: 'agSelectedRowCountComponent' }],
    },
  };

  const api = createGrid(container, gridOptions);

  return {
    hint: `
      <strong>Tree Data</strong> built from a <code>getDataPath</code> hierarchy with aggregated payroll per manager.
      Team Payroll uses <strong>Show Values As</strong> <code>percentOfParentRowTotal</code> — switch modes from the column
      menu. Selecting a manager selects their whole team.`,
    destroy: () => api.destroy(),
  };
}
