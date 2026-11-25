
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const app = express();

const PORT = Number(process.env.PORT || 3000);

function getApiKey() {
  try {
    const envPath = path.join(__dirname, ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      const match = content.match(/^GEMINI_API_KEY\s*=\s*(.*)$/m);
      if (match && match[1]) {
        return match[1].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {}
  return process.env.GEMINI_API_KEY || "";
}

const DEFAULT_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const LEGACY_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro"
]);

// MODEL CONFIGURATION
const CONFIGURED_MODELS = [
  DEFAULT_MODEL,
  ...(process.env.GEMINI_MODELS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean)
];

const MODEL_LIST = [
  ...new Set(CONFIGURED_MODELS)
]
  .filter(model => !LEGACY_MODELS.has(model));

const IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL ||
  "gemini-3.1-flash-image";

const PRIMARY_TIMEOUT = 5000;
const FALLBACK_TIMEOUT = 8000;
const IMAGE_TIMEOUT = 120000;

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");

const MEMORY_FILE = path.join(DATA_DIR, "memory.json");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const USER_CHATS_DIR = path.join(DATA_DIR, "user_chats");
const USER_MEMORY_DIR = path.join(DATA_DIR, "user_memory");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_CHATS_DIR, { recursive: true });
fs.mkdirSync(USER_MEMORY_DIR, { recursive: true });

if (!fs.existsSync(MEMORY_FILE)) {
  fs.writeFileSync(MEMORY_FILE, "[]");
}

if (!fs.existsSync(USAGE_FILE)) {
  fs.writeFileSync(
    USAGE_FILE,
    JSON.stringify({
      requests: 0,
      images: 0,
      errors: 0
    }, null, 2)
  );
}

if (!fs.existsSync(USERS_FILE)) {
  const defaultSalt = crypto.randomBytes(16).toString("hex");
  const defaultHash = crypto.pbkdf2Sync("password123", defaultSalt, 10000, 64, "sha512").toString("hex");
  const defaultUser = {
    id: "usr_demo",
    name: "Pengguna Nano AI",
    username: "demo",
    email: "demo@nano.local",
    passwordHash: defaultHash,
    salt: defaultSalt,
    avatar: "G",
    avatarColor: "#4285f4",
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(USERS_FILE, JSON.stringify([defaultUser], null, 2));
}

if (!fs.existsSync(SESSIONS_FILE)) {
  fs.writeFileSync(SESSIONS_FILE, "{}");
}

// MIDDLEWARE
app.use(express.json({ limit: "30mb" }));

app.use(express.urlencoded({
  extended: true,
  limit: "30mb"
}));

app.use(express.static(PUBLIC_DIR));

app.get("/landing", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "landing", "index.html"));
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

// UTILITIES
function readJson(file, fallback) {
  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(
    file,
    JSON.stringify(value, null, 2),
    "utf8"
  );
}

function usage() {
  return readJson(USAGE_FILE, {
    requests: 0,
    images: 0,
    errors: 0
  });
}

function bump(key) {
  const u = usage();
  u[key] = (u[key] || 0) + 1;
  writeJson(USAGE_FILE, u);
}

function fail(res, status, message) {
  return res.status(status).json({
    error: message
  });
}

// ======================================
// USER & AUTHENTICATION UTILITIES
// ======================================
function readUsers() {
  return readJson(USERS_FILE, []);
}

function writeUsers(users) {
  writeJson(USERS_FILE, users);
}

function readSessions() {
  return readJson(SESSIONS_FILE, {});
}

function writeSessions(sessions) {
  writeJson(SESSIONS_FILE, sessions);
}

function safeUser(u) {
  if (!u) return null;
  const { passwordHash, salt, ...safe } = u;
  return safe;
}

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  return req.headers["x-auth-token"] || req.query?.token || null;
}

function resolveUser(req) {
  const token = extractToken(req);
  if (!token) return null;
  const sessions = readSessions();
  const session = sessions[token];
  if (!session) return null;

  if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
    delete sessions[token];
    writeSessions(sessions);
    return null;
  }

  const users = readUsers();
  return users.find(u => u.id === session.userId) || null;
}

function requireAuth(req, res, next) {
  const user = resolveUser(req);
  if (!user) {
    return fail(
      res,
      401,
      "Sesi autentikasi tidak valid atau telah berakhir. Silakan login kembali."
    );
  }
  req.user = user;
  next();
}

function optionalAuth(req, res, next) {
  const user = resolveUser(req);
  if (user) req.user = user;
  next();
}

function readUserMemory(userId) {
  if (!userId) return readMemory();
  const file = path.join(USER_MEMORY_DIR, `${userId}.json`);
  const m = readJson(file, []);
  return Array.isArray(m) ? m : [];
}

function writeUserMemory(userId, items) {
  if (!userId) {
    writeJson(MEMORY_FILE, items);
  } else {
    const file = path.join(USER_MEMORY_DIR, `${userId}.json`);
    writeJson(file, items);
  }
}

function readMemory() {
  const m = readJson(MEMORY_FILE, []);
  return Array.isArray(m) ? m : [];
}

function validText(value) {
  return typeof value === "string" &&
    value.trim().length > 0;
}

// CHAT HISTORY
function convertMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(m => m && validText(m.content))
    .slice(-16)
    .map(m => ({
      role:
        m.role === "assistant" ||
        m.role === "model"
          ? "model"
          : "user",
      parts: [{
        text: m.content.trim().slice(0, 30000)
      }]
    }));
}

// API ERROR
function parseApiError(raw, status) {
  try {
    const j = JSON.parse(raw);

    return {
      code: Number(j.error?.code || status),
      message: j.error?.message || raw
    };
  } catch {
    return {
      code: status,
      message: raw || "Permintaan Gemini gagal."
    };
  }
}

// GEMINI REQUEST
// Timeout hanya berlaku sampai respons HTTP awal diterima.
// Setelah respons diterima, timer dihentikan agar streaming
// tidak terputus hanya karena melewati 20 detik.
async function callGemini(
  model,
  body,
  streaming = false,
  timeoutMs = PRIMARY_TIMEOUT
) {
  const method = streaming
    ? "streamGenerateContent"
    : "generateContent";

  const query = streaming ? "?alt=sse" : "";

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}${query}`;

  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort(
      new Error("Gemini initial response timeout")
    );
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": getApiKey()
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    // Jangan batalkan streaming setelah headers diterima.
    clearTimeout(timer);

    return response;

  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

// SSE PARSER
function parseSseEvent(eventText, onPayload) {
  for (const line of eventText.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;

    const raw = line.slice(5).trim();

    if (!raw || raw === "[DONE]") continue;

    try {
      const obj = JSON.parse(raw);

      let text = "";
      const parts =
        obj.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        if (typeof part.text === "string") {
          text += part.text;
        }
      }

      let sources = null;
      const chunks = obj.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (Array.isArray(chunks) && chunks.length > 0) {
        sources = chunks
          .filter(c => c.web?.uri)
          .map(c => ({
            title: c.web.title || c.web.uri,
            url: c.web.uri
          }));
      }

      if (text || (sources && sources.length)) {
        onPayload({ text, sources });
      }

      if (obj.error?.message) {
        console.error(
          "Gemini stream error:",
          obj.error.message
        );
      }

    } catch (error) {
      console.error(
        "SSE parse error:",
        error.message
      );
    }
  }
}

// DOCUMENT READER
async function extractFileText(file) {
  const ext = path.extname(file.originalname)
    .toLowerCase();

  const plain = [
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".js",
    ".html",
    ".css",
    ".py",
    ".xml",
    ".log"
  ];

  if (plain.includes(ext)) {
    return file.buffer.toString("utf8");
  }

  if (ext === ".pdf") {
    const result = await pdfParse(file.buffer);
    return result.text || "";
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({
      buffer: file.buffer
    });

    return result.value || "";
  }

  throw new Error(
    "Format belum didukung. Gunakan PDF, DOCX, TXT, MD, CSV, JSON, JS, HTML, CSS, PY, XML, atau LOG."
  );
}

// ======================================
// AUTHENTICATION & USER MANAGEMENT ENDPOINTS
// ======================================

// REGISTER
app.post("/api/auth/register", (req, res) => {
  const { name, username, email, password } = req.body || {};

  if (!validText(name) || !validText(username) || !validText(email) || !validText(password)) {
    return fail(res, 400, "Nama, username, email, dan password wajib diisi.");
  }

  const cleanUser = username.trim().toLowerCase();
  const cleanEmail = email.trim().toLowerCase();

  if (cleanUser.length < 3) {
    return fail(res, 400, "Username minimal 3 karakter.");
  }

  if (password.length < 6) {
    return fail(res, 400, "Password minimal 6 karakter.");
  }

  const users = readUsers();
  if (users.some(u => u.username?.toLowerCase() === cleanUser)) {
    return fail(res, 409, "Username sudah digunakan oleh akun lain.");
  }
  if (users.some(u => u.email?.toLowerCase() === cleanEmail)) {
    return fail(res, 409, "Alamat email sudah terdaftar.");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  const colors = ["#4285f4", "#9b72cb", "#d96570", "#1e8e3e", "#f29900", "#129eaf", "#e8710a"];
  const randomColor = colors[Math.floor(Math.random() * colors.length)];

  const newUser = {
    id: "usr_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex"),
    name: name.trim(),
    username: cleanUser,
    email: cleanEmail,
    passwordHash: hash,
    salt,
    avatar: name.trim().charAt(0).toUpperCase() || "U",
    avatarColor: randomColor,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeUsers(users);

  // Generate session token
  const token = "tok_" + crypto.randomBytes(32).toString("hex");
  const sessions = readSessions();
  sessions[token] = {
    userId: newUser.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  };
  writeSessions(sessions);

  res.json({
    success: true,
    token,
    user: safeUser(newUser),
    message: "Akun berhasil didaftarkan!"
  });
});

// LOGIN
app.post("/api/auth/login", (req, res) => {
  const { identifier, username, email, password } = req.body || {};
  const loginId = (identifier || username || email || "").trim().toLowerCase();

  if (!loginId || !password) {
    return fail(res, 400, "Masukkan username/email dan password.");
  }

  const users = readUsers();
  const user = users.find(
    u => u.username?.toLowerCase() === loginId || u.email?.toLowerCase() === loginId
  );

  if (!user) {
    return fail(res, 401, "Akun tidak ditemukan. Periksa kembali username atau email Anda.");
  }

  const hash = crypto.pbkdf2Sync(password, user.salt, 10000, 64, "sha512").toString("hex");
  if (hash !== user.passwordHash) {
    return fail(res, 401, "Password salah. Silakan coba lagi.");
  }

  // Generate session token
  const token = "tok_" + crypto.randomBytes(32).toString("hex");
  const sessions = readSessions();
  sessions[token] = {
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  };
  writeSessions(sessions);

  res.json({
    success: true,
    token,
    user: safeUser(user),
    message: `Selamat datang kembali, ${user.name}!`
  });
});

// LOGOUT
app.post("/api/auth/logout", (req, res) => {
  const token = extractToken(req);
  if (token) {
    const sessions = readSessions();
    delete sessions[token];
    writeSessions(sessions);
  }
  res.json({ success: true, message: "Berhasil keluar dari akun." });
});

// GET CURRENT USER PROFILE
app.get("/api/auth/me", (req, res) => {
  const user = resolveUser(req);
  if (!user) {
    return res.json({ loggedIn: false, user: null });
  }
  res.json({ loggedIn: true, user: safeUser(user) });
});

// UPDATE PROFILE
app.put("/api/auth/profile", requireAuth, (req, res) => {
  const { name, avatar } = req.body || {};
  const users = readUsers();
  const userIndex = users.findIndex(u => u.id === req.user.id);
  if (userIndex === -1) return fail(res, 404, "User tidak ditemukan.");

  if (validText(name)) users[userIndex].name = name.trim();
  if (validText(avatar)) users[userIndex].avatar = avatar.trim().charAt(0).toUpperCase();

  writeUsers(users);
  res.json({ success: true, user: safeUser(users[userIndex]) });
});

// USER CHATS (SYNC PER USER)
app.get("/api/user/chats", requireAuth, (req, res) => {
  const userChatFile = path.join(USER_CHATS_DIR, `${req.user.id}.json`);
  const userChats = readJson(userChatFile, []);
  res.json({ success: true, chats: userChats });
});

app.post("/api/user/chats", requireAuth, (req, res) => {
  const { chats } = req.body || {};
  if (!Array.isArray(chats)) return fail(res, 400, "Data chats harus berupa array.");
  const userChatFile = path.join(USER_CHATS_DIR, `${req.user.id}.json`);
  writeJson(userChatFile, chats);
  res.json({ success: true, count: chats.length });
});

// STATUS
app.get("/api/status", (req, res) => {
  res.json({
    configured: Boolean(getApiKey()),
    name: "Nano AI",
    status: "online"
  });
});

// MODELS
app.get("/api/models", (req, res) => {
  res.json({
    default: DEFAULT_MODEL,
    models: MODEL_LIST
  });
});

// MEMORY GET
app.get("/api/memory", optionalAuth, (req, res) => {
  const items = req.user ? readUserMemory(req.user.id) : readMemory();
  res.json({
    items
  });
});

// MEMORY ADD
app.post("/api/memory", optionalAuth, (req, res) => {
  const text = req.body?.text;

  if (!validText(text)) {
    return fail(
      res,
      400,
      "Isi memori tidak boleh kosong."
    );
  }

  const items = req.user ? readUserMemory(req.user.id) : readMemory();

  const item = {
    id: `${Date.now()}-${Math.random()
      .toString(36).slice(2, 7)}`,
    text: text.trim().slice(0, 5000),
    createdAt: new Date().toISOString()
  };

  items.unshift(item);

  writeUserMemory(req.user?.id, items);

  res.json({
    success: true,
    item,
    items
  });
});

// MEMORY DELETE
app.delete("/api/memory/:id", optionalAuth, (req, res) => {
  const allItems = req.user ? readUserMemory(req.user.id) : readMemory();
  const items = allItems.filter(
    x => x.id !== req.params.id
  );

  writeUserMemory(req.user?.id, items);

  res.json({
    success: true,
    items
  });
});

// DASHBOARD
app.get("/api/dashboard", (req, res) => {
  const u = usage();

  res.json({
    apiConfigured: Boolean(getApiKey()),
    models: MODEL_LIST,
    availableModels: MODEL_LIST.length,
    memoryItems: readMemory().length,
    requests: u.requests,
    images: u.images,
    errors: u.errors,
    server: "online"
  });
});

// UPLOAD FILE
app.post(
  "/api/upload-file",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return fail(
          res,
          400,
          "Pilih file terlebih dahulu."
        );
      }

      const text = await extractFileText(req.file);

      if (!text.trim()) {
        return fail(
          res,
          400,
          "Tidak ada teks yang dapat dibaca dari file ini."
        );
      }

      res.json({
        success: true,
        name: req.file.originalname,
        text: text.slice(0, 100000)
      });

    } catch (error) {
      res.status(400).json({
        error: error.message ||
          "Gagal membaca dokumen."
      });
    }
  }
);

// UPLOAD COMPATIBILITY
app.post("/api/upload", (req, res) => {
  if (!validText(req.body?.text)) {
    return fail(
      res,
      400,
      "Dokumen kosong."
    );
  }

  res.json({
    success: true,
    name: req.body.name || "Dokumen",
    text: req.body.text.slice(0, 100000)
  });
});

// ======================================
// NOVA AI SMART FALLBACK CHAT
// ======================================
app.post("/api/chat", optionalAuth, async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return fail(
      res,
      500,
      "API key belum diisi di file .env."
    );
  }

  const contents = convertMessages(
    req.body?.messages
  );

  if (!contents.length) {
    return fail(
      res,
      400,
      "Pesan kosong. Tulis pesan atau lampirkan file."
    );
  }

  // PILIH MODEL UTAMA
  const requested = req.body?.model;

  const selected =
    typeof requested === "string" &&
    MODEL_LIST.includes(requested)
      ? requested
      : DEFAULT_MODEL;

  // FAST FALLBACK: jika model utama bermasalah, segera alihkan ke model tercepat
  const fastModels = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest"
  ];

  const fallback = MODEL_LIST.find(
    model => model !== selected && fastModels.includes(model)
  ) || MODEL_LIST.find(model => model !== selected);

  const models = fallback
    ? [selected, fallback]
    : [selected];

  // MEMORY OPTIMIZATION & USER PERSONALIZATION
  const userMemoryList = req.user ? readUserMemory(req.user.id) : readMemory();
  const savedMemory = userMemoryList
    .map(item => item.text)
    .filter(Boolean)
    .slice(0, 10)
    .map(text => text.slice(0, 1000));

  const userNameInstruction = req.user
    ? ` Pengguna yang sedang kamu ajak bicara bernama: ${req.user.name}. Sapa atau sebut namanya sesekali secara hangat dan natural.`
    : "";

  const memoryInstruction = savedMemory.length
    ? "\n\nCatatan memori pengguna yang boleh digunakan bila relevan:\n- " +
      savedMemory.join("\n- ")
    : "";

  // REQUEST BODY
  const body = {
    contents,

    systemInstruction: {
      parts: [{
        text:
          "Kamu adalah Nano AI, asisten kecerdasan buatan canggih. " +
          "Gaya komunikasimu harus seperti manusia sungguhan yang lagi ngobrol santai: natural, luwes, ramah, dan cerdas. " +
          "PENTING: Jangan pakai bahasa kaku/formal birokratis seperti robot, TAPI JANGAN JUGA 'gaul sok asik' atau lebay (JANGAN panggil 'bro/sist', JANGAN pakai kata klise norak seperti 'kuy', 'gaspol', 'curhat tipis-tipis', 'seru-seruan bareng', dan jangan berlebihan pakai tanda seru). " +
          "Gunakan bahasa percakapan sehari-hari yang wajar dan santai layaknya teman diskusi yang pintar (misal gunakan 'aku/kamu', 'nggak', 'udah', 'gimana', 'bisa kok', 'coba deh', 'gini caranya'). " +
          "To the point, jelas, dan empatik. Jika menjelaskan materi teknis atau kode pemrograman, jelaskan dengan lugas dan mudah dimengerti layaknya programmer berpengalaman yang menjelaskan ke temannya. " +
          "Format jawaban tetap rapi menggunakan Markdown (headings, bullet points, dan code block rapi jika ada kode)." +
          userNameInstruction +
          memoryInstruction
      }]
    },

    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      maxOutputTokens: 8192
    }
  };

  if (req.body?.webSearch === true) {
    body.tools = [{
      google_search: {}
    }];
  }

  let upstream = null;
  let activeModel = "";

  let lastMessage =
    "Semua model gagal memberikan jawaban.";

  // SMART FALLBACK
  for (let i = 0; i < models.length; i++) {
    const model = models[i];

    const timeoutMs = i === 0
      ? PRIMARY_TIMEOUT
      : FALLBACK_TIMEOUT;

    console.log(
      `Nova: percobaan ${i + 1}/${models.length} - ${model} (timeout ${timeoutMs / 1000}s)`
    );

    try {
      const attempt = await callGemini(
        model,
        body,
        true,
        timeoutMs
      );

      if (attempt.ok) {
        if (!attempt.body) {
          lastMessage =
            "Gemini tidak mengembalikan streaming body.";
          continue;
        }

        upstream = attempt;
        activeModel = model;

        console.log(
          `Nova: model berhasil dipilih (${model})`
        );

        break;
      }

      const raw = await attempt.text();

      const parsed = parseApiError(
        raw,
        attempt.status
      );

      lastMessage = parsed.message;

      console.error(
        `Nova: ${model} gagal (${parsed.code}): ${parsed.message}`
      );

      const retryable = [
        404,
        408,
        429,
        500,
        502,
        503,
        504
      ].includes(parsed.code);

      if (!retryable) {
        return fail(
          res,
          parsed.code,
          parsed.message
        );
      }

    } catch (error) {
      lastMessage =
        error.name === "AbortError" ||
        error.name === "TimeoutError"
          ? `Timeout setelah ${timeoutMs / 1000} detik`
          : error.message;

      console.error(
        `Nova: koneksi ${model} gagal: ${lastMessage}`
      );
    }
  }

  if (!upstream) {
    bump("errors");

    return fail(
      res,
      503,
      `Semua model AI gagal. Detail terakhir: ${lastMessage}`
    );
  }

  bump("requests");

  // ======================================
  // STREAMING RESPONSE
  // ======================================
  res.status(200);

  res.setHeader(
    "Content-Type",
    "text/event-stream; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-cache, no-transform"
  );

  res.setHeader(
    "Connection",
    "keep-alive"
  );

  res.flushHeaders();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let disconnected = false;

  req.on("aborted", () => {
    disconnected = true;
  });

  res.on("close", () => {
    if (!res.writableEnded) {
      disconnected = true;
    }
  });

  try {
    while (!disconnected) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, {
        stream: true
      });

      const events = buffer.split(/\r?\n\r?\n/);

      buffer = events.pop() || "";

      for (const event of events) {
        parseSseEvent(event, payload => {
          if (
            !disconnected &&
            !res.writableEnded
          ) {
            res.write(
              `data: ${JSON.stringify({
                text: payload.text,
                sources: payload.sources,
                model: activeModel
              })}\n\n`
            );
          }
        });
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      parseSseEvent(buffer, payload => {
        if (
          !disconnected &&
          !res.writableEnded
        ) {
          res.write(
            `data: ${JSON.stringify({
              text: payload.text,
              sources: payload.sources,
              model: activeModel
            })}\n\n`
          );
        }
      });
    }

    if (
      !disconnected &&
      !res.writableEnded
    ) {
      res.write("data: [DONE]\n\n");
      res.end();
    }

    console.log(
      `Nova: streaming selesai (${activeModel})`
    );

  } catch (error) {
    console.error(
      "Streaming error:",
      error
    );

    if (
      !disconnected &&
      !res.writableEnded
    ) {
      res.write(
        `data: ${JSON.stringify({
          error:
            "Streaming terputus: " +
            error.message
        })}\n\n`
      );

      res.end();
    }

  } finally {
    if (disconnected) {
      reader.cancel().catch(() => {});
    }
  }
});

// ======================================
// IMAGE GENERATION
// ======================================
app.post("/api/image", async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return fail(
      res,
      500,
      "API key belum diisi di file .env."
    );
  }

  const prompt = req.body?.prompt;

  if (!validText(prompt)) {
    return fail(
      res,
      400,
      "Tuliskan deskripsi gambar terlebih dahulu."
    );
  }

  try {
    const response = await callGemini(
      IMAGE_MODEL,
      {
        contents: [{
          role: "user",
          parts: [{
            text: prompt.trim()
          }]
        }],

        generationConfig: {
          responseModalities: [
            "TEXT",
            "IMAGE"
          ]
        }
      },
      false,
      IMAGE_TIMEOUT
    );

    const raw = await response.text();

    if (!response.ok) {
      const parsed = parseApiError(
        raw,
        response.status
      );

      bump("errors");

      return fail(
        res,
        parsed.code,
        parsed.message
      );
    }

    const json = JSON.parse(raw);

    const parts =
      json.candidates?.[0]?.content?.parts || [];

    const imagePart = parts.find(
      p => p.inlineData?.data
    );

    const textPart =
      parts.find(p => p.text)?.text || "";

    if (!imagePart) {
      return fail(
        res,
        502,
        textPart ||
        "Model tidak mengembalikan gambar. Periksa dukungan model image di akun Anda."
      );
    }

    bump("images");

    res.json({
      success: true,
      mimeType:
        imagePart.inlineData.mimeType ||
        "image/png",
      image: imagePart.inlineData.data,
      text: textPart
    });

  } catch (error) {
    bump("errors");

    fail(
      res,
      500,
      error.message ||
        "Gagal membuat gambar."
    );
  }
});

// HOME
app.get("/", (req, res) => {
  res.sendFile(
    path.join(PUBLIC_DIR, "index.html")
  );
});

// 404
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint tidak ditemukan."
  });
});

// ERROR HANDLER
app.use((err, req, res, next) => {
  console.error(
    "Server error:",
    err
  );

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "Terjadi kesalahan internal pada server."
  });
});

// START SERVER
app.listen(PORT, () => {
  console.log("\n====================================");
  console.log("          NANO AI ULTIMATE          ");
  console.log("====================================");

  console.log(
    `Server       : http://localhost:${PORT}`
  );

  console.log(
    `Default model: ${DEFAULT_MODEL}`
  );

  console.log(
    `Models       : ${MODEL_LIST.join(", ")}`
  );

  console.log(
    `Gemini API   : ${getApiKey() ? "Configured" : "Not configured"}`
  );

  console.log(
    "Smart Fallback: maksimal 2 model"
  );

  console.log(
    "Primary timeout: 20 detik"
  );

  console.log(
    "Fallback timeout: 30 detik"
  );

  console.log(
    "Streaming: aktif"
  );

  console.log(
    "Chat history: 16 pesan"
  );

  console.log(
    "Memory: maksimal 10 catatan"
  );

  console.log("====================================\n");
});

