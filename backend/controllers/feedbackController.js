/* =====================================================================
   ThreadAI — feedback controller
   Associates feedback with the signed-in user when there is a session.
   No email is sent anywhere — the API never claims otherwise.
   ===================================================================== */
const { query } = require("../config/database");
const { str } = require("../utils/validate");

/* POST /api/feedback */
async function submitFeedback(req, res, next) {
  try {
    const rating = Number(req.body.rating);
    const message = str(req.body.message);

    const errors = {};
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      errors.rating = "Please choose a rating between 1 and 5.";
    }
    if (message.length < 5) {
      errors.message = "Please write at least 5 characters.";
    } else if (message.length > 1000) {
      errors.message = "Message is too long (max 1000 characters).";
    }
    if (Object.keys(errors).length) {
      return res.status(400).json({ ok: false, errors, error: "Validation failed." });
    }

    const userId = req.user ? req.user.id : null;
    const result = await query(
      "INSERT INTO feedback (user_id, rating, message) VALUES (?, ?, ?)",
      [userId, rating, message]
    );

    const rows = await query("SELECT id, rating, message, created_at FROM feedback WHERE id = ?", [
      result.insertId,
    ]);

    res.status(201).json({ ok: true, feedback: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { submitFeedback };
