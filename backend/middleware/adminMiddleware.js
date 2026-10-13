/* =====================================================================
   ThreadAI — admin authorization middleware
   Role is read from the signed JWT only. Editing frontend code or
   sending {"role":"admin"} in a request body can never grant access.
   ===================================================================== */
const { requireAuth } = require("./authMiddleware");

/** 401 if not signed in, 403 if signed in without the admin role. */
function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ ok: false, error: "Administrator access required." });
    }
    next();
  });
}

module.exports = { requireAdmin };
