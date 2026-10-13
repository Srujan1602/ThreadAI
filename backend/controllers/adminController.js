/* =====================================================================
   ThreadAI — administrator controller
   Every function here runs behind requireAdmin. Status changes are
   validated against the allowed transition map and recorded in
   request_status_history.
   ===================================================================== */
const { query, withTransaction } = require("../config/database");
const {
  STATUSES,
  STATUS_TRANSITIONS,
  isFutureDate,
  str,
} = require("../utils/validate");
const { mapRequest } = require("./requestController");

/* GET /api/admin/stats */
async function stats(_req, res, next) {
  try {
    const [counters] = await query(
      `SELECT
         (SELECT COUNT(*) FROM users) AS total_users,
         (SELECT COUNT(*) FROM clothing_requests) AS total_requests,
         (SELECT COUNT(*) FROM clothing_requests WHERE status = 'Pending') AS pending,
         (SELECT COUNT(*) FROM clothing_requests WHERE status = 'Accepted') AS accepted,
         (SELECT COUNT(*) FROM clothing_requests WHERE status = 'Pickup Scheduled') AS scheduled,
         (SELECT COUNT(*) FROM clothing_requests WHERE status = 'Picked Up') AS picked_up,
         (SELECT COUNT(*) FROM clothing_requests WHERE status = 'Completed') AS completed,
         (SELECT COUNT(*) FROM clothing_requests WHERE status = 'Rejected') AS rejected,
         (SELECT COUNT(*) FROM feedback) AS feedback_count`
    );

    // Request trend for the last 6 calendar months (incl. current),
    // padded with zeros so the chart always shows a full window
    const trendRows = await query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym,
              DATE_FORMAT(created_at, '%b') AS label,
              COUNT(*) AS value
       FROM clothing_requests
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 5 MONTH)
       GROUP BY ym, label
       ORDER BY ym ASC`
    );
    const byMonth = Object.fromEntries(trendRows.map((t) => [t.ym, Number(t.value)]));
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      trend.push({
        label: d.toLocaleString("en-US", { month: "short" }),
        value: byMonth[ym] || 0,
      });
    }

    const split = await query(
      `SELECT request_type, status, COUNT(*) AS value
       FROM clothing_requests
       GROUP BY request_type, status`
    );

    const donate = split
      .filter((r) => r.request_type === "donate" && r.status !== "Rejected")
      .reduce((a, r) => a + Number(r.value), 0);
    const recycle = split
      .filter((r) => r.request_type === "recycle" && r.status !== "Rejected")
      .reduce((a, r) => a + Number(r.value), 0);
    const rejected = split
      .filter((r) => r.status === "Rejected")
      .reduce((a, r) => a + Number(r.value), 0);

    res.json({
      ok: true,
      stats: {
        total_users: Number(counters.total_users),
        total_requests: Number(counters.total_requests),
        pending: Number(counters.pending),
        accepted: Number(counters.accepted),
        scheduled: Number(counters.scheduled),
        picked_up: Number(counters.picked_up),
        completed: Number(counters.completed),
        rejected: Number(counters.rejected),
        feedback_count: Number(counters.feedback_count),
        trend,
        split: { donate, recycle, rejected },
      },
    });
  } catch (err) {
    next(err);
  }
}

/* GET /api/admin/requests — all requests, searchable + filterable */
async function listRequests(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const offset = (page - 1) * limit;

    const search = str(req.query.search);
    const status = str(req.query.status);
    const type = str(req.query.type).toLowerCase();

    const where = ["1=1"];
    const params = [];

    if (search) {
      where.push(
        "(r.request_code LIKE ? OR r.clothing_category LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)"
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
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
      `SELECT COUNT(*) AS total
       FROM clothing_requests r
       JOIN users u ON u.id = r.user_id
       ${whereSql}`,
      params
    );

    const rows = await query(
      `SELECT r.*, u.full_name AS user_name, u.email AS user_email
       FROM clothing_requests r
       JOIN users u ON u.id = r.user_id
       ${whereSql}
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
        total: countRows[0].total,
        totalPages: Math.max(1, Math.ceil(countRows[0].total / limit)),
      },
    });
  } catch (err) {
    next(err);
  }
}

/* GET /api/admin/requests/:id — detail + history + owning user */
async function getRequest(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: "Invalid request id." });
    }

    const rows = await query(
      `SELECT r.*, u.full_name AS user_name, u.email AS user_email
       FROM clothing_requests r
       JOIN users u ON u.id = r.user_id
       WHERE r.id = ? LIMIT 1`,
      [id]
    );
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

/* PATCH /api/admin/requests/:id/status — validated status transitions */
async function updateStatus(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: "Invalid request id." });
    }

    const newStatus = str(req.body.status);
    const pickupDate = str(req.body.pickup_date);
    const note = str(req.body.note);

    if (!STATUSES.includes(newStatus)) {
      return res.status(400).json({ ok: false, error: "Unknown status value." });
    }

    const rows = await query("SELECT * FROM clothing_requests WHERE id = ? LIMIT 1", [id]);
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "Request not found." });
    }
    const current = rows[0];

    // Scheduling a pickup (or rescheduling) requires a valid future date.
    if (newStatus === "Pickup Scheduled") {
      if (!isFutureDate(pickupDate)) {
        return res.status(400).json({
          ok: false,
          errors: { pickup_date: "A valid pickup date (today or later) is required." },
          error: "A valid pickup date is required to schedule a pickup.",
        });
      }
    }

    const sameStatusReschedule =
      newStatus === current.status && newStatus === "Pickup Scheduled";
    const allowed =
      sameStatusReschedule || (STATUS_TRANSITIONS[current.status] || []).includes(newStatus);

    if (!allowed) {
      return res.status(409).json({
        ok: false,
        error: `Invalid transition: ${current.status} → ${newStatus}.`,
      });
    }

    const updated = await withTransaction(async (tx) => {
      if (sameStatusReschedule) {
        await tx("UPDATE clothing_requests SET pickup_date = ? WHERE id = ?", [pickupDate, id]);
      } else {
        await tx(
          "UPDATE clothing_requests SET status = ? , pickup_date = COALESCE(?, pickup_date) WHERE id = ?",
          [newStatus, newStatus === "Pickup Scheduled" ? pickupDate : null, id]
        );
      }
      await tx(
        `INSERT INTO request_status_history (request_id, old_status, new_status, changed_by, note)
         VALUES (?, ?, ?, ?, ?)`,
        [
          id,
          current.status,
          newStatus,
          req.user.id,
          note ||
            (sameStatusReschedule
              ? `Pickup date rescheduled to ${pickupDate}`
              : `Status changed by admin`),
        ]
      );
      const r = await tx("SELECT * FROM clothing_requests WHERE id = ?", [id]);
      return r[0];
    });

    res.json({ ok: true, request: mapRequest(updated) });
  } catch (err) {
    next(err);
  }
}

/* GET /api/admin/users — registered users with their request counts */
async function listUsers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const search = str(req.query.search);

    const where = ["1=1"];
    const params = [];
    if (search) {
      where.push("(u.full_name LIKE ? OR u.email LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    const whereSql = "WHERE " + where.join(" AND ");

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
      params
    );

    const rows = await query(
      `SELECT u.id, u.full_name, u.email, u.role, u.created_at,
              COUNT(r.id) AS request_count
       FROM users u
       LEFT JOIN clothing_requests r ON r.user_id = u.id
       ${whereSql}
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      ok: true,
      users: rows.map((u) => ({
        id: u.id,
        full_name: u.full_name,
        email: u.email,
        role: u.role,
        created_at: u.created_at,
        request_count: Number(u.request_count),
      })),
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        totalPages: Math.max(1, Math.ceil(countRows[0].total / limit)),
      },
    });
  } catch (err) {
    next(err);
  }
}

/* GET /api/admin/feedback — review submitted feedback */
async function listFeedback(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const countRows = await query("SELECT COUNT(*) AS total FROM feedback");
    const rows = await query(
      `SELECT f.id, f.rating, f.message, f.created_at,
              u.full_name AS user_name, u.email AS user_email
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json({
      ok: true,
      feedback: rows,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        totalPages: Math.max(1, Math.ceil(countRows[0].total / limit)),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  stats,
  listRequests,
  getRequest,
  updateStatus,
  listUsers,
  listFeedback,
};
