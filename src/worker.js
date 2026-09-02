import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

let schemaReady = false;
let schemaPromise = null;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    site TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '',
    camera_label TEXT NOT NULL DEFAULT '브라우저 카메라',
    status TEXT NOT NULL DEFAULT 'offline',
    agent_version TEXT NOT NULL DEFAULT '',
    last_seen TEXT,
    fps REAL NOT NULL DEFAULT 0,
    cpu REAL NOT NULL DEFAULT 0,
    memory REAL NOT NULL DEFAULT 0,
    people_count INTEGER NOT NULL DEFAULT 0,
    current_risk TEXT NOT NULL DEFAULT '정상',
    preview_key TEXT,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT '확인 필요',
    snapshot_key TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS media (
    key TEXT PRIMARY KEY,
    content_type TEXT NOT NULL DEFAULT 'image/jpeg',
    bytes BLOB NOT NULL,
    byte_length INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS training_samples (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    model_version TEXT NOT NULL DEFAULT '',
    predicted_json TEXT NOT NULL DEFAULT '{}',
    labels_json TEXT NOT NULL DEFAULT '{}',
    snapshot_key TEXT,
    reviewed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stop_work_requests (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    reporter_name TEXT NOT NULL,
    reporter_contact TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '접수',
    clip_key TEXT,
    clip_content_type TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS msds_documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    original_name TEXT NOT NULL,
    manufacturer TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT 'application/pdf',
    byte_length INTEGER NOT NULL DEFAULT 0,
    chunk_size INTEGER NOT NULL DEFAULT 245760,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    uploaded_by TEXT NOT NULL DEFAULT 'admin',
    uploaded_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS msds_chunks (
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    bytes BLOB NOT NULL,
    byte_length INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(document_id, chunk_index)
  )`,
  `CREATE TABLE IF NOT EXISTS d_safety_boards (
    id TEXT PRIMARY KEY,
    meeting_date TEXT NOT NULL DEFAULT '',
    work_time TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    job_name TEXT NOT NULL DEFAULT '',
    people_count INTEGER NOT NULL DEFAULT 0,
    contractor TEXT NOT NULL DEFAULT '',
    work_manager TEXT NOT NULL DEFAULT '',
    contractor_manager TEXT NOT NULL DEFAULT '',
    monitor_name TEXT NOT NULL DEFAULT '',
    monitor_dept TEXT NOT NULL DEFAULT '',
    cctv TEXT NOT NULL DEFAULT '',
    rows_json TEXT NOT NULL DEFAULT '[]',
    raw_text TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS d_safety_opinions (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    affiliation TEXT NOT NULL DEFAULT '',
    author_name TEXT NOT NULL DEFAULT '',
    job_name TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_msds_title ON msds_documents(title)`,
  `CREATE INDEX IF NOT EXISTS idx_msds_uploaded ON msds_documents(uploaded_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dsafety_created ON d_safety_boards(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dsafety_opinion_board ON d_safety_opinions(board_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_training_device ON training_samples(device_id, captured_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_stop_work_occurred ON stop_work_requests(occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_stop_work_device ON stop_work_requests(device_id, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_media_updated_at ON media(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events(occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_events_device_id ON events(device_id)`,
  `CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen DESC)`,
];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function error(message, status = 400, details = undefined) {
  return json({ ok: false, error: message, details }, status);
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function safeJsonParse(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

async function readJson(request) {
  try { return await request.json(); } catch { throw new Error("요청 본문이 올바른 JSON이 아닙니다."); }
}

function defaultConfig() {
  return {
    version: 2,
    zones: [{
      id: "zone-default",
      name: "출입 제한 구역",
      severity: "high",
      enabled: false,
      points: [[0.62, 0.28], [0.95, 0.28], [0.95, 0.93], [0.62, 0.93]],
    }],
    rules: {
      dangerZone: false,
      helmet: true,
      safetyGlasses: true,
      mask: true,
      harness: false,
      hookConnected: false,
      fall: true,
      unsafePosture: false,
      longStay: false,
      forklift: false,
      heavyEquipmentProximity: false,
      crane: false,
      agv: false,
      obstacle: false,
      blockedAisle: false,
      smoke: false,
      fire: false,
    },
    voice: {
      enabled: true,
      cooldownSeconds: 12,
      volume: 0.95,
      alerts: {
        helmet: true,
        safetyGlasses: true,
        mask: true,
        harness: true,
        hookConnected: true,
        dangerZone: true,
        fall: true,
        unsafePosture: true,
        longStay: true,
        forklift: true,
        heavyEquipmentProximity: true,
        crane: true,
        agv: true,
        obstacle: true,
        blockedAisle: true,
        smoke: true,
        fire: true,
      },
    },
    detection: { confidence: 0.31, consecutiveFrames: 2, intervalMs: 1000 },
    privacy: { faceMosaic: false },
  };
}

async function ensureSchema(env) {
  if (schemaReady) return;
  if (!env.DB) throw new Error("D1 바인딩 DB가 없습니다.");
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));
      const dsColumns = await env.DB.prepare("PRAGMA table_info(d_safety_boards)").all();
      const names = new Set((dsColumns.results || []).map((row) => String(row.name || "")));
      if (!names.has("site")) await env.DB.prepare("ALTER TABLE d_safety_boards ADD COLUMN site TEXT NOT NULL DEFAULT ''").run();
      const opinionColumns = await env.DB.prepare("PRAGMA table_info(d_safety_opinions)").all();
      const opinionNames = new Set((opinionColumns.results || []).map((row) => String(row.name || "")));
      if (!opinionNames.has("job_name")) await env.DB.prepare("ALTER TABLE d_safety_opinions ADD COLUMN job_name TEXT NOT NULL DEFAULT ''").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_dsafety_site_created ON d_safety_boards(site, created_at DESC)").run();
      schemaReady = true;
    })().catch((err) => { schemaPromise = null; throw err; });
  }
  await schemaPromise;
}

/* ---------- Signed session cookie ---------- */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : encoder.encode(String(input));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function parseCookies(request) {
  const result = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}

async function createSession(role, env) {
  const payload = { role, exp: Date.now() + 12 * 60 * 60 * 1000, sid: crypto.randomUUID() };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmac(encoded, env.SESSION_SECRET || "CHANGE_ME_SMART_SAFETY_SESSION_SECRET");
  return { token: `${encoded}.${signature}`, payload };
}

async function readSession(request, env) {
  const token = parseCookies(request).ssf_session;
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = await hmac(encoded, env.SESSION_SECRET || "CHANGE_ME_SMART_SAFETY_SESSION_SECRET");
  if (expected.length !== signature.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (mismatch) return null;
  try {
    const payload = JSON.parse(decoder.decode(base64UrlDecode(encoded)));
    if (!payload.exp || payload.exp < Date.now() || !["admin", "user"].includes(payload.role)) return null;
    return payload;
  } catch { return null; }
}

function sessionCookie(token, request, maxAge = 43200) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `ssf_session=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}

async function requireSession(request, env, role = null) {
  const session = await readSession(request, env);
  if (!session) return { response: error("로그인이 필요합니다.", 401) };
  if (role && session.role !== role) return { response: error("권한이 없습니다.", 403) };
  return { session };
}

/* ---------- Durable Object WebSocket signaling ---------- */

export class SignalingRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  peers(excludeClientId = null) {
    const peers = [];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {};
      if (attachment.clientId && attachment.clientId !== excludeClientId) peers.push(attachment);
    }
    return peers;
  }

  send(socket, payload) {
    try { socket.send(JSON.stringify(payload)); } catch { /* disconnected */ }
  }

  broadcast(payload, excludeClientId = null, targetClientId = null) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {};
      if (excludeClientId && attachment.clientId === excludeClientId) continue;
      if (targetClientId && attachment.clientId !== targetClientId) continue;
      this.send(socket, payload);
    }
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
    const url = new URL(request.url);
    const role = url.searchParams.get("role") || "unknown";
    const clientId = url.searchParams.get("clientId") || crypto.randomUUID();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role, clientId]);
    server.serializeAttachment({ role, clientId });
    this.send(server, { type: "connected", role, clientId, peers: this.peers(clientId), at: nowIso() });
    this.broadcast({ type: "peer-joined", role, clientId, at: nowIso() }, clientId);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, rawMessage) {
    const sender = socket.deserializeAttachment() || {};
    let message;
    try {
      const text = typeof rawMessage === "string" ? rawMessage : decoder.decode(rawMessage);
      message = JSON.parse(text);
    } catch {
      this.send(socket, { type: "error", message: "잘못된 신호 메시지입니다." });
      return;
    }
    const payload = {
      ...message,
      from: sender.clientId,
      role: sender.role,
      at: nowIso(),
    };
    delete payload.clientId;
    this.broadcast(payload, sender.clientId, message.to || null);
  }

  async webSocketClose(socket) {
    const sender = socket.deserializeAttachment() || {};
    this.broadcast({ type: "peer-left", clientId: sender.clientId, role: sender.role, at: nowIso() }, sender.clientId);
  }

  async webSocketError(socket) {
    const sender = socket.deserializeAttachment() || {};
    this.broadcast({ type: "peer-left", clientId: sender.clientId, role: sender.role, at: nowIso() }, sender.clientId);
    try { socket.close(1011, "WebSocket error"); } catch { /* noop */ }
  }
}

/* ---------- Data mapping ---------- */

function mapDevice(row) {
  const lastSeenMs = row.last_seen ? Date.parse(row.last_seen) : 0;
  const recent = lastSeenMs > Date.now() - 90000;
  const status = row.status === "offline" ? "offline" : recent ? "online" : "offline";
  return {
    id: row.id,
    name: row.name,
    site: row.site,
    area: row.area,
    cameraLabel: row.camera_label,
    status,
    agentVersion: row.agent_version,
    lastSeen: row.last_seen,
    fps: Number(row.fps || 0),
    cpu: Number(row.cpu || 0),
    memory: Number(row.memory || 0),
    peopleCount: Number(row.people_count || 0),
    currentRisk: row.current_risk || "정상",
    previewUrl: row.preview_key ? `/media/${encodeURIComponent(row.preview_key)}` : null,
    config: safeJsonParse(row.config_json, defaultConfig()),
  };
}

function mapEvent(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name || row.device_id,
    site: row.site || "",
    type: row.type,
    category: row.category,
    severity: row.severity,
    message: row.message,
    occurredAt: row.occurred_at,
    acknowledged: Boolean(row.acknowledged),
    status: row.status,
    snapshotUrl: row.snapshot_key ? `/media/${encodeURIComponent(row.snapshot_key)}` : null,
    metadata: safeJsonParse(row.metadata_json, {}),
  };
}

async function getDevices(env) {
  const result = await env.DB.prepare("SELECT * FROM devices ORDER BY name ASC").all();
  return (result.results || []).map(mapDevice);
}

async function getEvents(env, url) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 500);
  const deviceId = url.searchParams.get("deviceId");
  const category = url.searchParams.get("category");
  const severity = url.searchParams.get("severity");
  let sql = `SELECT e.*, d.name AS device_name, d.site AS site FROM events e LEFT JOIN devices d ON d.id=e.device_id WHERE 1=1`;
  const values = [];
  if (deviceId) { sql += " AND e.device_id=?"; values.push(deviceId); }
  if (category) { sql += " AND e.category=?"; values.push(category); }
  if (severity) { sql += " AND e.severity=?"; values.push(severity); }
  sql += " ORDER BY e.occurred_at DESC LIMIT ?";
  values.push(limit);
  const result = await env.DB.prepare(sql).bind(...values).all();
  return (result.results || []).map(mapEvent);
}

async function getSummary(env) {
  const devices = await getDevices(env);
  const recentResult = await env.DB.prepare("SELECT category FROM events WHERE occurred_at >= ? ORDER BY occurred_at DESC").bind(new Date(Date.now() - 86400000).toISOString()).all();
  const recentEvents = recentResult.results || [];
  const actionRow = await env.DB.prepare(`SELECT
    COALESCE(SUM(CASE WHEN acknowledged=0 AND severity IN ('high','critical') THEN 1 ELSE 0 END),0) AS high_risk,
    COALESCE(SUM(CASE WHEN acknowledged=0 AND type='STOP_WORK_REQUEST' THEN 1 ELSE 0 END),0) AS stop_work,
    COALESCE(SUM(CASE WHEN acknowledged=0 THEN 1 ELSE 0 END),0) AS unacknowledged
    FROM events`).first();
  const categoryCounts = {};
  for (const event of recentEvents) categoryCounts[event.category] = (categoryCounts[event.category] || 0) + 1;
  return {
    online: devices.filter((device) => device.status === "online").length,
    totalDevices: devices.length,
    people: devices.reduce((sum, device) => sum + device.peopleCount, 0),
    highRisk: Number(actionRow?.high_risk || 0),
    stopWork: Number(actionRow?.stop_work || 0),
    unacknowledged: Number(actionRow?.unacknowledged || 0),
    categoryCounts,
    generatedAt: nowIso(),
  };
}

async function readSetting(env, key, fallback) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key=?").bind(key).first();
  return row?.value ?? fallback;
}

async function writeSetting(env, key, value) {
  await env.DB.prepare(`INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(key, String(value), nowIso()).run();
}

async function getEventRetentionSettings(env) {
  const [daysValue, enabledValue, countRow, bytesRow] = await Promise.all([
    readSetting(env, "event_retention_days", "30"),
    readSetting(env, "event_auto_cleanup", "true"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM events").first(),
    env.DB.prepare("SELECT COALESCE(SUM(byte_length),0) AS bytes FROM media WHERE key LIKE 'events/%' OR key LIKE 'stop-work/%'").first(),
  ]);
  return {
    days: Math.min(365, Math.max(1, Number(daysValue || 30))),
    enabled: String(enabledValue) !== "false",
    eventCount: Number(countRow?.count || 0),
    snapshotBytes: Number(bytesRow?.bytes || 0),
  };
}

async function cleanupEventsOlderThan(env, days) {
  const safeDays = Math.min(365, Math.max(1, Number(days || 30)));
  const cutoff = new Date(Date.now() - safeDays * 86400000).toISOString();
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM events WHERE occurred_at < ?").bind(cutoff).first();
  const deleted = Number(countRow?.count || 0);
  if (!deleted) return { deleted: 0, cutoff, days: safeDays };
  await env.DB.batch([
    env.DB.prepare("DELETE FROM media WHERE key IN (SELECT snapshot_key FROM events WHERE occurred_at < ? AND snapshot_key IS NOT NULL)").bind(cutoff),
    env.DB.prepare("DELETE FROM media WHERE key IN (SELECT clip_key FROM stop_work_requests WHERE occurred_at < ? AND clip_key IS NOT NULL)").bind(cutoff),
    env.DB.prepare("DELETE FROM media WHERE key LIKE 'stop-work/%' AND updated_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM stop_work_requests WHERE occurred_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM events WHERE occurred_at < ?").bind(cutoff),
  ]);
  return { deleted, cutoff, days: safeDays };
}

async function deleteAllEvents(env) {
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM events").first();
  const deleted = Number(countRow?.count || 0);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM media WHERE key LIKE 'events/%' OR key LIKE 'stop-work/%'"),
    env.DB.prepare("DELETE FROM stop_work_requests"),
    env.DB.prepare("DELETE FROM events"),
  ]);
  return { deleted };
}


async function getDSafetyRetentionSettings(env) {
  const [daysValue, enabledValue, boardRow, opinionRow] = await Promise.all([
    readSetting(env, "d_safety_retention_days", "180"),
    readSetting(env, "d_safety_auto_cleanup", "true"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM d_safety_boards").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM d_safety_opinions").first(),
  ]);
  return {
    days: Math.min(730, Math.max(30, Number(daysValue || 180))),
    enabled: String(enabledValue) !== "false",
    boardCount: Number(boardRow?.count || 0),
    opinionCount: Number(opinionRow?.count || 0),
  };
}

async function cleanupDSafetyOlderThan(env, days) {
  const safeDays = Math.min(730, Math.max(30, Number(days || 180)));
  const cutoff = new Date(Date.now() - safeDays * 86400000).toISOString();
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM d_safety_boards WHERE created_at < ?").bind(cutoff).first();
  const deleted = Number(countRow?.count || 0);
  if (!deleted) return { deleted: 0, cutoff, days: safeDays };
  await env.DB.batch([
    env.DB.prepare("DELETE FROM d_safety_opinions WHERE board_id IN (SELECT id FROM d_safety_boards WHERE created_at < ?)").bind(cutoff),
    env.DB.prepare("DELETE FROM d_safety_boards WHERE created_at < ?").bind(cutoff),
  ]);
  return { deleted, cutoff, days: safeDays };
}

function exactArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return new Uint8Array(value).buffer;
}

async function putImage(env, key, bytes, contentType = "image/jpeg") {
  const buffer = exactArrayBuffer(bytes);
  if (!buffer.byteLength || buffer.byteLength > 1_500_000) return null;
  await env.DB.prepare(`INSERT INTO media (key, content_type, bytes, byte_length, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET content_type=excluded.content_type, bytes=excluded.bytes, byte_length=excluded.byte_length, updated_at=excluded.updated_at`).bind(key, contentType, buffer, buffer.byteLength, nowIso()).run();
  return key;
}

function base64ToBytes(base64) {
  const clean = base64.includes(",") ? base64.split(",").pop() : base64;
  const binary = atob(clean || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function stopWorkNotificationText(detail) {
  const lines = [
    "[POSEIDON 작업중지권 발동]",
    `장치: ${detail.deviceName || detail.deviceId}`,
    `사업장/구역: ${detail.site || "-"} / ${detail.area || "-"}`,
    `발동자: ${detail.reporterName}`,
    `연락처: ${detail.reporterContact || "미입력"}`,
    `사유: ${detail.reason}`,
    `시간: ${detail.occurredAt}`,
  ];
  if (detail.beforeClipUrl) lines.push(`발동 전 영상: ${detail.origin}${detail.beforeClipUrl}`);
  if (detail.afterClipUrl) lines.push(`발동 후 영상: ${detail.origin}${detail.afterClipUrl}`);
  if (!detail.beforeClipUrl && !detail.afterClipUrl && detail.clipUrl) lines.push(`영상: ${detail.origin}${detail.clipUrl}`);
  if (!detail.beforeClipUrl && !detail.afterClipUrl && !detail.clipUrl) lines.push("영상: 저장 없음");
  return lines.join("\n");
}

async function sendStopWorkEmail(env, detail) {
  if (!env.RESEND_API_KEY || !env.ADMIN_EMAIL || !env.EMAIL_FROM) return { channel: "email", configured: false };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [env.ADMIN_EMAIL],
      subject: `[POSEIDON] 작업중지권 발동 - ${detail.deviceName || detail.deviceId}`,
      text: stopWorkNotificationText(detail),
    }),
  });
  if (!response.ok) throw new Error(`email ${response.status}`);
  return { channel: "email", configured: true, sent: true };
}

async function sendStopWorkSms(env, detail) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER || !env.ADMIN_PHONE) return { channel: "sms", configured: false };
  const body = new URLSearchParams();
  body.set("From", env.TWILIO_FROM_NUMBER);
  body.set("To", env.ADMIN_PHONE);
  body.set("Body", stopWorkNotificationText(detail).slice(0, 1400));
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  });
  if (!response.ok) throw new Error(`sms ${response.status}`);
  return { channel: "sms", configured: true, sent: true };
}

async function sendStopWorkWebhook(env, detail) {
  if (!env.NOTIFY_WEBHOOK_URL) return { channel: "webhook", configured: false };
  const response = await fetch(env.NOTIFY_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "POSEIDON_STOP_WORK_REQUEST",
      severity: "critical",
      ...detail,
      text: stopWorkNotificationText(detail),
    }),
  });
  if (!response.ok) throw new Error(`webhook ${response.status}`);
  return { channel: "webhook", configured: true, sent: true };
}

function defaultEmergencyCallOptions() {
  return [
  {
    "id": "call-general",
    "site": "공통",
    "label": "일반 119",
    "phone": "119"
  },
  {
    "id": "call-gwangyang",
    "site": "광양제철소",
    "label": "광양제철소 119",
    "phone": "061-790-0119"
  },
  {
    "id": "call-pohang",
    "site": "포항제철소",
    "label": "포항제철소 119",
    "phone": "054-290-0119"
  }
];
}

function defaultEmergencyContacts() {
  return [
  {
    "id": "contact-001",
    "region": "공통",
    "type": "사내",
    "department": "사업장 안전환경부서",
    "name": "",
    "phone": "",
    "note": "담당자 이름·연락처는 관리자가 필요한 경우 직접 등록"
  },
  {
    "id": "contact-002",
    "region": "포항",
    "type": "사내",
    "department": "포항안전환경그룹",
    "name": "",
    "phone": "",
    "note": "담당자 이름·연락처 미등록"
  },
  {
    "id": "contact-003",
    "region": "광양",
    "type": "사내",
    "department": "광양안전환경그룹",
    "name": "",
    "phone": "",
    "note": "담당자 이름·연락처 미등록"
  },
  {
    "id": "contact-004",
    "region": "공통",
    "type": "사내",
    "department": "공사안전섹션 (에너지소재기획실)",
    "name": "",
    "phone": "",
    "note": "담당자 이름·연락처 미등록"
  },
  {
    "id": "contact-005",
    "region": "공통",
    "type": "사내",
    "department": "플랜트안전섹션",
    "name": "",
    "phone": "",
    "note": "담당자 이름·연락처 미등록"
  },
  {
    "id": "contact-006",
    "region": "포항",
    "type": "안전보건",
    "department": "고용노동부 산재예방지도과",
    "name": "",
    "phone": "054-271-6836",
    "note": ""
  },
  {
    "id": "contact-007",
    "region": "포항",
    "type": "안전보건",
    "department": "경북권중대산업사고예방센터",
    "name": "",
    "phone": "054-459-1141",
    "note": ""
  },
  {
    "id": "contact-008",
    "region": "포항",
    "type": "안전보건",
    "department": "포항남부소방서",
    "name": "",
    "phone": "054-286-1193",
    "note": ""
  },
  {
    "id": "contact-009",
    "region": "포항",
    "type": "안전보건",
    "department": "청림치안센터(파출소)",
    "name": "",
    "phone": "054-240-8115",
    "note": ""
  },
  {
    "id": "contact-010",
    "region": "포항",
    "type": "안전보건",
    "department": "일월 119 안전센터",
    "name": "",
    "phone": "054-284-2725",
    "note": ""
  },
  {
    "id": "contact-011",
    "region": "포항",
    "type": "안전보건",
    "department": "포항남부경찰서(주간)",
    "name": "",
    "phone": "054-240-8324",
    "note": ""
  },
  {
    "id": "contact-012",
    "region": "포항",
    "type": "안전보건",
    "department": "포항남부경찰서(야간)",
    "name": "",
    "phone": "054-240-8329",
    "note": ""
  },
  {
    "id": "contact-013",
    "region": "포항",
    "type": "안전보건",
    "department": "근로복지공단 포항지사",
    "name": "",
    "phone": "1588-0075",
    "note": ""
  },
  {
    "id": "contact-014",
    "region": "포항",
    "type": "환경",
    "department": "포항시청",
    "name": "",
    "phone": "054-270-8282",
    "note": ""
  },
  {
    "id": "contact-015",
    "region": "포항",
    "type": "환경",
    "department": "경북도청",
    "name": "",
    "phone": "054-880-3542",
    "note": ""
  },
  {
    "id": "contact-016",
    "region": "포항",
    "type": "환경",
    "department": "대구지방환경청",
    "name": "",
    "phone": "053-230-6402",
    "note": ""
  },
  {
    "id": "contact-017",
    "region": "포항",
    "type": "의료기관",
    "department": "포항세명기독병원",
    "name": "",
    "phone": "054-275-0005",
    "note": ""
  },
  {
    "id": "contact-018",
    "region": "포항",
    "type": "의료기관",
    "department": "포항좋은선린병원",
    "name": "",
    "phone": "054-245-5000",
    "note": ""
  },
  {
    "id": "contact-019",
    "region": "포항",
    "type": "의료기관",
    "department": "포항성모병원",
    "name": "",
    "phone": "054-272-0151",
    "note": ""
  },
  {
    "id": "contact-020",
    "region": "포항",
    "type": "의료기관",
    "department": "오학윤정형외과",
    "name": "",
    "phone": "054-273-1199",
    "note": ""
  },
  {
    "id": "contact-021",
    "region": "포항",
    "type": "의료기관",
    "department": "경북소방본부 119항공대",
    "name": "",
    "phone": "054-880-6521",
    "note": ""
  },
  {
    "id": "contact-022",
    "region": "포항",
    "type": "협조기관",
    "department": "해군항공단",
    "name": "",
    "phone": "054-290-6331",
    "note": ""
  },
  {
    "id": "contact-023",
    "region": "포항",
    "type": "협조기관",
    "department": "OCI 포항공장",
    "name": "",
    "phone": "054-290-8000",
    "note": ""
  },
  {
    "id": "contact-024",
    "region": "포항",
    "type": "협조기관",
    "department": "청림동주민센터",
    "name": "",
    "phone": "054-270-6751",
    "note": ""
  },
  {
    "id": "contact-025",
    "region": "포항",
    "type": "협조기관",
    "department": "나눔지역자활센터",
    "name": "",
    "phone": "054-252-4470",
    "note": ""
  },
  {
    "id": "contact-026",
    "region": "포항",
    "type": "협조기관",
    "department": "포항제철소 119 / 방재",
    "name": "",
    "phone": "054-290-0119",
    "note": ""
  },
  {
    "id": "contact-027",
    "region": "포항",
    "type": "협조기관",
    "department": "포스코(포항소) 환경센터",
    "name": "",
    "phone": "054-220-4440",
    "note": ""
  },
  {
    "id": "contact-028",
    "region": "광양",
    "type": "안전보건",
    "department": "고용노동부 여수지청",
    "name": "",
    "phone": "061-650-0130",
    "note": ""
  },
  {
    "id": "contact-029",
    "region": "광양",
    "type": "안전보건",
    "department": "전남권중대산업사고예방센터",
    "name": "",
    "phone": "061-690-1674",
    "note": ""
  },
  {
    "id": "contact-030",
    "region": "광양",
    "type": "안전보건",
    "department": "광양소방서",
    "name": "",
    "phone": "061-798-0900",
    "note": ""
  },
  {
    "id": "contact-031",
    "region": "광양",
    "type": "안전보건",
    "department": "광양119안전센터",
    "name": "",
    "phone": "061-798-0926",
    "note": ""
  },
  {
    "id": "contact-032",
    "region": "광양",
    "type": "안전보건",
    "department": "여수금호파출소",
    "name": "",
    "phone": "061-840-2132",
    "note": ""
  },
  {
    "id": "contact-033",
    "region": "광양",
    "type": "안전보건",
    "department": "근로복지공단 여수지사",
    "name": "",
    "phone": "1588-0075",
    "note": ""
  },
  {
    "id": "contact-034",
    "region": "광양",
    "type": "환경",
    "department": "광양시청",
    "name": "",
    "phone": "061-797-2114",
    "note": ""
  },
  {
    "id": "contact-035",
    "region": "광양",
    "type": "환경",
    "department": "전남도청",
    "name": "",
    "phone": "061-287-0011",
    "note": ""
  },
  {
    "id": "contact-036",
    "region": "광양",
    "type": "환경",
    "department": "영산강유역환경청",
    "name": "",
    "phone": "062-410-5114",
    "note": ""
  },
  {
    "id": "contact-037",
    "region": "광양",
    "type": "의료기관",
    "department": "광양사랑병원",
    "name": "",
    "phone": "061-797-7000",
    "note": ""
  },
  {
    "id": "contact-038",
    "region": "광양",
    "type": "의료기관",
    "department": "광양강남병원",
    "name": "",
    "phone": "061-818-7575",
    "note": ""
  },
  {
    "id": "contact-039",
    "region": "광양",
    "type": "의료기관",
    "department": "근로복지공단 순천병원",
    "name": "",
    "phone": "061-720-7114",
    "note": ""
  },
  {
    "id": "contact-040",
    "region": "광양",
    "type": "의료기관",
    "department": "순천성가롤로병원",
    "name": "",
    "phone": "061-720-2000",
    "note": ""
  },
  {
    "id": "contact-041",
    "region": "광양",
    "type": "의료기관",
    "department": "전남소방본부 119항공대",
    "name": "",
    "phone": "061-860-5156",
    "note": ""
  },
  {
    "id": "contact-042",
    "region": "광양",
    "type": "협조기관",
    "department": "광양제철소 119 / 방재",
    "name": "",
    "phone": "061-790-0119",
    "note": ""
  },
  {
    "id": "contact-043",
    "region": "광양",
    "type": "협조기관",
    "department": "포스코(광양소) 환경센터",
    "name": "",
    "phone": "061-790-4440",
    "note": ""
  },
  {
    "id": "contact-044",
    "region": "세종",
    "type": "안전보건",
    "department": "대전지방고용노동청",
    "name": "",
    "phone": "042-480-6290",
    "note": ""
  },
  {
    "id": "contact-045",
    "region": "세종",
    "type": "안전보건",
    "department": "금강화학안전관리단",
    "name": "",
    "phone": "042-865-0761",
    "note": ""
  },
  {
    "id": "contact-046",
    "region": "세종",
    "type": "안전보건",
    "department": "세종경찰서 운주지구대",
    "name": "",
    "phone": "044-863-2112",
    "note": ""
  },
  {
    "id": "contact-047",
    "region": "세종",
    "type": "안전보건",
    "department": "소정면119지역대",
    "name": "",
    "phone": "041-566-6119",
    "note": ""
  },
  {
    "id": "contact-048",
    "region": "세종",
    "type": "안전보건",
    "department": "전의의용소방대",
    "name": "",
    "phone": "044-863-2119",
    "note": ""
  },
  {
    "id": "contact-049",
    "region": "세종",
    "type": "안전보건",
    "department": "근로복지공단 유성지사",
    "name": "",
    "phone": "1588-0075",
    "note": ""
  },
  {
    "id": "contact-050",
    "region": "세종",
    "type": "환경",
    "department": "세종시청",
    "name": "",
    "phone": "044-300-4201",
    "note": ""
  },
  {
    "id": "contact-051",
    "region": "세종",
    "type": "환경",
    "department": "충남도청",
    "name": "",
    "phone": "041-635-2720",
    "note": ""
  },
  {
    "id": "contact-052",
    "region": "세종",
    "type": "환경",
    "department": "금강유역환경청",
    "name": "",
    "phone": "042-865-0800",
    "note": ""
  },
  {
    "id": "contact-053",
    "region": "세종",
    "type": "의료기관",
    "department": "천안단국대병원",
    "name": "",
    "phone": "041-550-6840",
    "note": ""
  },
  {
    "id": "contact-054",
    "region": "세종",
    "type": "의료기관",
    "department": "천안의료원",
    "name": "",
    "phone": "041-570-7119",
    "note": ""
  },
  {
    "id": "contact-055",
    "region": "세종",
    "type": "의료기관",
    "department": "천안충무병원",
    "name": "",
    "phone": "041-570-7519",
    "note": ""
  },
  {
    "id": "contact-056",
    "region": "세종",
    "type": "의료기관",
    "department": "천안우리병원",
    "name": "",
    "phone": "041-590-9000",
    "note": ""
  },
  {
    "id": "contact-057",
    "region": "세종",
    "type": "의료기관",
    "department": "천안화사의원(화상)",
    "name": "",
    "phone": "041-576-1195",
    "note": ""
  },
  {
    "id": "contact-058",
    "region": "세종",
    "type": "의료기관",
    "department": "천안손사랑의원",
    "name": "",
    "phone": "041-415-1119",
    "note": ""
  },
  {
    "id": "contact-059",
    "region": "세종",
    "type": "의료기관",
    "department": "청주마이크로병원",
    "name": "",
    "phone": "043-265-0071",
    "note": ""
  },
  {
    "id": "contact-060",
    "region": "세종",
    "type": "의료기관",
    "department": "세종누가연합의원",
    "name": "",
    "phone": "044-863-0494",
    "note": ""
  },
  {
    "id": "contact-061",
    "region": "세종",
    "type": "협조기관",
    "department": "전의산단관리사무소",
    "name": "",
    "phone": "044-868-8650",
    "note": ""
  },
  {
    "id": "contact-062",
    "region": "세종",
    "type": "협조기관",
    "department": "세종첨단산업단지",
    "name": "",
    "phone": "044-866-5005",
    "note": ""
  },
  {
    "id": "contact-063",
    "region": "세종",
    "type": "협조기관",
    "department": "세종음극재경비실(1공장)",
    "name": "",
    "phone": "044-850-2799",
    "note": ""
  },
  {
    "id": "contact-064",
    "region": "세종",
    "type": "협조기관",
    "department": "세종음극재경비실(2공장)",
    "name": "",
    "phone": "044-850-2699",
    "note": ""
  },
  {
    "id": "contact-065",
    "region": "세종",
    "type": "협조기관",
    "department": "대한산업안전협회 대전본부",
    "name": "",
    "phone": "042-628-2160",
    "note": ""
  },
  {
    "id": "contact-066",
    "region": "구미",
    "type": "안전보건",
    "department": "고용노동부 산재예방지도과",
    "name": "",
    "phone": "054-450-3550",
    "note": ""
  },
  {
    "id": "contact-067",
    "region": "구미",
    "type": "안전보건",
    "department": "경북권중대산업사고예방센터",
    "name": "",
    "phone": "054-459-1141",
    "note": ""
  },
  {
    "id": "contact-068",
    "region": "구미",
    "type": "안전보건",
    "department": "구미경찰서",
    "name": "",
    "phone": "054-450-3324",
    "note": ""
  },
  {
    "id": "contact-069",
    "region": "구미",
    "type": "안전보건",
    "department": "구미소방서",
    "name": "",
    "phone": "054-440-0143",
    "note": ""
  },
  {
    "id": "contact-070",
    "region": "구미",
    "type": "안전보건",
    "department": "옥계119 안전센터",
    "name": "",
    "phone": "054-471-5119",
    "note": ""
  },
  {
    "id": "contact-071",
    "region": "구미",
    "type": "안전보건",
    "department": "근로복지공단 구미지사",
    "name": "",
    "phone": "1588-0075",
    "note": ""
  },
  {
    "id": "contact-072",
    "region": "구미",
    "type": "환경",
    "department": "구미시 안전재난과",
    "name": "",
    "phone": "054-480-6736",
    "note": ""
  },
  {
    "id": "contact-073",
    "region": "구미",
    "type": "환경",
    "department": "경북도청 재난안전실",
    "name": "",
    "phone": "054-880-2300",
    "note": ""
  },
  {
    "id": "contact-074",
    "region": "구미",
    "type": "환경",
    "department": "구미합동방재센터",
    "name": "",
    "phone": "054-459-1119",
    "note": ""
  },
  {
    "id": "contact-075",
    "region": "구미",
    "type": "환경",
    "department": "대구지방환경청",
    "name": "",
    "phone": "053-230-6574",
    "note": ""
  },
  {
    "id": "contact-076",
    "region": "구미",
    "type": "의료기관",
    "department": "구미순천향대학병원",
    "name": "",
    "phone": "054-468-9119",
    "note": ""
  },
  {
    "id": "contact-077",
    "region": "구미",
    "type": "의료기관",
    "department": "갑을구미병원",
    "name": "",
    "phone": "054-710-6000",
    "note": ""
  },
  {
    "id": "contact-078",
    "region": "구미",
    "type": "협조기관",
    "department": "산동읍사무소",
    "name": "",
    "phone": "054-480-7877",
    "note": ""
  }
];
}

function isLegacyEmergencyContacts(contacts) {
  if (!Array.isArray(contacts) || contacts.length === 0) return true;
  const ids = new Set(contacts.map((item) => String(item?.id || "")));
  return contacts.length <= 4 && ["contact-119", "contact-hospital", "contact-labor", "contact-manager"].some((id) => ids.has(id));
}

async function getEmergencyConfig(env) {
  const rawContacts = await readSetting(env, "emergency_contacts", "");
  let contacts = safeJsonParse(rawContacts, null);
  if (!Array.isArray(contacts) || isLegacyEmergencyContacts(contacts)) contacts = defaultEmergencyContacts();

  const rawCalls = await readSetting(env, "emergency_call_options", "");
  let callOptions = safeJsonParse(rawCalls, null);
  if (!Array.isArray(callOptions) || !callOptions.length) callOptions = defaultEmergencyCallOptions();

  let defaultCallId = await readSetting(env, "emergency_default_call_id", "call-general");
  if (!callOptions.some((item) => item.id === defaultCallId)) defaultCallId = callOptions[0]?.id || "call-general";

  const chartKey = await readSetting(env, "emergency_chart_key", "");
  return {
    contacts,
    callOptions,
    defaultCallId,
    chartUrl: chartKey ? `/media/${encodeURIComponent(chartKey)}` : null,
  };
}

function normalizeEmergencyContacts(contacts) {
  const source = Array.isArray(contacts) ? contacts : [];
  return source.slice(0, 160).map((item, index) => ({
    id: String(item?.id || `contact-${index}-${crypto.randomUUID().slice(0, 6)}`),
    region: String(item?.region || "공통").trim().slice(0, 30),
    type: String(item?.type || "기타").trim().slice(0, 40),
    department: String(item?.department || item?.organization || "").trim().slice(0, 100),
    name: String(item?.name || "").trim().slice(0, 80),
    phone: String(item?.phone || "").trim().slice(0, 40),
    note: String(item?.note || "").trim().slice(0, 180),
  })).filter((item) => item.department || item.name || item.phone);
}

function normalizeEmergencyCallOptions(options) {
  const source = Array.isArray(options) ? options : [];
  const normalized = source.slice(0, 20).map((item, index) => ({
    id: String(item?.id || `call-${index}-${crypto.randomUUID().slice(0, 6)}`),
    site: String(item?.site || "공통").trim().slice(0, 60),
    label: String(item?.label || item?.name || "비상전화").trim().slice(0, 80),
    phone: String(item?.phone || "").trim().slice(0, 40),
  })).filter((item) => item.label && item.phone);
  return normalized.length ? normalized : defaultEmergencyCallOptions();
}

async function sendStopWorkNotifications(env, detail) {
  const jobs = [
    ["email", () => sendStopWorkEmail(env, detail)],
    ["sms", () => sendStopWorkSms(env, detail)],
    ["webhook", () => sendStopWorkWebhook(env, detail)],
  ];
  const results = [];
  for (const [channel, job] of jobs) {
    try {
      const result = await job();
      results.push(result || { channel, configured: false });
    } catch (error) {
      console.warn(`stop-work ${channel} notification failed`, error?.message || error);
      results.push({ channel, configured: true, sent: false });
    }
  }
  return results;
}

/* ---------- Smart safety law search ---------- */

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function safetyLawCategoryInfo(category) {
  const map = {
    "8": { name: "중대재해 처벌법", searchName: "중대재해 처벌 등에 관한 법률", priority: 1 },
    "9": { name: "중대재해 처벌법 시행령", searchName: "중대재해 처벌 등에 관한 법률 시행령", priority: 2 },
    "1": { name: "산업안전보건법", searchName: "산업안전보건법", priority: 3 },
    "2": { name: "산업안전보건법 시행령", searchName: "산업안전보건법 시행령", priority: 4 },
    "3": { name: "산업안전보건법 시행규칙", searchName: "산업안전보건법 시행규칙", priority: 5 },
    "4": { name: "산업안전보건기준에 관한 규칙", searchName: "산업안전보건기준에 관한 규칙", priority: 6 },
    "11": { name: "유해·위험작업 취업제한 규칙", searchName: "유해ㆍ위험작업의 취업 제한에 관한 규칙", priority: 7 },
    "5": { name: "고시·훈령·예규", searchName: "", priority: 8 },
  };
  return map[String(category || "")] || null;
}

function normalizeLawSearchText(value) {
  return stripHtml(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function lawSearchTerms(keyword) {
  return stripHtml(keyword)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .split(/\s+/)
    .map((term) => normalizeLawSearchText(term))
    .filter(Boolean);
}

function safetyLawRelevance(item, keyword) {
  const query = normalizeLawSearchText(keyword);
  const title = normalizeLawSearchText(item?.title || "");
  const content = normalizeLawSearchText(item?.content || "");
  const category = normalizeLawSearchText(item?.categoryName || "");
  const terms = lawSearchTerms(keyword);
  let score = 0;
  let matchType = "related";

  if (query && title.includes(query)) {
    score = title === query ? 12000 : 11000;
    matchType = "title-phrase";
  } else if (query && content.includes(query)) {
    score = 9000;
    matchType = "content-phrase";
  } else if (terms.length && terms.every((term) => title.includes(term))) {
    score = 7600;
    matchType = "title-all-terms";
  } else if (terms.length && terms.every((term) => content.includes(term))) {
    score = 6200;
    matchType = "content-all-terms";
  } else {
    const titleHits = terms.filter((term) => title.includes(term)).length;
    const contentHits = terms.filter((term) => content.includes(term)).length;
    const categoryHits = terms.filter((term) => category.includes(term)).length;
    score = titleHits * 900 + contentHits * 350 + categoryHits * 120;
  }

  // 동일 점수에서는 제목이 짧고 검색어가 앞쪽에 있는 결과를 조금 더 우선합니다.
  if (query && title.includes(query)) score += Math.max(0, 240 - title.indexOf(query) * 3 - title.length);
  return { score, matchType };
}

function rankSafetyLawItems(items, keyword) {
  return items
    .map((item, index) => {
      const relevance = safetyLawRelevance(item, keyword);
      return { ...item, relevance: relevance.score, matchType: relevance.matchType, _sourceOrder: index };
    })
    .sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      const ap = Number.isFinite(Number(a.priority)) ? Number(a.priority) : 999;
      const bp = Number.isFinite(Number(b.priority)) ? Number(b.priority) : 999;
      if (ap !== bp) return ap - bp;
      return a._sourceOrder - b._sourceOrder;
    })
    .map(({ _sourceOrder, ...item }) => item);
}

function officialLawLink(categoryInfo, title) {
  if (!categoryInfo) return "";
  if (!categoryInfo.searchName) {
    const clean = stripHtml(title).split(/[\[(]|\s+-\s+/)[0].trim();
    return `https://www.law.go.kr/admRulSc.do?menuId=5&subMenuId=41&query=${encodeURIComponent(clean || stripHtml(title))}`;
  }
  const match = stripHtml(title).match(/제\s*(\d+)\s*조(?:의\s*(\d+))?/);
  let raw = `https://www.law.go.kr/법령/${categoryInfo.searchName}`;
  if (match) raw += match[2] ? `/제${match[1]}조의${match[2]}` : `/제${match[1]}조`;
  return encodeURI(raw);
}

async function fetchKoshaSafetySearch(env, keyword) {
  const apiKey = String(env.KOSHA_API_KEY || "").trim();
  if (!apiKey) throw new Error("KOSHA_API_KEY가 설정되지 않았습니다.");
  const endpoint = new URL("https://apis.data.go.kr/B552468/srch/smartSearch");
  endpoint.searchParams.set("serviceKey", apiKey);
  endpoint.searchParams.set("pageNo", "1");
  endpoint.searchParams.set("numOfRows", "100");
  endpoint.searchParams.set("searchValue", keyword);
  endpoint.searchParams.set("category", "0");
  endpoint.searchParams.set("dataType", "JSON");

  const response = await fetch(endpoint.toString(), {
    headers: { "accept": "application/json", "user-agent": "POSEIDON-Safety-Law/6.8" },
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`안전보건공단 API 응답 오류 (${response.status})`);
  if (raw.trim().startsWith("<")) {
    const auth = raw.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/i)?.[1];
    throw new Error(auth ? `공공데이터 인증 오류: ${stripHtml(auth)}` : "공공데이터 API가 XML 오류를 반환했습니다.");
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error("안전보건공단 검색 응답을 해석하지 못했습니다."); }
  const body = payload?.response?.body || {};
  const sourceItems = body?.items;
  let items = Array.isArray(sourceItems) ? sourceItems : (sourceItems?.item || []);
  if (!Array.isArray(items)) items = items ? [items] : [];

  const result = { law: [], guide: [], media: [] };
  for (const item of items) {
    const category = String(item?.category || "");
    const title = stripHtml(item?.title || "제목 없음");
    const content = stripHtml(item?.content || item?.highlight_content || "");
    const info = safetyLawCategoryInfo(category);
    if (info) {
      result.law.push({
        categoryName: info.name,
        title,
        content,
        priority: info.priority,
        link: officialLawLink(info, title),
        source: "국가법령정보센터",
      });
    } else if (category === "7") {
      result.guide.push({
        categoryName: "KOSHA GUIDE",
        title,
        content,
        link: "https://portal.kosha.or.kr/archive/resources/tech-support/search/all?page=1&rowsPerPage=10",
        source: "한국산업안전보건공단",
      });
    } else if (category === "6") {
      const link = Array.isArray(item?.filepath) ? item.filepath[0] : String(item?.filepath || "");
      result.media.push({ categoryName: item?.media_style || "안전보건 자료", title, content, link, source: "한국산업안전보건공단" });
    }
  }
  for (const item of Array.isArray(body?.total_media) ? body.total_media : []) {
    const link = Array.isArray(item?.filepath) ? item.filepath[0] : String(item?.filepath || "");
    result.media.push({ categoryName: item?.media_style || "안전보건 자료", title: stripHtml(item?.title || "제목 없음"), content: "", link, source: "한국산업안전보건공단" });
  }
  // 검색어가 제목/본문에 직접 포함된 자료를 법 종류보다 먼저 보여줍니다.
  // 예: “안전난간” 검색 시 “안전난간의 구조 및 설치요건”이 최상단으로 올라옵니다.
  result.law = rankSafetyLawItems(result.law, keyword).slice(0, 30);
  result.guide = rankSafetyLawItems(result.guide, keyword).slice(0, 18);
  result.media = rankSafetyLawItems(result.media, keyword).slice(0, 12);
  return result;
}


/* ---------- Smart MSDS library ---------- */

const MSDS_MAX_FILE_BYTES = 12 * 1024 * 1024;
const MSDS_CHUNK_BYTES = 240 * 1024;
const MSDS_SOFT_STORAGE_BYTES = 150 * 1024 * 1024;

function safeFilename(value, fallback = "MSDS.pdf") {
  const cleaned = String(value || "").replace(/[\r\n\\/]+/g, "_").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || fallback).slice(0, 180);
}

function mapMsdsDocument(row) {
  return {
    id: row.id,
    title: row.title,
    originalName: row.original_name,
    manufacturer: row.manufacturer || "",
    keywords: row.keywords || "",
    contentType: row.content_type || "application/pdf",
    byteLength: Number(row.byte_length || 0),
    chunkCount: Number(row.chunk_count || 0),
    uploadedAt: row.uploaded_at,
    updatedAt: row.updated_at,
  };
}

async function getMsdsStats(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(byte_length),0) AS total_bytes FROM msds_documents").first();
  return { count: Number(row?.count || 0), totalBytes: Number(row?.total_bytes || 0), softLimitBytes: MSDS_SOFT_STORAGE_BYTES, maxFileBytes: MSDS_MAX_FILE_BYTES };
}

async function listMsdsDocuments(env, query = "") {
  const q = String(query || "").trim().slice(0, 80);
  let rows;
  if (q) {
    const like = `%${q}%`;
    const compact = `%${q.replace(/\s+/g, "")}%`;
    rows = await env.DB.prepare(`SELECT id,title,original_name,manufacturer,keywords,content_type,byte_length,chunk_count,uploaded_at,updated_at
      FROM msds_documents
      WHERE title LIKE ? COLLATE NOCASE OR original_name LIKE ? COLLATE NOCASE OR manufacturer LIKE ? COLLATE NOCASE OR keywords LIKE ? COLLATE NOCASE
         OR REPLACE(title,' ','') LIKE ? COLLATE NOCASE OR REPLACE(keywords,' ','') LIKE ? COLLATE NOCASE
      ORDER BY uploaded_at DESC LIMIT 200`)
      .bind(like, like, like, like, compact, compact).all();
  } else {
    rows = await env.DB.prepare(`SELECT id,title,original_name,manufacturer,keywords,content_type,byte_length,chunk_count,uploaded_at,updated_at
      FROM msds_documents ORDER BY uploaded_at DESC LIMIT 200`).all();
  }
  return { items: (rows.results || []).map(mapMsdsDocument), stats: await getMsdsStats(env) };
}

function findPdfHeaderOffset(bytes, maxScanBytes = 4096) {
  // PDF 헤더는 일반적으로 파일 첫 바이트에서 시작하지만,
  // 일부 정상 PDF는 BOM/개행/래퍼 바이트 때문에 앞에 몇 바이트가 붙을 수 있습니다.
  // PDF 규격/실사용 파일 호환성을 위해 앞부분에서 %PDF- 시그니처를 탐색합니다.
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 5) return -1;
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  const scanLimit = Math.min(bytes.byteLength - signature.length, Math.max(0, maxScanBytes));
  outer: for (let offset = 0; offset <= scanLimit; offset += 1) {
    for (let index = 0; index < signature.length; index += 1) {
      if (bytes[offset + index] !== signature[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

async function storeMsdsPdf(env, file, meta) {
  const byteLength = Number(file?.size || 0);
  if (!byteLength) throw new Error("빈 PDF 파일은 등록할 수 없습니다.");
  if (byteLength > MSDS_MAX_FILE_BYTES) throw new Error("MSDS PDF는 파일 1개당 12MB 이하로 등록해주세요.");
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const headerOffset = findPdfHeaderOffset(bytes);
  if (headerOffset < 0) {
    throw new Error("PDF 확장자는 확인됐지만 PDF 본문 헤더를 읽지 못했습니다. 암호화/보안문서이거나 다른 형식일 수 있습니다. PDF로 다시 저장한 뒤 시도해주세요.");
  }
  const stats = await getMsdsStats(env);
  if (stats.totalBytes + byteLength > MSDS_SOFT_STORAGE_BYTES) throw new Error("MSDS 권장 저장용량 150MB에 도달했습니다. 오래된 자료를 삭제하거나 R2 저장소 확장을 권장합니다.");

  const id = randomId("msds");
  const now = nowIso();
  const chunkCount = Math.ceil(byteLength / MSDS_CHUNK_BYTES);
  const statements = [
    env.DB.prepare(`INSERT INTO msds_documents (id,title,original_name,manufacturer,keywords,content_type,byte_length,chunk_size,chunk_count,uploaded_by,uploaded_at,updated_at)
      VALUES (?,?,?,?,?,'application/pdf',?,?,?,'admin',?,?)`)
      .bind(id, meta.title, meta.originalName, meta.manufacturer, meta.keywords, byteLength, MSDS_CHUNK_BYTES, chunkCount, now, now),
  ];
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * MSDS_CHUNK_BYTES;
    const end = Math.min(byteLength, start + MSDS_CHUNK_BYTES);
    const chunk = bytes.slice(start, end);
    statements.push(env.DB.prepare("INSERT INTO msds_chunks (document_id,chunk_index,bytes,byte_length) VALUES (?,?,?,?)")
      .bind(id, index, exactArrayBuffer(chunk), chunk.byteLength));
  }
  await env.DB.batch(statements);
  return { id, byteLength, chunkCount };
}

function parseByteRange(rangeHeader, total) {
  if (!rangeHeader || !/^bytes=\d*-\d*$/.test(rangeHeader)) return null;
  const [rawStart, rawEnd] = rangeHeader.replace("bytes=", "").split("-");
  if (!rawStart && !rawEnd) return null;
  let start;
  let end;
  if (!rawStart) {
    const suffix = Math.max(0, Number(rawEnd || 0));
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : total - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= total) return { invalid: true };
  return { start, end: Math.min(total - 1, end) };
}

function concatChunks(rows) {
  const parts = rows.map((row) => new Uint8Array(row.bytes || []));
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
}

async function serveMsdsPdf(request, env, id) {
  const doc = await env.DB.prepare("SELECT id,title,original_name,content_type,byte_length,chunk_size,chunk_count FROM msds_documents WHERE id=?").bind(id).first();
  if (!doc) return error("MSDS 자료를 찾을 수 없습니다.", 404);
  const total = Number(doc.byte_length || 0);
  const chunkSize = Number(doc.chunk_size || MSDS_CHUNK_BYTES);
  const range = parseByteRange(request.headers.get("range"), total);
  const filename = safeFilename(doc.original_name || `${doc.title || "MSDS"}.pdf`);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const commonHeaders = {
    "content-type": "application/pdf",
    "cache-control": "private, no-store",
    "accept-ranges": "bytes",
    "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "x-msds-storage": "d1-chunked",
  };
  if (range?.invalid) return new Response(null, { status: 416, headers: { ...commonHeaders, "content-range": `bytes */${total}` } });

  if (range) {
    const firstChunk = Math.floor(range.start / chunkSize);
    const lastChunk = Math.floor(range.end / chunkSize);
    const rows = await env.DB.prepare("SELECT chunk_index,bytes FROM msds_chunks WHERE document_id=? AND chunk_index BETWEEN ? AND ? ORDER BY chunk_index")
      .bind(id, firstChunk, lastChunk).all();
    const combined = concatChunks(rows.results || []);
    const relativeStart = range.start - firstChunk * chunkSize;
    const body = combined.slice(relativeStart, relativeStart + (range.end - range.start + 1));
    return new Response(body, { status: 206, headers: { ...commonHeaders, "content-length": String(body.byteLength), "content-range": `bytes ${range.start}-${range.end}/${total}` } });
  }

  const rows = await env.DB.prepare("SELECT chunk_index,bytes FROM msds_chunks WHERE document_id=? ORDER BY chunk_index").bind(id).all();
  const body = concatChunks(rows.results || []);
  return new Response(body, { status: 200, headers: { ...commonHeaders, "content-length": String(body.byteLength) } });
}


/* ---------- D-safety meeting / worker voice ---------- */

function mapDSafetyBoard(row) {
  return {
    id: row.id,
    site: row.site || String(row.location || "").split("/")[0].trim() || "미지정",
    meetingDate: row.meeting_date || "",
    workTime: row.work_time || "",
    location: row.location || "",
    jobName: row.job_name || "",
    peopleCount: Number(row.people_count || 0),
    contractor: row.contractor || "",
    workManager: row.work_manager || "",
    contractorManager: row.contractor_manager || "",
    monitorName: row.monitor_name || "",
    monitorDept: row.monitor_dept || "",
    cctv: row.cctv || "",
    rows: safeJsonParse(row.rows_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getDSafetyBoard(env, id) {
  const row = await env.DB.prepare("SELECT * FROM d_safety_boards WHERE id=?").bind(id).first();
  if (!row) return null;
  const opinions = await env.DB.prepare("SELECT * FROM d_safety_opinions WHERE board_id=? ORDER BY created_at DESC LIMIT 200").bind(id).all();
  return { ...mapDSafetyBoard(row), opinions: (opinions.results || []).map((item) => ({ id: item.id, boardId: item.board_id, affiliation: item.affiliation || "", name: item.author_name || "", jobName: item.job_name || "", content: item.content || "", createdAt: item.created_at })) };
}

/* ---------- API ---------- */

async function handleAuth(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const body = await readJson(request);
    const role = body.role === "user" ? "user" : "admin";
    const expected = role === "admin" ? (env.ADMIN_PIN || "2468") : (env.USER_PIN || "1357");
    if (String(body.pin || "") !== String(expected)) return error("비밀번호가 올바르지 않습니다.", 401);
    const { token, payload } = await createSession(role, env);
    return json({ ok: true, data: { role, expiresAt: new Date(payload.exp).toISOString() } }, 200, { "set-cookie": sessionCookie(token, request) });
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", request, 0) });
  }
  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    const session = await readSession(request, env);
    if (!session) return error("로그인이 필요합니다.", 401);
    return json({ ok: true, data: { role: session.role, expiresAt: new Date(session.exp).toISOString() } });
  }
  return null;
}

async function handleRealtime(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/realtime\/([^/]+)$/);
  if (!match) return null;
  const role = url.searchParams.get("role");
  const auth = await requireSession(request, env, role === "admin" ? "admin" : null);
  if (auth.response) return auth.response;
  if (role === "guard" && !["user", "admin"].includes(auth.session.role)) return error("현장 지킴이 권한이 없습니다.", 403);
  if (!env.SIGNALING) return error("Durable Object SIGNALING 바인딩이 없습니다.", 500);
  const deviceId = decodeURIComponent(match[1]);
  const id = env.SIGNALING.idFromName(deviceId);
  return env.SIGNALING.get(id).fetch(request);
}

async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  const authResponse = await handleAuth(request, env);
  if (authResponse) return authResponse;

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, data: { ok: true, service: env.APP_NAME || "스마트 안전지킴이", company: env.COMPANY_NAME || "POSCO Future M", time: nowIso(), realtime: Boolean(env.SIGNALING), browserEdition: true } });
  }

  const realtimeResponse = await handleRealtime(request, env);
  if (realtimeResponse) return realtimeResponse;

  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const isAdmin = auth.session.role === "admin";

  await ensureSchema(env);

  if (path === "/api/ice" && method === "GET") {
    let extra = [];
    try { extra = env.TURN_ICE_SERVERS ? JSON.parse(env.TURN_ICE_SERVERS) : []; } catch { extra = []; }
    return json({ ok: true, data: { iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }, ...(Array.isArray(extra) ? extra : [])] } });
  }


  if (path === "/api/safety-law/search" && method === "GET") {
    const query = String(url.searchParams.get("q") || "").trim().slice(0, 80);
    if (!query) return error("검색어를 입력해주세요.");
    try {
      const result = await fetchKoshaSafetySearch(env, query);
      const searchedAt = nowIso();
      const searchedAtLabel = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(searchedAt));
      return json({ ok: true, data: { query, ...result, searchedAt, searchedAtLabel } });
    } catch (searchError) {
      console.warn("safety-law search failed", searchError?.message || searchError);
      return error(searchError?.message || "안전보건법령 검색에 실패했습니다.", 502);
    }
  }

  if (path === "/api/msds" && method === "GET") {
    const query = String(url.searchParams.get("q") || "").trim();
    return json({ ok: true, data: await listMsdsDocuments(env, query) });
  }

  if (path === "/api/msds" && method === "POST") {
    if (!isAdmin) return error("MSDS 업로드는 관리자 권한이 필요합니다.", 403);
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) return error("MSDS 업로드는 multipart/form-data 형식이어야 합니다.");
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") return error("등록할 PDF 파일을 선택해주세요.");
    const originalName = safeFilename(file.name || "MSDS.pdf");
    const title = String(form.get("title") || originalName.replace(/\.pdf$/i, "")).trim().slice(0, 120);
    const manufacturer = String(form.get("manufacturer") || "").trim().slice(0, 120);
    const keywords = String(form.get("keywords") || "").trim().slice(0, 240);
    if (!title) return error("물질명 또는 제품명을 입력해주세요.");
    try {
      const result = await storeMsdsPdf(env, file, { title, originalName, manufacturer, keywords });
      return json({ ok: true, data: { ...result, stats: await getMsdsStats(env) } }, 201);
    } catch (uploadError) {
      console.warn("msds upload failed", uploadError?.message || uploadError);
      const status = /12MB|150MB|PDF/.test(uploadError?.message || "") ? 413 : 500;
      return error(uploadError?.message || "MSDS 자료를 저장하지 못했습니다.", status);
    }
  }

  const msdsFileMatch = path.match(/^\/api\/msds\/([^/]+)\/file$/);
  if (msdsFileMatch && method === "GET") return serveMsdsPdf(request, env, decodeURIComponent(msdsFileMatch[1]));

  const msdsDeleteMatch = path.match(/^\/api\/msds\/([^/]+)$/);
  if (msdsDeleteMatch && method === "DELETE") {
    if (!isAdmin) return error("MSDS 삭제는 관리자 권한이 필요합니다.", 403);
    const id = decodeURIComponent(msdsDeleteMatch[1]);
    const doc = await env.DB.prepare("SELECT id FROM msds_documents WHERE id=?").bind(id).first();
    if (!doc) return error("MSDS 자료를 찾을 수 없습니다.", 404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM msds_chunks WHERE document_id=?").bind(id),
      env.DB.prepare("DELETE FROM msds_documents WHERE id=?").bind(id),
    ]);
    return json({ ok: true, data: { id, deleted: true, stats: await getMsdsStats(env) } });
  }
  if (path === "/api/emergency/config" && method === "GET") return json({ ok: true, data: await getEmergencyConfig(env) });
  if (path === "/api/emergency/config" && method === "PUT") {
    if (!isAdmin) return error("비상연락망 수정은 관리자 권한이 필요합니다.", 403);
    const body = await readJson(request);
    const current = await getEmergencyConfig(env);
    const contacts = Object.prototype.hasOwnProperty.call(body, "contacts") ? normalizeEmergencyContacts(body.contacts) : current.contacts;
    const callOptions = Object.prototype.hasOwnProperty.call(body, "callOptions") ? normalizeEmergencyCallOptions(body.callOptions) : current.callOptions;
    let defaultCallId = String(body.defaultCallId || current.defaultCallId || callOptions[0]?.id || "").trim();
    if (!callOptions.some((item) => item.id === defaultCallId)) defaultCallId = callOptions[0]?.id || "";
    await writeSetting(env, "emergency_contacts", JSON.stringify(contacts));
    await writeSetting(env, "emergency_call_options", JSON.stringify(callOptions));
    await writeSetting(env, "emergency_default_call_id", defaultCallId);
    return json({ ok: true, data: await getEmergencyConfig(env) });
  }

  if (path === "/api/emergency/chart" && method === "POST") {
    if (!isAdmin) return error("보고체계도 등록은 관리자 권한이 필요합니다.", 403);
    const contentType = request.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return error("이미지 파일만 등록할 수 있습니다.");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength) return error("이미지 파일이 비어 있습니다.");
    if (bytes.byteLength > 1_450_000) return error("보고체계도 이미지는 1.45MB 이하로 압축해서 등록해주세요.", 413);
    const oldKey = await readSetting(env, "emergency_chart_key", "");
    const key = "emergency/report-chart";
    const stored = await putImage(env, key, bytes, contentType);
    if (!stored) return error("보고체계도 이미지를 저장하지 못했습니다.", 500);
    await writeSetting(env, "emergency_chart_key", key);
    if (oldKey && oldKey !== key) await env.DB.prepare("DELETE FROM media WHERE key=?").bind(oldKey).run();
    return json({ ok: true, data: await getEmergencyConfig(env) }, 201);
  }

  if (path === "/api/emergency/chart" && method === "DELETE") {
    if (!isAdmin) return error("보고체계도 삭제는 관리자 권한이 필요합니다.", 403);
    const oldKey = await readSetting(env, "emergency_chart_key", "");
    if (oldKey) await env.DB.prepare("DELETE FROM media WHERE key=?").bind(oldKey).run();
    await writeSetting(env, "emergency_chart_key", "");
    return json({ ok: true, data: await getEmergencyConfig(env) });
  }

  if (path === "/api/emergency/report" && method === "POST") {
    const body = await readJson(request);
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return error("현재 GPS 위치를 먼저 확인해주세요.");
    const deviceId = String(body.deviceId || "manual-emergency").trim().slice(0, 120) || "manual-emergency";
    const reporterName = String(body.reporterName || "").trim().slice(0, 80);
    const reporterContact = String(body.reporterContact || "").trim().slice(0, 100);
    const note = String(body.note || "119 비상대응 위치 전송").trim().slice(0, 600);
    const accuracy = Math.max(0, Number(body.accuracy || 0));
    const occurredAt = String(body.occurredAt || nowIso());
    const eventId = randomId("evt");
    const device = await env.DB.prepare("SELECT name,site,area FROM devices WHERE id=?").bind(deviceId).first();
    const metadata = { emergency119: true, reporterName, reporterContact, note, latitude, longitude, accuracy, mapUrl: `https://www.google.com/maps?q=${latitude},${longitude}` };
    await env.DB.prepare(`INSERT INTO events (id,device_id,type,category,severity,message,occurred_at,acknowledged,status,snapshot_key,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,0,'즉시 확인',NULL,?,?)`)
      .bind(eventId, deviceId, "EMERGENCY_119", "비상신고", "critical", `119 비상대응 GPS 전송: ${note}`, occurredAt, JSON.stringify(metadata), nowIso()).run();
    if (device) await env.DB.prepare("UPDATE devices SET current_risk='비상신고',last_seen=?,updated_at=? WHERE id=?").bind(nowIso(), nowIso(), deviceId).run();
    return json({ ok: true, data: { eventId, mapUrl: metadata.mapUrl } }, 201);
  }

  if (path === "/api/d-safety/boards" && method === "GET") {
    const result = await env.DB.prepare("SELECT * FROM d_safety_boards ORDER BY created_at DESC LIMIT 1000").all();
    return json({ ok: true, data: (result.results || []).map(mapDSafetyBoard) });
  }
  if (path === "/api/d-safety/boards" && method === "POST") {
    if (!isAdmin) return error("D-안전회의 등록은 관리자 권한이 필요합니다.", 403);
    const body = await readJson(request);
    const site = String(body.site || "").trim().slice(0,80);
    if (!site) return error("사업장을 입력해주세요.");
    const id = randomId("dsafety");
    const created = nowIso();
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 100).map((row) => ({ no: String(row.no || "-"), risk: String(row.risk || "").slice(0, 2500), action: String(row.action || "").slice(0, 2500) })) : [];
    await env.DB.prepare(`INSERT INTO d_safety_boards (id,site,meeting_date,work_time,location,job_name,people_count,contractor,work_manager,contractor_manager,monitor_name,monitor_dept,cctv,rows_json,raw_text,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'admin',?,?)`)
      .bind(id, site, String(body.meetingDate || "").slice(0,40), String(body.workTime || "").slice(0,80), String(body.location || "").slice(0,240), String(body.jobName || "").slice(0,800), Math.max(0, Number(body.peopleCount || 0)), String(body.contractor || "").slice(0,160), String(body.workManager || "").slice(0,100), String(body.contractorManager || "").slice(0,100), String(body.monitorName || "").slice(0,100), String(body.monitorDept || "").slice(0,120), String(body.cctv || "").slice(0,60), JSON.stringify(rows), String(body.rawText || "").slice(0,20000), created, created).run();
    return json({ ok: true, data: await getDSafetyBoard(env, id) }, 201);
  }
  if (path === "/api/d-safety/retention" && method === "GET") {
    if (!isAdmin) return error("D-안전회의 보관설정은 관리자 권한이 필요합니다.", 403);
    return json({ ok: true, data: await getDSafetyRetentionSettings(env) });
  }
  if (path === "/api/d-safety/retention" && method === "PUT") {
    if (!isAdmin) return error("D-안전회의 보관설정은 관리자 권한이 필요합니다.", 403);
    const body = await readJson(request);
    const days = Math.min(730, Math.max(30, Number(body.days || 180)));
    const enabled = body.enabled !== false;
    await Promise.all([writeSetting(env, "d_safety_retention_days", days), writeSetting(env, "d_safety_auto_cleanup", enabled ? "true" : "false")]);
    return json({ ok: true, data: await getDSafetyRetentionSettings(env) });
  }
  if (path === "/api/d-safety/cleanup" && method === "POST") {
    if (!isAdmin) return error("D-안전회의 데이터 정리는 관리자 권한이 필요합니다.", 403);
    const body = await readJson(request);
    const settings = await getDSafetyRetentionSettings(env);
    return json({ ok: true, data: await cleanupDSafetyOlderThan(env, body.days || settings.days) });
  }
  if (path === "/api/d-safety/export" && method === "GET") {
    if (!isAdmin) return error("D-안전회의 백업은 관리자 권한이 필요합니다.", 403);
    const boardsResult = await env.DB.prepare("SELECT * FROM d_safety_boards ORDER BY created_at DESC LIMIT 3000").all();
    const opinionsResult = await env.DB.prepare("SELECT * FROM d_safety_opinions ORDER BY created_at DESC LIMIT 10000").all();
    const opinionsByBoard = new Map();
    for (const item of opinionsResult.results || []) {
      if (!opinionsByBoard.has(item.board_id)) opinionsByBoard.set(item.board_id, []);
      opinionsByBoard.get(item.board_id).push({ id: item.id, boardId: item.board_id, affiliation: item.affiliation || "", name: item.author_name || "", jobName: item.job_name || "", content: item.content || "", createdAt: item.created_at });
    }
    const boards = (boardsResult.results || []).map((row) => ({ ...mapDSafetyBoard(row), opinions: opinionsByBoard.get(row.id) || [] }));
    return json({ ok: true, data: { exportedAt: nowIso(), version: "6.16.0", boards } });
  }
  const dSafetyBoardMatch = path.match(/^\/api\/d-safety\/boards\/([^/]+)$/);
  if (dSafetyBoardMatch && method === "GET") {
    const board = await getDSafetyBoard(env, decodeURIComponent(dSafetyBoardMatch[1]));
    if (!board) return error("D-안전회의 자료를 찾을 수 없습니다.", 404);
    return json({ ok: true, data: board });
  }
  if (dSafetyBoardMatch && method === "DELETE") {
    if (!isAdmin) return error("D-안전회의 삭제는 관리자 권한이 필요합니다.", 403);
    const id = decodeURIComponent(dSafetyBoardMatch[1]);
    await env.DB.batch([env.DB.prepare("DELETE FROM d_safety_opinions WHERE board_id=?").bind(id), env.DB.prepare("DELETE FROM d_safety_boards WHERE id=?").bind(id)]);
    return json({ ok: true });
  }
  const dSafetyOpinionMatch = path.match(/^\/api\/d-safety\/boards\/([^/]+)\/opinions$/);
  if (dSafetyOpinionMatch && method === "POST") {
    const boardId = decodeURIComponent(dSafetyOpinionMatch[1]);
    const exists = await env.DB.prepare("SELECT id,job_name FROM d_safety_boards WHERE id=?").bind(boardId).first();
    if (!exists) return error("D-안전회의 자료를 찾을 수 없습니다.", 404);
    const body = await readJson(request);
    const affiliation = String(body.affiliation || "").trim().slice(0, 100);
    const authorName = String(body.name || "").trim().slice(0, 80);
    const jobName = String(body.jobName || "").trim().slice(0, 800);
    const content = String(body.content || "").trim().slice(0, 1200);
    if (!affiliation || !authorName || !content) return error("소속, 이름, 의견을 모두 입력해주세요.");
    const id = randomId("opinion");
    const createdAt = nowIso();
    await env.DB.prepare("INSERT INTO d_safety_opinions (id,board_id,affiliation,author_name,job_name,content,created_at) VALUES (?,?,?,?,?,?,?)").bind(id, boardId, affiliation, authorName, jobName, content, createdAt).run();
    return json({ ok: true, data: { id, boardId, affiliation, name: authorName, jobName, content, createdAt } }, 201);
  }

  if (path === "/api/guard/privacy" && method === "PUT") {
    const body = await readJson(request);
    const deviceId = String(body.deviceId || "").trim();
    if (!deviceId) return error("deviceId가 필요합니다.");
    const row = await env.DB.prepare("SELECT config_json FROM devices WHERE id=?").bind(deviceId).first();
    if (!row) return error("장치를 찾을 수 없습니다.", 404);
    const config = safeJsonParse(row.config_json, defaultConfig());
    config.privacy ||= {};
    config.privacy.faceMosaic = body.faceMosaic === true;
    await env.DB.prepare("UPDATE devices SET config_json=?,updated_at=? WHERE id=?").bind(JSON.stringify(config), nowIso(), deviceId).run();
    return json({ ok: true, data: config.privacy });
  }

  if (path === "/api/stop-work" && method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) return error("작업중지권 요청은 multipart/form-data 형식이어야 합니다.");
    const form = await request.formData();
    const deviceId = String(form.get("deviceId") || "").trim();
    const reporterName = String(form.get("reporterName") || "").trim().slice(0, 80);
    const reporterContact = String(form.get("reporterContact") || "").trim().slice(0, 120);
    const reason = String(form.get("reason") || "").trim().slice(0, 2000);
    const occurredAt = String(form.get("occurredAt") || nowIso());
    if (!deviceId) return error("deviceId가 필요합니다.");
    if (!reporterName) return error("발동자 이름이 필요합니다.");
    if (!reason) return error("작업중지 사유가 필요합니다.");

    const device = await env.DB.prepare("SELECT id,name,site,area FROM devices WHERE id=?").bind(deviceId).first();
    if (!device) return error("등록된 장치를 찾을 수 없습니다.", 404);

    const requestId = randomId("stop");
    const eventId = randomId("evt");
    let snapshotKey = null;

    const snapshotBase64 = String(form.get("snapshotBase64") || "");
    if (snapshotBase64) {
      const bytes = base64ToBytes(snapshotBase64);
      if (bytes.byteLength <= 1_200_000) snapshotKey = await putImage(env, `events/${deviceId}/${eventId}.jpg`, bytes, "image/jpeg");
    }

    async function storeStopClip(fieldName, phase) {
      const clip = form.get(fieldName);
      if (!clip || typeof clip.arrayBuffer !== "function" || Number(clip.size || 0) <= 0) return { key: null, url: null, contentType: "" };
      if (Number(clip.size || 0) > 1_400_000) throw new Error(`${phase} 영상은 1.4MB 이하여야 합니다.`);
      const contentType = String(clip.type || "video/webm");
      const ext = contentType.includes("mp4") ? "mp4" : "webm";
      const key = await putImage(env, `stop-work/${deviceId}/${requestId}-${phase}.${ext}`, new Uint8Array(await clip.arrayBuffer()), contentType);
      return { key, url: key ? `/media/${encodeURIComponent(key)}` : null, contentType };
    }

    let beforeMedia = { key: null, url: null, contentType: "" };
    let afterMedia = { key: null, url: null, contentType: "" };
    try {
      beforeMedia = await storeStopClip("beforeClip", "before");
      afterMedia = await storeStopClip("afterClip", "after");
      // V6.3 이하 클라이언트 호환
      if (!beforeMedia.key && !afterMedia.key) {
        const legacy = form.get("clip");
        if (legacy && typeof legacy.arrayBuffer === "function" && Number(legacy.size || 0) > 0) {
          if (Number(legacy.size || 0) > 1_400_000) return error("작업중지 전후 영상은 1.4MB 이하여야 합니다.", 413);
          const contentType = String(legacy.type || "video/webm");
          const ext = contentType.includes("mp4") ? "mp4" : "webm";
          const key = await putImage(env, `stop-work/${deviceId}/${requestId}-legacy.${ext}`, new Uint8Array(await legacy.arrayBuffer()), contentType);
          afterMedia = { key, url: key ? `/media/${encodeURIComponent(key)}` : null, contentType };
        }
      }
    } catch (clipError) {
      return error(clipError.message || "작업중지 영상을 저장하지 못했습니다.", 413);
    }

    const clipKey = afterMedia.key || beforeMedia.key || null;
    const clipContentType = afterMedia.contentType || beforeMedia.contentType || "";
    const clipUrl = afterMedia.url || beforeMedia.url || null;
    const metadata = {
      stopWork: true,
      stopWorkId: requestId,
      reporterName,
      reporterContact,
      reason,
      clipUrl,
      clipKey,
      beforeClipUrl: beforeMedia.url,
      beforeClipKey: beforeMedia.key,
      afterClipUrl: afterMedia.url,
      afterClipKey: afterMedia.key,
      beforeSeconds: 10,
      afterSeconds: 10,
    };
    const message = `작업중지권 발동: ${reason}`;
    const createdAt = nowIso();

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO stop_work_requests (id,event_id,device_id,reporter_name,reporter_contact,reason,occurred_at,status,clip_key,clip_content_type,created_at) VALUES (?,?,?,?,?,?,?,'접수',?,?,?)`)
        .bind(requestId, eventId, deviceId, reporterName, reporterContact, reason, occurredAt, clipKey, clipContentType, createdAt),
      env.DB.prepare(`INSERT INTO events (id,device_id,type,category,severity,message,occurred_at,acknowledged,status,snapshot_key,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,0,'즉시 확인',?,?,?)`)
        .bind(eventId, deviceId, "STOP_WORK_REQUEST", "작업중지권", "critical", message, occurredAt, snapshotKey, JSON.stringify(metadata), createdAt),
      env.DB.prepare("UPDATE devices SET current_risk='작업중지',last_seen=?,status='online',updated_at=? WHERE id=?")
        .bind(createdAt, createdAt, deviceId),
    ]);

    const origin = new URL(request.url).origin;
    const detail = {
      requestId,
      eventId,
      deviceId,
      deviceName: device.name,
      site: device.site,
      area: device.area,
      reporterName,
      reporterContact,
      reason,
      occurredAt,
      clipUrl,
      beforeClipUrl: beforeMedia.url,
      afterClipUrl: afterMedia.url,
      origin,
    };
    const notificationResults = await sendStopWorkNotifications(env, detail);
    const labels = { email: "이메일", sms: "문자", webhook: "웹훅" };
    const sentChannels = notificationResults.filter((item) => item.sent).map((item) => labels[item.channel] || item.channel);
    const failedConfigured = notificationResults.some((item) => item.configured && item.sent === false);
    const notificationSummary = sentChannels.length
      ? `관리자 대시보드 접수 · ${sentChannels.join("·")} 전송 완료`
      : failedConfigured
        ? "관리자 대시보드 접수 · 외부 알림 전송 일부 실패"
        : "관리자 대시보드 접수 · 외부 알림은 아직 미설정";

    return json({ ok: true, data: { requestId, eventId, clipUrl, notificationSummary } }, 201);
  }

  if (path === "/api/guard/zone" && method === "PUT") {
    const body = await readJson(request);
    const deviceId = String(body.deviceId || "").trim();
    if (!deviceId) return error("deviceId가 필요합니다.");
    const row = await env.DB.prepare("SELECT config_json FROM devices WHERE id=?").bind(deviceId).first();
    if (!row) return error("먼저 현장 지킴이를 시작해 장치를 등록해주세요.", 404);

    const sourceZone = body.zone && typeof body.zone === "object" ? body.zone : {};
    const enabled = body.enabled === true;
    const rawPoints = Array.isArray(sourceZone.points) ? sourceZone.points.slice(0, 20) : [];
    const points = rawPoints
      .filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .map(([x, y]) => [Math.max(0, Math.min(1, Number(x))), Math.max(0, Math.min(1, Number(y)))]);
    if (enabled && points.length < 3) return error("위험구역을 사용하려면 점을 3개 이상 지정해주세요.");

    const severity = ["medium", "high", "critical"].includes(String(sourceZone.severity)) ? String(sourceZone.severity) : "high";
    const shape = sourceZone.shape === "rectangle" ? "rectangle" : "polygon";
    const config = safeJsonParse(row.config_json, defaultConfig());
    config.rules = { ...(config.rules || {}), dangerZone: enabled };
    config.zones = [{
      id: "zone-main",
      name: String(sourceZone.name || "출입 제한 구역").trim().slice(0, 80) || "출입 제한 구역",
      severity,
      shape,
      enabled,
      points,
    }];
    config.updatedBy = auth.session.role === "admin" ? "admin" : "field-user";
    config.zoneUpdatedAt = nowIso();
    const result = await env.DB.prepare("UPDATE devices SET config_json=?,updated_at=? WHERE id=?").bind(JSON.stringify(config), nowIso(), deviceId).run();
    if (!result.meta?.changes) return error("장치를 찾을 수 없습니다.", 404);
    return json({ ok: true, data: { config, zone: config.zones[0] } });
  }

  const adminOnly = path.startsWith("/api/dashboard/") || path === "/api/devices" || path.startsWith("/api/events") || path.startsWith("/api/reports/") || path.startsWith("/api/admin/") || path.startsWith("/api/demo/") || (path.startsWith("/api/devices/") && method !== "GET") || path.match(/^\/api\/events\/[^/]+\/ack$/);
  if (adminOnly && !isAdmin) return error("관리자 권한이 필요합니다.", 403);

  if (path === "/api/dashboard/summary" && method === "GET") return json({ ok: true, data: await getSummary(env) });
  if (path === "/api/devices" && method === "GET") return json({ ok: true, data: await getDevices(env) });
  if (path === "/api/events" && method === "GET") return json({ ok: true, data: await getEvents(env, url) });
  if (path === "/api/events" && method === "DELETE") return json({ ok: true, data: await deleteAllEvents(env) });

  if (path === "/api/events/settings" && method === "GET") {
    return json({ ok: true, data: await getEventRetentionSettings(env) });
  }
  if (path === "/api/events/settings" && method === "PUT") {
    const body = await readJson(request);
    const days = Math.min(365, Math.max(1, Number(body.days || 30)));
    const enabled = body.enabled !== false;
    await Promise.all([
      writeSetting(env, "event_retention_days", days),
      writeSetting(env, "event_auto_cleanup", enabled ? "true" : "false"),
    ]);
    return json({ ok: true, data: await getEventRetentionSettings(env) });
  }
  if (path === "/api/events/cleanup" && method === "POST") {
    const body = await readJson(request).catch(() => ({}));
    const settings = await getEventRetentionSettings(env);
    return json({ ok: true, data: await cleanupEventsOlderThan(env, body.days || settings.days) });
  }

  if (path === "/api/reports/daily" && method === "GET") {
    const days = Math.min(Math.max(Number(url.searchParams.get("days") || 7), 1), 31);
    const result = await env.DB.prepare(`SELECT substr(occurred_at,1,10) AS day, category, severity, COUNT(*) AS count FROM events WHERE occurred_at >= ? GROUP BY day, category, severity ORDER BY day ASC`).bind(new Date(Date.now() - days * 86400000).toISOString()).all();
    return json({ ok: true, data: result.results || [] });
  }

  if (path === "/api/agents/register" && method === "POST") {
    const body = await readJson(request);
    const id = String(body.deviceId || "").trim();
    if (!id) return error("deviceId가 필요합니다.");
    const now = nowIso();
    const requestedConfig = body.config && typeof body.config === "object" ? body.config : defaultConfig();
    const current = await env.DB.prepare("SELECT config_json FROM devices WHERE id=?").bind(id).first();
    const config = current?.config_json ? safeJsonParse(current.config_json, requestedConfig) : requestedConfig;
    await env.DB.prepare(`INSERT INTO devices (id,name,site,area,camera_label,status,agent_version,last_seen,fps,cpu,memory,people_count,current_risk,preview_key,config_json,created_at,updated_at) VALUES (?,?,?,?,?,'online',?,?,0,0,0,0,'정상',NULL,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,site=excluded.site,area=excluded.area,camera_label=excluded.camera_label,status='online',agent_version=excluded.agent_version,last_seen=excluded.last_seen,updated_at=excluded.updated_at`).bind(id, String(body.name || id), String(body.site || "미지정 사업장"), String(body.area || "미지정 구역"), String(body.cameraLabel || "브라우저 카메라"), String(body.agentVersion || "browser-2.0"), now, JSON.stringify(config), now, now).run();
    const device = await env.DB.prepare("SELECT * FROM devices WHERE id=?").bind(id).first();
    return json({ ok: true, data: mapDevice(device) }, 201);
  }

  if (path === "/api/agents/heartbeat" && method === "POST") {
    const body = await readJson(request);
    const id = String(body.deviceId || "").trim();
    if (!id) return error("deviceId가 필요합니다.");
    const now = nowIso();
    await env.DB.prepare(`UPDATE devices SET status='online',last_seen=?,fps=?,cpu=?,memory=?,people_count=?,current_risk=?,agent_version=COALESCE(?,agent_version),updated_at=? WHERE id=?`).bind(now, Number(body.fps || 0), Number(body.cpu || 0), Number(body.memory || 0), Number(body.peopleCount || 0), String(body.currentRisk || "정상"), body.agentVersion ? String(body.agentVersion) : null, now, id).run();
    return json({ ok: true, serverTime: now });
  }

  if (path === "/api/agents/offline" && method === "POST") {
    const body = await readJson(request).catch(() => ({}));
    const id = String(body.deviceId || "").trim();
    if (!id) return error("deviceId가 필요합니다.");
    await env.DB.prepare("UPDATE devices SET status='offline',people_count=0,current_risk='연결 종료',updated_at=? WHERE id=?").bind(nowIso(), id).run();
    return json({ ok: true });
  }

  const previewMatch = path.match(/^\/api\/agents\/preview\/([^/]+)$/);
  if (previewMatch && method === "POST") {
    const deviceId = decodeURIComponent(previewMatch[1]);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return error("이미지 본문이 비어 있습니다.");
    if (bytes.byteLength > 700000) return error("프리뷰 이미지는 700KB 이하여야 합니다.", 413);
    const key = `previews/${deviceId}/latest.jpg`;
    const stored = await putImage(env, key, bytes, request.headers.get("content-type") || "image/jpeg");
    const now = nowIso();
    await env.DB.prepare("UPDATE devices SET preview_key=?,last_seen=?,status='online',updated_at=? WHERE id=?").bind(stored, now, now, deviceId).run();
    return json({ ok: true, previewUrl: stored ? `/media/${encodeURIComponent(stored)}` : null });
  }

  if (path === "/api/agents/event" && method === "POST") {
    const body = await readJson(request);
    const deviceId = String(body.deviceId || "").trim();
    if (!deviceId) return error("deviceId가 필요합니다.");
    const eventId = String(body.id || randomId("evt"));
    let snapshotKey = null;
    if (body.snapshotBase64) {
      const bytes = base64ToBytes(String(body.snapshotBase64));
      if (bytes.byteLength <= 1200000) snapshotKey = await putImage(env, `events/${deviceId}/${eventId}.jpg`, bytes, "image/jpeg");
    }
    const occurredAt = String(body.occurredAt || nowIso());
    await env.DB.prepare(`INSERT INTO events (id,device_id,type,category,severity,message,occurred_at,acknowledged,status,snapshot_key,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,0,'확인 필요',?,?,?)`).bind(eventId, deviceId, String(body.type || "UNKNOWN"), String(body.category || "기타"), String(body.severity || "medium"), String(body.message || "안전 이벤트가 발생했습니다."), occurredAt, snapshotKey, JSON.stringify(body.metadata || {}), nowIso()).run();
    const now = nowIso();
    await env.DB.prepare("UPDATE devices SET current_risk=?,last_seen=?,status='online',updated_at=? WHERE id=?").bind(["critical", "high"].includes(body.severity) ? "위험" : "주의", now, now, deviceId).run();
    return json({ ok: true, id: eventId }, 201);
  }

  const configMatch = path.match(/^\/api\/devices\/([^/]+)\/config$/);
  if (configMatch && method === "GET") {
    const deviceId = decodeURIComponent(configMatch[1]);
    const row = await env.DB.prepare("SELECT config_json FROM devices WHERE id=?").bind(deviceId).first();
    if (!row) return error("장치를 찾을 수 없습니다.", 404);
    return json({ ok: true, data: safeJsonParse(row.config_json, defaultConfig()) });
  }
  if (configMatch && method === "PUT") {
    if (!isAdmin) return error("관리자 권한이 필요합니다.", 403);
    const deviceId = decodeURIComponent(configMatch[1]);
    const body = await readJson(request);
    const config = body.config && typeof body.config === "object" ? body.config : body;
    const result = await env.DB.prepare("UPDATE devices SET config_json=?,updated_at=? WHERE id=?").bind(JSON.stringify(config), nowIso(), deviceId).run();
    if (!result.meta?.changes) return error("장치를 찾을 수 없습니다.", 404);
    return json({ ok: true, data: config });
  }

  const deleteEventMatch = path.match(/^\/api\/events\/([^/]+)$/);
  if (deleteEventMatch && method === "DELETE") {
    const eventId = decodeURIComponent(deleteEventMatch[1]);
    const row = await env.DB.prepare("SELECT snapshot_key,metadata_json FROM events WHERE id=?").bind(eventId).first();
    if (!row) return error("이벤트를 찾을 수 없습니다.", 404);
    const metadata = safeJsonParse(row.metadata_json, {});
    const statements = [env.DB.prepare("DELETE FROM events WHERE id=?").bind(eventId)];
    if (row.snapshot_key) statements.unshift(env.DB.prepare("DELETE FROM media WHERE key=?").bind(row.snapshot_key));
    for (const mediaKey of [metadata.clipKey, metadata.beforeClipKey, metadata.afterClipKey].filter(Boolean)) statements.unshift(env.DB.prepare("DELETE FROM media WHERE key=?").bind(String(mediaKey)));
    if (metadata.stopWorkId) statements.push(env.DB.prepare("DELETE FROM stop_work_requests WHERE id=?").bind(String(metadata.stopWorkId)));
    await env.DB.batch(statements);
    return json({ ok: true });
  }

  const ackMatch = path.match(/^\/api\/events\/([^/]+)\/ack$/);
  if (ackMatch && method === "POST") {
    const eventId = decodeURIComponent(ackMatch[1]);
    const body = await readJson(request).catch(() => ({}));
    const status = String(body.status || "확인 완료");
    const row = await env.DB.prepare("SELECT metadata_json FROM events WHERE id=?").bind(eventId).first();
    if (!row) return error("이벤트를 찾을 수 없습니다.", 404);
    const metadata = safeJsonParse(row.metadata_json, {});
    const statements = [env.DB.prepare("UPDATE events SET acknowledged=1,status=? WHERE id=?").bind(status, eventId)];
    if (metadata.stopWorkId) statements.push(env.DB.prepare("UPDATE stop_work_requests SET status=? WHERE id=?").bind(status, String(metadata.stopWorkId)));
    await env.DB.batch(statements);
    return json({ ok: true });
  }

  const deleteDeviceMatch = path.match(/^\/api\/devices\/([^/]+)$/);
  if (deleteDeviceMatch && method === "DELETE") {
    const deviceId = decodeURIComponent(deleteDeviceMatch[1]);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM media WHERE key LIKE ? OR key LIKE ? OR key LIKE ?").bind(`previews/${deviceId}/%`, `events/${deviceId}/%`, `stop-work/${deviceId}/%`),
      env.DB.prepare("DELETE FROM stop_work_requests WHERE device_id=?").bind(deviceId),
      env.DB.prepare("DELETE FROM events WHERE device_id=?").bind(deviceId),
      env.DB.prepare("DELETE FROM devices WHERE id=?").bind(deviceId),
    ]);
    return json({ ok: true });
  }


  if (path === "/api/training/stats" && method === "GET") {
    const deviceId = String(url.searchParams.get("deviceId") || "").trim();
    const queries = [
      env.DB.prepare("SELECT COUNT(*) AS count FROM training_samples"),
      env.DB.prepare("SELECT COALESCE(SUM(byte_length),0) AS bytes FROM media WHERE key LIKE 'training/%'"),
    ];
    if (deviceId) {
      queries.push(env.DB.prepare("SELECT COUNT(*) AS count FROM training_samples WHERE device_id=?").bind(deviceId));
      queries.push(env.DB.prepare("SELECT COALESCE(SUM(byte_length),0) AS bytes FROM media WHERE key LIKE ?").bind(`training/${deviceId}/%`));
    }
    const results = await env.DB.batch(queries);
    const globalSamples = Number(results[0]?.results?.[0]?.count || 0);
    const globalBytes = Number(results[1]?.results?.[0]?.bytes || 0);
    const deviceSamples = deviceId ? Number(results[2]?.results?.[0]?.count || 0) : globalSamples;
    const deviceBytes = deviceId ? Number(results[3]?.results?.[0]?.bytes || 0) : globalBytes;
    return json({ ok: true, data: {
      deviceSamples,
      deviceBytes,
      globalSamples,
      globalBytes,
      softLimitBytes: 300 * 1024 * 1024,
      freeDatabaseLimitBytes: 500 * 1024 * 1024,
    }});
  }

  if (path === "/api/training/samples" && method === "POST") {
    const body = await readJson(request);
    const deviceId = String(body.deviceId || "").trim();
    if (!deviceId) return error("deviceId가 필요합니다.");
    const labels = body.labels && typeof body.labels === "object" ? body.labels : {};
    for (const key of ["helmet", "goggles", "mask"]) {
      if (!["on", "off", "unknown"].includes(String(labels[key] || ""))) return error(`labels.${key} 값이 필요합니다.`);
    }
    const id = randomId("train");
    let snapshotKey = null;
    if (body.snapshotBase64) {
      const bytes = base64ToBytes(String(body.snapshotBase64));
      if (bytes.byteLength > 700000) return error("학습 이미지는 700KB 이하여야 합니다.", 413);
      snapshotKey = await putImage(env, `training/${deviceId}/${id}.jpg`, bytes, "image/jpeg");
    }
    const capturedAt = String(body.capturedAt || nowIso());
    await env.DB.prepare(`INSERT INTO training_samples (id,device_id,captured_at,model_version,predicted_json,labels_json,snapshot_key,reviewed,created_at) VALUES (?,?,?,?,?,?,?,0,?)`)
      .bind(id, deviceId, capturedAt, String(body.modelVersion || ""), JSON.stringify(body.predictions || {}), JSON.stringify(labels), snapshotKey, nowIso()).run();
    return json({ ok: true, data: { id, snapshotUrl: snapshotKey ? `/media/${encodeURIComponent(snapshotKey)}` : null } }, 201);
  }

  if (path === "/api/training/samples" && method === "GET") {
    if (!isAdmin) return error("관리자 권한이 필요합니다.", 403);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200), 1), 1000);
    const result = await env.DB.prepare(`SELECT id,device_id,captured_at,model_version,predicted_json,labels_json,snapshot_key,reviewed,created_at FROM training_samples ORDER BY captured_at DESC LIMIT ?`).bind(limit).all();
    const rows = (result.results || []).map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      capturedAt: row.captured_at,
      modelVersion: row.model_version,
      predictions: safeJsonParse(row.predicted_json, {}),
      labels: safeJsonParse(row.labels_json, {}),
      snapshotUrl: row.snapshot_key ? `/media/${encodeURIComponent(row.snapshot_key)}` : null,
      reviewed: Boolean(row.reviewed),
      createdAt: row.created_at,
    }));
    return json({ ok: true, data: rows });
  }

  if (path === "/api/training/export" && method === "GET") {
    if (!isAdmin) return error("관리자 권한이 필요합니다.", 403);
    const result = await env.DB.prepare(`SELECT id,device_id,captured_at,model_version,predicted_json,labels_json,snapshot_key FROM training_samples ORDER BY captured_at ASC`).all();
    const rows = (result.results || []).map((row) => ({
      id: row.id,
      device_id: row.device_id,
      captured_at: row.captured_at,
      model_version: row.model_version,
      predictions: safeJsonParse(row.predicted_json, {}),
      labels: safeJsonParse(row.labels_json, {}),
      image_url: row.snapshot_key ? `/media/${encodeURIComponent(row.snapshot_key)}` : null,
    }));
    return new Response(JSON.stringify(rows, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename=poseidon-training-${new Date().toISOString().slice(0,10)}.json`, "cache-control": "no-store" } });
  }

  if (path === "/api/demo/simulate" && method === "POST") {
    const body = await readJson(request).catch(() => ({}));
    const devices = await getDevices(env);
    if (!devices.length) return error("시뮬레이션할 장치가 없습니다.");
    const device = devices.find((item) => item.id === body.deviceId) || devices[0];
    const samples = [
      ["DANGER_ZONE_ENTRY", "위험구역", "high", "출입 제한 구역에 작업자가 진입했습니다."],
      ["HELMET_NOT_DETECTED", "보호구", "high", "안전모 미착용 의심 상황이 감지되었습니다."],
      ["FORKLIFT_APPROACH", "중장비", "high", "지게차가 작업자 통행구역에 접근했습니다."],
      ["FALL_CANDIDATE", "불안전 행동", "critical", "넘어짐 의심 상황이 감지되었습니다."],
    ];
    const selected = samples[Math.floor(Math.random() * samples.length)];
    const id = randomId("evt");
    const now = nowIso();
    await env.DB.prepare(`INSERT INTO events (id,device_id,type,category,severity,message,occurred_at,acknowledged,status,snapshot_key,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,0,'확인 필요',NULL,'{"simulated":true}',?)`).bind(id, device.id, selected[0], selected[1], selected[2], selected[3], now, now).run();
    return json({ ok: true, id });
  }

  return error("API 경로를 찾을 수 없습니다.", 404);
}

async function handleMedia(request, env) {
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  await ensureSchema(env);
  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/media\//, ""));
  if (!key) return error("미디어 키가 없습니다.", 404);
  const row = await env.DB.prepare("SELECT content_type,bytes,byte_length,updated_at FROM media WHERE key=?").bind(key).first();
  if (!row) return error("미디어를 찾을 수 없습니다.", 404);
  const body = new Uint8Array(row.bytes || []);
  const total = body.byteLength;
  const contentType = row.content_type || "application/octet-stream";
  const commonHeaders = { "content-type": contentType, "cache-control": "no-store", "x-media-storage": "d1", "accept-ranges": "bytes" };
  const range = request.headers.get("range");
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const [rawStart, rawEnd] = range.replace("bytes=", "").split("-");
    const start = rawStart ? Math.max(0, Number(rawStart)) : 0;
    const end = rawEnd ? Math.min(total - 1, Number(rawEnd)) : total - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
      return new Response(null, { status: 416, headers: { ...commonHeaders, "content-range": `bytes */${total}` } });
    }
    const slice = body.slice(start, end + 1);
    return new Response(slice, { status: 206, headers: { ...commonHeaders, "content-length": String(slice.byteLength), "content-range": `bytes ${start}-${end}/${total}` } });
  }
  return new Response(body, { headers: { ...commonHeaders, "content-length": String(total) } });
}

async function proxyModel(request, ctx, modelUrl, cachePath, filename, errorMessage) {
  const cache = caches.default;
  const cacheKey = new Request(new URL(cachePath, request.url), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const upstream = await fetch(modelUrl, { redirect: "follow", headers: { "user-agent": "POSEIDON-AI-Safety/6.4" } });
  if (!upstream.ok) return error(errorMessage, 502, `upstream ${upstream.status}`);
  const headers = new Headers(upstream.headers);
  headers.set("content-type", "application/octet-stream");
  headers.set("cache-control", "public, max-age=86400, s-maxage=604800");
  headers.set("content-disposition", `inline; filename=${filename}`);
  headers.delete("set-cookie");
  const response = new Response(upstream.body, { status: 200, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
  return response;
}

async function handlePpeModel(request, env, ctx) {
  const modelUrl = env.PPE_MODEL_URL || "https://huggingface.co/ayushgupta7777/safetyvision-yolov8/resolve/main/v2/best_640.onnx";
  return proxyModel(request, ctx, modelUrl, "/models/ppe.onnx", "ppe.onnx", "보호구 모델을 불러오지 못했습니다.");
}

async function handlePersonModel(request, env, ctx) {
  const modelUrl = env.YOLO11N_MODEL_URL || "https://huggingface.co/webnn/yolo11n/resolve/main/onnx/yolo11n.onnx";
  return proxyModel(request, ctx, modelUrl, "/models/person.onnx", "yolo11n.onnx", "YOLO11n 사람 감지 모델을 불러오지 못했습니다.");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS", "access-control-allow-headers": "content-type,authorization", "access-control-allow-credentials": "true" } });
    try {
      if (url.pathname === "/models/ppe.onnx") return await handlePpeModel(request, env, ctx);
      if (url.pathname === "/models/person.onnx") return await handlePersonModel(request, env, ctx);
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, ctx);
      if (url.pathname.startsWith("/media/")) return await handleMedia(request, env);
      const assetResponse = await env.ASSETS.fetch(request);
      const headers = new Headers(assetResponse.headers);
      headers.set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)");
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
      if (url.pathname === "/" || !url.pathname.includes(".")) headers.set("Cache-Control", "no-cache");
      return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
    } catch (err) {
      console.error(err);
      return error("서버 처리 중 오류가 발생했습니다.", 500, String(err?.message || err));
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      await ensureSchema(env);
      const settings = await getEventRetentionSettings(env);
      if (settings.enabled) {
        const result = await cleanupEventsOlderThan(env, settings.days);
        console.log(`POSEIDON event retention cleanup: ${result.deleted} deleted, ${settings.days} days retained`);
      }
      const dSafetySettings = await getDSafetyRetentionSettings(env);
      if (dSafetySettings.enabled) {
        const result = await cleanupDSafetyOlderThan(env, dSafetySettings.days);
        console.log(`POSEIDON D-safety retention cleanup: ${result.deleted} deleted, ${dSafetySettings.days} days retained`);
      }
    })());
  },
};
