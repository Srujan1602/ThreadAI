/* =====================================================================
   ThreadAI — MySQL connection pool (mysql2, promise API)
   All queries in this project use parameterized placeholders (?).
   ===================================================================== */
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "threadai_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  // DATE columns come back as exact 'YYYY-MM-DD' strings — avoids the
  // timezone shift that toISOString() would introduce for pickup_date.
  dateStrings: ["DATE"],
  // Never leak query contents / credentials in errors
  debug: false,
});

/** Run a single parameterized query and return its rows. */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Run several parameterized queries inside one transaction. */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(async (sql, params = []) => {
      const [rows] = await conn.execute(sql, params);
      return rows;
    });
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Lightweight readiness probe used by GET /api/health. */
async function ping() {
  await pool.query("SELECT 1");
  return true;
}

module.exports = { pool, query, withTransaction, ping };
