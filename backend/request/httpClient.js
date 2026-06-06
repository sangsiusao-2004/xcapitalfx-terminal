const http = require('http');
const https = require('https');

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const body = options.body ? JSON.stringify(options.body) : null;

    const req = transport.request(
      target,
      {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch (err) {
            reject(new Error(`Invalid JSON response from ${target.hostname}`));
            return;
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const message = data?.msg || data?.error?.message || `HTTP ${res.statusCode}`;
            reject(new Error(message));
            return;
          }

          resolve(data);
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(options.timeout || 15000, () => {
      req.destroy(new Error(`Request timeout: ${target.hostname}`));
    });

    if (body) req.write(body);
    req.end();
  });
}

module.exports = { requestJson };
