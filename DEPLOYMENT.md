# Deploying ThreadAI / ReWear — free, no credit card, ₹0

Everything below uses genuinely free plans. **No billing or payment
details are required at any step.** Estimated time: 20–30 minutes.

Result: a permanent `https://…onrender.com` URL running the full app —
frontend, API, MySQL database, auth, pickup workflow, admin dashboard,
and the demo clothing analysis.

---

## Status of deployment targets (Phase 4 verified facts)

| Target | Status | Verified how |
|---|---|---|
| Local backend (`npm start`, port 5000) | **Working** | 64/64 automated tests + 24/24 end-to-end checks + DB persistence across restart |
| Cloudflare quick tunnel (`https://…trycloudflare.com`) | **Working but TEMPORARY** | 8/8 checks over public HTTPS (health, register, demo analysis, CSRF, auth). Lives only while your laptop runs the backend and `cloudflared`; the URL changes on every restart |
| Render free web service | **Configured, NOT deployed** | [`render.yaml`](render.yaml) is validated and ready; deploying needs *your* GitHub + Render + Aiven accounts (steps below) |

The backend **depends on your laptop** for the local and tunnel options.
Only the Render deployment removes that dependency.

---

## Prerequisites

- Git for Windows (free) — <https://git-scm.com/download/win>
- Node.js 18+ (you already have this)
- Free accounts: **GitHub** (source), **Render** (app), **Aiven** (MySQL).
  All three sign up without a credit card.
- No paid services, domains, or APIs anywhere in this guide.

---

## Step 1 — Push the project to GitHub (5 min)

```bat
cd C:\Users\Srujan\ReWear
git init
git add .
git commit -m "ReWear Phase 4: demo analysis mode + deployment config"
```

Create a **private** repository on github.com (New repository → Private,
create empty), then:

```bat
git remote add origin https://github.com/<your-username>/<repo>.git
git branch -M main
git push -u origin main
```

Safety check before pushing — this must print `.env`:

```bat
git check-ignore backend/.env
```

`.gitignore` excludes `.env`, `node_modules/`, `.tools/`, `tunnel.log`,
`server.log` and `backend/.run/` — your Gemini key never leaves your
machine. **Never** commit `.env`.

---

## Step 2 — Free MySQL database (5 min)

**Option A (recommended): Aiven for MySQL free tier** — real MySQL, so
the app's `mysql2` driver connects unchanged.

1. Sign up at <https://aiven.io/free-mysql-database> (no credit card).
2. Create a service → **MySQL** → **Free plan** → nearest region → Create.
3. Copy **Host**, **Port**, **Username**, **Password** from Overview.

**Option B: TiDB Serverless** (MySQL-compatible, 5 GiB, no card) —
use port `4000` and its generated password.

**Create the schema** in Aiven's SQL Editor (browser) — run the whole
file [`database/schema.sql`](database/schema.sql). Optionally create the
admin account now (Step 5).

---

## Step 3 — Deploy on Render (5 min)

1. Sign up at <https://render.com> (GitHub login, **no credit card**).
2. **New + → Blueprint** → connect the repo → Render detects
   [`render.yaml`](render.yaml) → **Apply**.
3. Open the service → **Environment** tab → fill the `sync: false`
   values from Step 2: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
   (e.g. `threadai_db`). Keep `DB_PORT=3306` (TiDB: `4000`).
4. **Save** → Render redeploys. Note the URL:
   `https://<name>-<something>.onrender.com`

The blueprint already sets `NODE_ENV=production`, `COOKIE_SECURE=true`,
`DEMO_MODE=true`, generates `JWT_SECRET`, and uses
`healthCheckPath: /api/health`. Same-origin hosting needs no
`CORS_ORIGIN` (the server allows origins matching its own Host header —
this was verified over the tunnel).

The schema is **not** auto-applied to the remote database; run
`database/schema.sql` once against Aiven as above. `/api/health` returns
`{"db":"up"}` only after that.

---

## Step 4 — Verify the public deployment (5 min)

Open, in order:

1. `…/api/health` → `{"ok":true,"db":"up"}`
2. `…/api/analyze/status` → `"demo":true`
3. Homepage loads; nav shows Login.
4. Register → Analyze page shows **Demo Analysis Mode** banner → upload
   an image + pick category/condition → card reads **“Demo Analysis —
   Simulated Results”**.
5. “Use this result & request pickup” → prefilled form → submit →
   appears in **My Requests** as `Pending`.
6. Admin login → advance the request through the status workflow.
7. **Logs**: Render dashboard → *Logs* tab shows the per-request lines
   (`METHOD /path status Xms`) the production logger writes.

Only after these pass is the deployment complete and verified.

---

## Step 5 — Admin account (private, never public)

There is **no default admin** in the code or the database. Create one
privately against the production database (run from your laptop; values
from Step 2 — do not paste them into chat or git):

```bat
cd backend
set DB_HOST=<from Aiven>
set DB_USER=<from Aiven>
set DB_PASSWORD=<from Aiven>
set DB_NAME=threadai_db
set ADMIN_EMAIL=<your private email>
set ADMIN_PASSWORD=<a strong password you do not share>
npm run create-admin
```

The admin credentials live only in your `.env` (local) and in the
command history of the machine you run this on. Never hardcode them in
HTML/JS or commit them.

---

## Environment variables (placeholders only — real values stay in .env / Render dashboard)

| Variable | Where | Example placeholder |
|---|---|---|
| `NODE_ENV` | render.yaml | `production` |
| `DEMO_MODE` | render.yaml | `true` (demo analysis, no AI calls) |
| `COOKIE_SECURE` | render.yaml | `true` (HTTPS) |
| `JWT_SECRET` | Render (auto-generated) | *(never committed)* |
| `DB_HOST` | Render dashboard | `mysql-xxxx.aivencloud.com` |
| `DB_PORT` | render.yaml | `3306` |
| `DB_USER` | Render dashboard | `avnadmin` |
| `DB_PASSWORD` | Render dashboard | *(never committed)* |
| `DB_NAME` | Render dashboard | `threadai_db` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | local `.env` only | `you@example.com` |
| `GEMINI_API_KEY` | Render dashboard (Sync: off) | only if disabling demo mode |
| `PORT` | set by Render automatically | *(do not hardcode)* |

Secrets belong in the Render dashboard (or local `.env`) — never in
this repository, HTML, or frontend JavaScript.

---

## Going live with real AI later (optional, still free tier)

1. Free key: <https://aistudio.google.com/apikey>.
2. Render → Environment → set `DEMO_MODE=false`, add `GEMINI_API_KEY`
   (Sync: off) → Save. The Analyze page switches automatically.
   Note: free Gemini keys have daily quotas; demo mode is the reliable
   choice for a live presentation.

---

## Free-tier restrictions (be exam-ready about these)

- **Render free web services sleep** after ~15 minutes without traffic;
  the first request after idle takes ~30–60 s, then everything is fast.
  Wake the site once before presenting.
- **Aiven free MySQL** (1 GB) can pause after prolonged inactivity; the
  app then reports `db:"down"` on `/api/health` until it wakes.
- **Free databases are not covered by provider backups.** Take your own
  dump regularly (free, local):

  ```bat
  mysqldump -h <DB_HOST> -u <DB_USER> -p <DB_NAME> > backup.sql
  ```

- **Free services may be reclaimed** by the provider after long account
  inactivity — keep a local `backup.sql` and the git repo so you can
  redeploy in minutes.
- **Upload storage**: the app never stores uploaded images on disk (they
  are validated in memory and discarded; only labels go to MySQL), so
  there is no file-storage limit or dependency to manage.
- If a provider starts asking for a card, stop — you picked a paid plan.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/api/health` → `{"db":"down"}` | DB paused / wrong `DB_*` values | Check env vars; Aiven free instances wake on reconnect (retry in a minute) |
| Site loads but API 404s | Deploy applied before env save | Re-save Environment tab to trigger redeploy |
| `503` with "not configured" | `DEMO_MODE=false` and no Gemini key | Set `DEMO_MODE=true` or add a key |
| Login loops back to login page | `COOKIE_SECURE=true` over plain http | Only on https (Render/tunnel); locally keep `false` |
| Analysis says "too many" | Rate limit (60/15 min demo, 20 real) | Wait 15 min or raise the limit in `backend/routes/analysisRoutes.js` |
| Stale CSS after an update | browser cached `css/style.css` (1 h) | Hard-refresh (Ctrl+F5); locally the cache expires within the hour |
| Tunnel URL stopped working | quick tunnels are ephemeral | Restart: `cloudflared tunnel --url http://localhost:5000` (new URL) |
| Render build failed | `npm install` error in build log | Open *Logs*, check Node version (18+) and `rootDir: backend` |

---

## Safe rollback

- **Render**: dashboard → *Deploys* → pick the previous successful
  deploy → **Rollback** (seconds, keeps the database).
- **Code**: every deploy is a git commit — `git revert <sha>` then push,
  or `git checkout <last-good-sha> .` locally.
- **Database**: restore from your own `backup.sql` dump (there is no
  destructive migration in this app; schema changes are manual and
  additive). Never delete tables to "fix" data.

---

## Local fallback demonstration (if the public site is unavailable)

The public URL is a convenience; the demo never depends on it:

```bat
cd C:\Users\Srujan\ReWear\backend
npm start
```

Open <http://127.0.0.1:5000/index.html> — full app, same demo analysis,
using your local MySQL (data persists across restarts; verified in
Phase 4). For an audience-network link, run the quick tunnel in a
second window:

```bat
C:\Users\Srujan\ReWear\.tools\cloudflared.exe tunnel --url http://localhost:5000
```

It prints a fresh `https://….trycloudflare.com` URL that works for as
long as that window stays open.

---

## Instant demo URL without any hosting account

Cloudflare's account-less quick tunnel (used for the Phase 4 public
verification): free, no signup, temporary URL, laptop must stay on.
See the fallback section above for the exact command.
