import { getJson } from '../request/apiClient.js';

const BINANCE_BASE_URL = 'https://api.binance.com';
const TRADINGVIEW_SCANNER_BASE_URL = 'https://scanner.tradingview.com';
const TV_SYMBOLS = {
  XAUUSD: 'OANDA:XAUUSD',
};

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatBinanceTicker(raw) {
  return {
    symbol: raw.symbol,
    price: Number(raw.lastPrice),
    open: Number(raw.openPrice),
    high: Number(raw.highPrice),
    low: Number(raw.lowPrice),
    volume: Number(raw.volume),
    change: Number(raw.priceChangePercent),
  };
}

function formatTradingViewTicker(raw, fallbackSymbol) {
  const [name, close, change, open, high, low, volume] = raw.d;
  return {
    symbol: fallbackSymbol || name,
    price: Number(close),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    volume: Number(volume || 0),
    change: Number(change),
  };
}

async function getDirectBinanceTicker24h(symbol) {
  const url = `${BINANCE_BASE_URL}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
  return formatBinanceTicker(await fetchJson(url));
}

async function getDirectBinanceTickers24h(symbols) {
  const url = `${BINANCE_BASE_URL}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
  return (await fetchJson(url)).map(formatBinanceTicker);
}

async function getDirectTradingViewTickers(symbols) {
  const tvSymbols = symbols.map(symbol => TV_SYMBOLS[symbol]);
  const raw = await fetchJson(`${TRADINGVIEW_SCANNER_BASE_URL}/cfd/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbols: {
        tickers: tvSymbols,
        query: { types: [] },
      },
      columns: ['name', 'close', 'change', 'open', 'high', 'low', 'volume'],
    }),
  });

  return (raw.data || []).map(quote => {
    const symbol = symbols.find(item => TV_SYMBOLS[item] === quote.s);
    return formatTradingViewTicker(quote, symbol);
  });
}

async function getDirectTicker24h(symbol) {
  const cleanSymbol = normalizeSymbol(symbol);
  if (TV_SYMBOLS[cleanSymbol]) {
    const data = await getDirectTradingViewTickers([cleanSymbol]);
    if (!data[0]) throw new Error(`No TradingView quote for ${cleanSymbol}`);
    return data[0];
  }
  return getDirectBinanceTicker24h(cleanSymbol);
}

async function getDirectTickers24h(symbols) {
  const cleanSymbols = symbols.map(normalizeSymbol).filter(Boolean);
  const tvSymbols = cleanSymbols.filter(symbol => TV_SYMBOLS[symbol]);
  const binanceSymbols = cleanSymbols.filter(symbol => !TV_SYMBOLS[symbol]);
  const results = [];

  const batches = await Promise.allSettled([
    binanceSymbols.length ? getDirectBinanceTickers24h(binanceSymbols) : Promise.resolve([]),
    tvSymbols.length ? getDirectTradingViewTickers(tvSymbols) : Promise.resolve([]),
  ]);

  batches.forEach(batch => {
    if (batch.status === 'fulfilled') results.push(...batch.value);
    else console.warn('[MarketService] direct market fetch failed:', batch.reason);
  });

  const bySymbol = new Map(results.map(item => [item.symbol, item]));
  return cleanSymbols.map(symbol => bySymbol.get(symbol)).filter(Boolean);
}

export function getKlines(symbol, interval) {
  return getJson(
    `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`
  );
}

export async function getTicker24h(symbol) {
  try {
    return await getJson(`/api/market/ticker24h?symbol=${encodeURIComponent(symbol)}`);
  } catch (err) {
    console.warn('[MarketService] backend ticker failed, using direct market API:', err);
    return getDirectTicker24h(symbol);
  }
}

export async function getTickers24h(symbols) {
  try {
    return await getJson(`/api/market/tickers24h?symbols=${encodeURIComponent(symbols.join(','))}`);
  } catch (err) {
    console.warn('[MarketService] backend tickers failed, using direct market API:', err);
    return getDirectTickers24h(symbols);
  }
}
