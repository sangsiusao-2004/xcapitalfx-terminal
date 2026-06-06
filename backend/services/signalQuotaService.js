const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config');
const authRepository = require('../repositories/authRepository');

const STORE_PATH = path.resolve(__dirname, '..', '..', 'data', 'signal-usage.json');
const USAGE_TABLE = 'signal_usage';
const PLAN_RULES = {
  Free: { dailyLimit: 5, cooldownSec: 90 },
  Pro: { dailyLimit: 50, cooldownSec: 30 },
  Premium: { dailyLimit: Infinity, cooldownSec: 5 },
};

function useSupabase() {
  return Boolean(CONFIG.supabaseUrl && CONFIG.supabaseServiceRoleKey);
}

function supabaseBaseUrl() {
  return CONFIG.supabaseUrl.replace(/\/+$/, '');
}

async function supabaseRequest(method, table, query = '', body) {
  const headers = {
    apikey: CONFIG.supabaseServiceRoleKey,
    'Content-Type': 'application/json',
    Prefer: method === 'POST' ? 'resolution=merge-duplicates,return=representation' : 'return=representation',
  };
  if (!CONFIG.supabaseServiceRoleKey.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${CONFIG.supabaseServiceRoleKey}`;
  }

  const res = await fetch(`${supabaseBaseUrl()}/rest/v1/${table}${query}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase usage error: ${text}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function planRules(plan) {
  return PLAN_RULES[plan] || PLAN_RULES.Free;
}

function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify({}, null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    return {};
  }
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

async function getPlanForEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error('Thiếu email tài khoản để kiểm tra lượt phân tích');
  if (normalizedEmail === 'admin@tradex.ai') return 'Premium';

  const user = await authRepository.getUserByEmail(normalizedEmail);
  if (!user) throw new Error('Không tìm thấy tài khoản. Vui lòng đăng nhập lại.');
  return user.plan || 'Free';
}

async function getUsageRow(email, usageDate = todayKey()) {
  const normalizedEmail = normalizeEmail(email);

  if (useSupabase()) {
    const rows = await supabaseRequest(
      'GET',
      USAGE_TABLE,
      `?email=eq.${encodeURIComponent(normalizedEmail)}&usage_date=eq.${encodeURIComponent(usageDate)}&select=*&limit=1`
    );
    const row = rows?.[0];
    return row ? {
      email: row.email,
      usageDate: row.usage_date,
      count: Number(row.count || 0),
      lastUsedAt: row.last_used_at,
    } : {
      email: normalizedEmail,
      usageDate,
      count: 0,
      lastUsedAt: null,
    };
  }

  const store = readStore();
  const key = `${normalizedEmail}::${usageDate}`;
  return store[key] || {
    email: normalizedEmail,
    usageDate,
    count: 0,
    lastUsedAt: null,
  };
}

function buildStatus({ email, plan, usage }) {
  const rules = planRules(plan);
  const lastAt = usage.lastUsedAt ? new Date(usage.lastUsedAt).getTime() : 0;
  const cooldownLeftSec = Math.max(0, Math.ceil((rules.cooldownSec * 1000 - (Date.now() - lastAt)) / 1000));
  const remaining = Number.isFinite(rules.dailyLimit)
    ? Math.max(0, rules.dailyLimit - Number(usage.count || 0))
    : null;

  return {
    email,
    plan,
    usageDate: usage.usageDate,
    used: Number(usage.count || 0),
    dailyLimit: Number.isFinite(rules.dailyLimit) ? rules.dailyLimit : null,
    remaining,
    cooldownSec: rules.cooldownSec,
    cooldownLeftSec,
  };
}

async function getUsageStatus(email) {
  const normalizedEmail = normalizeEmail(email);
  const plan = await getPlanForEmail(normalizedEmail);
  const usage = await getUsageRow(normalizedEmail);
  return buildStatus({ email: normalizedEmail, plan, usage });
}

async function assertCanAnalyze(email) {
  const status = await getUsageStatus(email);

  if (status.dailyLimit !== null && status.remaining <= 0) {
    throw new Error('Bạn đã hết lượt phân tích trong ngày hôm nay. Mời bạn quay lại vào ngày hôm sau hoặc chọn Nâng cấp tài khoản để tiếp tục sử dụng bot.');
  }

  if (status.cooldownLeftSec > 0) {
    throw new Error(`Vui lòng chờ thêm ${status.cooldownLeftSec} giây trước khi phân tích tiếp.`);
  }

  return status;
}

async function recordUsage(email) {
  const normalizedEmail = normalizeEmail(email);
  const usageDate = todayKey();
  const current = await getUsageRow(normalizedEmail, usageDate);
  const next = {
    email: normalizedEmail,
    usageDate,
    count: Number(current.count || 0) + 1,
    lastUsedAt: new Date().toISOString(),
  };

  if (useSupabase()) {
    const rows = await supabaseRequest(
      'POST',
      USAGE_TABLE,
      '?on_conflict=email,usage_date',
      {
        email: next.email,
        usage_date: next.usageDate,
        count: next.count,
        last_used_at: next.lastUsedAt,
        updated_at: new Date().toISOString(),
      }
    );
    const saved = rows?.[0];
    const plan = await getPlanForEmail(normalizedEmail);
    return buildStatus({
      email: normalizedEmail,
      plan,
      usage: {
        email: saved.email,
        usageDate: saved.usage_date,
        count: saved.count,
        lastUsedAt: saved.last_used_at,
      },
    });
  }

  const store = readStore();
  store[`${normalizedEmail}::${usageDate}`] = next;
  writeStore(store);
  const plan = await getPlanForEmail(normalizedEmail);
  return buildStatus({ email: normalizedEmail, plan, usage: next });
}

module.exports = {
  getUsageStatus,
  assertCanAnalyze,
  recordUsage,
};
