/* =====================================================================
   ThreadAI — create/update the initial administrator account

   Usage:
     cd backend
     npm run create-admin

   Credentials are read from backend/.env:
     ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD

   No administrator password is ever hardcoded in source code.
   If the admin email already exists, the password is rotated to the
   current ADMIN_PASSWORD value (useful for recovery).
   ===================================================================== */
require("dotenv").config();

const bcrypt = require("bcryptjs");
const { pool, query } = require("../config/database");

async function main() {
  const name = (process.env.ADMIN_NAME || "").trim();
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new Error("ADMIN_EMAIL must be a valid email address in backend/.env");
  }
  if (!password || password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters long in backend/.env");
  }
  if (!name) {
    throw new Error("ADMIN_NAME is required in backend/.env");
  }

  const hash = await bcrypt.hash(password, 10);

  const existing = await query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if (existing.length) {
    await query("UPDATE users SET password_hash = ?, role = 'admin', full_name = ? WHERE id = ?", [
      hash,
      name,
      existing[0].id,
    ]);
    console.log(`✓ Updated existing account ${email} → role=admin (password rotated).`);
  } else {
    await query(
      "INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'admin')",
      [name, email, "0000000000", hash]
    );
    console.log(`✓ Administrator account created: ${email}`);
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("✗ create-admin failed:", err.message);
    process.exitCode = 1;
    pool.end().finally(() => process.exit(1));
  });
