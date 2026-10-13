# ThreadAI — An AI-Powered Clothing Reuse and Recycling Management System

**Give Every Thread a Second Life 🌱**
Built as a Full Stack Development micro project.

| Phase | Status | Contents |
|---|---|---|
| **Phase 1** | ✅ Complete | Static frontend prototype (HTML/CSS/JS, responsive design system) |
| **Phase 2** | ✅ Complete | Node.js + Express REST API, MySQL persistence, JWT-cookie auth, admin console |
| **Phase 3** | ✅ Complete | Real AI clothing analysis (Google Gemini vision → `ai_analyses`), pickup prefill |

---

## Stack

- **Frontend:** existing Phase 1 HTML/CSS/JS (no framework — kept exactly as designed)
- **Backend:** Node.js + Express.js (`backend/`)
- **Database:** MySQL 8.0 (`database/schema.sql`)
- **API:** REST + JSON under `/api`
- **Auth:** signed JWT stored in an **httpOnly cookie** (nothing in localStorage), bcrypt password hashes, role-based authorization, origin/CSRF checks, rate limiting
- **DB access:** `mysql2` with parameterized queries only

## Project structure

```
threadai/
├── index.html, analyze.html, pickup.html, dashboard.html,
│   requests.html, login.html, register.html, admin.html,
│   about.html, contact.html          # Phase 1 pages, now API-driven
├── css/style.css                     # design system (unchanged look)
├── js/
│   ├── api.js                        # fetch client + session-aware nav
│   ├── helpers.js                    # badges, dates, timelines, state blocks
│   └── main.js                       # nav, toasts, validation helpers
├── backend/
│   ├── server.js                     # Express entrypoint (API + static frontend)
│   ├── package.json
│   ├── .env.example                  # copy to .env — never commit .env
│   ├── config/database.js            # mysql2 pool + query/transaction helpers
│   ├── middleware/
│   │   ├── authMiddleware.js         # JWT cookie session, requireAuth
│   │   └── adminMiddleware.js        # requireAdmin (role from token only)
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── requestController.js
│   │   ├── adminController.js
│   │   ├── feedbackController.js
│   │   └── analysisController.js     # image validation + AI orchestration
│   ├── services/
│   │   └── aiAnalyzer.js             # Gemini vision call, JSON mapping/timeouts
│   ├── routes/
│   │   ├── authRoutes.js  requestRoutes.js
│   │   ├── adminRoutes.js feedbackRoutes.js
│   │   └── analysisRoutes.js         # /api/analyze (multer memory upload)
│   ├── scripts/createAdmin.js        # secure admin provisioning
│   └── tests/api.test.js             # integration tests (npm test)
├── database/schema.sql               # full schema (FKs, checks, enums)
└── docs/API.md                       # endpoint reference
```

---

## Setup

### 1. Database

```bash
"/c/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe" -u root -p < database/schema.sql
```

(or in MySQL Workbench: run `database/schema.sql`)

This creates `threadai_db` with tables `users`, `clothing_requests`,
`ai_analyses`, `feedback`, `request_status_history`.

### 2. Backend

```bash
cd backend
cp .env.example .env        # then edit: DB_PASSWORD, JWT_SECRET, ADMIN_*
npm install
npm run create-admin        # creates/updates the admin account from ADMIN_* env
npm start                   # http://127.0.0.1:5000
```

`.env` values:

| Key | Meaning |
|---|---|
| `PORT` | API port (default 5000) |
| `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` | MySQL connection |
| `JWT_SECRET` | long random secret (see .env.example for a generator one-liner) |
| `JWT_EXPIRES_IN` | session lifetime (default `1d`) |
| `COOKIE_SECURE` | `true` behind HTTPS |
| `CORS_ORIGIN` | extra allowed origins (e.g. `http://127.0.0.1:8000`) |
| `ADMIN_NAME/ADMIN_EMAIL/ADMIN_PASSWORD` | used **only** by `npm run create-admin` |
| `GEMINI_API_KEY` | Google Gemini key enabling AI analysis — free at <https://aistudio.google.com/apikey>. Leave empty to run without AI: `/api/analyze` then returns a clear `503 AI_NOT_CONFIGURED`. |
| `GEMINI_MODEL` | optional, default `gemini-3.8-flash` |
| `AI_TIMEOUT_MS` | optional, default `25000` |

### 3. Frontend

Two options:

1. **Recommended** — the Express server serves the pages themselves:
   open `http://127.0.0.1:5000/index.html`
2. Static server on another port (Phase 1 style):
   `python -m http.server 8000` then open `http://127.0.0.1:8000/index.html`
   (the frontend auto-targets `http://127.0.0.1:5000` and that origin is
   pre-allowed in CORS; use `127.0.0.1` on both to keep cookies same-site)

### 4. Tests

```bash
cd backend
npm start          # in one terminal
npm test           # in another
```

Covers: registration (incl. duplicate email + forced-role rejection), login
(bad password, httpOnly cookie), protected `/me`, request creation/validation,
ownership isolation between two users, cancel rules, admin 401/403, status
transition enforcement, feedback validation, foreign-origin rejection.

> Each `npm test` run registers a few throwaway accounts (emails like
> `test<timestamp>@example.com`). Clean them up any time with:
> ```sql
> USE threadai_db;
> -- cascades to clothing_requests + request_status_history
> DELETE FROM users WHERE email LIKE 'test%@example.com'
>                    OR email LIKE 'evil%@example.com'
>                    OR email LIKE 'other%@example.com'
>                    OR email = 'ui_test@example.com';
> -- guest rows and any left orphaned by the cascade
> DELETE FROM feedback WHERE user_id IS NULL;
> ```
> To reset everything except the administrator account:
> ```sql
> USE threadai_db;
> DELETE FROM feedback;
> DELETE FROM users WHERE role <> 'admin';   -- cascades requests + history
> ALTER TABLE users AUTO_INCREMENT = 2;
> ALTER TABLE clothing_requests AUTO_INCREMENT = 1;
> ALTER TABLE feedback AUTO_INCREMENT = 1;
> ALTER TABLE request_status_history AUTO_INCREMENT = 1;
> ```

---

## API endpoints

See **[docs/API.md](docs/API.md)** for the full list with request/response
examples. Summary:

| Method | Endpoint | Auth |
|---|---|---|
| POST | `/api/auth/register` | public (rate-limited) |
| POST | `/api/auth/login` | public (rate-limited) |
| POST | `/api/auth/logout` | session |
| GET | `/api/auth/me` | session |
| POST | `/api/requests` | user |
| GET | `/api/requests` (search/filter/pagination) | user (own rows only) |
| GET | `/api/requests/summary` | user |
| GET | `/api/requests/:id` (+history) | user (owner only) |
| PATCH | `/api/requests/:id/cancel` | user (owner, Pending/Accepted) |
| GET | `/api/admin/stats` | admin |
| GET | `/api/admin/requests` | admin |
| GET | `/api/admin/requests/:id` | admin |
| PATCH | `/api/admin/requests/:id/status` | admin |
| GET | `/api/admin/users` | admin |
| GET | `/api/admin/feedback` | admin |
| POST | `/api/feedback` | optional session |
| GET | `/api/analyze/status` | public |
| POST | `/api/analyze` (multipart image) | user (rate-limited) |
| GET | `/api/health` | public |

---

## Status workflow

```
Pending → Accepted → Pickup Scheduled → Picked Up → Completed
   └──────────┴─────────────┘ (admin may Reject at any pre-completed stage)
```

- Transitions are enforced server-side (`STATUS_TRANSITIONS` in
  `backend/utils/validate.js`) and logged in `request_status_history`.
- Users can only **cancel** (which records `Rejected — Cancelled by user`)
  while a request is `Pending` or `Accepted`; they have no endpoint that can
  set `Accepted`/`Completed`.
- Scheduling (`Pickup Scheduled`) requires a valid future `pickup_date`.

## Security notes

- Parameterized SQL everywhere (`pool.execute` with `?` placeholders)
- bcrypt (10 rounds) password hashing; hashes never leave the server
- Public registration always creates `role = 'user'` — role escalation attempts
  are ignored; admin role comes only from `npm run create-admin`
- httpOnly, SameSite session cookie — no tokens in localStorage
- Origin check on all state-changing requests (CSRF defense) + CORS allowlist
- Rate limiting on register/login/feedback, 100 kB JSON body limit
- Generic error responses: no stack traces or credentials in API replies

## AI clothing analysis (Phase 3)

- `analyze.html` uploads a photo to `POST /api/analyze` (authenticated,
  rate-limited, ≤ 8 MB, JPG/PNG/WEBP verified by magic bytes).
- The backend calls **Google Gemini** (`GEMINI_API_KEY` in `backend/.env` —
  never exposed to the browser) and normalizes the model's answer into the
  same category/condition vocabulary the pickup form uses.
- The result card shows category, estimated condition, recommendation
  (Donate / Reuse / Recycle), explanation and confidence, plus a disclaimer:
  image-based assessments are estimates and cannot verify fabric composition
  or hidden damage.
- "Use this result & request pickup" prefills the pickup form (category,
  condition, and donate/recycle) — the user can correct anything before
  submitting. Only the extracted labels are stored in `ai_analyses`; the
  image itself is never written to disk.

### Enabling real AI

```bash
cd backend
# 1. get a free key at https://aistudio.google.com/apikey
# 2. put it in backend/.env:
#    GEMINI_API_KEY=your_key_here
# 3. restart the backend
```

Without a key the whole app still works; the Analyze page shows a visible
"AI not enabled" notice and `/api/analyze` returns `503 AI_NOT_CONFIGURED`
— the UI never fabricates results.

## Honest limitations

- **AI is an estimate** — category/condition/recommendation come from a photo;
  fabric composition and hidden damage (inside seams, lining) cannot be
  detected. Final condition is confirmed at pickup.
- **No email** — contact/feedback is stored in MySQL only; nothing is emailed.
- The analyze page's drag-drop demo preview is client-side only.
