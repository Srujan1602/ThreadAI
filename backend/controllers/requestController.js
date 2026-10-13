/* =====================================================================
   ThreadAI — clothing request controller (user-facing)
   create / list / detail / cancel / dashboard summary
   Ownership is enforced everywhere: a user can only ever see rows whose
   user_id matches their own session — URL/parameter tampering cannot
   reach another user's data.
   ===================================================================== */
const { query, withTransaction } = require("../config/database");
const {
  STATUSES,
  CANCELLABLE_STATUSES,
  validateRequestPayload,
  str,
} = require("../utils/validate");

function mapRequest(r) {
  if (!r) return null;
  // Return ISO-ish date string for the date field
  const d = r.pickup_date;
  return {
    id: r.id,
    request_code: r.request_code,
    user_id: r.user_id,
    clothing_category: r.clothing_category,
    clothing_condition: r.clothing_condition,
    quantity: r.quantity,
    request_type: r.request_type,
    description: r.description,
    pickup_address: r.pickup_address,
    pickup_date: d instanceof Date ? d.toISOString().slice(0, 10) : d,
    contact_phone: r.contact_phone,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
    // joined fields (list/detail queries)
    user_name: r.user_name || undefined,
    user_email: r.user_email || undefined,
  };
}

/* POST /api/requests — create a pickup request (authenticated users) */
async function createRequest(req, res, next) {
  try {
    const { errors, value } = validateRequestPayload(req.body);
    if (Object.keys(errors).length) {
      return res.status(400).json({ ok: false, errors, error: "Validation failed." });
    }

    const saved = await withTransaction(async (tx) => {
      // Unique placeholder first; the human-readable code is derived from
      // the auto-increment id inside the same transaction.
      const placeholder = "TMP-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      const result = await tx(
        `INSERT INTO clothing_requests
          (request_code, user_id, clothing_category, clothing_condition, quantity,
           request_type, description, pickup_address, pickup_date, contact_phone, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
        [
          placeholder,
          req.user.id,
          value.clothing_category,
          value.clothing_condition,
          value.quantity,
          value.request_type,
          value.description,
          value.pickup_address,
          value.pickup_date,
          value.contact_phone,
        ]
      );

      const id = result.insertId;
      const requestCode = "TAI-" + String(id).padStart(4, "0");
      await tx("UPDATE clothing_requests SET request_code = ? WHERE id = ?", [requestCode, id]);

      await tx(
        `INSERT INTO request_status_history (request_id, old_status, new_status, changed_by, note)
         VALUES (?, NULL, 'Pending', ?, 'Request submitted')`,
        [id, req.user.id]
      );

      const rows = await tx("SELECT * FROM clothing_requests WHERE id = ?", [id]);
      return rows[0];
    });

    res.status(201).json({ ok: true, request: mapRequest(saved) });
  } catch (err) {
    next(err);
  }
}

/* GET /api/requests — the signed-in user's own requests (search/filter/paginate) */
async function listRequests(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const search = str(req.query.search);
    const status = str(req.query.status);
    const type = str(req.query.type).toLowerCase();

    const where = ["r.user_id = ?"];
    const params = [req.user.id];

    if (search) {
      where.push("(r.request_code LIKE ? OR r.clothing_category LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status && STATUSES.includes(status)) {
      where.push("r.status = ?");
      params.push(status);
    }
    if (type === "donate" || type === "recycle") {
      where.push("r.request_type = ?");
      params.push(type);
    }

    const whereSql = "WHERE " + where.join(" AND ");

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM clothing_requests r ${whereSql}`,
      params
    );
    const total = countRows[0].total;

    const rows = await query(
      `SELECT r.* FROM clothing_requests r ${whereSql}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      ok: true,
      requests: rows.map(mapRequest),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    next(err);
  }
}

/* GET /api/requests/summary — dashboard statistics for the signed-in user */
async function summary(req, res, next) {
  try {
    const rows = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(status = 'Pending') AS pending,
         SUM(status = 'Accepted') AS accepted,
         SUM(status = 'Pickup Scheduled') AS scheduled,
         SUM(status = 'Picked Up') AS picked_up,
         SUM(status = 'Completed') AS completed,
         SUM(status = 'Rejected') AS rejected,
         COALESCE(SUM(CASE WHEN status <> 'Rejected' THEN quantity END), 0) AS pieces
       FROM clothing_requests WHERE user_id = ?`,
      [req.user.id]
    );
    const s = rows[0] || {};
    res.json({
      ok: true,
      summary: {
        total: Number(s.total) || 0,
        pending: Number(s.pending) || 0,
        accepted: Number(s.accepted) || 0,
        scheduled: Number(s.scheduled) || 0,
        picked_up: Number(s.picked_up) || 0,
        completed: Number(s.completed) || 0,
        rejected: Number(s.rejected) || 0,
        pieces: Number(s.pieces) || 0,
      },
    });
  } catch (err) {
    next(err);
  }
}

/* GET /api/requests/:id — detail + status history (owner only) */
async function getRequest(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: "Invalid request id." });
    }

    const rows = await query(
      "SELECT * FROM clothing_requests WHERE id = ? AND user_id = ? LIMIT 1",
      [id, req.user.id]
    );
    // 404 for both "does not exist" and "belongs to someone else"
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "Request not found." });
    }

    const history = await query(
      `SELECT h.old_status, h.new_status, h.note, h.created_at, u.full_name AS changed_by_name
       FROM request_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.request_id = ?
       ORDER BY h.created_at ASC, h.id ASC`,
      [id]
    );

    res.json({ ok: true, request: mapRequest(rows[0]), history });
  } catch (err) {
    next(err);
  }
}

/* PATCH /api/requests/:id/cancel — user may cancel only while Pending/Accepted */
async function cancelRequest(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: "Invalid request id." });
    }

    const rows = await query(
      "SELECT * FROM clothing_requests WHERE id = ? AND user_id = ? LIMIT 1",
      [id, req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "Request not found." });
    }

    const current = rows[0];
    if (!CANCELLABLE_STATUSES.includes(current.status)) {
      return res.status(409).json({
        ok: false,
        error: `This request can no longer be cancelled (current status: ${current.status}).`,
      });
    }

    const updated = await withTransaction(async (tx) => {
      await tx(
        "UPDATE clothing_requests SET status = 'Rejected' WHERE id = ? AND user_id = ?",
        [id, req.user.id]
      );
      await tx(
        `INSERT INTO request_status_history (request_id, old_status, new_status, changed_by, note)
         VALUES (?, ?, 'Rejected', ?, 'Cancelled by user')`,
        [id, current.status, req.user.id]
      );
      const r = await tx("SELECT * FROM clothing_requests WHERE id = ?", [id]);
      return r[0];
    });

    res.json({ ok: true, request: mapRequest(updated) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createRequest,
  listRequests,
  summary,
  getRequest,
  cancelRequest,
  mapRequest,
};
