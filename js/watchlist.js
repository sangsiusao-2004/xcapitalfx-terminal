// ========== WATCHLIST ==========
import { getTickers24h } from './services/marketService.js';

function changeClass(change) {
  if (change > 0) return 'up';
  if (change < 0) return 'dn';
  return 'flat';
}

function formatChange(change) {
  if (change > 0) return `+${change.toFixed(2)}%`;
  if (change < 0) return `${change.toFixed(2)}%`;
  return '0.00%';
}

export function renderWatchlist(watchSymbols, watchPrices, currentSym, onSelect) {
  const cont = document.getElementById('watchlist');
  if (!cont) return;
  cont.innerHTML = watchSymbols.map(w => {
    const p    = watchPrices[w.sym];
    const cls  = p ? changeClass(p.change) : '';
    const pStr = p
      ? (p.price > 1000
          ? p.price.toLocaleString('en-US', { maximumFractionDigits: 2 })
          : p.price.toFixed(4))
      : '--';
    const chg = p ? formatChange(p.change) : '';
    return `<div class="sym-row ${w.sym === currentSym ? 'active' : ''}"
                 data-sym="${w.sym}" data-market="${w.market || 'crypto'}">
      <div>
        <div class="sym-name">${w.label}</div>
        <div class="sym-change-s ${cls}">${chg}</div>
      </div>
      <div class="sym-price-s">${pStr}</div>
    </div>`;
  }).join('');

  cont.querySelectorAll('.sym-row').forEach(row => {
    row.addEventListener('click', () => onSelect(row.dataset.sym, row.dataset.market));
  });
}

export async function fetchWatchPrices(watchSymbols, watchPrices) {
  try {
    const data = await getTickers24h(watchSymbols.map(w => w.sym));
    data.forEach(d => {
      const prev = watchPrices[d.symbol];
      watchPrices[d.symbol] = {
        price: Number(d.price),
        change: Number(d.change),
        open: Number(d.open),
        high: Number(d.high),
        low: Number(d.low),
        volume: Number(d.volume),
        previousPrice: prev?.price ?? null,
        direction: prev?.price == null
          ? (d.change >= 0 ? 'up' : 'dn')
          : d.price >= prev.price ? 'up' : 'dn',
      };
    });
  } catch (e) {
    console.warn('[Watchlist] fetch error:', e);
  }
}

export function buildTicker(watchSymbols, watchPrices) {
  const strip = document.getElementById('ticker-strip');
  if (!strip) return;
  const items = watchSymbols.map(w => {
    const p    = watchPrices[w.sym];
    const cls  = p ? changeClass(p.change) : '';
    const pStr = p
      ? (p.price > 1000
          ? p.price.toLocaleString('en-US', { maximumFractionDigits: 1 })
          : p.price.toFixed(3))
      : '--';
    const chg = p ? formatChange(p.change) : '';
    return `<span class="ticker-item">
      <span class="t-sym">${w.label}</span>
      <span class="t-price">${pStr}</span>
      <span class="t-chg ${cls}">${chg}</span>
    </span>`;
  }).join('');
  strip.innerHTML = items + items;
}
