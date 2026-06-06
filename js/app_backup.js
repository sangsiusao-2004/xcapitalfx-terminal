// ========== APP.JS — MAIN ORCHESTRATOR ==========
import { CONFIG }                                    from './config.js';
import { checkAuth, logout }                         from './auth.js';
import { updateClock, renderSessions }               from './utils.js';
import { renderWatchlist, fetchWatchPrices, buildTicker } from './watchlist.js';
import { initChart, loadKlines, updatePriceHeader }  from './chart.js';
import { generateSignals }                           from './signals.js';
import { connectWS }                                 from './websocket.js';
import { askAI }                                     from './ai.js';

// ---- Auth check ----
checkAuth();

// ---- State ----
let currentSym = CONFIG.DEFAULT_SYMBOL;
let currentTf  = CONFIG.DEFAULT_TF;
let candleSeriesRef = null;
const priceWsRef    = { current: null };
const watchPrices   = {};
const watchSymbols  = CONFIG.WATCH_SYMBOLS;

// ---- Chế độ chart: 'crypto' | 'xauusd' ----
let chartMode = 'crypto';

// ========== SELECT SYMBOL (Crypto) ==========
function selectSym(sym) {
  if (chartMode !== 'crypto') switchToCrypto();
  currentSym = sym;

  const symEl = document.getElementById('ch-sym');
  const sbEl  = document.getElementById('sb-sym');
  if (symEl) symEl.textContent = sym;
  if (sbEl)  sbEl.textContent  = sym + ' · ' + currentTf;

  renderWatchlist(watchSymbols, watchPrices, currentSym, selectSym);
  loadKlines(currentSym, currentTf, generateSignals, currentSym);
  connectWS(currentSym, candleSeriesRef, updatePriceHeader, priceWsRef);
}

// ========== SET TIMEFRAME ==========
window.setTf = function(btn, tf) {
  currentTf = tf;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const sbEl = document.getElementById('sb-sym');
  if (sbEl) sbEl.textContent = currentSym + ' · ' + tf;

  if (chartMode === 'crypto') {
    loadKlines(currentSym, tf, generateSignals, currentSym);
  }
  // XAUUSD: TradingView widget tự xử lý timeframe riêng
};

// ========== CHART MODE SWITCHING ==========

// Chuyển sang XAUUSD (TradingView Widget)
window.switchToXAU = function() {
  chartMode = 'xauusd';

  // Đóng WS crypto
  if (priceWsRef.current) { priceWsRef.current.close(); priceWsRef.current = null; }

  // Cập nhật header
  const symEl = document.getElementById('ch-sym');
  const prEl  = document.getElementById('ch-price');
  const chgEl = document.getElementById('ch-change');
  const hEl   = document.getElementById('ch-high');
  const lEl   = document.getElementById('ch-low');
  const vEl   = document.getElementById('ch-vol');
  if (symEl) symEl.textContent = 'XAU/USD';
  if (prEl)  prEl.textContent  = '--';
  if (chgEl) { chgEl.textContent = '--'; chgEl.className = 'ch-change'; }
  if (hEl)   hEl.textContent   = '--';
  if (lEl)   lEl.textContent   = '--';
  if (vEl)   vEl.textContent   = '--';

  const sbEl = document.getElementById('sb-sym');
  if (sbEl) sbEl.textContent = 'XAUUSD · TradingView';

  // Active button
  document.querySelectorAll('.xau-btn').forEach(b => b.classList.add('active'));
  document.querySelectorAll('.sym-row').forEach(b => b.classList.remove('active'));

  // Mount TradingView widget
  const canvas = document.getElementById('chart-canvas');
  canvas.innerHTML = `
    <div id="tv-widget-container" style="width:100%;height:100%"></div>`;

  new TradingView.widget({
    container_id:  'tv-widget-container',
    width:         '100%',
    height:        '100%',
    symbol:        'OANDA:XAUUSD',
    interval:      tvInterval(currentTf),
    timezone:      'Asia/Ho_Chi_Minh',
    theme:         'dark',
    style:         '1',         // Candlestick
    locale:        'vi_VN',
    toolbar_bg:    '#070b0f',
    enable_publishing: false,
    hide_top_toolbar:  false,
    hide_legend:       false,
    save_image:        false,
    backgroundColor:   '#070b0f',
    gridColor:         'rgba(0,200,150,0.05)',
    studies: [
      'RSI@tv-basicstudies',
      'MAExp@tv-basicstudies',
    ],
  });

  // Tạo signal XAUUSD từ dữ liệu tĩnh (TradingView widget không có callback giá)
  document.getElementById('signal-body').innerHTML = `
    <div class="signal-card wait" style="margin-bottom:8px">
      <div class="sig-top">
        <div class="sig-direction" style="color:var(--gold,#c9a84c)">◆ XAU/USD</div>
        <div><div class="sig-sym">OANDA · SPOT</div></div>
      </div>
      <div style="font-family:var(--mono);font-size:11px;color:var(--muted);padding:6px 0;line-height:1.8">
        Chart XAUUSD đang hiển thị qua<br>
        <span style="color:var(--accent)">TradingView Widget</span> (realtime).<br>
        Dùng AI Chat để phân tích vàng.
      </div>
    </div>
    <div style="font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:2px;margin:8px 0 6px">// GỢI Ý HỎI AI</div>
    ${['Phân tích xu hướng XAUUSD hôm nay','Vàng có nên mua không?','Support/Resistance XAUUSD'].map(q =>
      `<div class="ai-suggest" onclick="fillAI('${q}')">${q}</div>`
    ).join('')}`;
};

// Chuyển lại Crypto chart
function switchToCrypto() {
  chartMode = 'crypto';
  document.querySelectorAll('.xau-btn').forEach(b => b.classList.remove('active'));

  // Re-init lightweight chart
  const { candleSeries } = initChart();
  candleSeriesRef = candleSeries;
  loadKlines(currentSym, currentTf, generateSignals, currentSym);
  connectWS(currentSym, candleSeriesRef, updatePriceHeader, priceWsRef);
}

// Mapping timeframe -> TradingView interval
function tvInterval(tf) {
  const map = { '1m':'1','5m':'5','15m':'15','1h':'60','4h':'240','1d':'D','1w':'W','1M':'M' };
  return map[tf] || '60';
}

// Fill AI input với gợi ý
window.fillAI = function(q) {
  const el = document.getElementById('ai-q');
  if (el) { el.value = q; el.focus(); }
};

// ========== INIT ==========
window.addEventListener('load', async () => {

  // Init crypto chart
  const { candleSeries } = initChart();
  candleSeriesRef = candleSeries;

  // Load dữ liệu ban đầu
  await loadKlines(currentSym, currentTf, generateSignals, currentSym);
  connectWS(currentSym, candleSeriesRef, updatePriceHeader, priceWsRef);

  // Watchlist
  await fetchWatchPrices(watchSymbols, watchPrices);
  renderWatchlist(watchSymbols, watchPrices, currentSym, selectSym);
  buildTicker(watchSymbols, watchPrices);

  // Clock & sessions
  updateClock();
  setInterval(updateClock, 1000);
  renderSessions();
  setInterval(renderSessions, 60000);

  // Refresh watchlist
  setInterval(async () => {
    await fetchWatchPrices(watchSymbols, watchPrices);
    renderWatchlist(watchSymbols, watchPrices, currentSym, selectSym);
    buildTicker(watchSymbols, watchPrices);
  }, 30000);

  // Refresh signals mỗi 60s
  setInterval(() => {
    if (chartMode === 'crypto') {
      loadKlines(currentSym, currentTf, generateSignals, currentSym);
    }
  }, 60000);

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', logout);

  // AI send
  document.getElementById('ai-send-btn')?.addEventListener('click', () => askAI(currentSym, currentTf));
  document.getElementById('ai-q')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') askAI(currentSym, currentTf);
  });

  // Nút XAUUSD topbar
    document.getElementById('xau-btn')
    ?.addEventListener('click', () => switchToXAU());

 // Nút XAUUSD sidebar
    document.getElementById('xau-sidebar-btn')
    ?.addEventListener('click', () => switchToXAU());
});