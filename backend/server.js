const { loadEnvFile } = require('./utils/loadEnv');
loadEnvFile();

const { CONFIG } = require('./config');
const marketService = require('./services/marketService');
const aiService = require('./services/aiService');
const authService = require('./services/authService');
const signalQuotaService = require('./services/signalQuotaService');
const { sendJson, sendError } = require('./utils/jsonResponse');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const STATIC_ALIASES = new Map([
  ['', 'login.html'],
  ['/', 'login.html'],
  ['/login', 'login.html'],
  ['/auth/login', 'login.html'],
  ['/dang-nhap', 'login.html'],
  ['/dang nhap', 'login.html'],
  ['/đăng-nhập', 'login.html'],
  ['/đăng nhập', 'login.html'],
  ['/register', 'login.html'],
  ['/auth/register', 'login.html'],
  ['/auth/forgot-password', 'login.html'],
  ['/dang-ky', 'login.html'],
  ['/dang ky', 'login.html'],
  ['/đăng-ký', 'login.html'],
  ['/đăng ký', 'login.html'],
  ['/home', 'index.html'],
  ['/home/aidesk', 'index.html'],
  ['/home/chartrealtime', 'index.html'],
  ['/trang-chu', 'index.html'],
  ['/trang chu', 'index.html'],
  ['/trang-chủ', 'index.html'],
  ['/trang chủ', 'index.html'],
  ['/admin', 'admin.html'],
  ['/admin/dashboard', 'admin.html'],
]);

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function routeApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/send-otp') {
    const body = await readRequestBody(req);
    const data = await authService.sendOtp(body);
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    const body = await readRequestBody(req);
    const data = await authService.register(body);
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readRequestBody(req);
    const data = await authService.login(body);
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/reset-password') {
    const body = await readRequestBody(req);
    const data = await authService.resetPassword(body);
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/update-plan') {
    const providedKey = String(req.headers['x-admin-plan-key'] || '').trim();
    const expectedKey = String(CONFIG.adminPlanKey || '').trim();
    if (!expectedKey || providedKey !== expectedKey) {
      sendError(res, 403, 'Bạn không có quyền thay đổi gói tài khoản.');
      return;
    }

    const body = await readRequestBody(req);
    const data = await authService.updatePlan(body);
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/signal/usage') {
    const data = await signalQuotaService.getUsageStatus(url.searchParams.get('email'));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/market/klines') {
    const data = await marketService.getKlines(
      url.searchParams.get('symbol'),
      url.searchParams.get('interval')
    );
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/market/ticker24h') {
    const data = await marketService.getTicker24h(url.searchParams.get('symbol'));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/market/tickers24h') {
    const data = await marketService.getTickers24h(url.searchParams.get('symbols'));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/market/technical-summary') {
    const data = await marketService.getTechnicalSummary(
      url.searchParams.get('symbol'),
      url.searchParams.get('interval')
    );
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
    const body = await readRequestBody(req);
    await signalQuotaService.assertCanAnalyze(body.userEmail);
    const data = await aiService.askTradingAssistant(body);
    const usage = await signalQuotaService.recordUsage(body.userEmail);
    sendJson(res, 200, { ok: true, data: { ...data, usage } });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/signal') {
    const body = await readRequestBody(req);
    await signalQuotaService.assertCanAnalyze(body.userEmail);
    const signal = await aiService.analyzeSignal(body);
    const usage = await signalQuotaService.recordUsage(body.userEmail);
    const data = { ...signal, usage };
    sendJson(res, 200, { ok: true, data });
    return;
  }

  sendError(res, 404, 'API endpoint not found');
}

function sendStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  const requestedPath = decodeURIComponent(url.pathname);
  const relativePath = STATIC_ALIASES.get(requestedPath)
    || requestedPath.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT_DIR, relativePath);

  if (!filePath.startsWith(ROOT_DIR + path.sep)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      sendError(res, 404, 'File not found');
      return;
    }

    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await routeApi(req, res, url);
      return;
    }

    sendStatic(req, res, url);
  } catch (err) {
    sendError(res, 400, err.message || 'Unexpected server error');
  }
});

server.listen(CONFIG.port, () => {
  console.log(`TradeX backend listening on http://localhost:${CONFIG.port}`);
});
