// ========== CHART ==========
import { CONFIG } from './config.js';
import { getKlines, getTicker24h } from './services/marketService.js';

let chart, candleSeries, volumeSeries, lastPrice = 0;

export function initChart() {
  const container = document.getElementById('chart-canvas');
  if (!container) return {};
  container.innerHTML = '';

  const C = CONFIG.CHART_COLORS;

  chart = LightweightCharts.createChart(container, {
    width:  container.offsetWidth,
    height: container.offsetHeight,
    layout: { background: { color: C.bg }, textColor: C.text },
    grid: {
      vertLines: { color: C.grid },
      horzLines: { color: C.grid },
    },
    crosshair: {
      vertLine: { color: C.cross, style: 1 },
      horzLine: { color: C.cross, style: 1 },
    },
    rightPriceScale: { borderColor: C.border, textColor: C.text },
    timeScale: {
      borderColor: C.border,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 5,
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor:        C.up,
    downColor:      C.down,
    borderUpColor:  C.up,
    borderDownColor:C.down,
    wickUpColor:    C.up,
    wickDownColor:  C.down,
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat:  { type: 'volume' },
    priceScaleId: 'vol',
  });
  chart.priceScale('vol').applyOptions({
    scaleMargins: { top: 0.85, bottom: 0 },
  });

  window.addEventListener('resize', () => {
    chart.applyOptions({
      width:  container.offsetWidth,
      height: container.offsetHeight,
    });
  });

  return { chart, candleSeries, volumeSeries };
}

export async function loadKlines(sym, tf, generateSignals, currentSym) {
  try {
    const data = await getKlines(sym, tf);

    const candles = data.candles.map(k => ({
      time:  k.time,
      open:  k.open,
      high:  k.high,
      low:   k.low,
      close: k.close,
    }));

    const vols = data.candles.map(k => ({
      time:  k.time,
      value: k.volume,
      color: k.close >= k.open
        ? CONFIG.CHART_COLORS.volUp
        : CONFIG.CHART_COLORS.volDown,
    }));

    candleSeries.setData(candles);
    volumeSeries.setData(vols);
    chart.timeScale().fitContent();

    const el = document.getElementById('sb-candles');
    if (el) el.textContent = candles.length + ' nến';

    const last  = candles[candles.length - 1];
    const first = candles[0];
    const chg   = ((last.close - first.open) / first.open * 100).toFixed(2);
    updatePriceHeader(last.close, parseFloat(chg));

    await fetch24h(sym);
    generateSignals(candles, currentSym || sym);
  } catch (e) {
    console.error('[Chart] loadKlines error:', e);
  }
}

export async function fetch24h(sym) {
  try {
    const d = await getTicker24h(sym);

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    set('ch-high', d.high.toLocaleString('en-US', { maximumFractionDigits: 2 }));
    set('ch-low',  d.low.toLocaleString('en-US',  { maximumFractionDigits: 2 }));

    const vol = d.volume;
    set('ch-vol', vol > 1e6 ? (vol / 1e6).toFixed(2) + 'M' : vol.toFixed(0));

    updatePriceHeader(d.price, d.change);
  } catch (e) {
    console.warn('[Chart] fetch24h error:', e);
  }
}

export function updatePriceHeader(price, chgPct) {
  const el = document.getElementById('ch-price');
  if (!el) return;

  const fmt = price > 1000
    ? price.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : price.toFixed(4);

  if (price > lastPrice && lastPrice > 0) {
    el.classList.add('flash-up');
    setTimeout(() => el.classList.remove('flash-up'), 500);
  } else if (price < lastPrice && lastPrice > 0) {
    el.classList.add('flash-dn');
    setTimeout(() => el.classList.remove('flash-dn'), 500);
  }
  lastPrice = price;
  el.textContent = fmt;

  const chgEl = document.getElementById('ch-change');
  if (chgEl) {
    chgEl.textContent = (chgPct >= 0 ? '+' : '') + chgPct + '%';
    chgEl.className   = 'ch-change ' + (chgPct >= 0 ? 'up' : 'dn');
  }
}
