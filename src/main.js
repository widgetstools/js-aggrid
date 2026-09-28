import { ModuleRegistry, createGrid } from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';
import { AgChartsEnterpriseModule } from 'ag-charts-enterprise';

import { createCanvasGrid } from './canvas-grid/index.js';
import { createSalesDemo } from './demos/sales.js';
import { createFormulasDemo } from './demos/formulas.js';
import { createTreeDemo } from './demos/tree.js';
import { createBenchmarkDemo } from './demos/benchmark.js';
import { createStressDemo } from './demos/stress.js';

// AllEnterpriseModule bundles every Community + Enterprise feature. Passing AG Charts
// Enterprise enables Integrated Charts and Sparklines.
ModuleRegistry.registerModules([AllEnterpriseModule.with(AgChartsEnterpriseModule)]);

// Without a key the grid is fully functional but shows a watermark and console warning.
const licenseKey = import.meta.env.VITE_AG_GRID_LICENSE_KEY;
if (licenseKey) {
  LicenseManager.setLicenseKey(licenseKey);
}

document.getElementById('version').textContent = `AG Grid Enterprise v${__AG_GRID_VERSION__}`;

const DEMOS = {
  sales: createSalesDemo,
  formulas: createFormulasDemo,
  tree: createTreeDemo,
  benchmark: createBenchmarkDemo,
  stress: createStressDemo,
};

// Every demo receives a grid factory, so the same configuration runs with DOM or canvas cells.
const RENDERERS = {
  dom: (container, gridOptions) => createGrid(container, gridOptions),
  canvas: createCanvasGrid,
};

function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (e.g. private mode): the preference just won't persist.
  }
}

const host = document.getElementById('grid-host');
const hint = document.getElementById('hint');
let currentDemo = 'sales';
let renderer = RENDERERS[readPref('renderer', 'dom')] ? readPref('renderer', 'dom') : 'dom';
let current;

function showDemo(name) {
  currentDemo = name;
  current?.destroy();
  host.innerHTML = '';
  const container = document.createElement('div');
  host.appendChild(container);
  current = DEMOS[name](container, { createGrid: RENDERERS[renderer], renderer });
  hint.innerHTML = current.hint;
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.demo === name);
  });
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showDemo(tab.dataset.demo));
});

function setRenderer(name) {
  renderer = name;
  writePref('renderer', name);
  document.querySelectorAll('[data-renderer]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.renderer === name));
  });
}

document.querySelectorAll('[data-renderer]').forEach((b) => {
  b.addEventListener('click', () => {
    setRenderer(b.dataset.renderer);
    showDemo(currentDemo);
  });
});
setRenderer(renderer);

// Theming API: `themeQuartz` reads `data-ag-theme-mode` from the body to switch colour schemes.
const themeToggle = document.getElementById('theme-toggle');
function setMode(mode) {
  document.body.dataset.agThemeMode = mode;
  themeToggle.textContent = mode === 'dark' ? '☀️ Light' : '🌙 Dark';
}
themeToggle.addEventListener('click', () => {
  setMode(document.body.dataset.agThemeMode === 'dark' ? 'light' : 'dark');
});
setMode(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

showDemo('sales');
