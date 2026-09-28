import { themeQuartz } from 'ag-grid-community';
import { startFrameMeter } from './perf.js';

// Results survive tab / renderer switches so DOM and Canvas runs can be compared.
const results = [];

const NUM_COLS = 30;
const fmt = (p) => (typeof p.value === 'number' ? p.value.toFixed(2) : p.value);

function makeRows(count) {
  const rows = new Array(count);
  for (let i = 0; i < count; i++) {
    const row = { id: i, name: `Instrument ${i}` };
    for (let c = 0; c < NUM_COLS; c++) row[`c${c}`] = Math.random() * 1000;
    rows[i] = row;
  }
  return rows;
}

export function createBenchmarkDemo(container, { createGrid, renderer }) {
  container.style.cssText = 'display:flex;flex-direction:column;gap:10px;height:100%';
  container.innerHTML = `
    <div class="bench-bar">
      <label>Rows <select data-k="rows"><option>10000</option><option selected>100000</option><option>250000</option></select></label>
      <label>Updates / 100ms <select data-k="updates"><option>0</option><option>200</option><option selected>1000</option><option>5000</option></select></label>
      <label><input type="checkbox" data-k="scroll" checked /> Auto-scroll</label>
      <label>Duration <select data-k="duration"><option value="5">5s</option><option value="10" selected>10s</option></select></label>
      <button class="bench-run">Run benchmark (${renderer})</button>
      <span class="bench-live"></span>
    </div>
    <div class="bench-grid"></div>
    <div class="bench-results-wrap"><table class="bench-results"><thead><tr>
      <th>Renderer</th><th>Rows</th><th>Updates/100ms</th><th>Scroll</th><th>Avg FPS</th><th>p95 frame</th>
      <th>Long tasks</th><th>Blocked ms</th><th>Grid DOM nodes</th>
    </tr></thead><tbody></tbody></table></div>`;

  const $ = (sel) => container.querySelector(sel);
  const setting = (k) => $(`[data-k="${k}"]`);
  const gridEl = $('.bench-grid');
  let api;
  let rows = [];
  let running = false;
  let stopRun = () => {};

  function renderResults() {
    $('.bench-results tbody').innerHTML = results
      .map(
        (r) => `<tr class="${r.renderer === 'canvas' ? 'is-canvas' : ''}"><td>${r.renderer}</td><td>${r.rows.toLocaleString()}</td>
        <td>${r.updates}</td><td>${r.scroll ? 'yes' : 'no'}</td><td><b>${r.fps.toFixed(1)}</b></td>
        <td>${r.p95.toFixed(1)} ms</td><td>${r.longTasks}</td><td>${Math.round(r.blocked)}</td><td>${r.nodes.toLocaleString()}</td></tr>`,
      )
      .join('') || '<tr><td colspan="9" class="bench-empty">No runs yet — run once with DOM and once with Canvas (switch in the header).</td></tr>';
  }

  function buildGrid() {
    api?.destroy();
    rows = makeRows(Number(setting('rows').value));
    const columnDefs = [
      { field: 'id', pinned: 'left', width: 90 },
      { field: 'name', pinned: 'left', width: 150 },
      ...Array.from({ length: NUM_COLS }, (_, c) => ({
        field: `c${c}`,
        headerName: `Price ${c + 1}`,
        width: 110,
        valueFormatter: fmt,
        enableCellChangeFlash: true,
      })),
    ];
    api = createGrid(gridEl, {
      theme: themeQuartz,
      columnDefs,
      rowData: rows,
      getRowId: (p) => String(p.data.id),
      asyncTransactionWaitMillis: 50,
      cellSelection: true,
      statusBar: { statusPanels: [{ statusPanel: 'agTotalRowCountComponent' }, { statusPanel: 'agAggregationComponent' }] },
    });
  }

  function scrollElement() {
    return renderer === 'canvas' ? gridEl.querySelector('.cg-scroller') : gridEl.querySelector('.ag-grid-viewport');
  }

  function run() {
    if (running) return stopRun();
    running = true;
    const button = $('.bench-run');
    button.textContent = 'Stop';
    const duration = Number(setting('duration').value) * 1000;
    const updates = Number(setting('updates').value);
    const doScroll = setting('scroll').checked;

    const updateTimer = updates
      ? setInterval(() => {
          const batch = [];
          for (let i = 0; i < updates; i++) {
            const row = rows[(Math.random() * rows.length) | 0];
            const c = `c${(Math.random() * NUM_COLS) | 0}`;
            row[c] = Math.max(0, row[c] + (Math.random() - 0.5) * 20);
            batch.push(row);
          }
          api.applyTransactionAsync({ update: batch });
        }, 100)
      : 0;

    const scroller = scrollElement();
    let dir = 1;
    const meter = startFrameMeter((now, elapsed) => {
      if (doScroll && scroller) {
        scroller.scrollTop += 40 * dir;
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) dir = -1;
        else if (scroller.scrollTop <= 0) dir = 1;
      }
      $('.bench-live').textContent = `${(elapsed / 1000).toFixed(1)}s · ${Math.round(meter.recentFps())} fps`;
      if (elapsed >= duration) finish();
    });

    function cleanup() {
      const stats = meter.stop();
      clearInterval(updateTimer);
      running = false;
      button.textContent = `Run benchmark (${renderer})`;
      $('.bench-live').textContent = '';
      return stats;
    }
    function finish() {
      const stats = cleanup();
      results.push({
        renderer,
        rows: rows.length,
        updates,
        scroll: doScroll,
        ...stats,
        nodes: gridEl.querySelectorAll('*').length,
      });
      renderResults();
    }
    stopRun = cleanup;
  }

  setting('rows').addEventListener('change', buildGrid);
  $('.bench-run').addEventListener('click', run);
  buildGrid();
  renderResults();

  return {
    hint: `
      <strong>Benchmark:</strong> 30 flashing price columns, streaming <code>applyTransactionAsync</code> updates while
      auto-scrolling. Run once per renderer (toggle <strong>DOM / Canvas</strong> in the header) and compare FPS, p95 frame
      time and main-thread long tasks. Results stay in the table until reload.`,
    destroy: () => {
      stopRun();
      api?.destroy();
    },
  };
}
