/* ==========================================================================
   ThreadAI — Shared frontend helpers
   (Mobile nav, reveal animations, toasts, demo utilities)
   ========================================================================== */

// ----- Mobile navigation -----
const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");

if (navToggle && navLinks) {
  navToggle.addEventListener("click", () => {
    navToggle.classList.toggle("open");
    navLinks.classList.toggle("open");
  });

  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navToggle.classList.remove("open");
      navLinks.classList.remove("open");
    });
  });
}

// ----- Scroll reveal animations -----
const revealEls = document.querySelectorAll(".reveal");
if (revealEls.length > 0) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  revealEls.forEach((el) => observer.observe(el));
}

// ----- Toast notifications -----
function toast(title, message, type = "success") {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }

  const el = document.createElement("div");
  el.className = "toast " + type;
  el.innerHTML =
    "<div>🌱</div><div><strong>" +
    escapeHtml(title) +
    "</strong><span>" +
    escapeHtml(message) +
    "</span></div>";
  stack.appendChild(el);

  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

// ----- Form validation helpers -----
function setFieldError(input, hasError) {
  const field = input.closest(".field");
  if (field) field.classList.toggle("error", hasError);
  return !hasError;
}

function validateRequired(input) {
  const empty = !input.value.trim();
  return setFieldError(input, empty);
}

function validateEmail(input) {
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
  return setFieldError(input, !ok);
}

function validatePhone(input) {
  const ok = /^[0-9+\-\s]{8,15}$/.test(input.value.trim());
  return setFieldError(input, !ok);
}

function validateMinLength(input, min) {
  return setFieldError(input, input.value.trim().length < min);
}

function validateMatch(a, b) {
  return setFieldError(b, a.value !== b.value);
}

// ----- Password visibility toggle -----
document.querySelectorAll(".pw-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = btn.parentElement.querySelector("input");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.textContent = showing ? "SHOW" : "HIDE";
  });
});

// ----- Current year in footer -----
document.querySelectorAll(".year-now").forEach((el) => {
  el.textContent = new Date().getFullYear();
});
