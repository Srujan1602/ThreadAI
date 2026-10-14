/* =====================================================================
   ThreadAI — frontend API client (Phase 2)
   - Talks to the Express backend with fetch(..., {credentials:'include'})
   - Session lives in an httpOnly cookie — nothing is stored in
     localStorage (no tokens in JS-reachable storage)
   - Session-aware navigation + protected page redirects
   ===================================================================== */

// Default: same-origin (""), which is correct when the page is served by
// the Express backend locally (:5000) AND in production (Railway, Render,
// tunnels) — the API always lives on the page's own host.
// The only case needing an absolute base is the Phase 1 static server
// (`python -m http.server 8000`) on localhost — detect that narrowly so a
// deployed site NEVER targets 127.0.0.1 (that broke on Railway: the page
// tried to reach the visitor's own laptop instead of the server).
// Override any time with: window.THREADAI_API_BASE = "http://127.0.0.1:5000";
const THREADAI_HOST = window.location.hostname;
const THREADAI_IS_LOCAL =
  THREADAI_HOST === "localhost" ||
  THREADAI_HOST === "127.0.0.1" ||
  THREADAI_HOST === "[::1]";
window.THREADAI_API_BASE =
  typeof window.THREADAI_API_BASE === "undefined"
    ? THREADAI_IS_LOCAL && window.location.port !== "5000"
      ? "http://127.0.0.1:5000"
      : ""
    : window.THREADAI_API_BASE;

const API_BASE = window.THREADAI_API_BASE;

class ApiError extends Error {
  constructor(message, status, errors) {
    super(message);
    this.status = status;
    this.errors = errors || {};
  }
}

/** Core fetch wrapper: JSON in/out, cookies included, typed errors out. */
async function apiFetch(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (_err) {
    throw new ApiError("Cannot reach the server. Is the backend running?", 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_err) {
    /* non-JSON response */
  }

  if (!res.ok) {
    throw new ApiError(
      (data && (data.error || data.message)) || `Request failed (${res.status}).`,
      res.status,
      data && data.errors
    );
  }
  return data;
}

const API = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: "POST", body }),
  patch: (path, body) => apiFetch(path, { method: "PATCH", body }),
};

/** POST a FormData (multipart) payload — used by the clothing analyzer.
 *  The browser sets the multipart boundary itself; never add a
 *  Content-Type header here. Errors match the ApiError shape above. */
API.upload = async (path, formData) => {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
  } catch (_err) {
    throw new ApiError("Cannot reach the server. Is the backend running?", 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_err) {
    /* non-JSON response */
  }

  if (!res.ok) {
    throw new ApiError(
      (data && (data.error || data.message)) || `Request failed (${res.status}).`,
      res.status,
      data && data.errors
    );
  }
  return data;
};

/** Show field-level API errors on a form. Returns true when all good. */
function showApiErrors(formEl, err) {
  if (!err || !err.errors) return false;
  let any = false;
  Object.entries(err.errors).forEach(([name, msg]) => {
    const input = formEl.querySelector(`[name="${name}"], #${name}`);
    if (!input) return;
    const field = input.closest(".field");
    if (!field) return;
    field.classList.add("error");
    const msgEl = field.querySelector(".error-msg");
    if (msgEl) msgEl.textContent = msg;
    any = true;
  });
  return any;
}

function clearApiErrors(formEl) {
  formEl.querySelectorAll(".field.error").forEach((f) => f.classList.remove("error"));
}

/** Disable a button + swap its label while a request is in flight. */
function setLoading(btn, loading, loadingText) {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = loadingText || "Please wait…";
  } else {
    btn.disabled = false;
    if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
  }
}

/* ---------------- session-aware navigation ---------------- */

let sessionPromise = null;

/** Fetch the current session once per page load (or refresh it). */
function getCurrentUser(force) {
  if (!sessionPromise || force) {
    sessionPromise = API.get("/api/auth/me")
      .then((d) => d.user)
      .catch(() => null);
  }
  return sessionPromise;
}

async function logout() {
  try {
    await API.post("/api/auth/logout");
  } finally {
    window.location.href = "index.html";
  }
}

function initSessionNav() {
  const authBtn = document.getElementById("navAuth");
  const dashLink = document.getElementById("navDash");

  getCurrentUser().then((user) => {
    if (user) {
      if (authBtn) {
        authBtn.textContent = "Logout";
        authBtn.removeAttribute("href");
        authBtn.addEventListener("click", (e) => {
          e.preventDefault();
          logout();
        });
      }
      if (dashLink) dashLink.style.display = "";
    } else {
      if (authBtn) {
        authBtn.textContent = "Login";
        authBtn.setAttribute("href", "login.html");
      }
      // Protected user pages → login with a redirect back
      const protection = document.body.dataset.protected;
      if (protection === "user" || protection === "admin") {
        const next = encodeURIComponent(
          window.location.pathname.split("/").pop() || "index.html"
        );
        window.location.href = "login.html?next=" + next;
        return;
      }
    }

    // Admin-only pages additionally require the admin role
    if (user && document.body.dataset.protected === "admin" && user.role !== "admin") {
      window.location.href = "login.html?error=admin";
    }
  });
}

document.addEventListener("DOMContentLoaded", initSessionNav);
