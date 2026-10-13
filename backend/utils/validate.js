/* =====================================================================
   ThreadAI — shared validation helpers (server-side)
   ===================================================================== */

const CATEGORIES = [
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
];

const CONDITIONS = ["Like New", "Good", "Fair", "Worn"];

const REQUEST_TYPES = ["donate", "recycle"];

const STATUSES = [
  "Pending",
  "Accepted",
  "Pickup Scheduled",
  "Picked Up",
  "Completed",
  "Rejected",
];

/** Allowed status transitions, enforced on every admin/user status change. */
const STATUS_TRANSITIONS = {
  Pending: ["Accepted", "Rejected"],
  Accepted: ["Pickup Scheduled", "Rejected"],
  "Pickup Scheduled": ["Picked Up", "Rejected"],
  "Picked Up": ["Completed"],
  Completed: [],
  Rejected: [],
};

/** Statuses from which a user may cancel their own request. */
const CANCELLABLE_STATUSES = ["Pending", "Accepted"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+\-\s]{8,15}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isEmail(v) {
  return typeof v === "string" && EMAIL_RE.test(v.trim());
}

function isPhone(v) {
  return typeof v === "string" && PHONE_RE.test(v.trim());
}

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

/** Normalize the request type to the DB enum ('donate' | 'recycle'). */
function normalizeType(v) {
  const s = str(v).toLowerCase();
  return REQUEST_TYPES.includes(s) ? s : null;
}

/** True when `dateStr` (YYYY-MM-DD) is today or in the future. */
function isFutureDate(dateStr) {
  if (!DATE_RE.test(dateStr)) return false;
  const d = new Date(dateStr + "T23:59:59");
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() >= today.getTime();
}

/**
 * Validate a clothing request payload.
 * Returns { errors: {field: message}, value: normalizedValue }.
 */
function validateRequestPayload(body) {
  const errors = {};
  const b = body || {};

  const category = str(b.clothing_category || b.category);
  if (!category) errors.clothing_category = "Clothing category is required.";
  else if (!CATEGORIES.includes(category)) errors.clothing_category = "Unknown clothing category.";

  const condition = str(b.clothing_condition || b.condition);
  if (!condition) errors.clothing_condition = "Condition is required.";
  else if (!CONDITIONS.includes(condition)) errors.clothing_condition = "Unknown condition.";

  const quantity = Number(b.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    errors.quantity = "Quantity must be a whole number between 1 and 100.";
  }

  const type = normalizeType(b.request_type || b.type);
  if (!type) errors.request_type = "Request type must be 'donate' or 'recycle'.";

  const address = str(b.pickup_address || b.address);
  if (address.length < 10) errors.pickup_address = "Please provide a complete pickup address.";
  else if (address.length > 255) errors.pickup_address = "Pickup address is too long (max 255 characters).";

  const date = str(b.pickup_date || b.date);
  if (!date) errors.pickup_date = "Preferred pickup date is required.";
  else if (!isFutureDate(date)) errors.pickup_date = "Pickup date must be today or later.";

  const phone = str(b.contact_phone || b.phone);
  if (!phone) errors.contact_phone = "Contact number is required.";
  else if (!isPhone(phone)) errors.contact_phone = "Enter a valid contact number (8-15 digits).";

  let description = str(b.description);
  if (description.length > 1000) {
    errors.description = "Description is too long (max 1000 characters).";
    description = description.slice(0, 1000);
  }

  return {
    errors,
    value: {
      clothing_category: category,
      clothing_condition: condition,
      quantity,
      request_type: type,
      description: description || null,
      pickup_address: address,
      pickup_date: date,
      contact_phone: phone,
    },
  };
}

module.exports = {
  CATEGORIES,
  CONDITIONS,
  REQUEST_TYPES,
  STATUSES,
  STATUS_TRANSITIONS,
  CANCELLABLE_STATUSES,
  isEmail,
  isPhone,
  str,
  normalizeType,
  isFutureDate,
  validateRequestPayload,
};
