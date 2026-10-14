/* ThreadAI — /api/analyze routes (Phase 3)
   POST /api/analyze        — authenticated users only (results are
                              attributed + rate-limited: each call
                              consumes real AI quota)
   GET  /api/analyze/status — public, returns {configured: bool} only  */
const express = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const { requireAuth } = require("../middleware/authMiddleware");
const controller = require("../controllers/analysisController");

const router = express.Router();

// Memory-only upload: images are never written to disk by the backend.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

// Each real AI analysis costs quota — keep per-IP usage bounded tightly.
// In DEMO_MODE nothing external is called, so the window is generous enough
// for a classroom (several students behind one NAT IP) while still bounded.
const DEMO_MODE = ["true", "1", "yes"].includes(
  String(process.env.DEMO_MODE || "").toLowerCase()
);
const analyzeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: DEMO_MODE ? 60 : 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many analysis requests. Please try again later." },
});

router.get("/status", controller.status);

router.post(
  "/",
  analyzeLimiter,
  requireAuth,
  (req, res, next) => {
    upload.single("image")(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          ok: false,
          error: "Image is too large. Please upload a file under 8 MB.",
        });
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({
          ok: false,
          error: 'Send the image in a form field named "image".',
        });
      }
      return res.status(400).json({ ok: false, error: "Could not read the uploaded image." });
    });
  },
  controller.analyze
);

module.exports = router;
