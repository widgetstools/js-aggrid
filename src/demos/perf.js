// Shared frame / main-thread measurement for the Benchmark and Stress demos.

export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * Runs a requestAnimationFrame loop recording frame times and Long Tasks.
 * `onFrame(now, elapsedMs)` runs every frame (e.g. to drive auto-scroll).
 */
export function startFrameMeter(onFrame) {
  const frameTimes = [];
  let longTasks = 0;
  let blocked = 0;
  let observer;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks++;
        blocked += entry.duration - 50;
      }
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    // Long Task API unsupported (e.g. Safari/Firefox): FPS numbers still work.
  }

  const start = performance.now();
  let last = start;
  let stopped = false;
  let raf = requestAnimationFrame(function tick(now) {
    frameTimes.push(now - last);
    last = now;
    onFrame?.(now, now - start);
    if (!stopped) raf = requestAnimationFrame(tick);
  });

  return {
    /** FPS over the most recent `n` frames. */
    recentFps(n = 30) {
      const recent = frameTimes.slice(-n);
      const total = recent.reduce((a, b) => a + b, 0);
      return total ? (recent.length * 1000) / total : 0;
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      const measured = frameTimes.slice(1);
      const total = measured.reduce((a, b) => a + b, 0);
      return {
        fps: total ? (measured.length * 1000) / total : 0,
        p95: percentile(measured, 0.95),
        longTasks,
        blocked,
      };
    },
  };
}

export function heapMB() {
  const mem = performance.memory;
  return mem ? Math.round(mem.usedJSHeapSize / 1048576) : null;
}
