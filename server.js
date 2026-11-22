// Anonymous advice board. Zero dependencies, Node 18+.
// Visitors post anonymously (no accounts, no IP addresses stored).
// Only the host (you) can publish advice, using ADMIN_PASSWORD.
//
// Run:  ADMIN_PASSWORD="choose-a-long-passphrase" node server.js

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const HOST_NAME = process.env.HOST_NAME || "Your Host";
const SITE_NAME = process.env.SITE_NAME || "Open Ear";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error("Set ADMIN_PASSWORD (at least 8 characters) before starting.");
  process.exit(1);
}

const CATEGORIES = ["Relationships", "Family", "School", "Work and career", "Money", "Health and mind", "Life direction", "Other"];
const LIMITS = { title: 120, body: 5000, reply: 8000, followup: 2000 };

// ---------- storage (JSON file, atomic writes) ----------
let db = { posts: [], replies: [] };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { /* fresh start */ }
let saving = false, dirty = false;
function save() {
  dirty = true;
  if (saving) return;
  saving = true;
  const tick = () => {
    dirty = false;
    const tmp = DATA_FILE + ".tmp";
    fs.writeFile(tmp, JSON.stringify(db), (err) => {
      if (!err) fs.rename(tmp, DATA_FILE, () => next());
      else next();
    });
  };
  const next = () => { if (dirty) tick(); else saving = false; };
  tick();
}
const id = () => crypto.randomBytes(6).toString("hex");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// ---------- auth (signed cookie, host only) ----------
function sign(v) { return v + "." + crypto.createHmac("sha256", SECRET).update(v).digest("hex"); }
function makeSession() { return sign("host:" + (Date.now() + 1000 * 60 * 60 * 24 * 30)); }
function isHost(req) {
  const m = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return false;
  const val = decodeURIComponent(m[1]);
  const i = val.lastIndexOf(".");
  if (i < 0) return false;
  const body = val.slice(0, i);
  const good = sign(body);
  const a = Buffer.from(good), b = Buffer.from(val);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(body.split(":")[1]) > Date.now();
}
function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

// ---------- rate limiting (in memory only, hashed, never written to disk) ----------
const buckets = new Map();
function limited(req, key, max, windowMs) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "";
  const k = key + ":" + sha(ip + SECRET);
  const now = Date.now();
  const arr = (buckets.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(k, arr); return true; }
  arr.push(now);
  buckets.set(k, arr);
  return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 3600000)) buckets.delete(k); }, 600000).unref();

// ---------- helpers ----------
function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 50000) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}
const clean = (s, max) => (typeof s === "string" ? s.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max) : "");
const publicPost = (p) => {
  const rs = db.replies.filter((r) => r.postId === p.id);
  return { id: p.id, title: p.title, body: p.body, category: p.category, createdAt: p.createdAt,
    replyCount: rs.length, answered: rs.some((r) => r.kind === "host") };
};
const publicReply = (r) => ({ id: r.id, kind: r.kind, body: r.body, createdAt: r.createdAt });

// ---------- routes ----------
async function api(req, res, url) {
  const host = isHost(req);
  const m = (re) => re.exec(url.pathname);
  let r;

  if (req.method === "GET" && url.pathname === "/api/config")
    return send(res, 200, { siteName: SITE_NAME, hostName: HOST_NAME, categories: CATEGORIES, limits: LIMITS, isHost: host });

  if (req.method === "POST" && url.pathname === "/api/login") {
    if (limited(req, "login", 8, 15 * 60 * 1000)) return send(res, 429, { error: "Too many attempts. Please wait a few minutes." });
    const b = await readBody(req);
    if (typeof b.password === "string" && safeEqual(b.password, ADMIN_PASSWORD)) {
      const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
      return send(res, 200, { ok: true }, { "Set-Cookie": `session=${encodeURIComponent(makeSession())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}` });
    }
    return send(res, 401, { error: "Incorrect password." });
  }
  if (req.method === "POST" && url.pathname === "/api/logout")
    return send(res, 200, { ok: true }, { "Set-Cookie": "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });

  if (req.method === "GET" && url.pathname === "/api/posts") {
    const cat = url.searchParams.get("category");
    const list = db.posts.filter((p) => !cat || p.category === cat).sort((a, b) => b.createdAt - a.createdAt).map(publicPost);
    return send(res, 200, { posts: list });
  }

  if (req.method === "POST" && url.pathname === "/api/posts") {
    if (limited(req, "post", 5, 60 * 60 * 1000)) return send(res, 429, { error: "You have posted a few times recently. Please try again later." });
    const b = await readBody(req);
    const title = clean(b.title, LIMITS.title), body = clean(b.body, LIMITS.body);
    const category = CATEGORIES.includes(b.category) ? b.category : "Other";
    if (title.length < 3 || body.length < 10) return send(res, 400, { error: "Please add a short title and a few sentences." });
    const token = crypto.randomBytes(16).toString("hex");
    const p = { id: id(), title, body, category, createdAt: Date.now(), tokenHash: sha(token) };
    db.posts.push(p); save();
    return send(res, 201, { post: publicPost(p), token });
  }

  if ((r = m(/^\/api\/posts\/([a-f0-9]+)$/)) && req.method === "GET") {
    const p = db.posts.find((x) => x.id === r[1]);
    if (!p) return send(res, 404, { error: "Not found." });
    const replies = db.replies.filter((x) => x.postId === p.id).sort((a, b) => a.createdAt - b.createdAt).map(publicReply);
    return send(res, 200, { post: publicPost(p), replies });
  }

  if ((r = m(/^\/api\/posts\/([a-f0-9]+)$/)) && req.method === "DELETE") {
    if (!host) return send(res, 403, { error: "Host only." });
    db.posts = db.posts.filter((x) => x.id !== r[1]);
    db.replies = db.replies.filter((x) => x.postId !== r[1]); save();
    return send(res, 200, { ok: true });
  }

  if ((r = m(/^\/api\/posts\/([a-f0-9]+)\/replies$/)) && req.method === "POST") {
    const p = db.posts.find((x) => x.id === r[1]);
    if (!p) return send(res, 404, { error: "Not found." });
    const b = await readBody(req);
    if (host) {
      const body = clean(b.body, LIMITS.reply);
      if (body.length < 1) return send(res, 400, { error: "Write something first." });
      const rep = { id: id(), postId: p.id, kind: "host", body, createdAt: Date.now() };
      db.replies.push(rep); save();
      return send(res, 201, { reply: publicReply(rep) });
    }
    // anonymous follow-up, only allowed for the original poster (token)
    if (limited(req, "follow", 20, 60 * 60 * 1000)) return send(res, 429, { error: "Please slow down a little." });
    if (typeof b.token !== "string" || !safeEqual(sha(b.token), p.tokenHash)) return send(res, 403, { error: "Only the original poster can add follow-ups." });
    const body = clean(b.body, LIMITS.followup);
    if (body.length < 1) return send(res, 400, { error: "Write something first." });
    const rep = { id: id(), postId: p.id, kind: "op", body, createdAt: Date.now() };
    db.replies.push(rep); save();
    return send(res, 201, { reply: publicReply(rep) });
  }

  if ((r = m(/^\/api\/replies\/([a-f0-9]+)$/)) && req.method === "DELETE") {
    if (!host) return send(res, 403, { error: "Host only." });
    db.replies = db.replies.filter((x) => x.id !== r[1]); save();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "Not found." });
}

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'",
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    const full = path.normalize(path.join(__dirname, "public", file));
    if (!full.startsWith(path.join(__dirname, "public"))) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
      res.end(data);
    });
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: "Bad request." });
  }
}).listen(PORT, () => console.log(`${SITE_NAME} running on http://localhost:${PORT}`));
