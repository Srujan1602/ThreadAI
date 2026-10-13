/* =====================================================================
   ThreadAI — AI clothing analysis (Phase 3)

   Real integration with the Google Gemini API (vision-capable LLM).
   The image is sent inline as base64; the model is asked for a strict
   JSON object via JSON mode, which is then normalized against the
   project's canonical category / condition / action vocabularies so
   the rest of the app (pickup form, admin dashboard) never sees a
   free-text label.

   Configuration (backend/.env):
     GEMINI_API_KEY   — required; from https://aistudio.google.com/apikey
     GEMINI_MODEL     — optional; defaults to gemini-3.8-flash
     AI_TIMEOUT_MS    — optional; defaults to 25000

   Nothing here stores images. The controller persists only the
   extracted labels into the existing ai_analyses table.
   ===================================================================== */

const { CATEGORIES, CONDITIONS } = require("../utils/validate");

const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_TIMEOUT_MS = 25000;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

/* ---------------- error types (mapped to HTTP codes in the controller) ---- */

class AiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AiError";
    this.code = code; // AI_NOT_CONFIGURED | AI_TIMEOUT | AI_BAD_REQUEST | AI_UPSTREAM
  }
}
class AiNotConfiguredError extends AiError {
  constructor() {
    super(
      "AI analysis is not configured on this server yet.",
      "AI_NOT_CONFIGURED"
    );
    this.name = "AiNotConfiguredError";
  }
}

function apiKey() {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return null;
  return key;
}

function isConfigured() {
  return Boolean(apiKey());
}

/* ---------------- canonical vocabularies + alias mapping ------------------ */

const ACTIONS = ["Donate", "Recycle", "Reuse"];

// Best-effort mapping from free-text model output to the app's
// canonical CATEGORIES list (see utils/validate.js).
const CATEGORY_ALIASES = [
  [/t-?shirt|tee|blouse|top|shirt|kurta\b|tank|sweater top/i, "Shirts & Tops"],
  [/jean|trouser|pant|shorts|chino|legging/i, "Jeans & Trousers"],
  [/dress|gown|frock|saree|sari|lehenga/i, "Dresses"],
  [/jacket|coat|blazer|hoodie|windbreaker|parka/i, "Jackets & Coats"],
  [/sweater|cardigan|pullover|woolen|woollen|knit|hoodie/i, "Sweaters & Woolens"],
  [/salwar|kameez|kurti|sherwani|dhoti|ethnic|kurta/i, "Ethnic Wear"],
  [/kid|child|baby|toddler|infant/i, "Kids Clothing"],
  [/shoe|sandal|sneaker|boot|slipper|footwear|flip ?flop/i, "Footwear"],
  [/bag|purse|backpack|wallet|cap|hat|scarf|belt|accessor/i, "Bags & Accessories"],
  [/towel|bedsheet|bed sheet|curtain|blanket|cushion|tablecloth|linen|household|rag/i, "Household Textiles"],
];

const CONDITION_ALIASES = [
  [/like ?new|brand ?new|mint|pristine|excellent|new/i, "Like New"],
  [/good|great|fine|clean|gently used/i, "Good"],
  [/fair|okay|ok|moderate|average|decent|usable|slight/i, "Fair"],
  [/worn|damag|torn|rip|hole|stain|fade|fray|threadbare|poor|heavily used|stained/i, "Worn"],
];

function mapCategory(raw) {
  const s = String(raw || "").trim();
  if (CATEGORIES.includes(s)) return s;
  for (const [re, canonical] of CATEGORY_ALIASES) {
    if (re.test(s)) return canonical;
  }
  return null;
}

function mapCondition(raw) {
  const s = String(raw || "").trim();
  if (CONDITIONS.includes(s)) return s;
  // Damage words win even inside longer phrases like "good but torn"
  for (const [re, canonical] of CONDITION_ALIASES) {
    if (re.test(s)) return canonical;
  }
  return null;
}

function mapAction(raw, condition) {
  const s = String(raw || "").trim().toLowerCase();
  if (s.includes("recycl")) return "Recycle";
  if (s.includes("reus")) return "Reuse";
  if (s.includes("donat")) return "Donate";
  // Fallback derived from condition rather than invented
  return condition === "Worn" ? "Recycle" : "Donate";
}

function clampConfidence(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/* ---------------- prompt + schema sent to Gemini ------------------------- */

const PROMPT = `You are the clothing analysis assistant for ThreadAI, a clothing donation and recycling platform.
Examine the attached photo of a clothing item and respond with ONE JSON object containing exactly these keys:
- "is_clothing": boolean — true only if the photo clearly shows a clothing item, wearable garment, or household textile.
- "category": string — one of exactly: "Shirts & Tops", "Jeans & Trousers", "Dresses", "Jackets & Coats", "Sweaters & Woolens", "Ethnic Wear", "Kids Clothing", "Footwear", "Bags & Accessories", "Household Textiles".
- "condition": string — one of exactly: "Like New", "Good", "Fair", "Worn". Judge ONLY from visible evidence (pilling, tears, holes, stains, fading, fraying, broken zips/buttons).
- "action": string — one of exactly: "Donate", "Recycle", "Reuse".
  Donate = wearable, clean, would genuinely help someone now.
  Reuse = still usable by the owner after repair, upcycling or restyling.
  Recycle = too damaged to wear; suitable for fibre recovery or rags.
- "explanation": string — 1 or 2 plain sentences justifying the recommendation, referencing what you can actually see in the photo.
- "confidence": number — integer 0-100 expressing how confident you are in the category and condition judgement.
Rules: never guess fabric composition; if the photo is not a clothing item set "is_clothing" to false and use your best guess for the other fields; respond with the JSON object only — no markdown, no commentary.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    is_clothing: { type: "BOOLEAN" },
    category: { type: "STRING" },
    condition: { type: "STRING" },
    action: { type: "STRING" },
    explanation: { type: "STRING" },
    confidence: { type: "NUMBER" },
  },
  required: ["is_clothing", "category", "condition", "action", "explanation", "confidence"],
};

/* ---------------- the actual API call ------------------------------------ */

function buildBody(buffer, mimeType, withSchema) {
  const generationConfig = {
    temperature: 0.2,
    responseMimeType: "application/json",
  };
  if (withSchema) generationConfig.responseSchema = RESPONSE_SCHEMA;

  return {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: buffer.toString("base64"),
            },
          },
          { text: PROMPT },
        ],
      },
    ],
    generationConfig,
  };
}

/** Extract the concatenated text parts of the first candidate. */
function extractText(payload) {
  const cand = payload && payload.candidates && payload.candidates[0];
  if (!cand || !cand.content || !Array.isArray(cand.content.parts)) return null;
  return cand.content.parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("");
}

async function callGemini(key, body, timeoutMs) {
  const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const url = `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new AiError(
        `The AI service did not respond within ${Math.round(timeoutMs / 1000)}s. Please try again.`,
        "AI_TIMEOUT"
      );
    }
    throw new AiError("Could not reach the AI service. Check the server's network access.", "AI_UPSTREAM");
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch (_err) {
    /* non-JSON body handled below */
  }

  return { status: res.status, payload };
}

/**
 * Analyze one clothing image.
 * @param {Buffer} buffer    raw image bytes
 * @param {string} mimeType  image/jpeg | image/png | image/webp
 * @returns {Promise<{category, condition, recommendation, explanation, confidence, is_clothing, model}>}
 * @throws {AiNotConfiguredError|AiError}
 */
async function analyzeClothingImage(buffer, mimeType) {
  const key = apiKey();
  if (!key) throw new AiNotConfiguredError();

  const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const withSchema = true;

  let { status, payload } = await callGemini(key, buildBody(buffer, mimeType, withSchema), timeoutMs);

  // Some models/endpoints reject responseSchema with a 400 — retry once
  // without it; the prompt still demands strict JSON.
  if (status === 400 && withSchema) {
    ({ status, payload } = await callGemini(key, buildBody(buffer, mimeType, false), timeoutMs));
  }

  if (status === 401 || status === 403) {
    throw new AiError(
      "The AI service rejected the configured API key. Check GEMINI_API_KEY in backend/.env.",
      "AI_UPSTREAM"
    );
  }
  if (status === 429) {
    throw new AiError(
      "The AI service rate limit has been reached. Please try again in a few minutes.",
      "AI_UPSTREAM"
    );
  }
  if (status < 200 || status >= 300) {
    const reason =
      payload && payload.error && payload.error.message
        ? String(payload.error.message).slice(0, 300)
        : `HTTP ${status}`;
    throw new AiError(`The AI service returned an error: ${reason}`, "AI_UPSTREAM");
  }

  const text = extractText(payload);
  if (!text) {
    throw new AiError(
      "The AI service returned no analysis for this image (it may have been blocked).",
      "AI_UPSTREAM"
    );
  }

  let parsed;
  try {
    // Tolerate fenced JSON just in case a model ignores JSON mode
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    parsed = JSON.parse(cleaned);
  } catch (_err) {
    throw new AiError("The AI service returned an unreadable result. Please try again.", "AI_UPSTREAM");
  }

  const isClothing = parsed.is_clothing !== false;

  // Map to canonical vocabularies. A null mapping is preserved as null so
  // the UI can say "could not determine" instead of inventing a label.
  const category = mapCategory(parsed.category);
  const condition = mapCondition(parsed.condition);
  const recommendation = mapAction(parsed.action, condition);
  const confidence = clampConfidence(parsed.confidence);

  const explanation = String(parsed.explanation || "").trim().slice(0, 600) || null;

  return {
    is_clothing: isClothing,
    category,
    condition,
    recommendation,
    explanation,
    confidence,
    model: (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
  };
}

module.exports = {
  analyzeClothingImage,
  isConfigured,
  AiError,
  AiNotConfiguredError,
  ACTIONS,
};
