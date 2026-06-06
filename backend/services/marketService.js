const binanceRepository = require('../repositories/binanceRepository');
const tradingViewRepository = require('../repositories/tradingViewRepository');

const TV_SYMBOLS = {
  XAUUSD: 'OANDA:XAUUSD',
};

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeInterval(interval) {
  const allowed = new Set(['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M']);
  return allowed.has(interval) ? interval : '1h';
}

function formatCandle(kline) {
  return {
    time: Math.floor(Number(kline[0]) / 1000),
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5]),
  };
}

function formatTicker(raw) {
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
    source: raw.s,
  };
}

async function getKlines(symbol, interval) {
  const cleanSymbol = normalizeSymbol(symbol);
  const cleanInterval = normalizeInterval(interval);
  if (!cleanSymbol) throw new Error('symbol is required');

  const limit = cleanInterval === '1m' || cleanInterval === '5m' ? 200 : 300;
  const raw = await binanceRepository.getKlines(cleanSymbol, cleanInterval, limit);
  return {
    symbol: cleanSymbol,
    interval: cleanInterval,
    candles: raw.map(formatCandle),
  };
}

async function getTicker24h(symbol) {
  const cleanSymbol = normalizeSymbol(symbol);
  if (!cleanSymbol) throw new Error('symbol is required');

  if (TV_SYMBOLS[cleanSymbol]) {
    const raw = await tradingViewRepository.getQuotes([TV_SYMBOLS[cleanSymbol]]);
    const quote = raw.data?.[0];
    if (!quote) throw new Error(`No TradingView quote for ${cleanSymbol}`);
    return formatTradingViewTicker(quote, cleanSymbol);
  }

  const raw = await binanceRepository.getTicker24h(cleanSymbol);
  return formatTicker(raw);
}

async function getTickers24h(symbols) {
  const cleanSymbols = String(symbols || '')
    .split(',')
    .map(normalizeSymbol)
    .filter(Boolean);

  if (!cleanSymbols.length) throw new Error('symbols is required');

  const tvSymbols = cleanSymbols.filter(symbol => TV_SYMBOLS[symbol]);
  const binanceSymbols = cleanSymbols.filter(symbol => !TV_SYMBOLS[symbol]);
  const results = [];

  if (binanceSymbols.length) {
    const raw = await binanceRepository.getTickers24h(binanceSymbols);
    results.push(...raw.map(formatTicker));
  }

  if (tvSymbols.length) {
    const raw = await tradingViewRepository.getQuotes(tvSymbols.map(symbol => TV_SYMBOLS[symbol]));
    raw.data.forEach(quote => {
      const symbol = tvSymbols.find(item => TV_SYMBOLS[item] === quote.s);
      results.push(formatTradingViewTicker(quote, symbol));
    });
  }

  const bySymbol = new Map(results.map(item => [item.symbol, item]));
  return cleanSymbols.map(symbol => bySymbol.get(symbol)).filter(Boolean);
}

module.exports = {
  getKlines,
  getTicker24h,
  getTickers24h,
};
