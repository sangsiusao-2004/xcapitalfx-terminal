const binanceRepository = require('../repositories/binanceRepository');
const tradingViewRepository = require('../repositories/tradingViewRepository');

const TV_SYMBOLS = {
  XAUUSD: 'OANDA:XAUUSD',
};

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeInterval(interval) {
  const allowed = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']);
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

function parseTradingViewTechnicals(raw) {
  const row = raw.data?.[0];
  if (!row) throw new Error('No TradingView technicals available');
  const [
    name,
    close,
    change,
    recommendAll,
    recommendMa,
    recommendOther,
    rsiValue,
    rsiPrev,
    macd,
    macdSignal,
    ema20,
    ema50,
    ema200,
    adx,
  ] = row.d;

  return {
    name,
    close: Number(close),
    change: Number(change),
    recommendAll: Number(recommendAll),
    recommendMa: Number(recommendMa),
    recommendOther: Number(recommendOther),
    rsi: Number(rsiValue),
    rsiPrev: Number(rsiPrev),
    macd: Number(macd),
    macdSignal: Number(macdSignal),
    ema20: Number(ema20),
    ema50: Number(ema50),
    ema200: Number(ema200),
    adx: Number(adx),
  };
}

function buildTechnicalSummary(technicals, symbol, interval) {
  let score = 0;
  const emaBull = technicals.ema20 > technicals.ema50 && technicals.ema50 >= technicals.ema200 * 0.995;
  const emaBear = technicals.ema20 < technicals.ema50 && technicals.ema50 <= technicals.ema200 * 1.005;
  const macdBull = technicals.macd > technicals.macdSignal;

  if (technicals.change > 0) score += 1;
  if (technicals.change < 0) score -= 1;
  if (emaBull) score += 2;
  if (emaBear) score -= 2;
  if (macdBull) score += 1;
  else score -= 1;
  if (technicals.rsi >= 52 && technicals.rsi <= 70) score += 1;
  if (technicals.rsi <= 48 && technicals.rsi >= 30) score -= 1;
  if (technicals.recommendAll > 0.1) score += 2;
  if (technicals.recommendAll < -0.1) score -= 2;

  const direction = score >= 3 ? 'BUY' : score <= -3 ? 'SELL' : 'WAIT';
  const confidence = Math.max(35, Math.min(92, 44 + Math.abs(score) * 8 + (technicals.adx > 25 ? 8 : 0)));
  const volatility = Number.isFinite(technicals.adx) ? technicals.adx : 0;
  const status = direction === 'BUY'
    ? 'Xu hướng tăng'
    : direction === 'SELL'
      ? 'Xu hướng giảm'
      : 'Thị trường sideways';
  const note = direction === 'BUY'
    ? 'Technical summary nghiêng về phe mua. Ưu tiên chờ giá hồi về EMA/vùng hỗ trợ rồi xác nhận thêm phản ứng nến.'
    : direction === 'SELL'
      ? 'Technical summary nghiêng về phe bán. Ưu tiên chờ giá hồi lên EMA/vùng kháng cự rồi xác nhận thêm phản ứng nến.'
      : 'Tín hiệu kỹ thuật chưa đồng thuận. Nên chờ phá vỡ vùng hỗ trợ/kháng cự hoặc retest rõ hơn.';

  return {
    symbol,
    interval,
    direction,
    status,
    note,
    confidence: Math.round(confidence),
    volatility: Math.round(volatility * 100) / 100,
    score,
    technicals,
  };
}

async function getTechnicalSummary(symbol, interval) {
  const cleanSymbol = normalizeSymbol(symbol);
  const cleanInterval = normalizeInterval(interval);
  if (!TV_SYMBOLS[cleanSymbol]) {
    throw new Error(`Technical summary is not configured for ${cleanSymbol}`);
  }

  const raw = await tradingViewRepository.getTechnicals([TV_SYMBOLS[cleanSymbol]], cleanInterval);
  return buildTechnicalSummary(parseTradingViewTechnicals(raw), cleanSymbol, cleanInterval);
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
  getTechnicalSummary,
};
