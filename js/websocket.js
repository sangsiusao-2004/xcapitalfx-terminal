// ========== PRICE POLLING ==========
import { getTicker24h } from './services/marketService.js';

export function connectWS(sym, candleSeries, updatePriceHeader, priceWsRef) {
  if (priceWsRef.current?.stop) {
    priceWsRef.current.stop();
    priceWsRef.current = null;
  }

  let closed = false;
  let timer = null;

  async function poll() {
    if (closed) return;

    try {
      const ticker = await getTicker24h(sym);
      updatePriceHeader(ticker.price, ticker.change);

      const nowSec = Math.floor(Date.now() / 1000);
      candleSeries.update({
        time:  nowSec,
        open:  ticker.open,
        high:  ticker.high,
        low:   ticker.low,
        close: ticker.price,
      });
    } catch (err) {
      console.warn('[Ticker] Poll error:', err);
    } finally {
      if (!closed) timer = setTimeout(poll, 5000);
    }
  }

  priceWsRef.current = {
    stop() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  };

  poll();
}
