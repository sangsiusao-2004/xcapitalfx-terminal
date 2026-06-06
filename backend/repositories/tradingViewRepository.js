const { CONFIG } = require('../config');
const { requestJson } = require('../request/httpClient');

async function getQuotes(tickers) {
  return requestJson(`${CONFIG.tradingViewScannerBaseUrl}/cfd/scan`, {
    method: 'POST',
    body: {
      symbols: {
        tickers,
        query: { types: [] },
      },
      columns: ['name', 'close', 'change', 'open', 'high', 'low', 'volume'],
    },
  });
}

function intervalSuffix(interval) {
  const map = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '1h': '60',
    '4h': '240',
    '1d': '',
    '1w': '1W',
    '1M': '1M',
  };
  return map[interval] ?? '60';
}

function column(name, suffix) {
  return suffix ? `${name}|${suffix}` : name;
}

async function getTechnicals(tickers, interval) {
  const suffix = intervalSuffix(interval);
  const columns = [
    'name',
    'close',
    'change',
    column('Recommend.All', suffix),
    column('Recommend.MA', suffix),
    column('Recommend.Other', suffix),
    column('RSI', suffix),
    column('RSI[1]', suffix),
    column('MACD.macd', suffix),
    column('MACD.signal', suffix),
    column('EMA20', suffix),
    column('EMA50', suffix),
    column('EMA200', suffix),
    column('ADX', suffix),
    column('Stoch.K', suffix),
    column('Stoch.D', suffix),
    column('CCI20', suffix),
    column('Mom', suffix),
  ];

  return requestJson(`${CONFIG.tradingViewScannerBaseUrl}/cfd/scan`, {
    method: 'POST',
    body: {
      symbols: {
        tickers,
        query: { types: [] },
      },
      columns,
    },
  });
}

module.exports = { getQuotes, getTechnicals };
