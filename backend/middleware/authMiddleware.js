/* =====================================================================
   ThreadAI — authentication middleware
   The session token is a signed JWT stored in an httpOnly cookie, so the
   frontend never sees or stores it (no localStorage tokens).
   ===================================================================== */
const jwt = require("jsonwebtoken");

const COOKIE_NAME = "threadai_token";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "replace_with_a_long_random_secret") {
    throw new Error("JWT_SECRET is missing or still the placeholder — set it in backend/.env");
  }
  return secret;
}

/** Sign a token for a user payload (never includes the password hash). */
function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.full_name },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || "1d" }
  );
}

/** Set the auth cookie (httpOnly — JavaScript can never read it). */
function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

/** Reads req.cookies, verifies the JWT and (if valid) attaches req.user. */
function attachUser(req, _res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.user = {
      id: Number(payload.sub),
      role: payload.role,
      name: payload.name,
    };
  } catch (_err) {
    req.user = undefined; // expired or tampered token
  }
  next();
}

/** 401 unless a valid session cookie is present. */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: "Authentication required." });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  attachUser,
  requireAuth,
};
