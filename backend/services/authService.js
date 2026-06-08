const crypto = require('crypto');
const repository = require('../repositories/authRepository');
const emailService = require('./emailService');

const OTP_TTL_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return {
    name: user.name,
    email: user.email,
    plan: user.plan || 'Free',
    planExpiresAt: user.planExpiresAt || null,
    verified: Boolean(user.verified),
    telegramId: user.telegramId || '',
    telegramUsername: user.telegramUsername || '',
    telegramVerified: Boolean(user.telegramVerified),
    createdAt: user.createdAt,
  };
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, hash] = storedHash.split(':');
  const candidate = hashPassword(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

function validateEmail(email) {
  const normalized = repository.normalizeEmail(email);
  if (!EMAIL_RE.test(normalized)) throw new Error('Email không hợp lệ');
  return normalized;
}

async function sendOtp({ email, name, purpose = 'register' }) {
  const normalizedEmail = validateEmail(email);
  const existingUser = await repository.getUserByEmail(normalizedEmail);

  if (purpose === 'register' && existingUser) {
    throw new Error('Email này đã được đăng ký');
  }
  if (purpose === 'reset_password' && !existingUser) {
    throw new Error('Email này chưa được đăng ký');
  }

  const code = generateOtp();
  await repository.saveOtp({
    id: crypto.randomUUID(),
    email: normalizedEmail,
    name: String(name || '').trim(),
    purpose,
    code,
    used: false,
    expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    createdAt: new Date().toISOString(),
  });

  const delivery = await emailService.sendOtpEmail({
    to: normalizedEmail,
    name: String(name || '').trim(),
    code,
    purpose,
  });
  return {
    email: normalizedEmail,
    sent: delivery.sent,
    devOtp: delivery.devOtp,
  };
}

async function register({ name, email, password, otp }) {
  const normalizedEmail = validateEmail(email);
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Vui lòng nhập họ và tên');
  if (!password || String(password).length < 6) throw new Error('Mật khẩu tối thiểu 6 ký tự');
  if (await repository.getUserByEmail(normalizedEmail)) throw new Error('Email này đã được đăng ký');

  const otpRecord = await repository.findActiveOtp(normalizedEmail, 'register', otp);
  if (!otpRecord) throw new Error('Mã xác thực không đúng hoặc đã hết hạn');

  const user = {
    name: cleanName,
    email: normalizedEmail,
    passwordHash: hashPassword(String(password)),
    plan: 'Free',
    verified: true,
    telegramId: '',
    telegramUsername: '',
    telegramVerified: false,
    planExpiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await repository.saveUser(normalizedEmail, user);
  await repository.markOtpUsed(otpRecord.id);
  return publicUser(user);
}

async function login({ user, password }) {
  const identifier = repository.normalizeEmail(user);

  const existingUser = await repository.getUserByEmail(identifier);
  if (!existingUser || !verifyPassword(String(password || ''), existingUser.passwordHash)) {
    throw new Error('Sai tên đăng nhập hoặc mật khẩu');
  }

  return publicUser(existingUser);
}

async function resetPassword({ email, otp, password }) {
  const normalizedEmail = validateEmail(email);
  if (!password || String(password).length < 6) throw new Error('Mật khẩu mới tối thiểu 6 ký tự');

  const existingUser = await repository.getUserByEmail(normalizedEmail);
  if (!existingUser) throw new Error('Không tìm thấy tài khoản');

  const otpRecord = await repository.findActiveOtp(normalizedEmail, 'reset_password', otp);
  if (!otpRecord) throw new Error('Mã xác thực không đúng hoặc đã hết hạn');

  const updatedUser = {
    ...existingUser,
    passwordHash: hashPassword(String(password)),
    updatedAt: new Date().toISOString(),
  };
  await repository.saveUser(normalizedEmail, updatedUser);
  await repository.markOtpUsed(otpRecord.id);
  return publicUser(updatedUser);
}

function resolvePlanExpiry({ plan, durationDays, expiresAt }) {
  if (plan === 'Free') return null;

  if (expiresAt) {
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) throw new Error('Ngày hết hạn không hợp lệ');
    return parsed.toISOString();
  }

  const days = Number(durationDays || 0);
  if (Number.isFinite(days) && days > 0) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  return null;
}

async function updatePlan({ email, plan, durationDays, expiresAt, telegramVerified }) {
  const normalizedEmail = validateEmail(email);
  const requestedPlan = String(plan || '').trim();
  const allowedPlans = new Set(['Free', 'Pro', 'Premium']);

  if (requestedPlan && !allowedPlans.has(requestedPlan)) {
    throw new Error('Gói tài khoản không hợp lệ');
  }

  const existingUser = await repository.getUserByEmail(normalizedEmail);
  if (!existingUser) throw new Error('Không tìm thấy tài khoản');
  const nextPlan = requestedPlan || existingUser.plan || 'Free';
  const shouldUpdateExpiry = Boolean(requestedPlan || durationDays || expiresAt);

  const updatedUser = {
    ...existingUser,
    plan: nextPlan,
    planExpiresAt: shouldUpdateExpiry
      ? resolvePlanExpiry({ plan: nextPlan, durationDays, expiresAt })
      : (existingUser.planExpiresAt || null),
    telegramVerified: typeof telegramVerified === 'boolean'
      ? telegramVerified
      : Boolean(existingUser.telegramVerified),
    updatedAt: new Date().toISOString(),
  };
  await repository.saveUser(normalizedEmail, updatedUser);
  return publicUser(updatedUser);
}

module.exports = {
  sendOtp,
  register,
  login,
  resetPassword,
  updatePlan,
};
