/* ThreadAI — /api/feedback routes */
const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/feedbackController");
const { attachUser } = require("../middleware/authMiddleware");

const router = express.Router();

const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many submissions. Please try again later." },
});

// attachUser (not requireAuth): feedback is allowed signed-in (attributed)
// or signed-out (stored anonymously) — matching the public contact page.
router.post("/", feedbackLimiter, attachUser, controller.submitFeedback);

module.exports = router;
