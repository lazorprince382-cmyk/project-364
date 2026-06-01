const crypto = require('crypto');

const AUTH_SECRET = process.env.STAFF_AUTH_SECRET || 'ocean-dev-secret-change-in-production';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hashBuf = crypto.scryptSync(String(password), salt, 64);
  return { salt, hash: hashBuf.toString('hex') };
}

function verifyPassword(password, salt, storedHash) {
  try {
    const h = crypto.scryptSync(String(password), String(salt), 64);
    const stored = Buffer.from(String(storedHash), 'hex');
    if (h.length !== stored.length) return false;
    return crypto.timingSafeEqual(h, stored);
  } catch (_) {
    return false;
  }
}

function signStaffSession(staff) {
  const payload = {
    id: staff.id,
    email: staff.email,
    role: staff.role,
    exp: Date.now() + 7 * 24 * 3600 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyStaffSession(token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) return null;
  } catch (_) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function bearerToken(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  signStaffSession,
  verifyStaffSession,
  bearerToken,
};
