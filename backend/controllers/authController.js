/* =====================================================================
   ThreadAI — auth controller
   register / login / logout / me
   - bcrypt password hashing (never returns password_hash)
   - role always defaults to 'user': public registration can NEVER
     create an administrator, regardless of what the client sends.
   ===================================================================== */
const bcrypt = require("bcryptjs");
const { query } = require("../config/database");
const { str, isEmail, isPhone } = require("../utils/validate");
const {
  signToken,
  setAuthCookie,
  clearAuthCookie,
} = require("../middleware/authMiddleware");

const BCRYPT_ROUNDS = 10;

function publicUser(row) {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    created_at: row.created_at,
  };
}

/* POST /api/auth/register */
async function register(req, res, next) {
  try {
    const fullName = str(req.body.full_name || req.body.name);
    const email = str(req.body.email).toLowerCase();
    const phone = str(req.body.phone);
    const password = typeof req.body.password === "string" ? req.body.password : "";

    const errors = {};
    if (fullName.length < 3 || fullName.length > 100) {
      errors.full_name = "Full name must be 3-100 characters.";
    }
    if (!isEmail(email)) errors.email = "Enter a valid email address.";
    // Phone is optional at registration. If supplied it must still be valid.
    if (phone && !isPhone(phone)) errors.phone = "Enter a valid phone number (8-15 digits).";
    if (password.length < 6) errors.password = "Password must be at least 6 characters.";
    // Defense in depth: ignore any attempted role escalation.
    if (Object.keys(errors).length) {
      return res.status(400).json({ ok: false, errors, error: "Validation failed." });
    }

    const existing = await query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
    if (existing.length) {
      return res.status(409).json({
        ok: false,
        errors: { email: "An account with this email already exists." },
        error: "An account with this email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const result = await query(
      "INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'user')",
      [fullName, email, phone || null, passwordHash]
    );

    const user = {
      id: result.insertId,
      full_name: fullName,
      email,
      phone: phone || null,
      role: "user",
    };

    setAuthCookie(res, signToken(user));
    res.status(201).json({ ok: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

/* POST /api/auth/login */
async function login(req, res, next) {
  try {
    const email = str(req.body.email).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!isEmail(email) || password.length < 1) {
      return res
        .status(400)
        .json({ ok: false, error: "Email and password are required." });
    }

    const rows = await query(
      "SELECT id, full_name, email, phone, password_hash, role FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    // Same message for unknown email and wrong password (no user enumeration).
    if (!rows.length) {
      return res
        .status(401)
        .json({ ok: false, error: "Invalid email or password." });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res
        .status(401)
        .json({ ok: false, error: "Invalid email or password." });
    }

    setAuthCookie(res, signToken(user));
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

/* POST /api/auth/logout */
async function logout(_req, res) {
  clearAuthCookie(res);
  res.json({ ok: true, message: "Signed out." });
}

/* GET /api/auth/me */
async function me(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Not signed in." });
    }
    const rows = await query(
      "SELECT id, full_name, email, phone, role, created_at FROM users WHERE id = ? LIMIT 1",
      [req.user.id]
    );
    if (!rows.length) {
      clearAuthCookie(res);
      return res.status(401).json({ ok: false, error: "Session is no longer valid." });
    }
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, logout, me, publicUser };
