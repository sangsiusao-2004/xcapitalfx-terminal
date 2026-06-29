// ========== APP.JS - MAIN ORCHESTRATOR ==========
import { CONFIG } from './config.js';
import { checkAuth, logout } from './auth.js';
import { updateClock, renderSessions } from './utils.js';
import { renderWatchlist, fetchWatchPrices, buildTicker } from './watchlist.js';
import { getJson, postJson } from './request/apiClient.js';
import { getTicker24h } from './services/marketService.js';

checkAuth();

let currentSym = CONFIG.DEFAULT_SYMBOL;
let currentTf = CONFIG.DEFAULT_TF;
let chartMode = 'crypto';
let currentView = 'main';
let realtimeChartMounted = false;
let currentUser = { name: 'Sang', email: 'guest@xcapital.ai' };

const watchPrices = {};
const watchSymbols = CONFIG.WATCH_SYMBOLS;
const MARKET_REFRESH_MS = 3000;
const REALTIME_XAU_REFRESH_MS = 1500;
const REALTIME_TECHNICAL_REFRESH_MS = 12000;
const SIGNAL_HISTORY_KEY = 'tx_signal_history';
const SIGNAL_HISTORY_LIMIT = 10;
const SIGNAL_USAGE_KEY = 'tx_signal_usage';
const THEME_KEY = 'tx_ui_theme';
const USAGE_NOTICE_HIDE_KEY_PREFIX = 'tx_usage_notice_hidden_date_v4';
const PLAN_CONFIGS = {
  Free: {
    dailyLimit: 5,
    cooldownSec: 90,
    label: 'Free',
    tagline: 'Dành cho trải nghiệm cơ bản',
  },
  Pro: {
    dailyLimit: 50,
    cooldownSec: 30,
    label: 'Pro',
    tagline: 'Dành cho trader giao dịch hằng ngày',
  },
  Premium: {
    dailyLimit: Infinity,
    cooldownSec: 5,
    label: 'Premium',
    tagline: 'Dành cho scalping tốc độ cao',
  },
};
let signalHistory = [];
let analyzeCooldownTimer = null;
let backendCooldownUntil = 0;
let phoneNudgeDismissedWhileModalOpen = false;
let phoneNudgeHiddenByProfileMenu = false;
let supportLastPrice = null;
let realtimeTechnicalSummary = null;
let realtimeTechnicalKey = '';
let realtimeTechnicalPending = false;
let realtimePriceTimer = null;

function getUiTheme() {
  const storedTheme = localStorage.getItem(THEME_KEY);
  return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'dark';
}

function applyUiTheme(theme = getUiTheme()) {
  const cleanTheme = theme === 'light' ? 'light' : 'dark';
  if (!localStorage.getItem(THEME_KEY)) {
    localStorage.setItem(THEME_KEY, 'dark');
  }
  document.body.classList.toggle('theme-light', cleanTheme === 'light');
  document.querySelectorAll('[data-theme-option]').forEach(button => {
    button.classList.toggle('active', button.dataset.themeOption === cleanTheme);
  });
}

function setUiTheme(theme) {
  const cleanTheme = theme === 'light' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, cleanTheme);
  applyUiTheme(cleanTheme);
  if (currentView === 'realtime') {
    realtimeChartMounted = false;
    mountRealtimeXauChart(true);
  }
}

applyUiTheme();
let realtimeTechnicalTimer = null;

function tvInterval(tf) {
  const map = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '4h': '240',
    '1d': 'D',
    '1w': 'W',
    '1M': 'M',
  };
  return map[tf] || '60';
}

function setHeader({ displaySymbol, statusSymbol, marketLabel }) {
  const symEl = document.getElementById('ch-sym');
  const prEl = document.getElementById('ch-price');
  const chgEl = document.getElementById('ch-change');
  const hEl = document.getElementById('ch-high');
  const lEl = document.getElementById('ch-low');
  const vEl = document.getElementById('ch-vol');
  const sbEl = document.getElementById('sb-sym');
  const candlesEl = document.getElementById('sb-candles');

  if (symEl) symEl.textContent = displaySymbol;
  if (prEl) prEl.textContent = '--';
  if (chgEl) {
    chgEl.textContent = '--';
    chgEl.className = 'ch-change';
  }
  if (hEl) hEl.textContent = '--';
  if (lEl) lEl.textContent = '--';
  if (vEl) vEl.textContent = '--';
  if (sbEl) sbEl.textContent = `${statusSymbol} · TradingView · ${currentTf}`;
  if (candlesEl) candlesEl.textContent = marketLabel || 'TradingView';
}

function formatPrice(price) {
  if (!Number.isFinite(price)) return '--';
  return price > 1000
    ? price.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : price.toFixed(4);
}

function formatVolume(volume) {
  if (!Number.isFinite(volume)) return '--';
  if (volume >= 1e9) return `${(volume / 1e9).toFixed(2)}B`;
  if (volume >= 1e6) return `${(volume / 1e6).toFixed(2)}M`;
  if (volume >= 1e3) return `${(volume / 1e3).toFixed(2)}K`;
  return volume.toFixed(0);
}

function updateHeaderFromWatchPrice(sym = currentSym) {
  const data = watchPrices[sym];
  if (!data) return;

  const prEl = document.getElementById('ch-price');
  const chgEl = document.getElementById('ch-change');
  const hEl = document.getElementById('ch-high');
  const lEl = document.getElementById('ch-low');
  const vEl = document.getElementById('ch-vol');

  if (prEl) prEl.textContent = formatPrice(data.price);
  if (chgEl) {
    chgEl.textContent = `${data.change >= 0 ? '+' : ''}${data.change.toFixed(2)}%`;
    chgEl.className = `ch-change ${data.change >= 0 ? 'up' : 'dn'}`;
  }
  if (hEl) hEl.textContent = formatPrice(data.high);
  if (lEl) lEl.textContent = formatPrice(data.low);
  if (vEl) vEl.textContent = formatVolume(data.volume);
}

function updateRealtimeSupportPanel() {
  const data = watchPrices.XAUUSD;
  const priceEl = document.getElementById('support-price');
  const changeEl = document.getElementById('support-change');
  const bidAskEl = document.getElementById('support-bidask');
  const highEl = document.getElementById('support-high');
  const lowEl = document.getElementById('support-low');
  const rangeEl = document.getElementById('support-range');
  const updatedEl = document.getElementById('support-updated');
  const trendStateEl = document.getElementById('support-trend-state');
  const trendNoteEl = document.getElementById('support-trend-note');
  const trendBarEl = document.getElementById('support-trend-bar');
  const trendLabelEl = document.getElementById('support-trend-label');
  const volatilityEl = document.getElementById('support-volatility');
  const referenceEl = document.getElementById('support-reference');
  const confidenceEl = document.getElementById('support-confidence');

  if (!priceEl || !changeEl || !bidAskEl || !highEl || !lowEl || !rangeEl || !updatedEl || !trendStateEl || !trendNoteEl || !trendBarEl || !trendLabelEl || !volatilityEl || !referenceEl || !confidenceEl) return;

  if (!data) {
    priceEl.textContent = '--';
    changeEl.textContent = '--';
    bidAskEl.textContent = '-- / --';
    highEl.textContent = '--';
    lowEl.textContent = '--';
    rangeEl.textContent = '--';
    updatedEl.textContent = '--';
    return;
  }

  const price = Number(data.price);
  const change = Number(data.change || 0);
  const priceState = supportLastPrice == null || price === supportLastPrice
    ? 'flat'
    : price > supportLastPrice ? 'up' : 'dn';
  const summary = realtimeTechnicalSummary;
  const fastChange = Number(data.previousPrice) > 0
    ? ((price - Number(data.previousPrice)) / Number(data.previousPrice)) * 100
    : 0;
  let state = summary?.direction || 'WAIT';
  if (summary && Math.abs(fastChange) >= 0.018) {
    if (fastChange > 0 && summary.direction !== 'SELL') state = 'BUY';
    if (fastChange < 0 && summary.direction !== 'BUY') state = 'SELL';
  }
  const stateClass = state === 'BUY' ? 'buy' : state === 'SELL' ? 'sell' : 'wait';
  const label = state === 'BUY'
    ? 'Trend tăng đang kích hoạt'
    : state === 'SELL'
      ? 'Trend giảm đang kích hoạt'
      : (summary?.status || 'Thị trường sideways');
  const note = summary
    ? state === 'BUY'
      ? 'AI phát hiện lực mua đang chiếm ưu thế. Theo dõi nhịp hồi về EMA/vùng hỗ trợ trước khi xác nhận follow trend.'
      : state === 'SELL'
        ? 'AI phát hiện lực bán đang chiếm ưu thế. Theo dõi nhịp hồi lên EMA/vùng kháng cự trước khi xác nhận follow trend.'
        : summary.note
    : 'AI đang tổng hợp dữ liệu kỹ thuật đa chỉ báo để xác định xu hướng và vùng xác nhận phù hợp.';
  const volatility = Number(summary?.volatility ?? Math.abs(change));
  const confidence = Math.max(35, Math.min(96, Number(summary?.confidence || 45) + Math.min(8, Math.abs(fastChange) * 180)));
  const barWidth = Math.max(18, Math.min(100, confidence));
  const stars = Math.max(1, Math.min(5, Math.round(confidence / 20)));

  priceEl.textContent = formatPrice(data.price);
  priceEl.className = `support-price ${priceState}`;
  changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
  changeEl.className = `support-change ${change >= 0 ? 'up' : 'dn'}`;
  const spread = Math.max(price * 0.00008, 0.25);
  const bid = price - spread / 2;
  const ask = price + spread / 2;
  const high = Number(data.high);
  const low = Number(data.low);
  bidAskEl.textContent = `${formatPrice(bid)} / ${formatPrice(ask)}`;
  bidAskEl.className = priceState;
  highEl.textContent = formatPrice(high);
  lowEl.textContent = formatPrice(low);
  rangeEl.textContent = Number.isFinite(high) && Number.isFinite(low) ? formatPrice(high - low) : '--';
  rangeEl.className = change >= 0 ? 'up' : 'dn';
  updatedEl.textContent = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  trendStateEl.textContent = state;
  trendStateEl.className = `trend-state ${stateClass}`;
  trendNoteEl.textContent = note;
  trendLabelEl.textContent = label;
  trendLabelEl.className = stateClass;
  volatilityEl.textContent = volatility.toFixed(2);
  volatilityEl.className = stateClass;
  referenceEl.textContent = `XAUUSD ${currentTf}`;
  referenceEl.className = stateClass;
  confidenceEl.textContent = `${'★'.repeat(stars).padEnd(5, '☆')} ${confidence}%`;
  confidenceEl.className = stateClass;
  trendBarEl.style.width = `${barWidth}%`;
  trendBarEl.className = `trend-bar-fill ${stateClass}`;
  supportLastPrice = price;
}

async function refreshRealtimeXauPrice() {
  if (currentView !== 'realtime') return;
  try {
    const ticker = await getTicker24h('XAUUSD');
    const prev = watchPrices.XAUUSD;
    watchPrices.XAUUSD = {
      price: Number(ticker.price),
      change: Number(ticker.change),
      open: Number(ticker.open),
      high: Number(ticker.high),
      low: Number(ticker.low),
      volume: Number(ticker.volume),
      previousPrice: prev?.price ?? null,
      direction: prev?.price == null
        ? (Number(ticker.change) >= 0 ? 'up' : 'dn')
        : Number(ticker.price) >= Number(prev.price) ? 'up' : 'dn',
    };
    updateRealtimeSupportPanel();
    updateHeaderFromWatchPrice(currentSym);
    renderWatchlist(watchSymbols, watchPrices, currentSym, selectSym);
    renderMobileMarketMenu();
  } catch (err) {
    console.warn('[Realtime XAU] fast refresh failed:', err);
  }
}

function startRealtimePriceFeed() {
  clearInterval(realtimePriceTimer);
  refreshRealtimeXauPrice();
  realtimePriceTimer = setInterval(refreshRealtimeXauPrice, REALTIME_XAU_REFRESH_MS);
  clearInterval(realtimeTechnicalTimer);
  refreshRealtimeTechnicalSummary(true);
  realtimeTechnicalTimer = setInterval(() => refreshRealtimeTechnicalSummary(true), REALTIME_TECHNICAL_REFRESH_MS);
}

function stopRealtimePriceFeed() {
  clearInterval(realtimePriceTimer);
  realtimePriceTimer = null;
  clearInterval(realtimeTechnicalTimer);
  realtimeTechnicalTimer = null;
}

async function refreshRealtimeTechnicalSummary(force = false) {
  const key = `XAUUSD:${currentTf}`;
  if (!force && realtimeTechnicalKey === key && realtimeTechnicalSummary) return;
  if (realtimeTechnicalPending) return;

  realtimeTechnicalPending = true;
  try {
    realtimeTechnicalSummary = await getJson(`/api/market/technical-summary?symbol=XAUUSD&interval=${encodeURIComponent(currentTf)}`);
    realtimeTechnicalKey = key;
    updateRealtimeSupportPanel();
  } catch (err) {
    console.warn('[Realtime Support] technical summary failed:', err);
  } finally {
    realtimeTechnicalPending = false;
  }
}

function refreshMarketViews() {
  renderWatchlist(watchSymbols, watchPrices, currentSym, selectSym);
  buildTicker(watchSymbols, watchPrices);
  updateHeaderFromWatchPrice(currentSym);
  renderMobileMarketMenu();
  updateRealtimeSupportPanel();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function getWatchLabel(sym) {
  return watchSymbols.find(w => w.sym === sym)?.label || sym;
}

function changeClass(change) {
  if (change > 0) return 'up';
  if (change < 0) return 'dn';
  return 'flat';
}

function isMobileLayout() {
  return window.matchMedia('(max-width: 680px)').matches;
}

function renderMobileMarketMenu() {
  const menu = document.getElementById('mobile-market-menu');
  if (!menu) return;

  menu.innerHTML = watchSymbols.map(w => {
    const data = watchPrices[w.sym];
    const price = data ? formatPrice(data.price) : '--';
    const change = data ? `${data.change >= 0 ? '+' : ''}${data.change.toFixed(2)}%` : '--';
    const changeState = data ? changeClass(data.change) : 'flat';
    const active = w.sym === currentSym ? ' active' : '';
    return `
      <button class="mobile-market-btn${active}" data-mobile-market="${escapeHtml(w.market || 'crypto')}" data-mobile-sym="${escapeHtml(w.sym)}" type="button">
        <span>${escapeHtml(w.label)}</span>
        <span class="mobile-market-price">${escapeHtml(price)} · <span class="mobile-market-change ${changeState}">${escapeHtml(change)}</span></span>
      </button>
    `;
  }).join('');
}

function toggleMobileMarketMenu(forceOpen) {
  if (!isMobileLayout()) return;
  const menu = document.getElementById('mobile-market-menu');
  if (!menu) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !menu.classList.contains('open');
  menu.classList.toggle('open', shouldOpen);
}

function toggleSignalDrawer(forceOpen) {
  if (!isMobileLayout()) return;
  const shouldOpen = typeof forceOpen === 'boolean'
    ? forceOpen
    : !document.body.classList.contains('signal-open');
  document.body.classList.toggle('signal-open', shouldOpen);
  toggleMobileMarketMenu(false);
}

function renderMobileSessions() {
  const mobile = document.getElementById('mobile-sessions');
  if (!mobile) return;

  const utcH = new Date().getUTCHours();
  const sessions = [
    { name: 'TOKYO', start: 0, end: 9 },
    { name: 'LONDON', start: 8, end: 17 },
    { name: 'NEW YORK', start: 13, end: 22 },
  ];

  mobile.innerHTML = sessions.map(s => {
    const active = utcH >= s.start && utcH < s.end;
    return `<span class="mobile-session-pill ${active ? 'open' : ''}">${s.name} ${active ? 'OPEN' : 'CLOSE'}</span>`;
  }).join('');
}

function syncMobileProfileDock() {
  const dock = document.querySelector('.profile-dock');
  const sidebar = document.getElementById('sidebar');
  if (!dock || !sidebar) return;

  if (isMobileLayout()) {
    if (dock.parentElement !== document.body) {
      document.body.appendChild(dock);
    }
  } else if (dock.parentElement !== sidebar) {
    const spacer = sidebar.querySelector('.sidebar-spacer');
    sidebar.insertBefore(dock, spacer?.nextSibling || null);
  }
  updatePhoneVerifyNudge();
}

function updatePhoneVerifyNudge() {
  const dock = document.querySelector('.profile-dock');
  if (!dock) return;

  let nudge = document.getElementById('phone-verify-nudge');
  const user = getStoredUser();
  if (user.telegramVerified || phoneNudgeDismissedWhileModalOpen || phoneNudgeHiddenByProfileMenu) {
    nudge?.remove();
    dock.classList.remove('needs-phone-verify');
    return;
  }

  dock.classList.add('needs-phone-verify');
  if (!nudge) {
    nudge = document.createElement('button');
    nudge.id = 'phone-verify-nudge';
    nudge.className = 'phone-verify-nudge';
    nudge.type = 'button';
    nudge.innerHTML = `
      <span class="phone-verify-nudge-icon">✦</span>
      <span class="phone-verify-nudge-copy">
        <strong>Xác minh Tài Khoản</strong>
        <span>Nhận thêm lượt miễn phí.</span>
      </span>
    `;
    nudge.addEventListener('click', () => {
      openPhoneVerification();
    });
    document.body.appendChild(nudge);
  }

  const rect = dock.getBoundingClientRect();
  const mobile = isMobileLayout();
  nudge.classList.toggle('mobile', mobile);
  const nudgeWidth = Math.min(mobile ? 238 : 292, window.innerWidth - 24);
  const profileCenterX = rect.left + rect.width / 2;
  const left = mobile
    ? Math.max(12, Math.min(profileCenterX - nudgeWidth + 24, window.innerWidth - nudgeWidth - 8))
    : Math.max(12, Math.min(rect.left + 10, window.innerWidth - nudgeWidth - 8));
  const top = mobile
    ? Math.min(window.innerHeight - 86, rect.bottom + 12)
    : Math.max(12, rect.top - 78);
  const arrowLeft = Math.max(18, Math.min(profileCenterX - left - 7, nudgeWidth - 24));
  nudge.style.left = `${left}px`;
  nudge.style.top = `${top}px`;
  nudge.style.setProperty('--nudge-arrow-left', `${arrowLeft}px`);
}

function updateTelegramVerifyUi(user = getStoredUser()) {
  document.querySelectorAll('[data-profile-action="phone"], [data-modal-action="phone"]')
    .forEach(button => {
      button.hidden = Boolean(user.telegramVerified);
    });
}

function openTelegramAdmin() {
  const username = 'ryantranforex';
  const appUrl = `tg://resolve?domain=${username}`;
  const webUrl = `https://t.me/${username}`;

  window.location.href = appUrl;
  setTimeout(() => {
    if (!document.hidden) {
      window.open(webUrl, '_blank', 'noopener');
    }
  }, 900);
}

function syncMobileTimeframes() {
  document.querySelectorAll('.mobile-tf-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.mobileTf === currentTf);
  });
}

function syncRealtimeTimeframes() {
  document.querySelectorAll('.realtime-tf-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.realtimeTf === currentTf);
  });
  const realtimeTf = document.getElementById('realtime-tf');
  if (realtimeTf) realtimeTf.textContent = currentTf;
}

function setTimeframe(tf, sourceButton) {
  currentTf = tf;
  const realtimeTf = document.getElementById('realtime-tf');
  if (realtimeTf) realtimeTf.textContent = tf;
  document.querySelectorAll('.tf-btn').forEach(button => {
    const text = button.textContent.trim().toLowerCase();
    button.classList.toggle('active', text === tf.toLowerCase());
  });
  if (sourceButton?.classList.contains('tf-btn')) {
    sourceButton.classList.add('active');
  }
  syncMobileTimeframes();
  syncRealtimeTimeframes();

  if (chartMode === 'xauusd') {
    window.switchToXAU();
  } else {
    mountCryptoTradingView(currentSym);
  }

  if (currentView === 'realtime') {
    mountRealtimeXauChart(true);
  }
}

function setRealtimeTimeframe(tf) {
  currentTf = tf;
  syncRealtimeTimeframes();
  syncMobileTimeframes();
  realtimeTechnicalSummary = null;
  realtimeTechnicalKey = '';
  updateRealtimeSupportPanel();
  refreshRealtimeTechnicalSummary(true);
  if (currentView === 'realtime') {
    mountRealtimeXauChart(true);
  }
}

function getStoredUser() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem('tx_user') || '{}');
    return {
      name: parsed.name || parsed.email?.split('@')[0] || 'Sang',
      email: parsed.email || 'guest@xcapital.ai',
      plan: parsed.plan || localStorage.getItem('tx_plan') || 'Free',
      planExpiresAt: parsed.planExpiresAt || null,
      telegramId: parsed.telegramId || '',
      telegramUsername: parsed.telegramUsername || '',
      telegramVerified: Boolean(parsed.telegramVerified),
    };
  } catch (err) {
    return { name: 'Sang', email: 'guest@xcapital.ai', plan: localStorage.getItem('tx_plan') || 'Free', planExpiresAt: null, telegramId: '', telegramUsername: '', telegramVerified: false };
  }
}

function initials(name) {
  const parts = String(name || 'User').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function currentPlan() {
  const storedUser = getStoredUser();
  const stored = storedUser.plan || localStorage.getItem('tx_plan') || 'Free';
  return PLAN_CONFIGS[stored] ? stored : 'Free';
}

async function setPlan(plan) {
  const nextPlan = PLAN_CONFIGS[plan] ? plan : 'Free';
  const user = getStoredUser();

  try {
    const updatedUser = await postJson('/api/auth/update-plan', {
      email: user.email,
      plan: nextPlan,
    });
    sessionStorage.setItem('tx_user', JSON.stringify(updatedUser));
    localStorage.setItem('tx_plan', updatedUser.plan || nextPlan);
    renderProfile();
    await updateSignalUsageBadge();
    return true;
  } catch (err) {
    console.warn('Could not sync plan with backend:', err);
    openProfileModal('Nâng cấp tài khoản', `
      <div class="modal-info-card">
        <div class="modal-info-value">Không thể tự đổi gói tài khoản</div>
        <div class="modal-info-label">
          Vì lý do bảo mật, gói Free/Pro/Premium chỉ được cập nhật sau khi admin xác nhận hoặc sau thanh toán thành công.
        </div>
      </div>
      <div class="modal-info-card">
        <div class="modal-info-label">Liên hệ nâng cấp</div>
        <div class="modal-info-value"><button class="modal-info-link" data-modal-action="support-telegram" type="button">@ryantranforex</button></div>
      </div>
    `);
    return false;
  }
}

function renderProfile() {
  currentUser = getStoredUser();
  const plan = currentPlan();
  const abbr = initials(currentUser.name);
  const profilePlan = currentUser.telegramVerified ? plan : 'Verify Telegram 2/2';

  [
    ['profile-avatar', abbr],
    ['profile-name', currentUser.name],
    ['profile-plan', profilePlan],
  ].forEach(([id, text]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
  updateSignalUsageBadge();
  updatePhoneVerifyNudge();
  updateTelegramVerifyUi(currentUser);
}

function openProfileModal(title, bodyHtml) {
  const modal = document.getElementById('profile-modal');
  const titleEl = document.getElementById('profile-modal-title');
  const bodyEl = document.getElementById('profile-modal-body');
  if (!modal || !titleEl || !bodyEl) return;
  phoneNudgeDismissedWhileModalOpen = true;
  document.getElementById('phone-verify-nudge')?.remove();
  titleEl.textContent = title;
  bodyEl.innerHTML = bodyHtml;
  modal.classList.add('open');
  toggleProfileMenu(false);
}

function closeProfileModal() {
  document.getElementById('profile-modal')?.classList.remove('open');
  phoneNudgeDismissedWhileModalOpen = false;
  updatePhoneVerifyNudge();
}

function openProfileInfo() {
  const plan = currentPlan();
  const telegramVerified = Boolean(currentUser.telegramVerified);
  openProfileModal('Ho so tai khoan', `
    <div class="modal-info-card modal-profile-row">
      <span class="profile-avatar">${escapeHtml(initials(currentUser.name))}</span>
      <div>
        <div class="modal-info-value" style="font-size:20px">${escapeHtml(currentUser.name)}</div>
        <div class="modal-info-label">${escapeHtml(telegramVerified ? plan : 'Email-only')} Account</div>
      </div>
    </div>
    <div class="modal-info-card">
      <div class="modal-info-label">Ten khach hang</div>
      <div class="modal-info-value">${escapeHtml(currentUser.name)}</div>
    </div>
    <div class="modal-info-card">
      <div class="modal-info-label">Email dang nhap</div>
      <div class="modal-info-value">${escapeHtml(currentUser.email)}</div>
    </div>
    <div class="modal-info-card">
      <div class="modal-info-label">Trang thai tai khoan</div>
      <div class="modal-info-value">${telegramVerified ? 'Da xac minh email va Telegram' : 'Da xac minh email, chua xac minh Telegram'}</div>
    </div>
    <div class="modal-info-card">
      <div class="modal-info-label">Telegram</div>
      <div class="modal-info-value">${telegramVerified ? 'Da xac minh' : 'Chua xac minh'}</div>
      ${telegramVerified ? '' : '<button class="modal-action" data-modal-action="phone" type="button">Xac minh Telegram</button>'}
    </div>
    <div class="modal-info-card">
      <div class="modal-info-label">Quyen truy cap</div>
      <div class="modal-info-value">${telegramVerified ? 'Goi Free day du: 5 luot/ngay, cho 90 giay giua cac luot.' : 'Dung thu: 2 luot/ngay, cho 120 phut giua cac luot. Xac minh Telegram de mo goi Free.'}</div>
    </div>
  `);
}

function openPhoneVerification() {
  openTelegramAdmin();
}

function openUsageNotice() {
  document.getElementById('usage-notice')?.classList.add('open');
}

function usageNoticeStorageKey() {
  const email = getStoredUser().email || 'guest';
  return `${USAGE_NOTICE_HIDE_KEY_PREFIX}:${email}`;
}

function shouldShowUsageNotice() {
  return localStorage.getItem(usageNoticeStorageKey()) !== todayKey();
}

function scheduleUsageNotice() {
  if (!shouldShowUsageNotice()) return;
  setTimeout(() => {
    if (shouldShowUsageNotice()) openUsageNotice();
  }, 650);
}

function closeUsageNotice() {
  document.getElementById('usage-notice')?.classList.remove('open');
}

function acceptUsageNotice() {
  if (document.getElementById('usage-notice-hide-today')?.checked) {
    localStorage.setItem(usageNoticeStorageKey(), todayKey());
  }
  closeUsageNotice();
}

function openUpgradePlans() {
  const activePlan = currentPlan();
  const plans = [
    {
      name: 'Free',
      eyebrow: 'Starter access',
      price: '0đ / tháng',
      featured: false,
      items: [
        '5 lượt phân tích mỗi ngày',
        'Chờ 90 giây sau mỗi tín hiệu',
        'Phù hợp kiểm tra xu hướng cơ bản',
        'Lưu lịch sử tín hiệu demo',
      ],
    },
    {
      name: 'Pro',
      eyebrow: 'Active trader',
      price: 'Gói giao dịch chuyên sâu',
      featured: true,
      items: [
        '50 lượt phân tích mỗi ngày',
        'Chờ 30 giây sau mỗi tín hiệu',
        'Ưu tiên scalping nhiều khung thời gian',
        'Phù hợp phiên London và New York',
      ],
    },
    {
      name: 'Premium',
      eyebrow: 'Priority signal desk',
      price: 'Không giới hạn lượt',
      featured: false,
      items: [
        'Phân tích không giới hạn mỗi ngày',
        'Chờ 5 giây giữa các lượt',
        'Tối ưu cho trader cần phản ứng nhanh',
        'Trải nghiệm đầy đủ XCapital AI Signal',
      ],
    },
  ];

  openProfileModal('Nâng cấp tài khoản', `
    <div class="plans-grid">
      ${plans.map(plan => `
        <div class="plan-card ${plan.featured ? 'featured' : ''}">
          <div class="plan-eyebrow">${escapeHtml(plan.eyebrow)}</div>
          <div class="plan-name">${escapeHtml(plan.name)}</div>
          <div class="plan-price">${escapeHtml(plan.price)}</div>
          <ul class="plan-list">
            ${plan.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
          <button class="plan-action ${activePlan === plan.name ? 'active' : ''}" data-modal-action="select-plan" data-plan="${escapeHtml(plan.name)}" type="button">
            ${activePlan === plan.name ? 'ĐANG SỬ DỤNG' : plan.name === 'Free' ? 'GÓI MIỄN PHÍ' : 'LIÊN HỆ TELEGRAM'}
          </button>
        </div>
      `).join('')}
    </div>
    <div class="plan-footnote">
      Giới hạn lượt được tính theo từng ngày trên trình duyệt hiện tại. Nút PHÂN TÍCH sẽ tự áp dụng quota và thời gian chờ theo gói đang dùng.
    </div>
  `);
}

function openSettings() {
  const theme = getUiTheme();
  openProfileModal('Cài đặt hệ thống', `
    <div class="modal-info-card settings-row">
      <div>
        <div class="modal-info-value">Nền giao diện</div>
        <div class="modal-info-label">Chọn nền sáng hoặc tối cho toàn bộ terminal.</div>
      </div>
      <div class="theme-toggle" role="group" aria-label="Nền giao diện">
        <button class="theme-toggle-btn ${theme === 'dark' ? 'active' : ''}" data-modal-action="theme" data-theme-option="dark" type="button">Tối</button>
        <button class="theme-toggle-btn ${theme === 'light' ? 'active' : ''}" data-modal-action="theme" data-theme-option="light" type="button">Sáng</button>
      </div>
    </div>
    <div class="modal-info-card settings-row">
      <div>
        <div class="modal-info-value">Thông báo tín hiệu</div>
        <div class="modal-info-label">Bật để nhận cảnh báo khi bot phát hiện xu hướng mới.</div>
      </div>
      <div class="settings-pill">ON</div>
    </div>
    <div class="modal-info-card">
      <button class="modal-action" data-modal-action="password" type="button">🔒 Đổi mật khẩu</button>
    </div>
  `);
}

function openPasswordForm() {
  openProfileModal('Cài đặt hệ thống', `
    <div class="modal-info-card">
      <div class="modal-info-value" style="margin-bottom:14px">Đổi mật khẩu</div>
      <div class="password-form">
        <input id="old-password" type="password" placeholder="Nhập mật khẩu cũ">
        <input id="new-password" type="password" placeholder="Nhập mật khẩu mới">
        <input id="confirm-password" type="password" placeholder="Xác nhận mật khẩu mới">
        <button class="password-submit" data-modal-action="submit-password" type="button">Đổi mật khẩu</button>
        <button class="password-cancel" data-modal-action="settings" type="button">Hủy</button>
        <div class="profile-alert" id="password-alert"></div>
      </div>
    </div>
  `);
}

function openSupport() {
  openProfileModal('Trung tâm hỗ trợ', `
    <div class="modal-info-card">
      <div class="modal-info-value">Hướng dẫn nhanh</div>
      <div class="modal-info-label">Chọn cặp tiền, timeframe, nhập vốn/risk rồi bấm PHÂN TÍCH để bot tạo tín hiệu scalping.</div>
    </div>
    <div class="modal-info-card">
      <div class="modal-info-label">Telegram hỗ trợ</div>
      <div class="modal-info-value"><button class="modal-info-link" data-modal-action="support-telegram" type="button">@ryantranforex</button></div>
    </div>
    <div class="modal-info-card">
      <div class="modal-info-label">Lưu ý vận hành</div>
      <div class="modal-info-value">Bot ưu tiên entry LIMIT/retest; chỉ kích hoạt khi giá phản ứng tại vùng entry.</div>
    </div>
  `);
}

function submitPasswordChange() {
  const oldPassword = document.getElementById('old-password')?.value || '';
  const newPassword = document.getElementById('new-password')?.value || '';
  const confirmPassword = document.getElementById('confirm-password')?.value || '';
  const alertEl = document.getElementById('password-alert');
  const users = (() => {
    try { return JSON.parse(localStorage.getItem('tx_users') || '{}'); }
    catch (err) { return {}; }
  })();
  const userRecord = users[currentUser.email];
  const currentPassword = userRecord?.pw || '';

  if (!oldPassword || !newPassword || !confirmPassword) {
    if (alertEl) alertEl.textContent = 'Vui lòng nhập đầy đủ thông tin.';
    return;
  }
  if (currentPassword && oldPassword !== currentPassword) {
    if (alertEl) alertEl.textContent = 'Mật khẩu cũ không đúng.';
    return;
  }
  if (newPassword.length < 6) {
    if (alertEl) alertEl.textContent = 'Mật khẩu mới tối thiểu 6 ký tự.';
    return;
  }
  if (newPassword !== confirmPassword) {
    if (alertEl) alertEl.textContent = 'Xác nhận mật khẩu mới không khớp.';
    return;
  }

  if (userRecord) {
    users[currentUser.email] = { ...userRecord, pw: newPassword };
    localStorage.setItem('tx_users', JSON.stringify(users));
  }
  if (alertEl) alertEl.textContent = 'Đổi mật khẩu thành công.';
}

function toggleProfileMenu(forceOpen) {
  const menu = document.getElementById('profile-menu');
  if (!menu) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !menu.classList.contains('open');
  phoneNudgeHiddenByProfileMenu = shouldOpen;
  menu.classList.toggle('open', shouldOpen);
  if (shouldOpen) {
    renderProfile();
  }
  updatePhoneVerifyNudge();
}

function handleProfileClick(event) {
  const actionBtn = event.target.closest('[data-profile-action]');
  if (!actionBtn) return;
  const action = actionBtn.dataset.profileAction;
  if (action === 'upgrade') {
    openUpgradePlans();
  } else if (action === 'phone') {
    openPhoneVerification();
  } else if (action === 'profile') {
    openProfileInfo();
  } else if (action === 'settings') {
    openSettings();
  } else if (action === 'support') {
    openSupport();
  }
}

async function handleProfileModalClick(event) {
  const actionEl = event.target.closest('[data-modal-action]');
  const action = actionEl?.dataset.modalAction;
  if (action === 'password') openPasswordForm();
  else if (action === 'settings') openSettings();
  else if (action === 'profile') openProfileInfo();
  else if (action === 'phone') openPhoneVerification();
  else if (action === 'verify-telegram') openTelegramAdmin();
  else if (action === 'support-telegram') openTelegramAdmin();
  else if (action === 'submit-password') submitPasswordChange();
  else if (action === 'theme') {
    setUiTheme(actionEl.dataset.themeOption);
    openSettings();
  }
  else if (action === 'select-plan') {
    const plan = actionEl.dataset.plan;
    if (plan === currentPlan()) return;
    if (plan === 'Pro' || plan === 'Premium') {
      openTelegramAdmin();
    }
  }
}

function syncSignalControls() {
  const symSelect = document.getElementById('signal-symbol');
  const tfSelect = document.getElementById('signal-tf');

  if (symSelect && !symSelect.options.length) {
    symSelect.innerHTML = watchSymbols
      .map(w => `<option value="${w.sym}">${w.label}</option>`)
      .join('');
  }

  if (symSelect) symSelect.value = currentSym;
  if (tfSelect) tfSelect.value = currentTf;
}

function addChatBubble(type, html) {
  const chat = document.getElementById('signal-chat');
  if (!chat) return null;

  const bubble = document.createElement('div');
  bubble.className = `ai-chat-bubble ${type}`;
  bubble.innerHTML = html;
  chat.appendChild(bubble);
  chat.parentElement.scrollTop = chat.parentElement.scrollHeight;
  return bubble;
}

function usageKeyForToday() {
  const user = getStoredUser();
  const dateKey = new Date().toLocaleDateString('en-CA');
  return `${user.email || 'guest'}::${dateKey}`;
}

function loadSignalUsage() {
  try {
    return JSON.parse(localStorage.getItem(SIGNAL_USAGE_KEY) || '{}');
  } catch (err) {
    return {};
  }
}

function saveSignalUsage(usage) {
  localStorage.setItem(SIGNAL_USAGE_KEY, JSON.stringify(usage));
}

function getPlanRules() {
  if (!getStoredUser().telegramVerified) {
    return { dailyLimit: 2, cooldownSec: 120 * 60 };
  }
  return PLAN_CONFIGS[currentPlan()] || PLAN_CONFIGS.Free;
}

function getTodaySignalUsage() {
  const usage = loadSignalUsage();
  return usage[usageKeyForToday()] || { count: 0, lastAt: 0 };
}

function getRemainingSignalUses() {
  const rules = getPlanRules();
  const usage = getTodaySignalUsage();
  if (!Number.isFinite(rules.dailyLimit)) return Infinity;
  return Math.max(0, rules.dailyLimit - Number(usage.count || 0));
}

async function updateSignalUsageBadge() {
  const badge = document.getElementById('signal-usage-badge');
  if (!badge) return;

  const user = getStoredUser();
  try {
    const usage = await getJson(`/api/signal/usage?email=${encodeURIComponent(user.email)}`);
    const syncedUser = {
      ...user,
      plan: usage.plan || user.plan,
      planExpiresAt: usage.planExpiresAt || null,
      telegramVerified: Boolean(usage.telegramVerified),
    };
    sessionStorage.setItem('tx_user', JSON.stringify(syncedUser));
    currentUser = syncedUser;
    updateTelegramVerifyUi(syncedUser);

    if (usage.cooldownLeftSec > 0) {
      backendCooldownUntil = Date.now() + usage.cooldownLeftSec * 1000;
    }
    const isTelegramVerified = Boolean(usage.telegramVerified);
    const label = isTelegramVerified ? usage.plan : 'Verify Telegram';
    const dailyLimit = isTelegramVerified ? usage.dailyLimit : 2;
    const remaining = isTelegramVerified ? usage.remaining : Math.max(0, dailyLimit - Number(usage.used || 0));
    badge.textContent = dailyLimit === null
      ? `${label}: vo han`
      : `${label}: ${remaining}/${dailyLimit} luot`;
    const planEl = document.getElementById('profile-plan');
    if (planEl && !isTelegramVerified && dailyLimit !== null) {
      planEl.textContent = `Verify Telegram ${remaining}/${dailyLimit}`;
    } else if (planEl && isTelegramVerified) {
      planEl.textContent = usage.plan || currentPlan();
    }
    updatePhoneVerifyNudge();
  } catch (err) {
    const plan = currentPlan();
    const rules = getPlanRules();
    const remaining = getRemainingSignalUses();
    badge.textContent = Number.isFinite(remaining)
      ? `${plan}: ${remaining}/${rules.dailyLimit} luot`
      : `${plan}: vo han`;
  }
}

function getCooldownSecondsLeft() {
  if (backendCooldownUntil > Date.now()) {
    return Math.ceil((backendCooldownUntil - Date.now()) / 1000);
  }

  const rules = getPlanRules();
  const usage = getTodaySignalUsage();
  const waitMs = Math.max(0, rules.cooldownSec * 1000 - (Date.now() - Number(usage.lastAt || 0)));
  return Math.ceil(waitMs / 1000);
}

function resetAnalyzeButton() {
  const btn = document.getElementById('signal-analyze-btn');
  if (!btn) return;
  btn.disabled = false;
  btn.classList.remove('cooldown');
  btn.textContent = 'PHÂN TÍCH';
}

function startAnalyzeCooldown(seconds) {
  const btn = document.getElementById('signal-analyze-btn');
  if (!btn) return;

  if (Number.isFinite(seconds) && seconds > 0) {
    backendCooldownUntil = Date.now() + seconds * 1000;
  }

  clearInterval(analyzeCooldownTimer);
  const tick = () => {
    const secondsLeft = getCooldownSecondsLeft();
    if (secondsLeft <= 0) {
      clearInterval(analyzeCooldownTimer);
      analyzeCooldownTimer = null;
      resetAnalyzeButton();
      return;
    }
    btn.disabled = true;
    btn.classList.add('cooldown');
    btn.textContent = `${secondsLeft}s`;
  };

  tick();
  analyzeCooldownTimer = setInterval(tick, 1000);
}

function getSignalAccessState() {
  const plan = currentPlan();
  const rules = getPlanRules();
  const usage = getTodaySignalUsage();
  const now = Date.now();
  const cooldownMs = rules.cooldownSec * 1000;
  const waitMs = Math.max(0, cooldownMs - (now - Number(usage.lastAt || 0)));

  if (Number.isFinite(rules.dailyLimit) && usage.count >= rules.dailyLimit) {
    return {
      ok: false,
      plan,
      usage,
      rules,
      reason: `Bạn đã hết ${rules.dailyLimit} lượt phân tích trong ngày hôm nay. Mời bạn quay lại vào ngày hôm sau hoặc chọn Nâng cấp tài khoản để tiếp tục sử dụng bot.`,
    };
  }

  if (waitMs > 0) {
    return {
      ok: false,
      plan,
      usage,
      rules,
      waitSec: Math.ceil(waitMs / 1000),
      reason: `Gói ${plan} cần chờ thêm ${Math.ceil(waitMs / 1000)} giây trước khi phân tích tiếp.`,
    };
  }

  return { ok: true, plan, usage, rules };
}

function rememberSignalUsage() {
  const usage = loadSignalUsage();
  const key = usageKeyForToday();
  const todayUsage = usage[key] || { count: 0, lastAt: 0 };
  usage[key] = {
    count: Number(todayUsage.count || 0) + 1,
    lastAt: Date.now(),
  };
  saveSignalUsage(usage);
  return usage[key];
}

function getRiskSettings() {
  const balance = Number(document.getElementById('risk-balance')?.value || 0);
  const riskPercent = Number(document.getElementById('risk-percent')?.value || 0);
  return {
    balance: Number.isFinite(balance) && balance > 0 ? balance : 0,
    riskPercent: Number.isFinite(riskPercent) && riskPercent > 0 ? riskPercent : 0,
  };
}

function calculateRiskPlan(signal) {
  const { balance, riskPercent } = getRiskSettings();
  const entry = Number(signal.entry);
  const stopLoss = Number(signal.stopLoss);
  const takeProfit1 = Number(signal.takeProfit1);
  const direction = signal.direction;

  if (direction === 'WAIT' || !balance || !riskPercent || !Number.isFinite(entry) || !Number.isFinite(stopLoss)) {
    return null;
  }

  const riskAmount = balance * riskPercent / 100;
  const stopDistance = Math.abs(entry - stopLoss);
  if (!stopDistance) return null;

  const positionSize = riskAmount / stopDistance;
  const rewardDistance = Number.isFinite(takeProfit1) ? Math.abs(takeProfit1 - entry) : 0;
  const rr = rewardDistance ? rewardDistance / stopDistance : 0;
  const rewardAmount1 = riskAmount * rr;

  return {
    balance,
    riskPercent,
    riskAmount,
    stopDistance,
    positionSize,
    rr,
    rewardAmount1,
  };
}

function loadSignalHistory() {
  try {
    signalHistory = JSON.parse(localStorage.getItem(SIGNAL_HISTORY_KEY) || '[]');
  } catch (err) {
    signalHistory = [];
  }
}

function saveSignalHistory() {
  localStorage.setItem(SIGNAL_HISTORY_KEY, JSON.stringify(signalHistory.slice(0, SIGNAL_HISTORY_LIMIT)));
}

function formatHistoryTime(createdAt) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '--:--:--';

  const time = date.toLocaleTimeString('vi-VN', { hour12: false });
  const today = new Date().toLocaleDateString('vi-VN');
  const signalDate = date.toLocaleDateString('vi-VN');
  return signalDate === today ? time : `${signalDate} ${time}`;
}

function renderSignalHistory() {
  const list = document.getElementById('signal-history');
  if (!list) return;

  if (!signalHistory.length) {
    list.innerHTML = `<div class="history-item" style="cursor:default"><span>Chưa có tín hiệu</span><span>--</span></div>`;
    return;
  }

  list.innerHTML = signalHistory.map(item => `
    <button class="history-item" data-action="load-history" data-id="${escapeHtml(item.id)}">
      <span>
        ${escapeHtml(item.symbol)} · ${escapeHtml(item.timeframe)}<br>
        <span style="color:var(--muted);font-size:8px">${escapeHtml(formatHistoryTime(item.createdAt))}</span>
      </span>
      <span class="history-dir ${escapeHtml(item.direction.toLowerCase())}">${escapeHtml(item.direction)} ${item.confidence}%</span>
    </button>
  `).join('');
}

function rememberSignal(signal, riskPlan) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const item = {
    id,
    createdAt: new Date().toISOString(),
    riskPlan,
    ...signal,
  };
  signalHistory = [item, ...signalHistory.filter(existing => existing.id !== id)].slice(0, SIGNAL_HISTORY_LIMIT);
  saveSignalHistory();
  renderSignalHistory();
  return item;
}

function renderHistorySignal(id) {
  const item = signalHistory.find(signal => signal.id === id);
  if (!item) return;

  const market = watchSymbols.find(w => w.sym === item.symbol)?.market || 'crypto';
  currentTf = item.timeframe || currentTf;
  document.querySelectorAll('.tf-btn').forEach(button => {
    button.classList.toggle('active', button.textContent.trim().toLowerCase() === currentTf.toLowerCase());
  });
  selectSym(item.symbol, market);
  addChatBubble('bot', renderSignalResult(item, item.riskPlan, item.id));
}

function renderSignalResult(result) {
  const sideClass = result.direction.toLowerCase();
  const actionText = result.direction === 'WAIT'
    ? 'WAIT'
    : (result.orderType || result.direction);
  const directionIcon = result.direction === 'BUY'
    ? '▲'
    : result.direction === 'SELL' ? '▼' : '◆';
  const marketText = `${result.symbol || result.sym || '--'} · ${result.timeframe || result.tf || currentTf}`;
  const orderRows = result.direction === 'WAIT'
    ? `<div class="setup-note">${escapeHtml(result.mtf?.reason || 'Không mở lệnh ngay. Chờ phá vỡ vùng high/low gần nhất rồi retest có xác nhận.')}</div>`
    : `
      <div class="sig-row"><span class="sig-row-label">ENTRY</span><span class="sig-row-val val-entry">${formatPrice(result.entry)}</span></div>
      <div class="sig-row"><span class="sig-row-label">STOP LOSS</span><span class="sig-row-val val-sl">${formatPrice(result.stopLoss)}</span></div>
      <div class="sig-row"><span class="sig-row-label">TP 1</span><span class="sig-row-val val-tp">${formatPrice(result.takeProfit1)}</span></div>
      <div class="sig-row"><span class="sig-row-label">TP 2</span><span class="sig-row-val val-tp">${formatPrice(result.takeProfit2)}</span></div>
      <div class="sig-row"><span class="sig-row-label">TP 3</span><span class="sig-row-val val-tp">${formatPrice(result.takeProfit3)}</span></div>`;

  return `
    <div class="ai-chat-meta"><span>BOT AI SIGNAL</span><span>${new Date().toLocaleTimeString('vi-VN', { hour12: false })}</span></div>
    <div class="signal-card ${sideClass}">
      <div class="sig-top">
        <div class="sig-direction">${directionIcon} ${escapeHtml(actionText)}</div>
        <span class="order-type">${escapeHtml(marketText)}</span>
      </div>
      ${orderRows}
      <div class="sig-conf">
        <span class="sig-conf-label">CONF</span>
        <div class="conf-bar"><div class="conf-fill" style="width:${result.confidence}%"></div></div>
        <span class="sig-conf-pct">${result.confidence}%</span>
      </div>
      <div class="setup-note">
        ${escapeHtml(result.conclusion || result.structure || '')}
      </div>
    </div>`;
}

async function runSignalAnalysis() {
  const symSelect = document.getElementById('signal-symbol');
  const tfSelect = document.getElementById('signal-tf');
  const btn = document.getElementById('signal-analyze-btn');
  const sym = symSelect?.value || currentSym;
  const tf = tfSelect?.value || currentTf;
  const market = watchSymbols.find(w => w.sym === sym)?.market || 'crypto';
  const user = getStoredUser();
  const customerName = user.name;
  const riskSettings = getRiskSettings();
  let analysisCompleted = false;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'ĐANG PHÂN TÍCH...';
  }
  addChatBubble('user', `
    <div class="ai-chat-meta"><span>${escapeHtml(customerName)}</span><span>REQUEST</span></div>
    <div class="ai-q-text">Phân tích ${escapeHtml(getWatchLabel(sym))} trên khung ${escapeHtml(tf)}</div>
  `);

  const loading = addChatBubble('bot', `
    <div class="ai-chat-meta"><span>BOT AI SIGNAL</span><span>SCANNING</span></div>
    <div class="ai-a-text loading">Đang quét thị trường...</div>
    <div class="scan-list">
      <div class="scan-step">Fetching market data</div>
      <div class="scan-step">Reading 1h / 15m / 5m structure</div>
      <div class="scan-step">Calculating EMA / RSI / ATR / MACD</div>
      <div class="scan-step">Filtering liquidity, risk and MTF alignment</div>
      <div class="scan-step">Generating AI conclusion</div>
    </div>
  `);

  try {
    currentTf = tf;
    document.querySelectorAll('.tf-btn').forEach(button => {
      button.classList.toggle('active', button.textContent.trim().toLowerCase() === tf.toLowerCase());
    });
    selectSym(sym, market);

    await fetchWatchPrices(watchSymbols, watchPrices);
    refreshMarketViews();
    const result = await postJson('/api/ai/signal', { symbol: sym, timeframe: tf, userEmail: user.email, riskSettings });
    const riskPlan = calculateRiskPlan(result);
    const stored = rememberSignal(result, riskPlan);
    if (result.usage?.cooldownSec) {
      backendCooldownUntil = Date.now() + result.usage.cooldownSec * 1000;
    }
    await updateSignalUsageBadge();
    analysisCompleted = true;
    if (loading) loading.innerHTML = renderSignalResult(stored, riskPlan, stored.id);
  } catch (err) {
    if (loading) {
      const message = err.message === 'Failed to fetch'
        ? 'Không kết nối được backend AI Signal. Hãy chạy node backend/server.js rồi mở http://localhost:3000/login.html để bot lấy dữ liệu XAU/USD và thị trường.'
        : (err.message || err);
      const normalizedMessage = String(message).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const isLimitMessage = /cooldown|limit|quota|remaining|het luot|cho them/.test(normalizedMessage);
      loading.innerHTML = `
        <div class="ai-chat-meta"><span>BOT AI SIGNAL</span><span>${isLimitMessage ? 'LIMIT' : 'ERROR'}</span></div>
        <div class="ai-a-text" style="color:${isLimitMessage ? 'var(--yellow)' : 'var(--red)'}">${escapeHtml(isLimitMessage ? message : `Không lấy được dữ liệu để phân tích: ${message}`)}</div>`;
    }
  } finally {
    if (analysisCompleted) startAnalyzeCooldown();
    else resetAnalyzeButton();
  }
}

async function handleSignalPanelClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;
  if (action === 'load-history') {
    renderHistorySignal(actionEl.dataset.id);
  }
}

function mountTradingViewChart({ containerId, symbol }) {
  const canvas = document.getElementById('chart-canvas');
  if (!canvas || typeof TradingView === 'undefined') return;

  canvas.innerHTML = `<div id="${containerId}" style="width:100%;height:100%"></div>`;
  const isLightTheme = getUiTheme() === 'light';

  new TradingView.widget({
    container_id: containerId,
    width: '100%',
    height: '100%',
    symbol,
    interval: tvInterval(currentTf),
    timezone: 'Asia/Ho_Chi_Minh',
    theme: isLightTheme ? 'light' : 'dark',
    style: '1',
    locale: 'vi_VN',
    toolbar_bg: isLightTheme ? '#ffffff' : '#070b0f',
    enable_publishing: false,
    hide_top_toolbar: true,
    hide_side_toolbar: true,
    hide_legend: true,
    save_image: false,
    backgroundColor: isLightTheme ? '#ffffff' : '#070b0f',
    gridColor: isLightTheme ? 'rgba(0,92,74,0.08)' : 'rgba(0,200,150,0.05)',
    details: false,
    hotlist: false,
    calendar: false,
    disabled_features: [
      'header_widget',
      'left_toolbar',
      'legend_widget',
      'display_market_status',
      'symbol_info',
      'create_volume_indicator_by_default',
      'volume_force_overlay',
      'header_symbol_search',
      'header_compare',
      'header_indicators',
      'header_settings',
      'header_chart_type',
      'header_interval_dialog_button',
      'header_undo_redo',
      'header_screenshot',
      'header_fullscreen_button',
    ],
    studies: [],
  });
}

function renderTradingViewInfo() {
  syncSignalControls();
}

function mountRealtimeXauChart(force = false) {
  const container = document.getElementById('realtime-xau-chart');
  if (!container || typeof TradingView === 'undefined') return;
  if (realtimeChartMounted && !force) return;

  container.innerHTML = '<div id="realtime-tv-widget-container" style="width:100%;height:100%"></div>';
  const isLightTheme = getUiTheme() === 'light';
  new TradingView.widget({
    container_id: 'realtime-tv-widget-container',
    width: '100%',
    height: '100%',
    symbol: 'OANDA:XAUUSD',
    interval: tvInterval(currentTf),
    timezone: 'Asia/Ho_Chi_Minh',
    theme: isLightTheme ? 'light' : 'dark',
    style: '1',
    locale: 'vi_VN',
    toolbar_bg: isLightTheme ? '#ffffff' : '#070b0f',
    enable_publishing: false,
    hide_top_toolbar: true,
    hide_side_toolbar: true,
    hide_legend: true,
    save_image: false,
    backgroundColor: isLightTheme ? '#ffffff' : '#070b0f',
    gridColor: isLightTheme ? 'rgba(0,92,74,0.08)' : 'rgba(0,200,150,0.05)',
    details: false,
    hotlist: false,
    calendar: false,
    disabled_features: [
      'header_widget',
      'left_toolbar',
      'legend_widget',
      'display_market_status',
      'symbol_info',
      'create_volume_indicator_by_default',
      'volume_force_overlay',
      'header_symbol_search',
      'header_compare',
      'header_indicators',
      'header_settings',
      'header_chart_type',
      'header_interval_dialog_button',
      'header_undo_redo',
      'header_screenshot',
      'header_fullscreen_button',
      'context_menus',
    ],
    studies: [
      'MASimple@tv-basicstudies',
      'MAExp@tv-basicstudies',
      'BB@tv-basicstudies',
    ],
  });
  realtimeChartMounted = true;
}

function setAppView(view) {
  currentView = view === 'realtime' ? 'realtime' : 'main';
  document.body.classList.toggle('view-realtime', currentView === 'realtime');
  document.querySelectorAll('[data-view-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.viewTab === currentView);
  });

  if (currentView === 'realtime') {
    document.body.classList.remove('signal-open');
    syncRealtimeTimeframes();
    const sbEl = document.getElementById('sb-sym');
    const candlesEl = document.getElementById('sb-candles');
    if (sbEl) sbEl.textContent = `XAUUSD · Realtime · ${currentTf}`;
    if (candlesEl) candlesEl.textContent = 'OANDA · TradingView';
    mountRealtimeXauChart();
    startRealtimePriceFeed();
    refreshRealtimeTechnicalSummary();
    return;
  }

  stopRealtimePriceFeed();
  setHeader({
    displaySymbol: getWatchLabel(currentSym),
    statusSymbol: currentSym,
    marketLabel: chartMode === 'xauusd' ? 'OANDA · TradingView' : 'BINANCE · TradingView',
  });
  updateHeaderFromWatchPrice(currentSym);
}

function mountCryptoTradingView(sym) {
  chartMode = 'crypto';
  currentSym = sym;

  setHeader({
    displaySymbol: sym,
    statusSymbol: sym,
    marketLabel: 'BINANCE · TradingView',
  });
  updateHeaderFromWatchPrice(sym);

  renderWatchlist(watchSymbols, watchPrices, currentSym, selectSym);
  renderMobileMarketMenu();
  mountTradingViewChart({
    containerId: 'tv-widget-container',
    symbol: `BINANCE:${sym}`,
  });

  renderTradingViewInfo({
    title: `◆ ${sym}`,
    source: 'BINANCE · SPOT',
    questions: [
      `Phân tích xu hướng ${sym} hôm nay`,
      `${sym} có nên mua không?`,
      `Support/Resistance ${sym}`,
    ],
  });
}

function selectSym(sym, market = 'crypto') {
  if (market === 'xauusd' || sym === 'XAUUSD') {
    window.switchToXAU();
    return;
  }
  mountCryptoTradingView(sym);
}

window.selectSymTV = selectSym;

window.setTf = function(btn, tf) {
  setTimeframe(tf, btn);
};

window.switchToXAU = function() {
  chartMode = 'xauusd';
  currentSym = 'XAUUSD';

  document.querySelectorAll('.sym-row').forEach(row => row.classList.remove('active'));
  renderWatchlist(watchSymbols, watchPrices, currentSym, selectSym);
  renderMobileMarketMenu();

  setHeader({
    displaySymbol: 'XAU/USD',
    statusSymbol: 'XAUUSD',
    marketLabel: 'OANDA · TradingView',
  });
  updateHeaderFromWatchPrice('XAUUSD');

  mountTradingViewChart({
    containerId: 'tv-widget-container',
    symbol: 'OANDA:XAUUSD',
  });

  renderTradingViewInfo({
    title: '◆ XAU/USD',
    source: 'OANDA · SPOT',
    questions: [
      'Phân tích xu hướng XAUUSD hôm nay',
      'Vàng có nên mua không?',
      'Support/Resistance XAUUSD',
    ],
  });
};

window.addEventListener('load', async () => {
  loadSignalHistory();
  renderSignalHistory();
  await updateSignalUsageBadge();
  if (getCooldownSecondsLeft() > 0) startAnalyzeCooldown();
  await fetchWatchPrices(watchSymbols, watchPrices);
  refreshMarketViews();
  syncSignalControls();

  const defaultMarket = watchSymbols.find(w => w.sym === currentSym)?.market || 'crypto';
  selectSym(currentSym, defaultMarket);

  updateClock();
  setInterval(updateClock, 1000);
  renderSessions();
  renderMobileSessions();
  syncMobileProfileDock();
  syncMobileTimeframes();
  setInterval(renderSessions, 60000);
  setInterval(renderMobileSessions, 60000);

  setInterval(async () => {
    await fetchWatchPrices(watchSymbols, watchPrices);
    refreshMarketViews();
  }, MARKET_REFRESH_MS);

  renderProfile();
  document.getElementById('profile-trigger')?.addEventListener('click', event => {
    event.stopPropagation();
    toggleProfileMenu();
  });
  document.getElementById('profile-menu')?.addEventListener('click', event => {
    event.stopPropagation();
    handleProfileClick(event);
  });
  document.getElementById('profile-logout-btn')?.addEventListener('click', logout);
  document.getElementById('profile-modal-close')?.addEventListener('click', closeProfileModal);
  document.getElementById('profile-modal')?.addEventListener('click', event => {
    if (event.target.id === 'profile-modal') closeProfileModal();
    else handleProfileModalClick(event);
  });
  document.getElementById('usage-notice-accept')?.addEventListener('click', acceptUsageNotice);
  document.getElementById('usage-notice')?.addEventListener('click', event => {
    if (event.target.id === 'usage-notice') closeUsageNotice();
    if (event.target.closest('[data-notice-action="telegram"]')) openTelegramAdmin();
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#profile-menu') && !event.target.closest('#profile-trigger')) {
      toggleProfileMenu(false);
    }
    if (!event.target.closest('#mobile-market-menu') && !event.target.closest('#ch-sym')) {
      toggleMobileMarketMenu(false);
    }
  });
  document.getElementById('signal-analyze-btn')?.addEventListener('click', runSignalAnalysis);
  document.getElementById('signal-panel')?.addEventListener('click', handleSignalPanelClick);
  document.getElementById('signal-drawer-toggle')?.addEventListener('click', () => toggleSignalDrawer(true));
  document.getElementById('signal-panel-close')?.addEventListener('click', () => toggleSignalDrawer(false));
  document.querySelectorAll('[data-view-tab]').forEach(button => {
    button.addEventListener('click', () => setAppView(button.dataset.viewTab));
  });
  document.getElementById('realtime-tf-row')?.addEventListener('click', event => {
    const button = event.target.closest('[data-realtime-tf]');
    if (!button) return;
    setRealtimeTimeframe(button.dataset.realtimeTf);
  });
  document.getElementById('ch-sym')?.addEventListener('click', event => {
    event.stopPropagation();
    toggleMobileMarketMenu();
  });
  document.getElementById('mobile-market-menu')?.addEventListener('click', event => {
    const button = event.target.closest('[data-mobile-sym]');
    if (!button) return;
    selectSym(button.dataset.mobileSym, button.dataset.mobileMarket);
    toggleMobileMarketMenu(false);
  });
  document.getElementById('mobile-timeframes')?.addEventListener('click', event => {
    const button = event.target.closest('[data-mobile-tf]');
    if (!button) return;
    setTimeframe(button.dataset.mobileTf, button);
  });
  window.addEventListener('resize', () => {
    syncMobileProfileDock();
    updatePhoneVerifyNudge();
    if (!isMobileLayout()) {
      document.body.classList.remove('signal-open');
      toggleMobileMarketMenu(false);
    }
  });

  scheduleUsageNotice();
  window.testBTC = () => selectSym('BTCUSDT');
});

window.addEventListener('pageshow', () => {
  if (sessionStorage.getItem('tx_auth')) {
    scheduleUsageNotice();
  }
});
