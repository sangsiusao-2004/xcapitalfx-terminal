const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config');

const STORE_PATH = path.resolve(__dirname, '..', '..', 'data', 'auth-store.json');
const USERS_TABLE = 'xcapital_users';
const OTPS_TABLE = 'email_otps';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function useSupabase() {
  return Boolean(CONFIG.supabaseUrl && CONFIG.supabaseServiceRoleKey);
}

function supabaseBaseUrl() {
  return CONFIG.supabaseUrl.replace(/\/+$/, '');
}

async function supabaseRequest(method, table, query = '', body) {
  const url = `${supabaseBaseUrl()}/rest/v1/${table}${query}`;
  const headers = {
    apikey: CONFIG.supabaseServiceRoleKey,
    'Content-Type': 'application/json',
  };
  if (!CONFIG.supabaseServiceRoleKey.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${CONFIG.supabaseServiceRoleKey}`;
  }

  if (method === 'POST') {
    headers.Prefer = 'resolution=merge-duplicates,return=representation';
  } else if (method === 'PATCH') {
    headers.Prefer = 'return=representation';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error: ${text}`);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function isMissingTelegramColumnError(err) {
  const message = String(err?.message || '');
  return message.includes('PGRST204')
    && (
      message.includes("'telegram_id' column") ||
      message.includes("'telegram_username' column") ||
      message.includes("'telegram_verified' column")
    );
}

function toDbUser(user) {
  return {
    name: user.name,
    email: normalizeEmail(user.email),
    password_hash: user.passwordHash,
    plan: user.plan || 'Free',
    plan_expires_at: user.planExpiresAt || null,
    verified: Boolean(user.verified),
    telegram_id: user.telegramId || null,
    telegram_username: user.telegramUsername || null,
    telegram_verified: Boolean(user.telegramVerified),
    created_at: user.createdAt || new Date().toISOString(),
    updated_at: user.updatedAt || new Date().toISOString(),
  };
}

function toDbUserWithoutTelegram(user) {
  const row = toDbUser(user);
  delete row.telegram_id;
  delete row.telegram_username;
  delete row.telegram_verified;
  return row;
}

function fromDbUser(row) {
  if (!row) return null;
  return {
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    plan: row.plan || 'Free',
    planExpiresAt: row.plan_expires_at,
    verified: Boolean(row.verified),
    telegramId: row.telegram_id || '',
    telegramUsername: row.telegram_username || '',
    telegramVerified: Boolean(row.telegram_verified),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDbOtp(record) {
  return {
    id: record.id,
    email: normalizeEmail(record.email),
    name: record.name || '',
    purpose: record.purpose,
    code: record.code,
    used: Boolean(record.used),
    expires_at: record.expiresAt,
    created_at: record.createdAt || new Date().toISOString(),
    used_at: record.usedAt || null,
  };
}

function fromDbOtp(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    purpose: row.purpose,
    code: row.code,
    used: Boolean(row.used),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    usedAt: row.used_at,
  };
}

function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify({ users: {}, otps: [] }, null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return {
      users: parsed.users || {},
      otps: Array.isArray(parsed.otps) ? parsed.otps : [],
    };
  } catch (err) {
    return { users: {}, otps: [] };
  }
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

async function getUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);

  if (useSupabase()) {
    const rows = await supabaseRequest(
      'GET',
      USERS_TABLE,
      `?email=eq.${encodeURIComponent(normalizedEmail)}&select=*&limit=1`
    );
    return fromDbUser(rows?.[0]);
  }

  const store = readStore();
  return store.users[normalizedEmail] || null;
}

async function saveUser(email, user) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedUser = { ...user, email: normalizedEmail };

  if (useSupabase()) {
    let rows;
    try {
      rows = await supabaseRequest(
        'POST',
        USERS_TABLE,
        '?on_conflict=email',
        toDbUser(normalizedUser)
      );
    } catch (err) {
      if (!isMissingTelegramColumnError(err)) throw err;
      rows = await supabaseRequest(
        'POST',
        USERS_TABLE,
        '?on_conflict=email',
        toDbUserWithoutTelegram(normalizedUser)
      );
    }
    return fromDbUser(rows?.[0]) || normalizedUser;
  }

  const store = readStore();
  store.users[normalizedEmail] = normalizedUser;
  writeStore(store);
  return normalizedUser;
}

async function saveOtp(record) {
  const normalizedRecord = { ...record, email: normalizeEmail(record.email) };

  if (useSupabase()) {
    await supabaseRequest(
      'PATCH',
      OTPS_TABLE,
      `?email=eq.${encodeURIComponent(normalizedRecord.email)}&purpose=eq.${encodeURIComponent(normalizedRecord.purpose)}&used=eq.false`,
      { used: true, used_at: new Date().toISOString() }
    );
    const rows = await supabaseRequest('POST', OTPS_TABLE, '', toDbOtp(normalizedRecord));
    return fromDbOtp(rows?.[0]) || normalizedRecord;
  }

  const store = readStore();
  const now = Date.now();
  store.otps = store.otps
    .filter(otp => !otp.used && new Date(otp.expiresAt).getTime() > now)
    .filter(otp => !(otp.email === normalizedRecord.email && otp.purpose === normalizedRecord.purpose));
  store.otps.push(normalizedRecord);
  writeStore(store);
  return normalizedRecord;
}

async function findActiveOtp(email, purpose, code) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = String(code || '').trim();

  if (useSupabase()) {
    const rows = await supabaseRequest(
      'GET',
      OTPS_TABLE,
      `?email=eq.${encodeURIComponent(normalizedEmail)}&purpose=eq.${encodeURIComponent(purpose)}&code=eq.${encodeURIComponent(normalizedCode)}&used=eq.false&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&limit=1`
    );
    return fromDbOtp(rows?.[0]);
  }

  const store = readStore();
  const now = Date.now();
  return store.otps.find(otp =>
    otp.email === normalizedEmail &&
    otp.purpose === purpose &&
    otp.code === normalizedCode &&
    !otp.used &&
    new Date(otp.expiresAt).getTime() > now
  ) || null;
}

async function markOtpUsed(id) {
  if (useSupabase()) {
    await supabaseRequest(
      'PATCH',
      OTPS_TABLE,
      `?id=eq.${encodeURIComponent(id)}`,
      { used: true, used_at: new Date().toISOString() }
    );
    return;
  }

  const store = readStore();
  store.otps = store.otps.map(otp => otp.id === id ? { ...otp, used: true, usedAt: new Date().toISOString() } : otp);
  writeStore(store);
}

module.exports = {
  normalizeEmail,
  getUserByEmail,
  saveUser,
  saveOtp,
  findActiveOtp,
  markOtpUsed,
};
