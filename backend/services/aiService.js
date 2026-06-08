const { CONFIG } = require('../config');
const anthropicRepository = require('../repositories/anthropicRepository');
const marketService = require('./marketService');
const tradingViewRepository = require('../repositories/tradingViewRepository');

const TV_SYMBOLS = {
  XAUUSD: 'OANDA:XAUUSD',
};
const SCALP_TIMEFRAMES = ['1h', '15m', '5m'];

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sameDirection(a, b) {
  return a !== 'WAIT' && b !== 'WAIT' && a === b;
}

function oppositeDirection(a, b) {
  return (a === 'BUY' && b === 'SELL') || (a === 'SELL' && b === 'BUY');
}

function normalizeRiskSettings(riskSettings = {}) {
  const balance = Number(riskSettings.balance);
  const riskPercent = Number(riskSettings.riskPercent);
  return {
    balance: Number.isFinite(balance) && balance > 0 ? balance : 0,
    riskPercent: Number.isFinite(riskPercent) && riskPercent > 0 ? riskPercent : 1,
  };
}

function getScalpProfile(context, riskSettings, marketBias = {}) {
  const atrValue = Number(context.technicals.atr || context.range * 0.25);
  const risk = normalizeRiskSettings(riskSettings);
  const riskAmount = risk.balance ? risk.balance * risk.riskPercent / 100 : 0;
  const riskFactor = clamp((risk.riskPercent - 1) / 4, 0, 1);
  const highRiskPenalty = riskFactor * 8;
  const smallAccountPenalty = risk.balance && riskAmount < 10 ? 1.2 : 0;
  const maxStopPrice = clamp(20 - highRiskPenalty - smallAccountPenalty, 8, 20);
  const stopPrice = clamp((atrValue * 0.42 * (1 - riskFactor * 0.35)) - smallAccountPenalty, 6, maxStopPrice);
  const entryPullbackPrice = clamp((atrValue * 0.12 * (1 - riskFactor * 0.42)) - smallAccountPenalty * 0.15, 1.5, 5);
  const trendStrength = clamp(Math.abs(Number(marketBias.score || 0)) / 7, 0, 1);
  const hotMarket = atrValue >= 18 || Math.abs(Number(context.change || 0)) >= 1.2 || trendStrength > 0.72;
  const tp1Price = clamp((hotMarket ? 6.2 : 5.4) + trendStrength * 0.8 - riskFactor * 0.9, 5, 7);
  const tp2Price = clamp(tp1Price * (1.75 + trendStrength * 0.45) + (hotMarket ? 1.5 : 0), 9, 22);
  const tp3Price = clamp(tp1Price * (2.9 + trendStrength * 0.9) + (hotMarket ? 3 : 0), 16, 30);
  const confidencePenalty = riskFactor >= 0.75 ? 8 : riskFactor > 0 ? 4 : 0;

  return {
    atrValue,
    risk,
    riskFactor,
    riskAmount,
    stopDistance: stopPrice,
    entryPullback: entryPullbackPrice,
    tp1Distance: tp1Price,
    tp2Distance: tp2Price,
    tp3Distance: tp3Price,
    stopPrice: round(stopPrice, 2),
    tp1Price: round(tp1Price, 2),
    tp2Price: round(tp2Price, 2),
    tp3Price: round(tp3Price, 2),
    confidencePenalty,
  };
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

async function collectScalpMarketContexts(symbol, selectedTimeframe) {
  const cleanTimeframe = normalizeTimeframe(selectedTimeframe);
  const timeframes = Array.from(new Set([...SCALP_TIMEFRAMES, cleanTimeframe]));
  const contexts = await Promise.all(timeframes.map(tf => collectMarketContext(symbol, tf)));
  return Object.fromEntries(contexts.map(context => [context.timeframe, context]));
}

function analyzeMarketContext(context, riskSettings) {
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

  const scalp = getScalpProfile(context, riskSettings, { score, direction, zone });
  const ema20 = Number(technicals.ema20) || price;
  const minPullbackRatio = 0.2 + scalp.riskFactor * 0.18;
  const buyRetest = clamp(ema20, price - scalp.entryPullback, price - scalp.entryPullback * minPullbackRatio);
  const sellRetest = clamp(ema20, price + scalp.entryPullback * minPullbackRatio, price + scalp.entryPullback);
  const buyLiquidityRetest = clamp(recentLow + scalp.stopDistance * 0.28, price - scalp.entryPullback, price - scalp.entryPullback * minPullbackRatio);
  const sellLiquidityRetest = clamp(recentHigh - scalp.stopDistance * 0.28, price + scalp.entryPullback * minPullbackRatio, price + scalp.entryPullback);
  let orderType = 'WAIT';
  let entry = price;
  let entryReason = 'Chua co setup du an toan de dat lenh.';

  if (direction === 'BUY') {
    if (zone === 'premium' || price > ema20 + scalp.entryPullback * 0.35) {
      orderType = 'BUY LIMIT';
      entry = buyRetest;
      entryReason = `Scalping BUY: risk ${scalp.risk.riskPercent}% nen cho pullback ngan ve EMA20/discount, SL toi da 20 gia.`;
    } else {
      orderType = 'BUY LIMIT';
      entry = buyLiquidityRetest;
      entryReason = `Scalping BUY: retest ho tro gan gia, TP1 co dinh vung ${scalp.tp1Price} gia de chot ngan an toan.`;
    }
  } else if (direction === 'SELL') {
    if (zone === 'discount' || price < ema20 - scalp.entryPullback * 0.35) {
      orderType = 'SELL LIMIT';
      entry = sellRetest;
      entryReason = `Scalping SELL: risk ${scalp.risk.riskPercent}% nen cho hoi ngan ve EMA20/premium, SL toi da 20 gia.`;
    } else {
      orderType = 'SELL LIMIT';
      entry = sellLiquidityRetest;
      entryReason = `Scalping SELL: retest khang cu gan gia, TP1 co dinh vung ${scalp.tp1Price} gia de chot ngan an toan.`;
    }
  }

  const stopLoss = direction === 'SELL'
    ? entry + scalp.stopDistance
    : entry - scalp.stopDistance;
  const takeProfit1 = direction === 'SELL' ? entry - scalp.tp1Distance : entry + scalp.tp1Distance;
  const takeProfit2 = direction === 'SELL' ? entry - scalp.tp2Distance : entry + scalp.tp2Distance;
  const takeProfit3 = direction === 'SELL' ? entry - scalp.tp3Distance : entry + scalp.tp3Distance;
  const confidence = Math.min(94, Math.max(40, 50 + Math.abs(score) * 6 + (Number(technicals.adx) > 25 ? 8 : 0) - scalp.confidencePenalty));

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
      scalpStopPrice: scalp.stopPrice,
      scalpTp1Price: scalp.tp1Price,
      scalpTp2Price: scalp.tp2Price,
      scalpTp3Price: scalp.tp3Price,
      riskPercent: scalp.risk.riskPercent,
      riskAmount: round(scalp.riskAmount, 2),
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

function applyMultiTimeframeFilter(analyses) {
  const higher = analyses['1h'];
  const setup = analyses['15m'];
  const entry = analyses['5m'];
  const selected = analyses.selected || entry || setup || higher;
  const base = { ...(entry || selected) };

  if (!base) throw new Error('No analysis context available');

  const mtf = {
    bias: higher?.direction || 'WAIT',
    setup: setup?.direction || 'WAIT',
    entry: entry?.direction || base.direction,
    selected: selected?.direction || base.direction,
    aligned: false,
    reason: '',
  };

  const hasHardConflict =
    oppositeDirection(base.direction, mtf.bias) ||
    oppositeDirection(base.direction, mtf.setup);

  if (base.direction === 'WAIT') {
    mtf.reason = '5m chua co trigger ro nen uu tien dung ngoai.';
  } else if (hasHardConflict) {
    mtf.reason = `MTF chua dong thuan: 1h ${mtf.bias}, 15m ${mtf.setup}, 5m ${mtf.entry}.`;
    return {
      ...base,
      direction: 'WAIT',
      orderType: 'WAIT',
      confidence: Math.min(base.confidence, 48),
      stopLoss: null,
      takeProfit1: null,
      takeProfit2: null,
      takeProfit3: null,
      entryReason: `${mtf.reason} Khong ep lenh scalping khi higher timeframe nguoc huong.`,
      mtf: { ...mtf, aligned: false },
    };
  } else if (sameDirection(base.direction, mtf.bias) && sameDirection(base.direction, mtf.setup)) {
    mtf.aligned = true;
    mtf.reason = `MTF dong thuan: 1h ${mtf.bias}, 15m ${mtf.setup}, 5m ${mtf.entry}.`;
    base.confidence = Math.min(96, base.confidence + 5);
  } else {
    mtf.reason = `MTF tam chap nhan: 1h ${mtf.bias}, 15m ${mtf.setup}, 5m ${mtf.entry}.`;
    base.confidence = Math.max(40, base.confidence - 7);
  }

  return {
    ...base,
    entryReason: `${base.entryReason} ${mtf.reason}`,
    mtf,
  };
}

function fallbackConclusion(context, analysis) {
  const mtfReason = analysis.mtf?.reason || 'MTF dang doc 1h/15m/5m.';
  const riskLine = `Risk ${analysis.indicators.riskPercent || 1}%: SL toi da ${analysis.indicators.scalpStopPrice} gia, TP1 ${analysis.indicators.scalpTp1Price} gia.`;

  if (analysis.direction === 'WAIT') {
    return `${context.symbol} ${context.timeframe}: dung ngoai. ${mtfReason}
Gia chua cho setup scalping du sach; cho liquidity sweep/retest ro hon roi moi kich hoat lenh. ${riskLine}`;
  }

  const directionText = analysis.direction === 'BUY' ? 'mua' : 'ban';
  const zoneText = analysis.zone === 'premium'
    ? 'premium'
    : analysis.zone === 'discount' ? 'discount' : 'equilibrium';

  return `${context.symbol} ${context.timeframe}: uu tien ${analysis.orderType}; bias ${directionText} theo MTF, EMA stack va momentum tai vung ${zoneText}.
${analysis.entryReason} ${riskLine} Invalidation nam tai SL, chi vao khi gia retest entry co phan ung ro.`;
}

async function buildAiConclusion(context, analysis) {
  return fallbackConclusion(context, analysis);
}

function fallbackAssistantAnswer(question, symbol, timeframe) {
  const cleanSymbol = normalizeSymbol(symbol) || 'XAUUSD';
  const cleanTimeframe = normalizeTimeframe(timeframe);
  const lower = question.toLowerCase();

  if (/risk|lot|v[oố]n|sl|stop|tp|take/i.test(lower)) {
    return `${cleanSymbol} ${cleanTimeframe}: voi scalping, uu tien risk nho va SL ngan theo setup hien tai. Hay de bot tinh entry/SL/TP bang nut PHAN TICH; neu risk cao, bot se tu dong siết entry va SL de an toàn hơn.`;
  }

  if (/buy|sell|mua|b[aá]n|entry|v[aà]o l[eệ]nh/i.test(lower)) {
    return `${cleanSymbol} ${cleanTimeframe}: khong nen vao lenh chi dua tren cau hoi nhanh. Hay bam PHAN TICH de bot doc MTF 1h/15m/5m, EMA, RSI, ATR, liquidity va risk truoc khi dua tin hieu.`;
  }

  return `${cleanSymbol} ${cleanTimeframe}: bot hien dang uu tien che do mien phi noi bo. Hay dung PHAN TICH de tao tin hieu scalping MTF; cau hoi tu do se tra loi ngan gon theo rule san co, khong goi Claude de tranh ton credit.`;
}

async function askTradingAssistant({ question, symbol, timeframe }) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) throw new Error('question is required');

  if (!CONFIG.enableClaudeChat || !CONFIG.anthropicApiKey) {
    return {
      answer: fallbackAssistantAnswer(cleanQuestion, symbol, timeframe),
      source: 'rule-engine',
    };
  }

  try {
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
      answer: data.content?.[0]?.text || fallbackAssistantAnswer(cleanQuestion, symbol, timeframe),
      source: 'claude',
    };
  } catch (err) {
    console.warn('[AI Chat] Anthropic failed, using rule-engine answer:', err.message);
    return {
      answer: fallbackAssistantAnswer(cleanQuestion, symbol, timeframe),
      source: 'rule-engine',
    };
  }
}

async function analyzeSignal({ symbol, timeframe, riskSettings }) {
  const selectedTimeframe = normalizeTimeframe(timeframe);
  const contexts = await collectScalpMarketContexts(symbol, selectedTimeframe);
  const analysisByTimeframe = {
    '1h': analyzeMarketContext(contexts['1h'], riskSettings),
    '15m': analyzeMarketContext(contexts['15m'], riskSettings),
    '5m': analyzeMarketContext(contexts['5m'], riskSettings),
    selected: analyzeMarketContext(contexts[selectedTimeframe] || contexts['5m'], riskSettings),
  };
  const context = contexts['5m'] || contexts[selectedTimeframe];
  const analysis = applyMultiTimeframeFilter(analysisByTimeframe);
  const conclusion = await buildAiConclusion(context, analysis);

  return {
    symbol: context.symbol,
    timeframe: selectedTimeframe,
    source: `${context.source} · 1h/15m/5m`,
    conclusion,
    ...analysis,
  };
}

module.exports = { askTradingAssistant, analyzeSignal };
