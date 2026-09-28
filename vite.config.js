import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const agGridPkg = JSON.parse(
  readFileSync(new URL('./node_modules/ag-grid-community/package.json', import.meta.url), 'utf8'),
);

export default defineConfig({
  define: {
    __AG_GRID_VERSION__: JSON.stringify(agGridPkg.version),
  },
});
