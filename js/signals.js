// ========== AI SIGNAL GENERATOR ==========

export function generateSignals(candles, currentSym) {
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const n      = closes.length;
  if (n < 60) return;

  // --- RSI(14) ---
  function rsi(data, period = 14) {
    let gains = 0, losses = 0;
    for (let i = n - period; i < n; i++) {
      const diff = data[i] - data[i - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgG = gains / period;
    const avgL = losses / period;
    if (avgL === 0) return 100;
    return 100 - 100 / (1 + avgG / avgL);
  }

  // --- EMA ---
  function ema(data, period) {
    const k = 2 / (period + 1);
    let val  = data[0];
    for (let i = 1; i < data.length; i++) val = data[i] * k + val * (1 - k);
    return val;
  }

  const rsiVal   = rsi(closes);
  const ema9     = ema(closes.slice(-20),  9);
  const ema21    = ema(closes.slice(-30), 21);
  const ema50    = ema(closes.slice(-60), 50);
  const lastClose = closes[n - 1];

  // --- ATR(14) ---
  let atr = 0;
  for (let i = n - 14; i < n; i++) {
    atr += Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1])
    );
  }
  atr /= 14;

  // --- Voting ---
  const trend      = ema9 > ema21 && ema21 > ema50 ? 'BUY'
                   : ema9 < ema21 && ema21 < ema50 ? 'SELL' : 'WAIT';
  const rsiSignal  = rsiVal < 35 ? 'BUY' : rsiVal > 65 ? 'SELL' : 'WAIT';
  const priceSignal = lastClose > ema9 ? 'BUY' : 'SELL';

  const votes    = [trend, rsiSignal, priceSignal];
  const buyVotes  = votes.filter(v => v === 'BUY').length;
  const sellVotes = votes.filter(v => v === 'SELL').length;

  let dir, conf;
  if      (buyVotes  >= 2) { dir = 'BUY';  conf = buyVotes  === 3 ? 88 : 68; }
  else if (sellVotes >= 2) { dir = 'SELL'; conf = sellVotes === 3 ? 85 : 65; }
  else                     { dir = 'WAIT'; conf = 45; }

  const entry = lastClose;
  const sl  = dir === 'BUY'  ? entry - atr * 1.5 : entry + atr * 1.5;
  const tp1 = dir === 'BUY'  ? entry + atr * 2   : entry - atr * 2;
  const tp2 = dir === 'BUY'  ? entry + atr * 3.5 : entry - atr * 3.5;

  const fmt = v => v > 1000
    ? v.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : v.toFixed(4);

  const now = new Date().toLocaleTimeString('vi-VN', { hour12: false });

  // --- Signal card HTML ---
  const signalHtml = `
    <div class="signal-card ${dir.toLowerCase()}">
      <div class="sig-top">
        <div class="sig-direction">${
          dir === 'BUY'  ? '▲ BUY'  :
          dir === 'SELL' ? '▼ SELL' : '◆ WAIT'
        }</div>
        <div>
          <div class="sig-sym">${currentSym}</div>
          <div class="sig-time">${now}</div>
        </div>
      </div>
      ${dir !== 'WAIT' ? `
        <div class="sig-row">
          <span class="sig-row-label">ENTRY</span>
          <span class="sig-row-val val-entry">${fmt(entry)}</span>
        </div>
        <div class="sig-row">
          <span class="sig-row-label">STOP LOSS</span>
          <span class="sig-row-val val-sl">${fmt(sl)}</span>
        </div>
        <div class="sig-row">
          <span class="sig-row-label">TP 1</span>
          <span class="sig-row-val val-tp">${fmt(tp1)}</span>
        </div>
        <div class="sig-row">
          <span class="sig-row-label">TP 2</span>
          <span class="sig-row-val val-tp">${fmt(tp2)}</span>
        </div>
      ` : `
        <div style="font-family:var(--mono);font-size:11px;color:var(--muted);padding:6px 0;line-height:1.6">
          Thị trường chưa rõ xu hướng.<br>Chờ tín hiệu rõ hơn.
        </div>
      `}
      <div class="sig-conf">
        <span class="sig-conf-label">CONF</span>
        <div class="conf-bar">
          <div class="conf-fill" style="width:${conf}%"></div>
        </div>
        <span class="sig-conf-pct">${conf}%</span>
      </div>
    </div>`;

  // --- Indicator stack HTML ---
  const rsiClass   = rsiVal < 40 ? 'bull' : rsiVal > 60 ? 'bear' : 'neut';
  const maClass    = ema9 > ema21 ? 'bull' : 'bear';
  const trendClass = trend === 'BUY' ? 'bull' : trend === 'SELL' ? 'bear' : 'neut';

  const indHtml = `
    <div style="font-family:var(--mono);font-size:9px;color:var(--muted);
                letter-spacing:2px;margin-bottom:6px;margin-top:10px;">
      // INDICATOR STACK
    </div>
    <div class="ind-grid">
      <div class="ind-item">
        <div class="ind-name">RSI(14)</div>
        <div class="ind-val ${rsiClass}">${rsiVal.toFixed(1)}</div>
      </div>
      <div class="ind-item">
        <div class="ind-name">EMA 9/21</div>
        <div class="ind-val ${maClass}">${maClass === 'bull' ? 'BULL' : 'BEAR'}</div>
      </div>
      <div class="ind-item">
        <div class="ind-name">TREND</div>
        <div class="ind-val ${trendClass}">${trend}</div>
      </div>
      <div class="ind-item">
        <div class="ind-name">ATR</div>
        <div class="ind-val neut">${fmt(atr)}</div>
      </div>
    </div>`;

  const body = document.getElementById('signal-body');
  if (body) body.innerHTML = signalHtml + indHtml;
}