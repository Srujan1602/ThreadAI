/* ThreadAI — /api/auth routes */
const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/authController");

const router = express.Router();

// Brute-force protection on credential endpoints (per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many attempts. Please try again in 15 minutes." },
});

router.post("/register", authLimiter, controller.register);
router.post("/login", authLimiter, controller.login);
router.post("/logout", controller.logout);
router.get("/me", controller.me);

module.exports = router;
