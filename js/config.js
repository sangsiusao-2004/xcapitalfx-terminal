// =====================================================
//  TRADEX AI - CENTRAL CONFIG
// =====================================================

const browserLocation = typeof window !== 'undefined' ? window.location : { port: '' };

export const CONFIG = {
  // Same-origin when served by backend; Live Server still calls the local backend.
  API_BASE_URL: browserLocation.port === '3000' ? '' : 'http://localhost:3000',

  WATCH_SYMBOLS: [
    { sym: 'XAUUSD',   label: 'XAU/USD',  market: 'xauusd' },
    { sym: 'BTCUSDT',  label: 'BTC/USDT'  },
    { sym: 'ETHUSDT',  label: 'ETH/USDT'  },
    { sym: 'SOLUSDT',  label: 'SOL/USDT'  },
    { sym: 'BNBUSDT',  label: 'BNB/USDT'  },
    { sym: 'XRPUSDT',  label: 'XRP/USDT'  },
    { sym: 'DOGEUSDT', label: 'DOGE/USDT' },
  ],

  DEFAULT_SYMBOL: 'XAUUSD',
  DEFAULT_TF: '1h',

  CHART_COLORS: {
    bg:      '#070b0f',
    text:    '#4a6a60',
    grid:    'rgba(0,200,150,0.05)',
    cross:   'rgba(0,200,150,0.3)',
    border:  'rgba(0,200,150,0.15)',
    up:      '#00c896',
    down:    '#ff4757',
    volUp:   'rgba(0,200,150,0.25)',
    volDown: 'rgba(255,71,87,0.25)',
  },
};
