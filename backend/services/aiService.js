const { CONFIG } = require('../config');
const anthropicRepository = require('../repositories/anthropicRepository');
const marketService = require('./marketService');
const tradingViewRepository = require('../repositories/tradingViewRepository');

const TV_SYMBOLS = {
  XAUUSD: 'OANDA:XAUUSD',
};

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeTimeframe(timeframe) {
  const allowed = new Set(['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M']);
  return allowed.has(timeframe) ? timeframe : '1h';
}

function ema(values, period) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let value = values[0];
  for (let i = 1; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
}

function rsi(values, period = 14) {
  if (values.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

function atr(candles, period = 14) {
  if (candles.length <= period) return 0;
  let total = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];
    total += Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );
  }
  return total / period;
}

function highest(candles, key) {
  return Math.max(...candles.map(candle => candle[key]).filter(Number.isFinite));
}

function lowest(candles, key) {
  return Math.min(...candles.map(candle => candle[key]).filter(Number.isFinite));
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseTradingViewTechnicals(raw) {
  const row = raw.data?.[0];
  if (!row) return null;
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
    stochK,
    stochD,
    cci20,
    momentum,
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
    stochK: Number(stochK),
    stochD: Number(stochD),
    cci20: Number(cci20),
    momentum: Number(momentum),
  };
}

function buildSnapshotFromTicker(ticker, technicals) {
  const price = Number(technicals?.close || ticker.price);
  const open = Number(ticker.open);
  const high = Number(ticker.high);
  const low = Number(ticker.low);
  const range = Math.max(high - low, price * 0.002);
  return {
    price,
    open,
    high,
    low,
    change: Number(ticker.change),
    volume: Number(ticker.volume || 0),
    range,
    candles: [],
    technicals,
  };
}

async function collectMarketContext(symbol, timeframe) {
  const cleanSymbol = normalizeSymbol(symbol);
  const cleanTimeframe = normalizeTimeframe(timeframe);
  if (!cleanSymbol) throw new Error('symbol is required');

  const ticker = await marketService.getTicker24h(cleanSymbol);
  let candles = [];
  let technicals = null;

  if (TV_SYMBOLS[cleanSymbol]) {
    const rawTechnicals = await tradingViewRepository.getTechnicals([TV_SYMBOLS[cleanSymbol]], cleanTimeframe);
    technicals = parseTradingViewTechnicals(rawTechnicals);
    return {
      symbol: cleanSymbol,
      timeframe: cleanTimeframe,
      source: 'TradingView/OANDA',
      ticker,
      ...buildSnapshotFromTicker(ticker, technicals),
    };
  }

  const klineData = await marketService.getKlines(cleanSymbol, cleanTimeframe);
  candles = klineData.candles || [];
  const closes = candles.map(candle => candle.close);
  const price = Number(ticker.price || closes[closes.length - 1]);
  const high = Number(ticker.high || highest(candles, 'high'));
  const low = Number(ticker.low || lowest(candles, 'low'));

  technicals = {
    ema20: ema(closes.slice(-120), 20),
    ema50: ema(closes.slice(-180), 50),
    ema200: ema(closes.slice(-260), 200),
    rsi: rsi(closes),
    atr: atr(candles),
    macd: ema(closes.slice(-120), 12) - ema(closes.slice(-120), 26),
    macdSignal: ema(closes.slice(-80).map((_, idx, arr) => {
      const source = closes.slice(Math.max(0, closes.length - arr.length + idx - 26), closes.length - arr.length + idx + 1);
      return ema(source, 12) - ema(source, 26);
    }), 9),
  };

  return {
    symbol: cleanSymbol,
    timeframe: cleanTimeframe,
    source: 'Binance',
    ticker,
    price,
    open: Number(ticker.open),
    high,
    low,
    change: Number(ticker.change),
    volume: Number(ticker.volume || 0),
    range: Math.max(high - low, price * 0.002),
    candles,
    technicals,
  };
}

function analyzeMarketContext(context) {
  const { price, high, low, open, change, range, candles, technicals } = context;
  const recent = candles.length ? candles.slice(-50) : [];
  const recentHigh = recent.length ? highest(recent, 'high') : high;
  const recentLow = recent.length ? lowest(recent, 'low') : low;
  const rangePosition = range > 0 ? (price - low) / range : 0.5;
  const atrValue = Number(technicals.atr || range * 0.25);
  const macdBull = Number(technicals.macd) > Number(technicals.macdSignal);
  const emaBull = Number(technicals.ema20) > Number(technicals.ema50)
    && (!Number.isFinite(Number(technicals.ema200)) || Number(technicals.ema50) >= Number(technicals.ema200) * 0.995);
  const emaBear = Number(technicals.ema20) < Number(technicals.ema50)
    && (!Number.isFinite(Number(technicals.ema200)) || Number(technicals.ema50) <= Number(technicals.ema200) * 1.005);

  let score = 0;
  if (change > 0) score += 1;
  if (change < 0) score -= 1;
  if (emaBull) score += 2;
  if (emaBear) score -= 2;
  if (macdBull) score += 1;
  else score -= 1;
  if (technicals.rsi >= 52 && technicals.rsi <= 70) score += 1;
  if (technicals.rsi <= 48 && technicals.rsi >= 30) score -= 1;
  if (rangePosition > 0.62) score += 1;
  if (rangePosition < 0.38) score -= 1;
  if (Number(technicals.recommendAll) > 0.1) score += 2;
  if (Number(technicals.recommendAll) < -0.1) score -= 2;

  const direction = score >= 3 ? 'BUY' : score <= -3 ? 'SELL' : 'WAIT';
  const zone = rangePosition >= 0.66 ? 'premium' : rangePosition <= 0.34 ? 'discount' : 'equilibrium';
  const structure = emaBull
    ? 'Bullish structure: EMA20 tren EMA50, dong tien dang nghieng ve phe mua.'
    : emaBear
      ? 'Bearish structure: EMA20 duoi EMA50, dong tien dang nghieng ve phe ban.'
      : 'Mixed structure: dong tien chua ro, can xac nhan BOS/CHoCH.';
  const liquidity = direction === 'SELL'
    ? `Gia dang gan vung premium/kháng cự. Buy-side liquidity nam quanh ${round(recentHigh || high, 4)}.`
    : direction === 'BUY'
      ? `Gia dang giu tren vung ho tro. Sell-side liquidity nam quanh ${round(recentLow || low, 4)}.`
      : `Gia dang trong vung ${zone}. Nen cho quet thanh khoan roi retest.`;

  const buffer = Math.max(atrValue, range * 0.15, price * 0.0015);
  const pullbackBuy = Math.max(
    low + range * 0.38,
    Math.min(Number(technicals.ema20) || price, price - buffer * 0.35)
  );
  const pullbackSell = Math.min(
    high - range * 0.38,
    Math.max(Number(technicals.ema20) || price, price + buffer * 0.35)
  );
  const breakoutBuy = Math.max(recentHigh || high, price + buffer * 0.25);
  const breakoutSell = Math.min(recentLow || low, price - buffer * 0.25);
  let orderType = 'WAIT';
  let entry = price;
  let entryReason = 'Chua co setup du an toan de dat lenh.';

  if (direction === 'BUY') {
    if (zone === 'premium' || price > (Number(technicals.ema20) || price) + buffer * 0.2) {
      orderType = 'BUY LIMIT';
      entry = pullbackBuy;
      entryReason = 'Gia dang cao trong range; cho pullback ve EMA20/discount de co entry an toan hon.';
    } else {
      orderType = 'BUY LIMIT';
      entry = Math.min(price, Math.max(recentLow + buffer * 0.35, pullbackBuy));
      entryReason = 'Cho retest vung ho tro gan nhat thay vi mua duoi gia thi truong.';
    }
  } else if (direction === 'SELL') {
    if (zone === 'discount' || price < (Number(technicals.ema20) || price) - buffer * 0.2) {
      orderType = 'SELL LIMIT';
      entry = pullbackSell;
      entryReason = 'Gia dang thap trong range; cho hoi len EMA20/premium de co entry an toan hon.';
    } else {
      orderType = 'SELL LIMIT';
      entry = Math.max(price, Math.min(recentHigh - buffer * 0.35, pullbackSell));
      entryReason = 'Cho retest vung khang cu gan nhat thay vi ban duoi gia thi truong.';
    }
  }

  const stopLoss = direction === 'SELL'
    ? Math.max(recentHigh || high, entry + buffer)
    : Math.min(recentLow || low, entry - buffer);
  const risk = Math.abs(entry - stopLoss) || buffer;
  const takeProfit1 = direction === 'SELL' ? entry - risk * 1.5 : entry + risk * 1.5;
  const takeProfit2 = direction === 'SELL' ? entry - risk * 2.5 : entry + risk * 2.5;
  const takeProfit3 = direction === 'SELL' ? entry - risk * 3.5 : entry + risk * 3.5;
  const confidence = Math.min(94, Math.max(40, 50 + Math.abs(score) * 6 + (Number(technicals.adx) > 25 ? 8 : 0)));

  return {
    direction,
    confidence: Math.round(confidence),
    score,
    orderType,
    entry: round(entry, price > 1000 ? 2 : 4),
    stopLoss: direction === 'WAIT' ? null : round(stopLoss, price > 1000 ? 2 : 4),
    takeProfit1: direction === 'WAIT' ? null : round(takeProfit1, price > 1000 ? 2 : 4),
    takeProfit2: direction === 'WAIT' ? null : round(takeProfit2, price > 1000 ? 2 : 4),
    takeProfit3: direction === 'WAIT' ? null : round(takeProfit3, price > 1000 ? 2 : 4),
    zone,
    structure,
    liquidity,
    entryReason,
    indicators: {
      price: round(price, price > 1000 ? 2 : 4),
      change: round(change, 2),
      rsi: round(technicals.rsi, 2),
      atr: round(atrValue, price > 1000 ? 2 : 4),
      ema20: round(technicals.ema20, price > 1000 ? 2 : 4),
      ema50: round(technicals.ema50, price > 1000 ? 2 : 4),
      ema200: round(technicals.ema200, price > 1000 ? 2 : 4),
      macd: round(technicals.macd, 5),
      macdSignal: round(technicals.macdSignal, 5),
      adx: round(technicals.adx, 2),
      recommendAll: round(technicals.recommendAll, 3),
    },
  };
}

function fallbackConclusion(context, analysis) {
  const action = analysis.direction === 'WAIT'
    ? 'chưa đủ xác nhận để vào lệnh'
    : `ưu tiên ${analysis.orderType}`;
  return `${context.symbol} ${context.timeframe}: ${action}; bias dựa trên EMA stack, momentum và vùng ${analysis.zone}. ${analysis.entryReason}
SMC: ${analysis.liquidity} Invalidation nằm tại SL; chỉ kích hoạt khi giá retest entry có phản ứng rõ.`;
}

async function buildAiConclusion(context, analysis) {
  if (!CONFIG.anthropicApiKey) return fallbackConclusion(context, analysis);

  const prompt = `Du lieu thi truong:
${JSON.stringify({
    symbol: context.symbol,
    timeframe: context.timeframe,
    source: context.source,
    price: analysis.indicators.price,
    change: analysis.indicators.change,
    indicators: analysis.indicators,
    smartMoney: {
      zone: analysis.zone,
      structure: analysis.structure,
      liquidity: analysis.liquidity,
    },
    proposedPlan: {
      direction: analysis.direction,
      orderType: analysis.orderType,
      confidence: analysis.confidence,
      entry: analysis.entry,
      stopLoss: analysis.stopLoss,
      takeProfit1: analysis.takeProfit1,
      takeProfit2: analysis.takeProfit2,
      takeProfit3: analysis.takeProfit3,
      entryReason: analysis.entryReason,
    },
  }, null, 2)}

Hay viet ket luan scalping bang tieng Viet, chi 1 den 3 dong ngan. Dung thuat ngu chuyen mon nhu SMC, liquidity sweep, premium/discount, EMA stack, momentum, invalidation. Neu co setup thi giai thich vi sao entry LIMIT/retest an toan hon, khong viet dai va khong lap lai toan bo so lieu.`;

  try {
    const data = await anthropicRepository.createMessage({
      model: CONFIG.anthropicModel,
      max_tokens: 700,
      system: 'Ban la AI Signal Bot cho scalping trader. Chi tra loi 1-3 dong tieng Viet, ngan gon, chuyen mon, dua tren SMC, liquidity, EMA, RSI, ATR, momentum. Khong viet dai.',
      messages: [{ role: 'user', content: prompt }],
    });

    return data.content?.[0]?.text || fallbackConclusion(context, analysis);
  } catch (err) {
    console.warn('[AI Signal] Anthropic failed, using rule-engine conclusion:', err.message);
    return fallbackConclusion(context, analysis);
  }
}

async function askTradingAssistant({ question, symbol, timeframe }) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) throw new Error('question is required');

  const data = await anthropicRepository.createMessage({
    model: CONFIG.anthropicModel,
    max_tokens: 1000,
    system: `Bạn là AI Trading Assistant cho terminal TradeX.
Trả lời ngắn gọn, súc tích bằng tiếng Việt.
Tập trung vào phân tích thị trường, kỹ thuật, tâm lý giao dịch.
Symbol hiện tại: ${symbol || 'UNKNOWN'}, Timeframe: ${timeframe || 'UNKNOWN'}.
Không dùng markdown phức tạp. Trả lời tối đa 3-4 câu.`,
    messages: [{ role: 'user', content: cleanQuestion }],
  });

  return {
    answer: data.content?.[0]?.text || 'Không có phản hồi.',
  };
}

async function analyzeSignal({ symbol, timeframe }) {
  const context = await collectMarketContext(symbol, timeframe);
  const analysis = analyzeMarketContext(context);
  const conclusion = await buildAiConclusion(context, analysis);

  return {
    symbol: context.symbol,
    timeframe: context.timeframe,
    source: context.source,
    conclusion,
    ...analysis,
  };
}

module.exports = { askTradingAssistant, analyzeSignal };
