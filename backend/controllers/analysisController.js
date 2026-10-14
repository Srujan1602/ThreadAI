/* =====================================================================
   ThreadAI — clothing analysis controller (Phase 3)
   POST /api/analyze        (authenticated) — run a real AI analysis
   GET  /api/analyze/status (public)        — is the AI configured?

   The uploaded image lives in memory only (multer memoryStorage),
   is validated by declared MIME type AND magic bytes, is never
   written to disk, and is sent only to the configured AI provider.
   Only the extracted labels are persisted (ai_analyses table that
   already exists in the schema — no migration needed).
   ===================================================================== */
const { query } = require("../config/database");
const { analyzeClothingImage, isConfigured } = require("../services/aiAnalyzer");
const { CATEGORIES, CONDITIONS, str } = require("../utils/validate");

/* File-upload constraints (mirrored in analyze.html for fast feedback) */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Magic-byte sniffing — the declared MIME header alone is not trusted. */
function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

const DISCLAIMER =
  "Image-based assessments are estimates. They may not detect fabric composition, " +
  "internal wear, or damage hidden from the photo — the final condition is confirmed at pickup.";

/* ---------------- Demo clothing analysis mode --------------------------- */
/* DEMO_MODE=true (backend/.env) makes POST /api/analyze return a
   deterministic, clearly-labelled SIMULATED result built from the
   category + condition the user selected. No AI provider is contacted,
   no API key is needed, and nothing is inferred from the image — this
   exists so the workflow can be demonstrated with zero budget/online
   dependency. The image is still validated (real image file required)
   but is never sent anywhere or stored. */

function demoEnabled() {
  return ["true", "1", "yes"].includes(String(process.env.DEMO_MODE || "").toLowerCase());
}

const DEMO_CATEGORIES = [
  "Shirts & Tops",
  "Jeans & Trousers",
  "Dresses",
  "Jackets & Coats",
  "Sweaters & Woolens",
  "Ethnic Wear",
  "Kids Clothing",
  "Footwear",
  "Bags & Accessories",
  "Household Textiles",
  "Other",
];

/* Condition → simulated outcome. Deliberately deterministic and
   explainable: the "assessment" is a pure function of the selected
   condition (the category shapes the wording only). */
const DEMO_OUTCOMES = {
  "Like New": {
    recommendation: "Donate",
    summary: "barely-used garment in excellent shape",
    suitability: "Excellent — ready to be worn by someone else right away.",
    next_step: "Schedule a doorstep pickup and we'll collect it for donation.",
    note: "Items in this condition are ideal for direct donation drives.",
  },
  Good: {
    recommendation: "Donate",
    summary: "well-kept garment with plenty of life left",
    suitability: "Good — suitable for donation, ideally after a quick wash.",
    next_step: "Request a pickup and choose 'Donate' so it reaches someone who needs it.",
    note: "A quick wash and fold is all the preparation this item needs.",
  },
  Fair: {
    recommendation: "Recycle",
    summary: "usable garment showing visible signs of wear",
    suitability: "Fair — has noticeable wear; better suited to textile recycling than donation.",
    next_step: "Request a recycling pickup so the fabric can be recovered instead of landfilled.",
    note: "Light repairs can extend its life, but recycling is the more reliable route at this condition.",
  },
  Worn: {
    recommendation: "Recycle",
    summary: "heavily-worn garment at the end of its wearable life",
    suitability: "Poor — too worn for reuse; fibre recycling recovers most of the material.",
    next_step: "Request a recycling pickup — worn textiles are broken down into reusable fibre.",
    note: "Even heavily worn textiles have value as recovered fibre for new products.",
  },
};

/** Build the simulated analysis. Pure function — same inputs, same output. */
function buildDemoAnalysis(category, condition, categoryLabel, conditionLabel) {
  const outcome = DEMO_OUTCOMES[condition];
  return {
    is_clothing: true,
    category: category === "Other" ? null : category,
    condition,
    recommendation: outcome.recommendation,
    explanation:
      `Simulated assessment: your ${categoryLabel} is in ${conditionLabel.toLowerCase()} ` +
      `condition — ${outcome.summary}. ${outcome.note}`,
    confidence: null, // never fabricate a confidence number in demo mode
    model: null,
    demo: true,
    summary: `${categoryLabel} · ${conditionLabel} condition`,
    donation_suitability: outcome.suitability,
    next_step: outcome.next_step,
  };
}

const DEMO_DISCLAIMER =
  "Demo Analysis — Simulated Results. This result was generated from the category " +
  "and condition you selected; no AI image recognition was performed on your photo.";

/* Map the service result to the app's donate/recycle/reuse prefill. */
function buildPrefill(analysis) {
  // Reuse means "keep it yourself" — the pickup form only knows
  // donate/recycle, so we only prefill a request_type when one applies.
  const request_type =
    analysis.recommendation === "Donate"
      ? "donate"
      : analysis.recommendation === "Recycle"
      ? "recycle"
      : null;
  return {
    clothing_category: CATEGORIES.includes(analysis.category) ? analysis.category : null,
    clothing_condition: CONDITIONS.includes(analysis.condition) ? analysis.condition : null,
    request_type,
  };
}

/* POST /api/analyze — multipart form field: "image" */
async function analyze(req, res, next) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        ok: false,
        error: "Please choose an image file (JPG, PNG, or WEBP) to analyze.",
      });
    }

    const declared = req.file.mimetype && req.file.mimetype.toLowerCase();
    if (!ALLOWED_MIME[declared]) {
      return res.status(415).json({
        ok: false,
        error: "Unsupported image type. Please upload a JPG, PNG, or WEBP image.",
      });
    }

    const actual = sniffImageType(req.file.buffer);
    if (!actual || actual !== declared) {
      return res.status(415).json({
        ok: false,
        error: "The file content does not match a valid image. Please upload a real photo.",
      });
    }

    if (req.file.size > MAX_IMAGE_BYTES) {
      return res.status(413).json({
        ok: false,
        error: "Image is too large. Please upload a file under 8 MB.",
      });
    }

    /* ---- Demo mode: deterministic simulated result, zero AI calls ---- */
    if (demoEnabled()) {
      const category = str(req.body.category);
      const condition = str(req.body.condition);
      const errors = {};
      if (!DEMO_CATEGORIES.includes(category)) {
        errors.category = "Please select a clothing category.";
      }
      if (!CONDITIONS.includes(condition)) {
        errors.condition = "Please select a condition.";
      }
      if (Object.keys(errors).length) {
        return res.status(400).json({ ok: false, errors, error: "Please select a category and condition." });
      }

      const categoryLabel = str(req.body.category_label).replace(/[<>]/g, "").slice(0, 40) || category;
      const conditionLabel = str(req.body.condition_label).replace(/[<>]/g, "").slice(0, 40) || condition;
      const analysis = buildDemoAnalysis(category, condition, categoryLabel, conditionLabel);

      // Persist the labels like a real run so dashboards stay consistent
      // (simulated values are returned to the user clearly labelled as demo).
      let analysisId = null;
      try {
        const result = await query(
          `INSERT INTO ai_analyses
             (user_id, image_path, predicted_category, predicted_condition, recommendation, confidence_score)
           VALUES (?, NULL, ?, ?, ?, ?)`,
          [req.user.id, analysis.category, analysis.condition, analysis.recommendation, analysis.confidence]
        );
        analysisId = result.insertId;
      } catch (_dbErr) {
        console.warn("[ThreadAI] could not persist demo analysis row:", _dbErr.message);
      }

      return res.json({
        ok: true,
        demo: true,
        analysis: { id: analysisId, ...analysis },
        prefill: buildPrefill(analysis),
        disclaimer: DEMO_DISCLAIMER,
      });
    }

    let analysis;
    try {
      analysis = await analyzeClothingImage(req.file.buffer, actual);
    } catch (aiErr) {
      if (aiErr.code === "AI_NOT_CONFIGURED") {
        return res.status(503).json({
          ok: false,
          code: "AI_NOT_CONFIGURED",
          error:
            "AI analysis is not configured on this server yet. " +
            "Set GEMINI_API_KEY in backend/.env and restart the backend to enable it.",
        });
      }
      if (aiErr.code === "AI_TIMEOUT") {
        return res.status(504).json({ ok: false, code: "AI_TIMEOUT", error: aiErr.message });
      }
      // Transient provider overload (Gemini "high demand") — not a config or
      // key problem. 503 + Retry-After tells the client this is temporary.
      if (aiErr.code === "AI_UNAVAILABLE") {
        res.set("Retry-After", "15");
        return res.status(503).json({ ok: false, code: "AI_UNAVAILABLE", error: aiErr.message });
      }
      // AI_UPSTREAM and anything unexpected from the provider
      return res.status(502).json({ ok: false, code: "AI_UPSTREAM", error: aiErr.message });
    }

    // Persist only the extracted labels (existing ai_analyses table).
    let analysisId = null;
    try {
      const result = await query(
        `INSERT INTO ai_analyses
           (user_id, image_path, predicted_category, predicted_condition, recommendation, confidence_score)
         VALUES (?, NULL, ?, ?, ?, ?)`,
        [
          req.user.id,
          analysis.category,
          analysis.condition,
          analysis.recommendation,
          analysis.confidence,
        ]
      );
      analysisId = result.insertId;
    } catch (_dbErr) {
      // A storage failure must not discard the user's result — the
      // analysis is still valid and returned below.
      console.warn("[ThreadAI] could not persist ai_analyses row:", _dbErr.message);
    }

    res.json({
      ok: true,
      analysis: {
        id: analysisId,
        is_clothing: analysis.is_clothing,
        category: analysis.category,
        condition: analysis.condition,
        recommendation: analysis.recommendation,
        explanation: analysis.explanation,
        confidence: analysis.confidence,
        model: analysis.model,
      },
      prefill: buildPrefill(analysis),
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    next(err);
  }
}

/* GET /api/analyze/status — reveals nothing but booleans + model name. */
function status(_req, res) {
  const demo = demoEnabled();
  res.json({
    ok: true,
    demo,
    configured: isConfigured(),
    provider: demo ? "demo-simulator" : "google-gemini",
    accepted_types: Object.keys(ALLOWED_MIME),
    max_bytes: MAX_IMAGE_BYTES,
  });
}

module.exports = { analyze, status, DISCLAIMER };
