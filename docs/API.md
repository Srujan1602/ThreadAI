# ThreadAI API Reference

Base URL: `http://127.0.0.1:5000` (configurable via `PORT`)
All responses are JSON: `{ "ok": true, ... }` or `{ "ok": false, "error": "...", "errors": {...} }`.

**Authentication** uses an httpOnly cookie (`threadai_token`) set by
`POST /api/auth/login` and `POST /api/auth/register`. Send requests with
`credentials: 'include'`; never put tokens in headers or localStorage.

**Status codes:** `200` ok · `201` created · `400` validation · `401` not signed in ·
`403` forbidden / foreign origin · `404` not found (also used for other users' rows) ·
`409` conflict (duplicate email, invalid status transition, already cancelled) ·
`413` body too large · `429` rate limited · `500` server error.

---

## Auth

### POST /api/auth/register
Public · rate-limited (20 / 15 min / IP)

```json
{ "full_name": "Priya Sharma", "email": "priya@example.com",
  "password": "secret123", "phone": "9845011223" }
```
→ `201` `{ "ok": true, "user": { "id", "full_name", "email", "phone", "role": "user", "created_at" } }`

- Only `full_name`, `email` and `password` are required — **`phone` is optional**
  (omit it or send `""`; it is stored as `NULL`). If supplied, it must match
  8–15 digits.
- `400` with `errors: {field: message}`
- `409` duplicate email
- Any `role` sent in the body is ignored — public registration is always `user`.

### POST /api/auth/login
Public · rate-limited
```json
{ "email": "priya@example.com", "password": "secret123" }
```
→ `200` `{ "ok": true, "user": {...} }` + `Set-Cookie: threadai_token=…; HttpOnly; SameSite=Lax`
→ `401` `{ "ok": false, "error": "Invalid email or password." }` (same for unknown email)

### POST /api/auth/logout
→ `200` clears the cookie.

### GET /api/auth/me
→ `200` `{ "ok": true, "user": {...} }` · `401` when signed out.

---

## User requests (session required — always scoped to the signed-in user)

### POST /api/requests
```json
{
  "clothing_category": "Shirts & Tops",
  "clothing_condition": "Good",
  "quantity": 4,
  "request_type": "donate",
  "description": "Cotton shirts, freshly washed",
  "pickup_address": "14 Rose Garden, Indiranagar, Bengaluru 560038",
  "pickup_date": "2026-10-20",
  "contact_phone": "9845011223"
}
```
→ `201` `{ "ok": true, "request": { "request_code": "TAI-0001", "status": "Pending", ... } }`

- Server generates the unique `TAI-####` code; success is returned only after
  the insert **and** its history row commit.
- Validation: category/condition from fixed lists, quantity 1–100, type
  `donate|recycle`, address ≥ 10 chars, pickup date ≥ today, phone 8–15 digits.

### GET /api/requests
Query: `search` (request_code or clothing_category), `status`, `type`
(`donate|recycle`), `page` (default 1), `limit` (default 10, max 50)
→ `200` `{ "ok": true, "requests": [...], "pagination": { page, limit, total, totalPages } }`

### GET /api/requests/summary
→ `200` `{ "summary": { total, pending, accepted, scheduled, picked_up, completed, rejected, pieces } }`

### GET /api/requests/:id
→ `200` `{ "request": {...}, "history": [ { old_status, new_status, note, created_at, changed_by_name } ] }`
→ `404` if the id doesn't exist **or** belongs to another user.

### PATCH /api/requests/:id/cancel
→ `200` updated request with `status: "Rejected"` (history note *Cancelled by user*)
→ `409` unless current status is `Pending` or `Accepted` · `404` for non-owners.

---

## Administrator (role must be `admin` in the session)

### GET /api/admin/stats
```json
{ "stats": { "total_users", "total_requests", "pending", "accepted", "scheduled",
  "picked_up", "completed", "rejected", "feedback_count",
  "trend": [ { "label": "Jun", "value": 12 }, ... ],
  "split": { "donate": 10, "recycle": 5, "rejected": 2 } } }
```

### GET /api/admin/requests
Query: `search` (code/category/user name/email), `status`, `type`, `page`, `limit` (max 100)
→ `200` with `user_name`, `user_email` joined onto each request + `pagination`.

### GET /api/admin/requests/:id
→ `200` `{ request, history }` · `404` unknown id.

### PATCH /api/admin/requests/:id/status
```json
{ "status": "Pickup Scheduled", "pickup_date": "2026-10-25", "note": "optional" }
```
Allowed transitions:

| From | To |
|---|---|
| Pending | Accepted, Rejected |
| Accepted | Pickup Scheduled, Rejected |
| Pickup Scheduled | Picked Up, Rejected |
| Picked Up | Completed |
| Completed / Rejected | — |

- `Pickup Scheduled` requires `pickup_date` ≥ today (also used to reschedule:
  send the same status with a new date).
- `409` for any disallowed transition; every change is logged to
  `request_status_history` with the acting admin.

### GET /api/admin/users
Query: `search`, `page`, `limit` → users with `request_count`.

### GET /api/admin/feedback
Query: `page`, `limit` → feedback with user name/email (null = guest).

---

## AI clothing analysis (Phase 3)

Provider: **Google Gemini** (vision). The key lives only in `backend/.env` —
the frontend never sees it.

### GET /api/analyze/status
Public · no session required
→ `200` `{ ok, configured: bool, provider: "google-gemini", accepted_types, max_bytes }`

### POST /api/analyze
Session required (401 without) · rate-limited (20 / 15 min / IP)

`multipart/form-data` with one field:

| field | type | limits |
|---|---|---|
| `image` | JPG / PNG / WEBP file | ≤ 8 MB, magic bytes verified server-side |

→ `200`:
```json
{
  "ok": true,
  "analysis": {
    "id": 1, "is_clothing": true,
    "category": "Shirts & Tops", "condition": "Good",
    "recommendation": "Donate", "explanation": "…", "confidence": 88,
    "model": "gemini-2.5-flash"
  },
  "prefill": { "clothing_category": "Shirts & Tops", "clothing_condition": "Good", "request_type": "donate" },
  "disclaimer": "Image-based assessments are estimates…"
}
```
- `category` / `condition` are normalized to the same vocabularies as the
  pickup form (`null` when the model could not be mapped — never invented).
- `recommendation` is one of `Donate` / `Recycle` / `Reuse`; `prefill.request_type`
  is `null` for **Reuse** (the form only knows donate/recycle).
- Errors: `400` no image · `413` > 8 MB · `415` bad type or fake image bytes
  · `503` `AI_NOT_CONFIGURED` · `502` provider failure · `504` provider timeout.
- Only the extracted labels are stored (`ai_analyses` table, `user_id` = session
  user). The image itself is never written to disk.

---

## Feedback

### POST /api/feedback
Optional session (attributed when signed in, guest otherwise) · rate-limited
```json
{ "rating": 5, "message": "Pickup was quick and easy!" }
```
→ `201` `{ "feedback": { id, rating, message, created_at } }` · `400` invalid rating (<1/>5) or message (<5 chars).
No email is sent — submissions are stored in MySQL only.

---

## Misc

### GET /api/health
→ `200 { ok: true, db: "up" }` or `503 { ok: false, db: "down" }`.
