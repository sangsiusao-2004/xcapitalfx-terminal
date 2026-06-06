const { CONFIG } = require('../config');
const { requestJson } = require('../request/httpClient');

function buildUrl(path, params) {
  const url = new URL(path, CONFIG.binanceBaseUrl);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  return url.toString();
}

async function getKlines(symbol, interval, limit) {
  return requestJson(buildUrl('/api/v3/klines', { symbol, interval, limit }));
}

async function getTicker24h(symbol) {
  return requestJson(buildUrl('/api/v3/ticker/24hr', { symbol }));
}

async function getTickers24h(symbols) {
  return requestJson(buildUrl('/api/v3/ticker/24hr', {
    symbols: JSON.stringify(symbols),
  }));
}

module.exports = {
  getKlines,
  getTicker24h,
  getTickers24h,
};
