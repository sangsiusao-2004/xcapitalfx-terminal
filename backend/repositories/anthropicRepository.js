const { CONFIG } = require('../config');
const { requestJson } = require('../request/httpClient');

async function createMessage(payload) {
  if (!CONFIG.anthropicApiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY on backend');
  }

  return requestJson(`${CONFIG.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': CONFIG.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: payload,
  });
}

module.exports = { createMessage };
