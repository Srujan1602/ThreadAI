/* =====================================================================
   ThreadAI — Express server (Phase 2 backend)

   Serves:
     - REST API under /api
     - the existing Phase 1 frontend (static files from the project root)

   Security: parameterized SQL, bcrypt hashes, httpOnly JWT cookie,
   role-based authorization, origin checks for state-changing requests,
   rate limiting, body size limits, and error responses that never leak
   stack traces or credentials.
   ===================================================================== */
require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const { attachUser } = require("./middleware/authMiddleware");
const { ping } = require("./config/database");

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const IS_PROD = process.env.NODE_ENV === "production";

// ---- Allowed origins (frontend served from another port, if any) ----
const EXTRA_ORIGINS = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin, req) {
  if (!origin) return true; // same-origin / curl
  const allowed = new Set(EXTRA_ORIGINS);
  allowed.add(`http://127.0.0.1:${PORT}`);
  allowed.add(`http://localhost:${PORT}`);
  if (allowed.has(origin)) return true;
  // Production / tunnel deployments: the backend serves the frontend
  // itself, so the page and the API share one host (e.g. https://app
  // .onrender.com). Allow any origin whose host matches the request's
  // own Host header — still rejects genuinely foreign origins.
  try {
    return new URL(origin).host === (req && req.get("Host"));
  } catch (_err) {
    return false;
  }
}

// ---- Core middleware ----
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  cors({
    credentials: true,
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  })
);
app.use(express.json({ limit: "100kb" })); // request body size limit
app.use(cookieParser());
app.use(attachUser);

// ---- Production request log ----
// Render (and any stdout-capturing host) shows these lines in its Logs tab:
// one line per request with method, path, status and duration. Only
// non-sensitive fields are logged — never cookies, bodies or credentials.
if (IS_PROD) {
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      console.log(
        `${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`
      );
    });
    next();
  });
}

// ---- CSRF defense: reject state-changing requests from foreign origins ----
// (the session cookie is httpOnly + SameSite=Lax; this adds an explicit
//  Origin check for POST/PATCH/PUT/DELETE)
app.use((req, res, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    const origin = req.get("Origin") || req.get("Referer");
    if (origin && !isAllowedOrigin(origin, req)) {
      return res.status(403).json({ ok: false, error: "Cross-origin request blocked." });
    }
  }
  next();
});

// ---- API routes ----
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/requests", require("./routes/requestRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/feedback", require("./routes/feedbackRoutes"));
app.use("/api/analyze", require("./routes/analysisRoutes"));

// ---- Health check (useful for tests and the frontend banner) ----
app.get("/api/health", async (_req, res) => {
  try {
    await ping();
    res.json({ ok: true, db: "up" });
  } catch (_err) {
    res.status(503).json({ ok: false, db: "down" });
  }
});

// Unknown API route
app.use("/api", (_req, res) => {
  res.status(404).json({ ok: false, error: "Endpoint not found." });
});

// ---- Static frontend (whitelisted paths only) ----
// Never expose backend/, database/, .env, node_modules, etc.
// maxAge 0 + ETag: browsers must revalidate (cheap 304) on every load.
// A 1h max-age previously pinned stale JS/CSS for up to an hour after a
// deploy, so users kept running pre-fix code ('Cannot reach the server').
const ROOT = path.join(__dirname, "..");
const FRONTEND_INDEX = path.join(ROOT, "index.html");

app.use(
  "/css",
  express.static(path.join(ROOT, "css"), { dotfiles: "deny", maxAge: "0", etag: true })
);
app.use(
  "/js",
  express.static(path.join(ROOT, "js"), { dotfiles: "deny", maxAge: "0", etag: true })
);

app.get("/", (_req, res) => res.sendFile(FRONTEND_INDEX));

app.get("/:page.html", (req, res, next) => {
  const page = req.params.page;
  if (!/^[a-z0-9_-]+$/i.test(page)) return next();
  res.sendFile(path.join(ROOT, `${page}.html`), (err) => {
    if (err) res.status(404).type("text").send("Page not found");
  });
});

// Anything else at the root (e.g. /backend/.env) is not served.
app.use((_req, res) => res.status(404).type("text").send("Not found"));

// ---- Central error handler: no stack traces / credentials to clients ----
app.use((err, _req, res, _next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "Request body is too large." });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ ok: false, error: "Invalid JSON body." });
  }
  console.error("[ThreadAI error]", err.message);
  if (!IS_PROD) console.error(err.stack);
  res.status(500).json({ ok: false, error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`ThreadAI backend running at http://127.0.0.1:${PORT}`);
  console.log(`Frontend:  http://127.0.0.1:${PORT}/index.html`);
  console.log(`API:       http://127.0.0.1:${PORT}/api/health`);
});
