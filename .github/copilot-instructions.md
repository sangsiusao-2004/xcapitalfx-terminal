# Copilot instructions for TradeX AI

- This repo is a static frontend-only trading dashboard. There is no backend server project or build pipeline.
- Entry points are `login.html` and `index.html`.
- `index.html` loads `js/app.js` as an ES module: do not assume CommonJS or bundling.
- `js/config.js` is the single source of runtime settings: API keys, default symbol/timeframe, watchlist coins, and chart colors.
- `js/app.js` is the orchestrator:
  - `checkAuth()` from `js/auth.js`
  - `initChart()` and `loadKlines()` from `js/chart.js`
  - `renderWatchlist()` / `fetchWatchPrices()` from `js/watchlist.js`
  - `connectWS()` from `js/websocket.js`
  - `generateSignals()` from `js/signals.js`
  - `askAI()` from `js/ai.js`
  - clock and session panel updates from `js/utils.js`
- Authentication is client-side only, implemented directly in `login.html` using `localStorage` + `sessionStorage`. `tx_auth` in `sessionStorage` gates access to `index.html`.
- The app uses browser globals heavily: `window.selectSymTV`, `window.setTf`, `window.switchToXAU`, and inline HTML event handlers are expected.
- Page flow:
  1. `login.html` authenticates users and redirects to `index.html`.
  2. `index.html` initializes the chart, watchlist, ticker, session clock, and realtime Binance websocket.
- External integrations:
  - Binance REST API for klines and 24h ticker (`js/chart.js`, `js/watchlist.js`)
  - Binance WebSocket miniTicker for live price updates (`js/websocket.js`)
  - Anthropic Claude API for AI chat (`js/ai.js`)
  - TradingView widget loaded from CDN in `index.html`
  - LightweightCharts loaded from CDN in `index.html`
  - EmailJS OTP registration in `login.html`
- Important runtime requirement: because the app uses native ES modules, it must be served over HTTP. Use one of these:
  - `cd tradex-terminal && python -m http.server 8080`
  - VS Code Live Server opening `login.html`
- Do not add build-tool assumptions, package installs, or server-side rendering. Fixes and features should keep the current module-based, browser-first structure.
- Refer to these files for conventions:
  - `js/config.js` for global settings
  - `js/app.js` for state and page orchestration
  - `js/chart.js` for Binance data loading and chart rendering
  - `js/websocket.js` for WebSocket lifecycle and price updates
  - `login.html` for auth flow and OTP/email registration

> If anything in this file is unclear or incomplete, point me to the area you want expanded and I’ll refine it.