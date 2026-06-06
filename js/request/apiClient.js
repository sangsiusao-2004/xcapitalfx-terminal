import { CONFIG } from '../config.js';

async function parseJsonResponse(res) {
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error?.message || 'API error');
  }
  return data.data;
}

export async function getJson(path) {
  const res = await fetch(CONFIG.API_BASE_URL + path);
  return parseJsonResponse(res);
}

export async function postJson(path, body) {
  const res = await fetch(CONFIG.API_BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonResponse(res);
}
