/* =====================================================================
   ThreadAI — API integration tests (no extra dependencies)

   Prerequisites:
     1. MySQL running and database/schema.sql applied
     2. backend/.env configured (DB_* + JWT_SECRET)
     3. npm run create-admin  (ADMIN_* values in .env)
     4. npm start             (server on PORT, default 5000)

   Run:  npm test
   Exit code 0 = all checks passed.
   ===================================================================== */

require("dotenv").config(); // load ADMIN_* / TEST_BASE_URL from backend/.env

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:5000";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name + (extra ? ` — ${extra}` : ""));
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const token = raw.find((c) => c.startsWith("threadai_token="));
  return token ? token.split(";")[0] : "";
}

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:5000",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_e) { /* non-JSON */ }
  return { status: res.status, data, cookie: cookieFrom(res), res };
}

const stamp = Date.now();

async function run() {
  console.log(`\nThreadAI API tests → ${BASE}\n`);

  /* ---------------- health ---------------- */
  console.log("Health");
  const health = await call("GET", "/api/health");
  check("GET /api/health responds", health.status === 200 || health.status === 503);
  check("database reachable", health.data && health.data.db === "up",
    "is MySQL running and schema.sql applied?");

  if (!health.data || health.data.db !== "up") {
    console.log("\nAborting: database is not reachable.");
    process.exit(1);
  }

  /* ---------------- registration ---------------- */
  console.log("\nRegistration");
  const newUser = {
    full_name: "Test User " + stamp,
    email: `test${stamp}@example.com`,
    phone: "9845012345",
    password: "secret123",
  };

  const reg = await call("POST", "/api/auth/register", { body: newUser });
  check("POST /api/auth/register → 201", reg.status === 201, `got ${reg.status}`);
  check("response has user without password_hash",
    reg.data && reg.data.user && !reg.data.user.password_hash && !("password_hash" in (reg.data.user || {})));
  check("new user role is 'user'", reg.data && reg.data.user && reg.data.user.role === "user");

  // Attempted privilege escalation must be ignored
  const evil = await call("POST", "/api/auth/register", {
    body: { ...newUser, email: `evil${stamp}@example.com`, role: "admin" },
  });
  const evilMe = await call("GET", "/api/auth/me", { cookie: evil.cookie });
  check("registering with role:'admin' still creates a regular user",
    evil.status === 201 && evilMe.data && evilMe.data.user.role === "user");

  const dup = await call("POST", "/api/auth/register", { body: newUser });
  check("duplicate email → 409", dup.status === 409, `got ${dup.status}`);

  const badEmail = await call("POST", "/api/auth/register", {
    body: { ...newUser, email: "not-an-email" },
  });
  check("invalid email → 400", badEmail.status === 400, `got ${badEmail.status}`);

  /* phone is optional at registration */
  const noPhoneUser = {
    full_name: "No Phone User " + stamp,
    email: `nophone${stamp}@example.com`,
    password: "secret123",
  };
  const noPhoneReg = await call("POST", "/api/auth/register", { body: noPhoneUser });
  check("register without phone → 201", noPhoneReg.status === 201, `got ${noPhoneReg.status}`);
  check("phoneless user is created with phone null",
    noPhoneReg.status === 201 && noPhoneReg.data.user.phone === null,
    `phone=${JSON.stringify(noPhoneReg.data.user && noPhoneReg.data.user.phone)}`);

  const noPhoneLogin = await call("POST", "/api/auth/login", {
    body: { email: noPhoneUser.email, password: noPhoneUser.password },
  });
  check("login works with email + password only (no phone)",
    noPhoneLogin.status === 200 && noPhoneLogin.data.user.role === "user",
    `got ${noPhoneLogin.status}`);

  const emptyPhoneReg = await call("POST", "/api/auth/register", {
    body: { ...newUser, email: `emptyphone${stamp}@example.com`, phone: "" },
  });
  check("register with blank phone string → 201", emptyPhoneReg.status === 201, `got ${emptyPhoneReg.status}`);

  const badPhoneReg = await call("POST", "/api/auth/register", {
    body: { ...newUser, email: `badphone${stamp}@example.com`, phone: "abc" },
  });
  check("invalid phone (when supplied) → 400", badPhoneReg.status === 400, `got ${badPhoneReg.status}`);

  /* ---------------- login ---------------- */
  console.log("\nLogin");
  const badLogin = await call("POST", "/api/auth/login", {
    body: { email: newUser.email, password: "wrong-password" },
  });
  check("wrong password → 401", badLogin.status === 401, `got ${badLogin.status}`);

  const login = await call("POST", "/api/auth/login", {
    body: { email: newUser.email, password: newUser.password },
  });
  check("correct credentials → 200", login.status === 200, `got ${login.status}`);
  check("sets an httpOnly session cookie",
    login.cookie.startsWith("threadai_token=") && login.res.headers.get("set-cookie").includes("HttpOnly"));
  const userCookie = login.cookie;

  const me = await call("GET", "/api/auth/me", { cookie: userCookie });
  check("GET /api/auth/me returns the user", me.status === 200 && me.data.user.email === newUser.email);
  check("/api/auth/me works without a cookie → 401",
    (await call("GET", "/api/auth/me")).status === 401);

  /* ---------------- requests ---------------- */
  console.log("\nClothing requests");
  const req1 = await call("POST", "/api/requests", {
    cookie: userCookie,
    body: {
      clothing_category: "Shirts & Tops",
      clothing_condition: "Good",
      quantity: 3,
      request_type: "donate",
      pickup_address: "14 Rose Garden, Indiranagar, Bengaluru",
      pickup_date: futureDate(5),
      contact_phone: "9845012345",
      description: "Cotton shirts in good condition.",
    },
  });
  check("POST /api/requests → 201", req1.status === 201, `got ${req1.status}: ${JSON.stringify(req1.data)}`);
  const createdId = req1.data && req1.data.request ? req1.data.request.id : null;
  check("server generated a TAI-#### request code",
    req1.data && /^TAI-\d{4}$/.test(req1.data.request.request_code));
  check("new request status is Pending", req1.data && req1.data.request.status === "Pending");

  const invalidReq = await call("POST", "/api/requests", {
    cookie: userCookie,
    body: {
      clothing_category: "Shirts & Tops",
      clothing_condition: "Good",
      quantity: 0,
      request_type: "donate",
      pickup_address: "short",
      pickup_date: "2001-01-01",
      contact_phone: "abc",
    },
  });
  check("invalid payload → 400 with field errors",
    invalidReq.status === 400 && Object.keys(invalidReq.data.errors || {}).length >= 4);

  check("unauthenticated create → 401",
    (await call("POST", "/api/requests", { body: {} })).status === 401);

  const list = await call("GET", "/api/requests?page=1&limit=5", { cookie: userCookie });
  check("GET /api/requests returns own requests with pagination",
    list.status === 200 && list.data.requests.length >= 1 && list.data.pagination.total >= 1);

  const search = await call("GET", "/api/requests?search=TAI-", { cookie: userCookie });
  check("search by request code works", search.status === 200 && search.data.requests.length >= 1);

  const summary = await call("GET", "/api/requests/summary", { cookie: userCookie });
  check("GET /api/requests/summary returns totals",
    summary.status === 200 && summary.data.summary.total >= 1);

  const detail = await call("GET", `/api/requests/${createdId}`, { cookie: userCookie });
  check("GET /api/requests/:id returns detail + history",
    detail.status === 200 && Array.isArray(detail.data.history) && detail.data.history.length >= 1);

  /* second user must not reach the first user's data */
  const user2 = await call("POST", "/api/auth/register", {
    body: {
      full_name: "Other Person " + stamp,
      email: `other${stamp}@example.com`,
      phone: "9845099999",
      password: "secret123",
    },
  });
  check("cross-user detail access → 404",
    (await call("GET", `/api/requests/${createdId}`, { cookie: user2.cookie })).status === 404);
  const list2 = await call("GET", "/api/requests", { cookie: user2.cookie });
  check("user 2 sees only their own requests",
    list2.status === 200 && list2.data.requests.every((r) => r.id !== createdId));

  const cancel = await call("PATCH", `/api/requests/${createdId}/cancel`, { cookie: userCookie });
  check("owner can cancel a Pending request", cancel.status === 200 && cancel.data.request.status === "Rejected");
  const cancelAgain = await call("PATCH", `/api/requests/${createdId}/cancel`, { cookie: userCookie });
  check("cannot cancel twice (status no longer cancellable)", cancelAgain.status === 409);
  check("non-owner cannot cancel → 404",
    (await call("PATCH", `/api/requests/${createdId}/cancel`, { cookie: user2.cookie })).status === 404);

  // second request so admin tests have a Pending row
  const req2 = await call("POST", "/api/requests", {
    cookie: userCookie,
    body: {
      clothing_category: "Jeans & Trousers",
      clothing_condition: "Fair",
      quantity: 2,
      request_type: "recycle",
      pickup_address: "22 MG Road, Pune, 411001",
      pickup_date: futureDate(7),
      contact_phone: "9845012345",
    },
  });
  const adminTargetId = req2.data && req2.data.request ? req2.data.request.id : null;

  /* ---------------- admin permissions ---------------- */
  console.log("\nAdministrator permissions");
  const adminDenied = await call("GET", "/api/admin/stats", { cookie: userCookie });
  check("regular user → 403 on /api/admin/stats", adminDenied.status === 403, `got ${adminDenied.status}`);
  check("no cookie → 401 on /api/admin/stats",
    (await call("GET", "/api/admin/stats")).status === 401);

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    check("ADMIN_EMAIL / ADMIN_PASSWORD provided for admin tests", false,
      "set them in backend/.env (used by npm run create-admin)");
  } else {
    const adminLogin = await call("POST", "/api/auth/login", {
      body: { email: adminEmail, password: adminPassword },
    });
    check("admin can log in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");
    const adminCookie = adminLogin.cookie;

    const stats = await call("GET", "/api/admin/stats", { cookie: adminCookie });
    check("GET /api/admin/stats → 200 with counters",
      stats.status === 200 && typeof stats.data.stats.total_requests === "number");
    check("stats include a monthly trend array",
      stats.status === 200 && Array.isArray(stats.data.stats.trend));

    const adminList = await call("GET", "/api/admin/requests?limit=50", { cookie: adminCookie });
    check("admin can list all requests", adminList.status === 200 && adminList.data.requests.length >= 1);
    check("admin list includes the user's new request",
      adminList.data.requests.some((r) => r.id === adminTargetId));

    const adminUsers = await call("GET", "/api/admin/users", { cookie: adminCookie });
    check("GET /api/admin/users → 200", adminUsers.status === 200 && adminUsers.data.users.length >= 2);

    /* status transition enforcement */
    const bad = await call("PATCH", `/api/admin/requests/${adminTargetId}/status`, {
      cookie: adminCookie,
      body: { status: "Completed" },
    });
    check("invalid transition Pending → Completed → 409", bad.status === 409, `got ${bad.status}`);

    const accepted = await call("PATCH", `/api/admin/requests/${adminTargetId}/status`, {
      cookie: adminCookie,
      body: { status: "Accepted" },
    });
    check("valid transition Pending → Accepted", accepted.status === 200 && accepted.data.request.status === "Accepted");

    const scheduledNoDate = await call("PATCH", `/api/admin/requests/${adminTargetId}/status`, {
      cookie: adminCookie,
      body: { status: "Pickup Scheduled" },
    });
    check("scheduling without a date → 400", scheduledNoDate.status === 400);

    const scheduled = await call("PATCH", `/api/admin/requests/${adminTargetId}/status`, {
      cookie: adminCookie,
      body: { status: "Pickup Scheduled", pickup_date: futureDate(3) },
    });
    check("valid transition Accepted → Pickup Scheduled",
      scheduled.status === 200 && scheduled.data.request.status === "Pickup Scheduled");

    const picked = await call("PATCH", `/api/admin/requests/${adminTargetId}/status`, {
      cookie: adminCookie,
      body: { status: "Picked Up" },
    });
    check("Pickup Scheduled → Picked Up", picked.status === 200);

    const completed = await call("PATCH", `/api/admin/requests/${adminTargetId}/status`, {
      cookie: adminCookie,
      body: { status: "Completed" },
    });
    check("Picked Up → Completed", completed.status === 200 && completed.data.request.status === "Completed");

    const detail2 = await call("GET", `/api/admin/requests/${adminTargetId}`, { cookie: adminCookie });
    check("status history recorded for the full flow",
      detail2.status === 200 && detail2.data.history.length >= 4);

    /* regular user must not be able to self-complete */
    const selfComplete = await call("PATCH", `/api/requests/${adminTargetId}/status`, {
      cookie: userCookie,
      body: { status: "Completed" },
    });
    check("users have no status-update endpoint (404)", selfComplete.status === 404);
  }

  /* ---------------- feedback ---------------- */
  console.log("\nFeedback");
  const badFb = await call("POST", "/api/feedback", {
    body: { rating: 9, message: "hi" },
  });
  check("invalid rating/message → 400", badFb.status === 400);

  const fb = await call("POST", "/api/feedback", {
    cookie: userCookie,
    body: { rating: 5, message: "Great platform, pickup was quick and easy!" },
  });
  check("valid feedback → 201", fb.status === 201, `got ${fb.status}: ${JSON.stringify(fb.data)}`);
  check("feedback linked to signed-in user",
    fb.status === 201 && fb.data.feedback && fb.data.feedback.id);

  const guestFb = await call("POST", "/api/feedback", {
    body: { rating: 4, message: "Anonymous guest feedback entry." },
  });
  check("signed-out feedback still accepted → 201", guestFb.status === 201);

  /* ---------------- AI clothing analysis ---------------- */
  console.log("\nAI clothing analysis");

  const analyzeStatus = await call("GET", "/api/analyze/status");
  check("GET /api/analyze/status → 200",
    analyzeStatus.status === 200 &&
    typeof analyzeStatus.data.configured === "boolean" &&
    typeof analyzeStatus.data.demo === "boolean");
  const aiConfigured = analyzeStatus.status === 200 && analyzeStatus.data.configured === true;
  const demoMode = analyzeStatus.status === 200 && analyzeStatus.data.demo === true;

  // 1x1 red PNG (valid PNG magic bytes) and a fake "PNG" that is really text
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const fakePng = Buffer.from("this is definitely not a png, just text", "utf8");

  async function uploadImage(bytes, filename, contentType, cookie, fields) {
    const form = new FormData();
    form.append("image", new Blob([bytes], { type: contentType }), filename);
    if (fields) {
      Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    }
    const res = await fetch(BASE + "/api/analyze", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:5000", ...(cookie ? { Cookie: cookie } : {}) },
      body: form,
    });
    let data = null;
    try { data = await res.json(); } catch (_e) { /* non-JSON */ }
    return { status: res.status, data };
  }

  check("unauthenticated analyze → 401",
    (await uploadImage(tinyPng, "a.png", "image/png")).status === 401);

  // No file at all (empty multipart body with just the auth cookie)
  const noFile = await (async () => {
    const form = new FormData();
    const res = await fetch(BASE + "/api/analyze", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:5000", Cookie: userCookie },
      body: form,
    });
    let data = null;
    try { data = await res.json(); } catch (_e) { /* non-JSON */ }
    return { status: res.status, data };
  })();
  check("missing image field → 400", noFile.status === 400, `got ${noFile.status}`);

  const textAsPng = await uploadImage(fakePng, "fake.png", "image/png", userCookie);
  check("text file disguised as PNG → 415 (magic-byte check)",
    textAsPng.status === 415, `got ${textAsPng.status}: ${JSON.stringify(textAsPng.data)}`);

  const wrongMime = await uploadImage(tinyPng, "a.png", "application/zip", userCookie);
  check("unsupported MIME type → 415", wrongMime.status === 415, `got ${wrongMime.status}`);

  // Oversized upload (>8 MB) — multer limit
  const bigBuffer = Buffer.concat([tinyPng, Buffer.alloc(9 * 1024 * 1024, 0)]);
  const tooBig = await uploadImage(bigBuffer, "big.png", "image/png", userCookie);
  check("oversized image → 413", tooBig.status === 413, `got ${tooBig.status}`);

  const realAnalyze = await uploadImage(tinyPng, "pixel.png", "image/png", userCookie);
  if (demoMode) {
    /* ---------------- demo clothing analysis mode ---------------- */
    check("demo mode: missing category/condition → 400 with field errors",
      realAnalyze.status === 400 &&
      realAnalyze.data && realAnalyze.data.errors &&
      !!realAnalyze.data.errors.category,
      `got ${realAnalyze.status}: ${JSON.stringify(realAnalyze.data)}`);

    const demoRun = await uploadImage(tinyPng, "pixel.png", "image/png", userCookie, {
      category: "Shirts & Tops",
      condition: "Good",
    });
    check("demo mode: valid upload + selections → 200 simulated result",
      demoRun.status === 200 &&
      demoRun.data.ok === true &&
      demoRun.data.demo === true &&
      demoRun.data.analysis &&
      demoRun.data.analysis.demo === true &&
      demoRun.data.analysis.recommendation === "Donate" &&
      demoRun.data.analysis.confidence === null &&
      typeof demoRun.data.analysis.donation_suitability === "string" &&
      typeof demoRun.data.analysis.next_step === "string" &&
      typeof demoRun.data.disclaimer === "string" &&
      demoRun.data.disclaimer.includes("Demo Analysis") &&
      demoRun.data.prefill &&
      demoRun.data.prefill.clothing_category === "Shirts & Tops" &&
      demoRun.data.prefill.clothing_condition === "Good",
      `got ${demoRun.status}: ${JSON.stringify(demoRun.data).slice(0, 240)}`);

    const demoRun2 = await uploadImage(tinyPng, "pixel.png", "image/png", userCookie, {
      category: "Shirts & Tops",
      condition: "Good",
    });
    check("demo mode: same inputs → identical simulated result",
      demoRun2.status === 200 &&
      demoRun2.data.analysis.recommendation === demoRun.data.analysis.recommendation &&
      demoRun2.data.analysis.explanation === demoRun.data.analysis.explanation,
      `got ${demoRun2.status}`);

    const demoWorn = await uploadImage(tinyPng, "pixel.png", "image/png", userCookie, {
      category: "Other",
      condition: "Worn",
    });
    check("demo mode: Worn condition → Recycle, Other → null category",
      demoWorn.status === 200 &&
      demoWorn.data.analysis.recommendation === "Recycle" &&
      demoWorn.data.analysis.category === null &&
      demoWorn.data.prefill.clothing_category === null,
      `got ${demoWorn.status}: ${JSON.stringify(demoWorn.data).slice(0, 200)}`);
  } else if (aiConfigured) {
    check("valid image + configured AI → 200 with analysis",
      realAnalyze.status === 200 &&
      realAnalyze.data.ok === true &&
      realAnalyze.data.analysis &&
      typeof realAnalyze.data.analysis.recommendation === "string" &&
      typeof realAnalyze.data.disclaimer === "string",
      `got ${realAnalyze.status}: ${JSON.stringify(realAnalyze.data).slice(0, 200)}`);
  } else {
    check("valid image without AI credentials → 503 AI_NOT_CONFIGURED",
      realAnalyze.status === 503 && realAnalyze.data && realAnalyze.data.code === "AI_NOT_CONFIGURED",
      `got ${realAnalyze.status}: ${JSON.stringify(realAnalyze.data)}`);
  }

  /* ---------------- CSRF / origin ---------------- */
  console.log("\nSecurity");
  const cross = await fetch(BASE + "/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example.com" },
    body: JSON.stringify({}),
  });
  check("foreign Origin on a state-changing request → 403", cross.status === 403, `got ${cross.status}`);

  const noStack = await call("POST", "/api/requests", { cookie: userCookie, body: "{invalid json" });
  check("malformed JSON → 400 without stack trace",
    noStack.status === 400 && !JSON.stringify(noStack.data).includes("at "));

  /* ---------------- result ---------------- */
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("Failures:");
    failures.forEach((f) => console.log("  - " + f));
  }
  process.exit(failed ? 1 : 0);
}

function futureDate(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

run().catch((err) => {
  console.error("Test run crashed:", err.message);
  console.error("Is the backend running at " + BASE + "? (npm start)");
  process.exit(1);
});
