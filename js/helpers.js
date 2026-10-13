/* ==========================================================================
   ThreadAI — shared UI helpers (status badges, dates, timelines, states)
   Used by the dashboard, My Requests, and admin pages.
   ========================================================================== */

const STATUSES = [
  "Pending",
  "Accepted",
  "Pickup Scheduled",
  "Picked Up",
  "Completed",
  "Rejected",
];

const STATUS_META = {
  Pending: { cls: "badge-pending", step: 0 },
  Accepted: { cls: "badge-accepted", step: 1 },
  "Pickup Scheduled": { cls: "badge-scheduled", step: 2 },
  "Picked Up": { cls: "badge-picked", step: 3 },
  Completed: { cls: "badge-completed", step: 4 },
  Rejected: { cls: "badge-rejected", step: -1 },
};

const TIMELINE_STEPS = [
  "Pending",
  "Accepted",
  "Pickup Scheduled",
  "Picked Up",
  "Completed",
];

function statusBadge(status) {
  const meta = STATUS_META[status] || { cls: "badge-pending" };
  return '<span class="badge ' + meta.cls + '">' + escapeHtml(status) + "</span>";
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(String(iso).length === 10 ? iso + "T00:00:00" : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function timelineHtml(status) {
  const step = (STATUS_META[status] || { step: 0 }).step;
  if (step === -1) {
    return (
      '<div class="timeline">' +
      '<div class="tl-step done"><span class="tl-label">Request received</span></div>' +
      '<div class="tl-step current" style="flex:2"><span class="tl-label">Rejected / cancelled — ' +
      "no pickup will be made</span></div></div>"
    );
  }
  return (
    '<div class="timeline">' +
    TIMELINE_STEPS.map((label, i) => {
      const cls = i < step ? "done" : i === step ? "done current" : "";
      return (
        '<div class="tl-step ' + cls + '"><span class="tl-label">' + label + "</span></div>"
      );
    }).join("") +
    "</div>"
  );
}

function typeLabel(type) {
  return String(type).toLowerCase() === "recycle" ? "Recycle" : "Donate";
}

function typeEmoji(type) {
  return String(type).toLowerCase() === "recycle" ? "♻️" : "💚";
}

/* ---- state blocks: loading / empty / error (used by API-driven views) ---- */

function loadingStateHtml(label) {
  return (
    '<div class="state-block"><div class="state-spinner"></div><p>' +
    escapeHtml(label || "Loading…") +
    "</p></div>"
  );
}

function emptyStateHtml(icon, title, hint) {
  return (
    '<div class="state-block"><div class="state-icon">' +
    icon +
    "</div><p><strong>" +
    escapeHtml(title) +
    "</strong></p>" +
    (hint ? '<p class="state-hint">' + escapeHtml(hint) + "</p>" : "") +
    "</div>"
  );
}

function errorStateHtml(title, hint) {
  return (
    '<div class="state-block state-error"><div class="state-icon">⚠️</div><p><strong>' +
    escapeHtml(title) +
    "</strong></p>" +
    (hint ? '<p class="state-hint">' + escapeHtml(hint) + "</p>" : "") +
    "</div>"
  );
}
