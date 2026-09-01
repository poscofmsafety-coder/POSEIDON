const POSEIDON_BUILD = "6.1.0";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isMobile = () => matchMedia("(max-width: 820px)").matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

const pageTitles = {
  overview: "통합 대시보드",
  guard: "현장 지킴이",
  live: "실시간 관제",
  devices: "장치 관리",
  zones: "위험구역 설정",
  ppe: "근로자 보호구",
  behavior: "불안전 행동",
  environment: "작업환경",
  equipment: "중장비",
  events: "이벤트 센터",
  reports: "리포트",
  settings: "설정",
  "user-help": "사용 안내",
};

const ruleGroups = {
  ppe: [
    ["helmet", "안전모", "안전모와 미착용 상태를 감지하고 한국어 음성으로 안내합니다.", true],
    ["safetyGlasses", "보안경", "보안경과 미착용 의심 상태를 감지합니다.", true],
    ["mask", "마스크", "마스크 착용·미착용·판정불가 상태를 감지합니다.", true],
    ["harness", "안전대", "안전대 미착용 의심 상태를 확인합니다.", false],
    ["hookConnected", "안전대 후크 체결", "현장 전용 학습모델 연결을 위한 확장 규칙입니다.", false],
  ],
  behavior: [
    ["dangerZone", "위험구역 진입", "작업자의 발 위치가 설정 구역 안으로 들어오면 경고합니다.", true],
    ["fall", "넘어짐 의심", "넘어짐 객체가 반복 감지되면 관리자 확인을 요청합니다.", true],
    ["unsafePosture", "불안전 자세", "작업 자세 이상을 확인하는 확장 규칙입니다.", false],
    ["longStay", "위험구역 장시간 체류", "지정 시간 이상 체류한 작업자를 경고합니다.", false],
  ],
  environment: [
    ["obstacle", "통로 장애물", "통로 내 장애물·적치물을 확인하는 확장 규칙입니다.", false],
    ["blockedAisle", "안전통로 점유", "안전통로 침범 상태를 확인합니다.", false],
    ["smoke", "연기", "연기 발생 의심 장면을 관리자에게 알립니다.", false],
    ["fire", "화재", "화염 의심 장면을 관리자에게 알립니다.", false],
  ],
  equipment: [
    ["forklift", "지게차", "지게차 접근 시 ‘지게차가 지나갑니다’ 음성 경고를 제공합니다.", false],
    ["heavyEquipmentProximity", "중장비 근접", "작업자와 중장비의 안전거리 이탈을 확인합니다.", false],
    ["crane", "크레인·인양물", "인양반경 내 작업자 접근을 확인하는 확장 규칙입니다.", false],
    ["agv", "AGV·운반차", "무인운반차 동선과 작업자 접근을 확인합니다.", false],
  ],
};

const defaultConfig = () => ({
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
});

const state = {
  session: null,
  currentPage: "overview",
  summary: null,
  devices: [],
  events: [],
  dashboardTimer: null,
  iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
  zonePoints: [],
  zoneConfig: null,
  zoneBackground: null,
  rtc: { relayConfigured: false, iceServerCount: 1 },
};

const realtime = {
  adminSignals: new Map(),
  adminVideoPeers: new Map(),
  adminRemoteStreams: new Map(),
  guardVideoPeers: new Map(),
  pendingIce: new Map(),
};

const guard = {
  active: false,
  starting: false,
  stream: null,
  signal: null,
  config: defaultConfig(),
  worker: null,
  modelReady: false,
  inferenceBusy: false,
  inferenceTimer: null,
  personWorker: null,
  personModelReady: false,
  personInferenceBusy: false,
  personInferenceTimer: null,
  personDetections: [],
  personInferenceFps: 0,
  mobileInferenceCanvas: null,
  heartbeatTimer: null,
  configTimer: null,
  previewTimer: null,
  peopleCount: 0,
  inferenceFps: 0,
  detections: [],
  currentRisk: "정상",
  viewerCount: 0,
  streaks: new Map(),
  lastEvents: new Map(),
  warningTimer: null,
  modelError: null,
  latestAssessments: [],
  latestSourceWidth: 0,
  latestSourceHeight: 0,
  trainingSavedCount: Number(localStorage.getItem("poseidon_training_saved") || 0),
  autoTraining: {
    active: false,
    intervalTimer: null,
    uiTimer: null,
    startedAt: 0,
    durationSeconds: 30,
    intervalSeconds: 2,
    saved: 0,
    skipped: 0,
    errors: 0,
    busy: false,
    lastFingerprint: null,
    labels: null,
  },
  trainingStorage: { deviceBytes: 0, globalBytes: 0, deviceSamples: 0, globalSamples: 0 },
};

const callState = {
  status: "idle",
  direction: null,
  deviceId: null,
  peerId: null,
  signal: null,
  callId: null,
  pc: null,
  localStream: null,
  localTrack: null,
  remoteStream: null,
  ringTimer: null,
  audioContext: null,
  connectTimer: null,
  disconnectTimer: null,
  remoteAudioBlocked: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uuid(prefix = "id") {
  return `${prefix}-${crypto.randomUUID()}`;
}

function formatDate(value, withDate = true) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    ...(withDate ? { month: "2-digit", day: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function toast(message, duration = 3200) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  $("#toastContainer").append(item);
  setTimeout(() => item.remove(), duration);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof Blob) && !(options.body instanceof ArrayBuffer) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...options, headers, credentials: "include" });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : await response.text();
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    showLogin(state.session?.role || "admin");
    throw new Error("로그인이 만료되었습니다.");
  }
  if (!response.ok) throw new Error(payload?.error || payload?.message || String(payload) || `HTTP ${response.status}`);
  return payload?.data ?? payload;
}

function showLogin(role = "admin") {
  state.session = null;
  $("#appShell").hidden = true;
  $("#loginScreen").hidden = false;
  setLoginRole(role);
  $("#loginPin").value = "";
  setTimeout(() => $("#loginPin").focus(), 50);
}

function setLoginRole(role) {
  $("#loginRole").value = role;
  $$('[data-login-role]').forEach((button) => button.classList.toggle("active", button.dataset.loginRole === role));
  $("#loginHelp").textContent = role === "admin"
    ? "관리자용 통합관제 화면으로 접속합니다."
    : "현장 카메라와 무전 기능을 사용하는 사용자 화면으로 접속합니다.";
}

async function restoreSession() {
  try {
    const session = await api("/api/auth/me");
    applySession(session);
  } catch {
    const preferred = new URL(location.href).searchParams.get("mode") === "user" || location.pathname.startsWith("/guard") ? "user" : "admin";
    showLogin(preferred);
  }
}

function applySession(session) {
  state.session = session;
  $("#loginScreen").hidden = true;
  $("#appShell").hidden = false;
  const isAdmin = session.role === "admin";
  $$(".admin-only").forEach((element) => { element.hidden = !isAdmin; });
  $$(".user-only").forEach((element) => { element.hidden = isAdmin; });
  $("#roleBadge").textContent = isAdmin ? "관리자" : "현장 사용자";
  goToPage(isAdmin ? "overview" : "guard");
  if (isAdmin) {
    loadDashboard();
    startDashboardPolling();
  } else {
    stopDashboardPolling();
    loadGuardProfile();
  }
}

async function login(event) {
  event.preventDefault();
  const button = $("#loginButton");
  button.disabled = true;
  try {
    const session = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ role: $("#loginRole").value, pin: $("#loginPin").value }),
    });
    unlockAudio();
    applySession(session);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* noop */ }
  stopDashboardPolling();
  closeAllAdminSignals();
  if (guard.active) await stopGuard();
  endCall(false);
  showLogin("admin");
}

function goToPage(page) {
  if (!pageTitles[page]) return;
  if (state.session?.role === "user" && !["guard", "user-help"].includes(page)) page = "guard";
  state.currentPage = page;
  $$(".page").forEach((section) => section.classList.toggle("active", section.id === `page-${page}`));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  $("#pageTitle").textContent = pageTitles[page];
  document.body.classList.remove("sidebar-open");
  if (state.session?.role === "admin") {
    syncAdminWatchRequests();
    if (page === "zones") prepareZoneEditor();
    if (["ppe", "behavior", "environment", "equipment"].includes(page)) loadRuleEditor(page);
    if (page === "reports") renderReports();
    if (page === "events") loadEventRetentionSettings();
  }
}

function updateClock() {
  const now = new Date();
  $("#clock").textContent = `${new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(now)}\n${new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now)}`;
}

function startDashboardPolling() {
  stopDashboardPolling();
  state.dashboardTimer = setInterval(() => loadDashboard(true), 15000);
}

function stopDashboardPolling() {
  clearInterval(state.dashboardTimer);
  state.dashboardTimer = null;
}

async function loadDashboard(silent = false) {
  if (state.session?.role !== "admin") return;
  if (!silent) document.body.classList.add("loading");
  try {
    const [summary, devices, events] = await Promise.all([
      api("/api/dashboard/summary"),
      api("/api/devices"),
      api("/api/events?limit=120"),
    ]);
    state.summary = summary;
    state.devices = devices;
    state.events = events;
    renderKpis();
    reconcileDeviceCards($("#overviewDevices"), false);
    reconcileDeviceCards($("#liveDevices"), true);
    renderDevicesTable();
    renderEvents();
    renderCategoryChart();
    renderBriefing();
    updateDeviceSelects();
    reconcileAdminSignals();
  } catch (error) {
    toast(`관제 데이터 오류: ${error.message}`);
  } finally {
    document.body.classList.remove("loading");
  }
}

function renderKpis() {
  const s = state.summary || {};
  const cards = [
    [`${s.online || 0}/${s.totalDevices || 0}`, "정상 연결"],
    [s.people || 0, "AI 감지 인원"],
    [s.todayEvents || 0, "최근 24시간"],
    [s.highRisk || 0, "고위험 이벤트"],
    [s.unacknowledged || 0, "관리자 조치 필요"],
  ];
  $("#kpiGrid").innerHTML = cards.map(([value, label]) => `<article class="kpi-card"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></article>`).join("");
}

function deviceCardMarkup(device, live) {
  return `<article class="device-card" data-device-id="${escapeHtml(device.id)}" data-live="${live ? "1" : "0"}">
    <div class="device-media">
      <img class="device-preview" alt="${escapeHtml(device.name)} 최근 프리뷰" />
      <video class="device-video" autoplay muted playsinline></video>
      <div class="media-placeholder"><div>카메라 연결 대기<br /><small>지킴이 시작 후 실시간 영상이 표시됩니다.</small></div></div>
      <span class="connection-badge"></span>
      <span class="viewer-badge">WebRTC 대기</span>
      <span class="connection-note">실시간 연결 준비 중</span>
    </div>
    <div class="device-body">
      <div class="device-title-row"><div><h4></h4><p></p></div><span class="device-risk"></span></div>
      <div class="device-stats"><div><span>FPS</span><b data-stat="fps">0</b></div><div><span>작업자</span><b data-stat="people">0명</b></div><div><span>최근 연결</span><b data-stat="seen">-</b></div></div>
      <div class="device-actions"><button class="watch-button" type="button">영상 재연결</button><button class="call-button" type="button">무전 호출</button></div>
    </div>
  </article>`;
}

function reconcileDeviceCards(container, live) {
  if (!container) return;
  const existing = new Map($$(".device-card", container).map((card) => [card.dataset.deviceId, card]));
  for (const device of state.devices) {
    let card = existing.get(device.id);
    if (!card) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = deviceCardMarkup(device, live);
      card = wrapper.firstElementChild;
      container.append(card);
      $(".watch-button", card).addEventListener("click", () => requestWatch(device.id, true));
      $(".call-button", card).addEventListener("click", () => initiateAdminCall(device.id));
    }
    updateDeviceCard(card, device);
    existing.delete(device.id);
  }
  for (const card of existing.values()) card.remove();
  if (!state.devices.length) container.innerHTML = `<div class="panel" style="padding:24px;color:var(--muted)">연결된 현장 장치가 없습니다. 현장 QR로 사용자 모드에 접속해 지킴이를 시작하세요.</div>`;
}

function updateDeviceCard(card, device) {
  $("h4", card).textContent = device.name;
  $(".device-title-row p", card).textContent = `${device.site} · ${device.area}`;
  const risk = $(".device-risk", card);
  risk.textContent = device.currentRisk || "정상";
  risk.classList.toggle("warning", !["정상", "안전"].includes(device.currentRisk));
  $("[data-stat='fps']", card).textContent = Number(device.fps || 0).toFixed(1);
  $("[data-stat='people']", card).textContent = `${device.peopleCount || 0}명`;
  $("[data-stat='seen']", card).textContent = formatDate(device.lastSeen, false);
  const badge = $(".connection-badge", card);
  badge.className = `connection-badge ${device.status === "online" ? "live-badge" : "offline-badge"}`;
  badge.textContent = device.status === "online" ? "● ONLINE" : "○ OFFLINE";
  const preview = $(".device-preview", card);
  if (device.previewUrl) {
    const next = `${device.previewUrl}${device.previewUrl.includes("?") ? "&" : "?"}v=${Date.parse(device.lastSeen || "") || Date.now()}`;
    if (preview.dataset.src !== next) {
      preview.dataset.src = next;
      preview.src = next;
    }
  } else {
    preview.removeAttribute("src");
  }
  attachStreamToCard(card, device.id);
}

function attachStreamToCard(card, deviceId) {
  const video = $(".device-video", card);
  const stream = realtime.adminRemoteStreams.get(deviceId);
  const note = $(".connection-note", card);
  const viewer = $(".viewer-badge", card);
  if (stream) {
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
    video.hidden = false;
    note.hidden = true;
    viewer.textContent = "● 실시간 영상";
  } else {
    video.hidden = true;
    note.hidden = false;
    viewer.textContent = state.devices.find((item) => item.id === deviceId)?.status === "online" ? "WebRTC 연결 중" : "장치 오프라인";
    note.textContent = state.devices.find((item) => item.id === deviceId)?.status === "online" ? "실시간 연결 준비 중" : "최근 프리뷰";
  }
}

function attachStreamEverywhere(deviceId) {
  $$(`.device-card[data-device-id="${CSS.escape(deviceId)}"]`).forEach((card) => attachStreamToCard(card, deviceId));
}

function renderDevicesTable() {
  const body = $("#deviceTableBody");
  if (!body) return;
  body.innerHTML = state.devices.map((device) => `<tr><td><b>${escapeHtml(device.name)}</b><br /><small>${escapeHtml(device.id)}</small></td><td>${escapeHtml(device.site)}<br /><small>${escapeHtml(device.area)}</small></td><td><span class="status-pill ${device.status}">${device.status === "online" ? "온라인" : "오프라인"}</span></td><td>${device.peopleCount || 0}명</td><td>${formatDate(device.lastSeen)}</td><td><button class="table-action" data-device-call="${escapeHtml(device.id)}">무전</button> <button class="table-action" data-device-delete="${escapeHtml(device.id)}">삭제</button></td></tr>`).join("");
  $$('[data-device-call]', body).forEach((button) => button.addEventListener("click", () => initiateAdminCall(button.dataset.deviceCall)));
  $$('[data-device-delete]', body).forEach((button) => button.addEventListener("click", () => deleteDevice(button.dataset.deviceDelete)));
}

function renderEvents() {
  const events = state.events || [];
  const overview = $("#overviewEvents");
  if (overview) {
    overview.innerHTML = events.slice(0, 7).map((event) => `<div class="event-item"><time>${formatDate(event.occurredAt)}</time><span class="event-device">${escapeHtml(event.deviceName)}</span><span>${escapeHtml(event.message)}</span><span class="severity-pill ${escapeHtml(event.severity)}">${severityLabel(event.severity)}</span></div>`).join("") || `<div class="event-item">최근 이벤트가 없습니다.</div>`;
  }
  renderEventTable();
}

function severityLabel(value) {
  return value === "critical" ? "긴급" : value === "high" ? "위험" : "주의";
}

function renderEventTable() {
  const body = $("#eventTableBody");
  if (!body) return;
  const deviceFilter = $("#eventDeviceFilter")?.value || "";
  const categoryFilter = $("#eventCategoryFilter")?.value || "";
  const severityFilter = $("#eventSeverityFilter")?.value || "";
  const items = state.events.filter((event) => (!deviceFilter || event.deviceId === deviceFilter) && (!categoryFilter || event.category === categoryFilter) && (!severityFilter || event.severity === severityFilter));
  body.innerHTML = items.map((event) => `<tr><td>${formatDate(event.occurredAt)}</td><td>${escapeHtml(event.deviceName)}</td><td>${escapeHtml(event.category)}</td><td><span class="severity-pill ${escapeHtml(event.severity)}">${severityLabel(event.severity)}</span></td><td>${event.snapshotUrl ? `<a href="${escapeHtml(event.snapshotUrl)}" target="_blank" rel="noopener">${escapeHtml(event.message)}</a>` : escapeHtml(event.message)}</td><td>${escapeHtml(event.status)}</td><td><div class="event-actions">${event.acknowledged ? "<span>완료</span>" : `<button class="table-action" data-event-ack="${escapeHtml(event.id)}">확인 완료</button>`}<button class="table-action danger-action" data-event-delete="${escapeHtml(event.id)}">삭제</button></div></td></tr>`).join("") || `<tr><td colspan="7">조회된 이벤트가 없습니다.</td></tr>`;
  $$('[data-event-ack]', body).forEach((button) => button.addEventListener("click", () => acknowledgeEvent(button.dataset.eventAck)));
  $$('[data-event-delete]', body).forEach((button) => button.addEventListener("click", () => deleteEvent(button.dataset.eventDelete)));
}

function renderCategoryChart() {
  const counts = state.summary?.categoryCounts || {};
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  $("#categoryChart").innerHTML = entries.map(([name, count]) => `<div class="category-row"><span>${escapeHtml(name)}</span><div class="category-bar"><i style="width:${Math.max(5, count / max * 100)}%"></i></div><b>${count}</b></div>`).join("") || `<div style="color:var(--muted)">오늘 발생한 이벤트가 없습니다.</div>`;
}

function renderBriefing() {
  const s = state.summary || {};
  const top = Object.entries(s.categoryCounts || {}).sort((a, b) => b[1] - a[1])[0];
  const main = s.highRisk > 0 ? `현재 <b>${s.highRisk}건의 고위험 이벤트</b>가 확인되었습니다. 현장 무전과 이벤트 확인 기능을 이용해 조치 여부를 점검하세요.` : `현재 연결된 현장은 <b>안정 상태</b>입니다. 실시간 영상과 보호구 AI가 지속적으로 현장을 확인합니다.`;
  const points = [top ? `오늘 가장 많이 발생한 유형은 ‘${top[0]}’ ${top[1]}건입니다.` : "오늘 누적 이벤트가 없습니다.", `${s.online || 0}대의 현장 지킴이가 중앙 관제에 연결되어 있습니다.`, s.unacknowledged ? `확인이 필요한 이벤트가 ${s.unacknowledged}건 남아 있습니다.` : "모든 이벤트가 확인된 상태입니다."];
  $("#aiBriefing").innerHTML = `<div class="brief-main">${main}</div><div class="ai-points">${points.map((point) => `<div class="ai-point"><i></i><span>${escapeHtml(point)}</span></div>`).join("")}</div>`;
}

function updateDeviceSelects() {
  const options = state.devices.map((device) => `<option value="${escapeHtml(device.id)}">${escapeHtml(device.name)} · ${escapeHtml(device.area)}</option>`).join("");
  [$("#zoneDeviceSelect"), ...$$(".rule-device-select")].filter(Boolean).forEach((select) => {
    const before = select.value;
    select.innerHTML = options || `<option value="">장치 없음</option>`;
    if (state.devices.some((device) => device.id === before)) select.value = before;
  });
  const filter = $("#eventDeviceFilter");
  if (filter) {
    const before = filter.value;
    filter.innerHTML = `<option value="">전체 장치</option>${options}`;
    filter.value = before;
  }
}

async function acknowledgeEvent(id) {
  try {
    await api(`/api/events/${encodeURIComponent(id)}/ack`, { method: "POST", body: JSON.stringify({ status: "확인 완료" }) });
    toast("이벤트를 확인 완료 처리했습니다.");
    await loadDashboard(true);
  } catch (error) { toast(error.message); }
}

async function deleteDevice(id) {
  if (!confirm("장치와 관련 이벤트를 삭제하시겠습니까?")) return;
  try {
    await api(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
    closeAdminSignal(id);
    await loadDashboard(true);
  } catch (error) { toast(error.message); }
}

async function simulateEvent() {
  try {
    await api("/api/demo/simulate", { method: "POST", body: "{}" });
    toast("시연용 위험 이벤트를 생성했습니다.");
    await loadDashboard(true);
  } catch (error) { toast(error.message); }
}

async function loadEventRetentionSettings() {
  if (state.session?.role !== "admin" || !$("#eventRetentionDays")) return;
  try {
    const data = await api("/api/events/settings");
    state.eventRetention = data;
    $("#eventRetentionEnabled").checked = data.enabled !== false;
    $("#eventRetentionDays").value = String(data.days || 30);
    $("#eventRetentionStats").textContent = `현재 ${data.eventCount || 0}건 · 스냅숏 ${formatTrainingBytes(data.snapshotBytes || 0)} · 매일 자동 정리`;
  } catch (error) {
    $("#eventRetentionStats").textContent = `보관설정 조회 실패: ${error.message}`;
  }
}

async function saveEventRetentionSettings() {
  try {
    const days = Math.min(365, Math.max(1, Number($("#eventRetentionDays").value || 30)));
    const enabled = $("#eventRetentionEnabled").checked;
    const data = await api("/api/events/settings", { method: "PUT", body: JSON.stringify({ days, enabled }) });
    toast(`이벤트 자동정리: ${enabled ? `${days}일 보관` : "사용 안 함"}`);
    state.eventRetention = data;
    await loadEventRetentionSettings();
  } catch (error) { toast(error.message); }
}

async function cleanupExpiredEvents() {
  const days = Math.min(365, Math.max(1, Number($("#eventRetentionDays").value || 30)));
  if (!confirm(`${days}일이 지난 이벤트와 스냅숏을 지금 삭제할까요?`)) return;
  try {
    const result = await api("/api/events/cleanup", { method: "POST", body: JSON.stringify({ days }) });
    toast(`${result.deleted || 0}건을 정리했습니다.`);
    await loadDashboard(true);
    await loadEventRetentionSettings();
  } catch (error) { toast(error.message); }
}

async function deleteEvent(id) {
  if (!confirm("이 이벤트와 연결된 스냅숏을 삭제할까요?")) return;
  try {
    await api(`/api/events/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.events = state.events.filter((event) => event.id !== id);
    renderEvents();
    await loadEventRetentionSettings();
    toast("이벤트를 삭제했습니다.");
  } catch (error) { toast(error.message); }
}

async function deleteAllEvents() {
  if (!confirm("이벤트 센터의 모든 이벤트와 이벤트 스냅숏을 삭제합니다. 학습데이터는 삭제되지 않습니다. 계속할까요?")) return;
  if (!confirm("정말 전체 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
  try {
    const result = await api("/api/events", { method: "DELETE" });
    toast(`${result.deleted || 0}건을 삭제했습니다.`);
    await loadDashboard(true);
    await loadEventRetentionSettings();
  } catch (error) { toast(error.message); }
}

/* ---------- WebRTC signaling ---------- */

async function loadIceServers() {
  try {
    const result = await api("/api/ice");
    if (Array.isArray(result.iceServers) && result.iceServers.length) state.iceServers = result.iceServers;
  } catch { /* STUN default remains */ }
  state.rtc.iceServerCount = state.iceServers.length;
  state.rtc.relayConfigured = state.iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.filter(Boolean).some((url) => String(url).startsWith("turn:" ) || String(url).startsWith("turns:"));
  });
}

function websocketUrl(deviceId, role, clientId) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/api/realtime/${encodeURIComponent(deviceId)}?role=${encodeURIComponent(role)}&clientId=${encodeURIComponent(clientId)}`;
}

function createSignal(deviceId, role, onMessage) {
  const signal = {
    deviceId,
    role,
    clientId: uuid(role),
    ws: null,
    peers: new Map(),
    closed: false,
    reconnectTimer: null,
    send(message) {
      if (this.ws?.readyState !== WebSocket.OPEN) return false;
      try {
        this.ws.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    },
    close() {
      this.closed = true;
      clearTimeout(this.reconnectTimer);
      try { this.ws?.close(1000, "closed"); } catch { /* noop */ }
    },
  };

  const connect = () => {
    if (signal.closed || !state.session) return;
    const ws = new WebSocket(websocketUrl(deviceId, role, signal.clientId));
    signal.ws = ws;
    ws.onopen = () => {
      signal.send({ type: "hello", deviceId, role });
      if (role === "admin" && shouldWatchDevice(deviceId)) setTimeout(() => requestWatch(deviceId), 100);
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "connected" || message.type === "peers") {
          signal.peers.clear();
          for (const peer of message.peers || []) signal.peers.set(peer.clientId, peer);
        } else if (message.type === "peer-joined" && message.clientId) {
          signal.peers.set(message.clientId, { clientId: message.clientId, role: message.role });
        } else if (message.type === "peer-left" && message.clientId) {
          signal.peers.delete(message.clientId);
          cleanupPeer(deviceId, message.clientId);
        }
        onMessage(signal, message);
      } catch (error) { console.warn("signal message", error); }
    };
    ws.onclose = () => {
      if (!signal.closed && state.session) signal.reconnectTimer = setTimeout(connect, 2200);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
  };
  connect();
  return signal;
}

function reconcileAdminSignals() {
  if (state.session?.role !== "admin") return;
  const onlineIds = new Set(state.devices.filter((device) => device.status === "online").map((device) => device.id));
  for (const deviceId of onlineIds) {
    if (!realtime.adminSignals.has(deviceId)) {
      realtime.adminSignals.set(deviceId, createSignal(deviceId, "admin", handleAdminSignalMessage));
    }
  }
  for (const deviceId of realtime.adminSignals.keys()) {
    if (!onlineIds.has(deviceId)) closeAdminSignal(deviceId);
  }
  syncAdminWatchRequests();
}

function closeAdminSignal(deviceId) {
  realtime.adminSignals.get(deviceId)?.close();
  realtime.adminSignals.delete(deviceId);
  closeAdminVideoPeer(deviceId);
}

function closeAllAdminSignals() {
  for (const deviceId of [...realtime.adminSignals.keys()]) closeAdminSignal(deviceId);
}

function shouldWatchDevice(deviceId) {
  if (state.session?.role !== "admin") return false;
  if (!["overview", "live", "zones"].includes(state.currentPage)) return false;
  const online = state.devices.filter((device) => device.status === "online").slice(0, state.currentPage === "live" ? 6 : 4);
  return online.some((device) => device.id === deviceId);
}

function syncAdminWatchRequests() {
  for (const [deviceId, signal] of realtime.adminSignals) {
    if (shouldWatchDevice(deviceId)) requestWatch(deviceId);
    else signal.send({ type: "watch-stop" });
  }
}

function requestWatch(deviceId, force = false) {
  const signal = realtime.adminSignals.get(deviceId);
  if (!signal) return;
  const existing = realtime.adminVideoPeers.get(deviceId)?.pc;
  if (!force && existing && !["failed", "closed"].includes(existing.connectionState)) return;
  if (force) closeAdminVideoPeer(deviceId);
  signal.send({ type: "watch-start" });
  $$(`.device-card[data-device-id="${CSS.escape(deviceId)}"] .connection-note`).forEach((element) => { element.textContent = "WebRTC 실시간 영상 연결 중"; element.hidden = false; });
}

function createPeerConnection() {
  return new RTCPeerConnection({ iceServers: state.iceServers, iceCandidatePoolSize: 2 });
}

function pcKey(channel, deviceId, peerId, callId = "") {
  return `${channel}:${deviceId}:${peerId}:${callId}`;
}

function queueIce(key, candidate) {
  if (!realtime.pendingIce.has(key)) realtime.pendingIce.set(key, []);
  realtime.pendingIce.get(key).push(candidate);
}

async function flushIce(key, pc) {
  const candidates = realtime.pendingIce.get(key) || [];
  realtime.pendingIce.delete(key);
  for (const candidate of candidates) {
    try { await pc.addIceCandidate(candidate); } catch { /* noop */ }
  }
}

async function handleAdminSignalMessage(signal, message) {
  if (message.type === "peer-joined" && message.role === "guard" && shouldWatchDevice(signal.deviceId)) signal.send({ type: "watch-start", to: message.clientId });
  if (message.type === "offer" && message.channel === "video") await acceptAdminVideoOffer(signal, message);
  if (message.type === "ice" && message.channel === "video") await handleAdminVideoIce(signal, message);
  if (["call-request", "call-accept", "call-reject", "call-offer", "call-answer", "call-ice", "call-end", "call-busy"].includes(message.type)) await handleCallSignal(signal, message);
}

async function acceptAdminVideoOffer(signal, message) {
  closeAdminVideoPeer(signal.deviceId);
  const pc = createPeerConnection();
  realtime.adminVideoPeers.set(signal.deviceId, { pc, peerId: message.from });
  const key = pcKey("video", signal.deviceId, message.from);
  pc.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    realtime.adminRemoteStreams.set(signal.deviceId, stream);
    attachStreamEverywhere(signal.deviceId);
    if (state.currentPage === "zones") drawZoneCanvas();
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) signal.send({ type: "ice", channel: "video", candidate: event.candidate, to: message.from });
  };
  pc.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      realtime.adminRemoteStreams.delete(signal.deviceId);
      attachStreamEverywhere(signal.deviceId);
    }
  };
  await pc.setRemoteDescription(message.description);
  await flushIce(key, pc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  signal.send({ type: "answer", channel: "video", description: pc.localDescription, to: message.from });
}

async function handleAdminVideoIce(signal, message) {
  const record = realtime.adminVideoPeers.get(signal.deviceId);
  const key = pcKey("video", signal.deviceId, message.from);
  if (!record?.pc?.remoteDescription) queueIce(key, message.candidate);
  else try { await record.pc.addIceCandidate(message.candidate); } catch { /* noop */ }
}

function closeAdminVideoPeer(deviceId) {
  const record = realtime.adminVideoPeers.get(deviceId);
  try { record?.pc?.close(); } catch { /* noop */ }
  realtime.adminVideoPeers.delete(deviceId);
  realtime.adminRemoteStreams.delete(deviceId);
  attachStreamEverywhere(deviceId);
}

function cleanupPeer(deviceId, peerId) {
  const admin = realtime.adminVideoPeers.get(deviceId);
  if (admin?.peerId === peerId) closeAdminVideoPeer(deviceId);
  const guardPc = realtime.guardVideoPeers.get(peerId);
  if (guardPc) {
    try { guardPc.close(); } catch { /* noop */ }
    realtime.guardVideoPeers.delete(peerId);
    updateGuardViewerCount();
  }
  if (callState.peerId === peerId) endCall(false);
}

async function handleGuardSignalMessage(signal, message) {
  if (message.type === "watch-start" && message.from) await createGuardVideoOffer(signal, message.from);
  if (message.type === "watch-stop" && message.from) closeGuardVideoPeer(message.from);
  if (message.type === "answer" && message.channel === "video") await acceptGuardVideoAnswer(message);
  if (message.type === "ice" && message.channel === "video") await handleGuardVideoIce(message);
  if (["call-request", "call-accept", "call-reject", "call-offer", "call-answer", "call-ice", "call-end", "call-busy"].includes(message.type)) await handleCallSignal(signal, message);
}

async function createGuardVideoOffer(signal, adminPeerId) {
  if (!guard.active || !guard.stream) return;
  const existing = realtime.guardVideoPeers.get(adminPeerId);
  if (existing && !["failed", "closed"].includes(existing.connectionState)) return;
  closeGuardVideoPeer(adminPeerId);
  const pc = createPeerConnection();
  realtime.guardVideoPeers.set(adminPeerId, pc);
  for (const track of guard.stream.getVideoTracks()) pc.addTrack(track, guard.stream);
  const key = pcKey("video", getGuardDeviceId(), adminPeerId);
  pc.onicecandidate = (event) => {
    if (event.candidate) signal.send({ type: "ice", channel: "video", candidate: event.candidate, to: adminPeerId });
  };
  pc.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) closeGuardVideoPeer(adminPeerId);
    updateGuardViewerCount();
  };
  const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
  await pc.setLocalDescription(offer);
  signal.send({ type: "offer", channel: "video", description: pc.localDescription, to: adminPeerId });
  updateGuardViewerCount();
}

async function acceptGuardVideoAnswer(message) {
  const pc = realtime.guardVideoPeers.get(message.from);
  if (!pc) return;
  await pc.setRemoteDescription(message.description);
  await flushIce(pcKey("video", getGuardDeviceId(), message.from), pc);
}

async function handleGuardVideoIce(message) {
  const pc = realtime.guardVideoPeers.get(message.from);
  const key = pcKey("video", getGuardDeviceId(), message.from);
  if (!pc?.remoteDescription) queueIce(key, message.candidate);
  else try { await pc.addIceCandidate(message.candidate); } catch { /* noop */ }
}

function closeGuardVideoPeer(peerId) {
  const pc = realtime.guardVideoPeers.get(peerId);
  try { pc?.close(); } catch { /* noop */ }
  realtime.guardVideoPeers.delete(peerId);
  updateGuardViewerCount();
}

function updateGuardViewerCount() {
  guard.viewerCount = [...realtime.guardVideoPeers.values()].filter((pc) => ["connected", "connecting", "new"].includes(pc.connectionState)).length;
  $("#guardViewerMetric").textContent = `${guard.viewerCount}명 연결`;
}

/* ---------- Two-way radio ---------- */

function unlockAudio() {
  try {
    callState.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    callState.audioContext.resume().catch(() => {});
  } catch { /* noop */ }
}

function beep(frequency = 880, duration = 0.16, volume = 0.08) {
  unlockAudio();
  const context = callState.audioContext;
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = frequency;
  gain.gain.value = volume;
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  oscillator.stop(context.currentTime + duration);
}

function startRinging() {
  stopRinging();
  beep(880, .18, .1);
  callState.ringTimer = setInterval(() => { beep(880, .16, .08); setTimeout(() => beep(1120, .16, .07), 220); }, 1200);
}

function stopRinging() {
  clearInterval(callState.ringTimer);
  callState.ringTimer = null;
}

function showCallModal(mode, title, description) {
  $("#callModal").hidden = false;
  $("#callTitle").textContent = title;
  $("#callDescription").textContent = description;
  $("#incomingCallActions").hidden = mode !== "incoming";
  $("#activeCallActions").hidden = mode !== "active";
  if (mode !== "active") $("#remoteAudioUnlock").hidden = true;
  $("#callOrb").className = `call-orb ${mode === "incoming" || mode === "outgoing" ? "ringing" : mode === "active" ? "connected" : ""}`;
}

function hideCallModal() {
  $("#callModal").hidden = true;
  $("#floatingCallAlert").hidden = true;
}

function findPeer(signal, role) {
  return [...signal.peers.values()].find((peer) => peer.role === role)?.clientId || null;
}

async function initiateAdminCall(deviceId) {
  const signal = realtime.adminSignals.get(deviceId);
  if (!signal) return toast("현장 장치가 온라인 상태가 아닙니다.");
  const peerId = findPeer(signal, "guard");
  if (!peerId) return toast("현장 지킴이 연결을 찾지 못했습니다. 지킴이 화면이 켜져 있는지 확인해주세요.");
  try {
    await ensureCallMicrophone();
    beginOutgoingCall(signal, peerId, deviceId, state.devices.find((item) => item.id === deviceId)?.name || "현장 장치");
  } catch (error) {
    toast(`무전용 마이크를 사용할 수 없습니다: ${error.message}`, 5000);
  }
}

async function initiateGuardCall() {
  const signal = guard.signal;
  if (!signal) return toast("관제 서버 연결이 필요합니다.");
  const peerId = findPeer(signal, "admin");
  if (!peerId) return toast("현재 접속 중인 관리자가 없습니다.");
  try {
    await ensureCallMicrophone();
    beginOutgoingCall(signal, peerId, getGuardDeviceId(), "관제센터");
  } catch (error) {
    toast(`무전용 마이크를 사용할 수 없습니다: ${error.message}`, 5000);
  }
}

function beginOutgoingCall(signal, peerId, deviceId, targetName) {
  if (callState.status !== "idle") return toast("이미 다른 무전 통화가 진행 중입니다.");
  callState.status = "outgoing";
  callState.direction = "outgoing";
  callState.signal = signal;
  callState.peerId = peerId;
  callState.deviceId = deviceId;
  callState.callId = uuid("call");
  const sent = signal.send({ type: "call-request", to: peerId, callId: callState.callId, deviceId });
  if (!sent) {
    endCall(false);
    return toast("무전 신호 연결이 아직 준비되지 않았습니다. 2~3초 뒤 다시 호출해주세요.", 5000);
  }
  startRinging();
  showCallModal("outgoing", `${targetName} 호출 중`, "상대방이 응답하면 무전 통화가 연결됩니다.");
  clearTimeout(callState.connectTimer);
  callState.connectTimer = setTimeout(() => {
    if (["outgoing", "connecting"].includes(callState.status)) {
      toast("무전 응답/연결 시간이 초과되었습니다. 상대 장치의 브라우저와 네트워크를 확인해주세요.", 6000);
      endCall(true);
    }
  }, 20000);
}

async function handleCallSignal(signal, message) {
  if (message.type === "call-request") {
    if (callState.status !== "idle") {
      signal.send({ type: "call-busy", to: message.from, callId: message.callId });
      return;
    }
    callState.status = "incoming";
    callState.direction = "incoming";
    callState.signal = signal;
    callState.peerId = message.from;
    callState.deviceId = signal.deviceId;
    callState.callId = message.callId;
    const deviceName = state.devices.find((item) => item.id === signal.deviceId)?.name || (state.session?.role === "user" ? "관제센터" : "현장 지킴이");
    startRinging();
    showCallModal("incoming", `${deviceName} 무전 호출`, "호출이 도착했습니다. 응답 버튼을 눌러 통화를 연결하세요.");
    $("#floatingCallTitle").textContent = `${deviceName} 호출 수신`;
    $("#floatingCallText").textContent = "무전 통화 응답이 필요합니다.";
    $("#floatingCallAlert").hidden = false;
    if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("스마트 안전지킴이 무전 호출", { body: `${deviceName}에서 연락이 왔습니다.` });
    return;
  }
  if (message.callId && callState.callId && message.callId !== callState.callId) return;
  if (message.type === "call-accept" && callState.status === "outgoing") {
    stopRinging();
    await ensureCallMicrophone();
    await createCallOffer();
  } else if (["call-reject", "call-busy"].includes(message.type)) {
    toast(message.type === "call-busy" ? "상대방이 다른 통화 중입니다." : "상대방이 호출을 거절했습니다.");
    endCall(false);
  } else if (message.type === "call-offer") {
    await receiveCallOffer(message);
  } else if (message.type === "call-answer") {
    if (callState.pc) {
      await callState.pc.setRemoteDescription(message.description);
      await flushIce(pcKey("call", callState.deviceId, callState.peerId, callState.callId), callState.pc);
      callState.status = "connecting";
      showCallModal("outgoing", "무전 연결 확인 중", "음성 경로와 네트워크 연결을 확인하고 있습니다.");
    }
  } else if (message.type === "call-ice") {
    const key = pcKey("call", callState.deviceId, message.from, message.callId);
    if (!callState.pc?.remoteDescription) queueIce(key, message.candidate);
    else try { await callState.pc.addIceCandidate(message.candidate); } catch { /* noop */ }
  } else if (message.type === "call-end") {
    toast("무전 통화가 종료되었습니다.");
    endCall(false);
  }
}

async function ensureCallMicrophone() {
  if (callState.localTrack?.readyState === "live") return;
  if (state.session?.role === "user" && guard.stream?.getAudioTracks().length) {
    callState.localStream = guard.stream;
    callState.localTrack = guard.stream.getAudioTracks()[0];
  } else {
    callState.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    callState.localTrack = callState.localStream.getAudioTracks()[0];
  }
  callState.localTrack.enabled = false;
}

function buildCallPeer() {
  const pc = createPeerConnection();
  callState.pc = pc;
  if (callState.localTrack) pc.addTrack(callState.localTrack, callState.localStream);
  pc.onicecandidate = (event) => {
    if (event.candidate) callState.signal?.send({ type: "call-ice", channel: "call", callId: callState.callId, candidate: event.candidate, to: callState.peerId });
  };
  pc.ontrack = (event) => {
    callState.remoteStream = event.streams[0] || new MediaStream([event.track]);
    const audio = $("#remoteCallAudio");
    audio.srcObject = callState.remoteStream;
    audio.muted = false;
    audio.volume = 1;
    audio.play().then(() => {
      callState.remoteAudioBlocked = false;
      $("#remoteAudioUnlock").hidden = true;
    }).catch(() => {
      callState.remoteAudioBlocked = true;
      $("#remoteAudioUnlock").hidden = false;
      toast("상대방 음성이 차단되었습니다. '상대방 음성 재생'을 눌러주세요.", 6000);
    });
  };
  pc.oniceconnectionstatechange = () => {
    clearTimeout(callState.disconnectTimer);
    if (["connected", "completed"].includes(pc.iceConnectionState)) setCallConnected();
    if (pc.iceConnectionState === "failed") {
      toast(state.rtc.relayConfigured ? "무전 네트워크 연결에 실패했습니다. 다시 호출해주세요." : "무전 P2P 연결에 실패했습니다. 사내망에서는 TURN 서버 설정이 필요할 수 있습니다.", 7000);
      endCall(false);
    } else if (pc.iceConnectionState === "disconnected") {
      callState.disconnectTimer = setTimeout(() => {
        if (pc.iceConnectionState === "disconnected") {
          toast("무전 연결이 끊어졌습니다. 다시 호출해주세요.", 5000);
          endCall(false);
        }
      }, 6000);
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") setCallConnected();
    if (["failed", "closed"].includes(pc.connectionState)) endCall(false);
  };
  pc.onicecandidateerror = (event) => console.warn("radio ICE candidate error", event?.errorText || event);
  return pc;
}

async function createCallOffer() {
  const pc = buildCallPeer();
  const offer = await pc.createOffer({ offerToReceiveAudio: true });
  await pc.setLocalDescription(offer);
  callState.signal.send({ type: "call-offer", channel: "call", callId: callState.callId, description: pc.localDescription, to: callState.peerId });
  showCallModal("outgoing", "무전 연결 중", "음성 채널을 연결하고 있습니다.");
}

async function receiveCallOffer(message) {
  await ensureCallMicrophone();
  const pc = buildCallPeer();
  await pc.setRemoteDescription(message.description);
  await flushIce(pcKey("call", callState.deviceId, message.from, callState.callId), pc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  callState.signal.send({ type: "call-answer", channel: "call", callId: callState.callId, description: pc.localDescription, to: message.from });
  callState.status = "connecting";
  showCallModal("outgoing", "무전 연결 확인 중", "음성 경로와 네트워크 연결을 확인하고 있습니다.");
}

async function acceptIncomingCall() {
  if (callState.status !== "incoming") return;
  stopRinging();
  try {
    await ensureCallMicrophone();
    callState.signal.send({ type: "call-accept", to: callState.peerId, callId: callState.callId });
    showCallModal("outgoing", "무전 연결 중", "상대방의 음성 채널을 기다리고 있습니다.");
    clearTimeout(callState.connectTimer);
    callState.connectTimer = setTimeout(() => {
      if (["incoming", "connecting"].includes(callState.status)) {
        toast("무전 음성 연결 시간이 초과되었습니다. 네트워크를 확인한 뒤 다시 호출해주세요.", 6000);
        endCall(true);
      }
    }, 20000);
  } catch (error) {
    toast(`마이크를 사용할 수 없습니다: ${error.message}`);
    callState.signal.send({ type: "call-reject", to: callState.peerId, callId: callState.callId });
    endCall(false);
  }
}

function rejectIncomingCall() {
  callState.signal?.send({ type: "call-reject", to: callState.peerId, callId: callState.callId });
  endCall(false);
}

function setCallConnected() {
  if (callState.status === "connected") return;
  callState.status = "connected";
  clearTimeout(callState.connectTimer);
  callState.connectTimer = null;
  stopRinging();
  const pathLabel = state.rtc.relayConfigured ? "P2P/TURN 자동 연결" : "P2P 연결";
  showCallModal("active", "무전 통화 연결됨", `${pathLabel} · 말하기 버튼을 누른 동안 상대방에게 음성이 전달됩니다.`);
  $("#floatingCallAlert").hidden = true;
  $("#guardRadioIndicator").textContent = "통화 중";
  $("#guardRadioIndicator").classList.add("active");
  beep(1320, .12, .06);
}

function setPushToTalk(active) {
  if (callState.status !== "connected" || !callState.localTrack) return;
  callState.localTrack.enabled = active;
  $("#pttButton").classList.toggle("transmitting", active);
  $("#pttButton b").textContent = active ? "송신 중" : "누르고 말하기";
}

function endCall(notify = true) {
  if (notify && callState.signal && callState.peerId && callState.callId) callState.signal.send({ type: "call-end", to: callState.peerId, callId: callState.callId });
  stopRinging();
  clearTimeout(callState.connectTimer);
  clearTimeout(callState.disconnectTimer);
  callState.connectTimer = null;
  callState.disconnectTimer = null;
  setPushToTalk(false);
  try { callState.pc?.close(); } catch { /* noop */ }
  if (callState.localStream && callState.localStream !== guard.stream) callState.localStream.getTracks().forEach((track) => track.stop());
  if (callState.localStream === guard.stream && callState.localTrack) callState.localTrack.enabled = false;
  Object.assign(callState, { status: "idle", direction: null, deviceId: null, peerId: null, signal: null, callId: null, pc: null, localStream: null, localTrack: null, remoteStream: null, remoteAudioBlocked: false });
  $("#remoteCallAudio").srcObject = null;
  $("#remoteAudioUnlock").hidden = true;
  $("#guardRadioIndicator").textContent = "대기";
  $("#guardRadioIndicator").classList.remove("active");
  hideCallModal();
}

/* ---------- Field guard ---------- */

function getGuardDeviceId() {
  let id = localStorage.getItem("ssg-device-id");
  if (!id) {
    id = `${isMobile() ? "mobile" : "browser"}-${crypto.randomUUID().slice(0, 12)}`;
    localStorage.setItem("ssg-device-id", id);
  }
  return id;
}

function loadGuardProfile() {
  const saved = JSON.parse(localStorage.getItem("ssg-guard-profile") || "{}");
  $("#guardDeviceId").textContent = getGuardDeviceId();
  $("#guardDeviceName").value = saved.name || (isMobile() ? "휴대폰 지킴이" : "노트북 지킴이");
  $("#guardSite").value = saved.site || "POSCO Future M 시연 현장";
  $("#guardArea").value = saved.area || "안전 시연구역";
  $("#guardVoiceEnabled").checked = saved.voiceEnabled !== false;
  $("#guardZoneEnabled").checked = saved.zoneEnabled === true;
}

function saveGuardProfile() {
  localStorage.setItem("ssg-guard-profile", JSON.stringify({
    name: $("#guardDeviceName").value.trim(),
    site: $("#guardSite").value.trim(),
    area: $("#guardArea").value.trim(),
    cameraId: $("#guardCameraSelect").value,
    voiceEnabled: $("#guardVoiceEnabled").checked,
    zoneEnabled: $("#guardZoneEnabled").checked,
  }));
  toast("장치 정보를 저장했습니다.");
  if (guard.active) registerGuard();
}

function guardVideoConstraintCandidates() {
  const saved = JSON.parse(localStorage.getItem("ssg-guard-profile") || "{}");
  const selected = $("#guardCameraSelect").value || saved.cameraId || "";
  const mobile = isMobile();
  const size = mobile
    ? { width: { ideal: 960, max: 1280 }, height: { ideal: 540, max: 720 }, frameRate: { ideal: 18, max: 24 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } };
  const candidates = [];
  if (selected) candidates.push({ deviceId: { exact: selected }, ...size });
  if (mobile) candidates.push({ facingMode: { ideal: "environment" }, ...size });
  candidates.push(size);
  candidates.push(true);
  return candidates;
}

async function requestGuardCameraStream() {
  let lastError = null;
  for (const video of guardVideoConstraintCandidates()) {
    try {
      return { stream: await navigator.mediaDevices.getUserMedia({ video, audio: false }), fallback: Boolean(lastError) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("카메라를 열 수 없습니다.");
}

async function attachOptionalGuardMicrophone(stream) {
  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const track = mic.getAudioTracks()[0];
    if (track) {
      track.enabled = false;
      stream.addTrack(track);
    }
    return true;
  } catch (error) {
    console.info("Microphone permission deferred:", error?.message || error);
    return false;
  }
}

function inferenceProfile() {
  const mobile = isMobile();
  const cores = Number(navigator.hardwareConcurrency || 4);
  const memory = Number(navigator.deviceMemory || 4);
  const constrained = mobile && (cores <= 4 || memory <= 4);
  return {
    personDelay: constrained ? 1700 : mobile ? 1200 : 700,
    ppeDelay: constrained ? 2800 : mobile ? 2000 : Math.max(900, guard.config.detection?.intervalMs || 1000),
    transport: mobile ? "rgba" : "bitmap",
  };
}

function buildRgbaInferenceFrame(video, inputSize = 640) {
  if (!video.videoWidth || !video.videoHeight) return null;
  if (!guard.mobileInferenceCanvas) guard.mobileInferenceCanvas = document.createElement("canvas");
  const canvas = guard.mobileInferenceCanvas;
  canvas.width = inputSize;
  canvas.height = inputSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const scale = Math.min(inputSize / sourceWidth, inputSize / sourceHeight);
  const drawWidth = Math.round(sourceWidth * scale);
  const drawHeight = Math.round(sourceHeight * scale);
  const padX = Math.floor((inputSize - drawWidth) / 2);
  const padY = Math.floor((inputSize - drawHeight) / 2);
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, inputSize, inputSize);
  ctx.drawImage(video, padX, padY, drawWidth, drawHeight);
  const image = ctx.getImageData(0, 0, inputSize, inputSize);
  return {
    rgba: image.data.buffer,
    meta: { sourceWidth, sourceHeight, scale, padX, padY },
  };
}

async function postInferenceFrame(targetWorker, requestId, threshold) {
  const video = $("#guardVideo");
  if (video.readyState < 2 || !video.videoWidth) throw new Error("카메라 프레임 준비 중");
  const profile = inferenceProfile();
  if (profile.transport === "rgba" || typeof createImageBitmap !== "function") {
    const frame = buildRgbaInferenceFrame(video, 640);
    if (!frame) throw new Error("모바일 추론 프레임 생성 실패");
    targetWorker.postMessage({ type: "infer-rgba", requestId, rgba: frame.rgba, meta: frame.meta, threshold }, [frame.rgba]);
    return;
  }
  const bitmap = await createImageBitmap(video);
  targetWorker.postMessage({ type: "infer", requestId, bitmap, threshold }, [bitmap]);
}

async function startGuard() {
  if (guard.active || guard.starting) return;
  if (!navigator.mediaDevices?.getUserMedia) return toast("이 브라우저에서는 카메라 기능을 사용할 수 없습니다.");
  guard.starting = true;
  updateGuardUi();
  try {
    unlockAudio();
    const camera = await requestGuardCameraStream();
    const stream = camera.stream;
    guard.stream = stream;
    const microphoneReady = await attachOptionalGuardMicrophone(stream);
    if (camera.fallback) toast("저장된 카메라 설정 대신 사용 가능한 카메라로 자동 전환했습니다.");
    if (!microphoneReady) toast("카메라는 시작했습니다. 무전 사용 시 마이크 권한을 다시 요청합니다.", 4500);
    const video = $("#guardVideo");
    video.srcObject = stream;
    await video.play();
    await enumerateCameras();
    resizeGuardOverlay();
    guard.active = true;
    guard.starting = false;
    guard.currentRisk = "정상";
    await registerGuard();
    await fetchGuardConfig();
    guard.signal = createSignal(getGuardDeviceId(), "guard", handleGuardSignalMessage);
    startGuardWorker();
    startGuardTimers();
    updateGuardUi();
    setTimeout(uploadGuardPreview, 1200);
    toast("스마트 안전지킴이가 시작되었습니다.");
  } catch (error) {
    guard.starting = false;
    guard.active = false;
    updateGuardUi();
    toast(`카메라 또는 마이크를 시작할 수 없습니다: ${error.message}`);
  }
}

async function stopGuard() {
  guard.active = false;
  guard.starting = false;
  stopGuardTimers();
  guard.signal?.close();
  guard.signal = null;
  for (const peerId of [...realtime.guardVideoPeers.keys()]) closeGuardVideoPeer(peerId);
  guard.worker?.terminate();
  guard.worker = null;
  guard.personWorker?.terminate();
  guard.personWorker = null;
  guard.modelReady = false;
  guard.personModelReady = false;
  guard.inferenceBusy = false;
  guard.personInferenceBusy = false;
  guard.inferenceFps = 0;
  guard.personInferenceFps = 0;
  guard.personDetections = [];
  guard.stream?.getTracks().forEach((track) => track.stop());
  guard.stream = null;
  $("#guardVideo").srcObject = null;
  clearGuardOverlay();
  try { await api("/api/agents/offline", { method: "POST", body: JSON.stringify({ deviceId: getGuardDeviceId() }) }); } catch { /* noop */ }
  updateGuardUi();
}

async function toggleGuard() {
  if (guard.active || guard.starting) await stopGuard();
  else await startGuard();
}

function updateGuardUi() {
  const active = guard.active;
  const starting = guard.starting;
  const label = starting ? "시작 중" : active ? "지킴이 종료" : "지킴이 시작";
  $("#guardStartButton").textContent = label;
  $("#guardTopButton b").textContent = label;
  $("#guardStartButton").disabled = starting;
  $("#guardTopButton").disabled = starting;
  $("#guardCameraPlaceholder").hidden = active;
  $("#guardLiveBadge").style.display = active ? "block" : "none";
  $("#guardStatusPill").classList.toggle("online", active);
  $("#guardStatusPill b").textContent = active ? "관제 연결" : starting ? "시작 중" : "대기 중";
  $("#guardConnectionMetric").textContent = active ? "ONLINE" : "OFFLINE";
  const personLabel = guard.personModelReady ? "YOLO11n" : "PERSON 준비";
  const ppeLabel = guard.modelReady ? "PPE" : guard.modelError ? "PPE 오류" : "PPE 준비";
  $("#guardModelMetric").textContent = active ? `${personLabel} + ${ppeLabel}` : "대기";
  $("#guardPeopleMetric").textContent = `${guard.peopleCount}명`;
  $("#guardFpsMetric").textContent = active ? `PERSON ${guard.personInferenceFps.toFixed(1)} · PPE ${guard.inferenceFps.toFixed(1)}` : "0.0 FPS";
  updateGuardViewerCount();
}

async function enumerateCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const select = $("#guardCameraSelect");
  const before = select.value;
  const cameras = devices.filter((device) => device.kind === "videoinput");
  select.innerHTML = cameras.map((camera, index) => `<option value="${escapeHtml(camera.deviceId)}">${escapeHtml(camera.label || `카메라 ${index + 1}`)}</option>`).join("") || `<option value="">기본 카메라</option>`;
  if (cameras.some((camera) => camera.deviceId === before)) select.value = before;
}

async function restartGuardCamera() {
  if (!guard.active) return saveGuardProfile();
  await stopGuard();
  await sleep(250);
  await startGuard();
}

async function registerGuard() {
  const profile = {
    name: $("#guardDeviceName").value.trim() || "현장 지킴이",
    site: $("#guardSite").value.trim() || "미지정 사업장",
    area: $("#guardArea").value.trim() || "미지정 구역",
  };
  localStorage.setItem("ssg-guard-profile", JSON.stringify({ ...profile, cameraId: $("#guardCameraSelect").value, voiceEnabled: $("#guardVoiceEnabled").checked, zoneEnabled: $("#guardZoneEnabled").checked }));
  await api("/api/agents/register", { method: "POST", body: JSON.stringify({ deviceId: getGuardDeviceId(), ...profile, cameraLabel: $("#guardCameraSelect").selectedOptions[0]?.textContent || "브라우저 카메라", agentVersion: "browser-yolo11n-3.0", config: guard.config }) });
}

async function fetchGuardConfig() {
  if (!guard.active) return;
  try {
    guard.config = await api(`/api/devices/${encodeURIComponent(getGuardDeviceId())}/config`);
    $("#guardVoiceEnabled").checked = guard.config.voice?.enabled !== false;
    drawGuardOverlay(guard.detections, 0, 0);
  } catch { /* first registration race */ }
}

function startGuardTimers() {
  stopGuardTimers();
  guard.heartbeatTimer = setInterval(sendGuardHeartbeat, 10000);
  guard.configTimer = setInterval(fetchGuardConfig, 15000);
  guard.previewTimer = setInterval(uploadGuardPreview, 30000);
}

function stopGuardTimers() {
  ["heartbeatTimer", "configTimer", "previewTimer", "inferenceTimer", "personInferenceTimer"].forEach((key) => { clearInterval(guard[key]); clearTimeout(guard[key]); guard[key] = null; });
}

async function sendGuardHeartbeat() {
  if (!guard.active) return;
  try {
    await api("/api/agents/heartbeat", { method: "POST", body: JSON.stringify({ deviceId: getGuardDeviceId(), fps: guard.inferenceFps, cpu: 0, memory: 0, peopleCount: guard.peopleCount, currentRisk: guard.currentRisk, agentVersion: "browser-yolo11n-3.0" }) });
  } catch { /* reconnect will retry */ }
}

function startGuardWorker() {
  guard.worker?.terminate();
  guard.personWorker?.terminate();
  guard.worker = new Worker(`/ppe-worker.js?v=${POSEIDON_BUILD}`);
  guard.personWorker = new Worker(`/person-worker.js?v=${POSEIDON_BUILD}`);
  guard.modelReady = false;
  guard.personModelReady = false;
  guard.inferenceBusy = false;
  guard.personInferenceBusy = false;
  guard.modelError = null;
  $("#ppeLoading").hidden = false;
  $("#ppeLoadingText").textContent = "YOLO11n 사람 감지 + 보호구 AI 준비 중";
  guard.worker.onmessage = (event) => handlePpeWorkerMessage(event.data || {});
  guard.worker.onerror = (event) => {
    guard.modelError = event.message || "보호구 AI 오류";
    $("#ppeLoadingText").textContent = guard.modelError;
    updateGuardUi();
  };
  guard.personWorker.onmessage = (event) => handlePersonWorkerMessage(event.data || {});
  guard.personWorker.onerror = (event) => {
    console.warn("YOLO11n person worker error", event.message);
    $("#ppeLoadingText").textContent = "사람 감지 AI 오류 · 보호구 AI는 계속 사용합니다.";
  };
  guard.personWorker.postMessage({ type: "load" });
  guard.worker.postMessage({ type: "load" });
}

function maybeHideAiLoader() {
  if (guard.modelReady && guard.personModelReady) {
    $("#ppeLoading").style.setProperty("--model-progress", "100%");
    $("#ppeLoadingText").textContent = "YOLO11n + 보호구 AI 준비 완료";
    $("#ppeLoadingProgress").textContent = "100%";
    setTimeout(() => { $("#ppeLoading").hidden = true; }, 900);
  }
}

function handlePpeWorkerMessage(message) {
  if (message.type === "model-status") {
    $("#ppeLoadingText").textContent = `PPE · ${message.message}`;
  } else if (message.type === "model-progress") {
    const percent = message.percent || 0;
    $("#ppeLoading").style.setProperty("--model-progress", `${Math.min(95, percent)}%`);
    $("#ppeLoadingProgress").textContent = message.total ? `PPE ${percent}%` : `${Math.round((message.loaded || 0) / 1048576)}MB`;
  } else if (message.type === "model-ready") {
    guard.modelReady = true;
    updateGuardUi();
    scheduleGuardInference(150);
    maybeHideAiLoader();
  } else if (message.type === "model-error") {
    guard.modelError = message.message;
    $("#ppeLoadingText").textContent = "보호구 AI를 불러오지 못했습니다.";
    $("#ppeLoadingProgress").textContent = "재시도 필요";
    toast(message.message, 6000);
    updateGuardUi();
  } else if (message.type === "result") {
    guard.inferenceBusy = false;
    guard.detections = message.detections || [];
    guard.inferenceFps = message.inferenceMs ? 1000 / message.inferenceMs : 0;
    processGuardDetections(message);
    scheduleGuardInference(inferenceProfile().ppeDelay);
  } else if (message.type === "inference-error") {
    guard.inferenceBusy = false;
    console.warn(message.message);
    scheduleGuardInference(Math.max(1800, inferenceProfile().ppeDelay));
  }
}

function handlePersonWorkerMessage(message) {
  if (message.type === "model-status") {
    if (!guard.modelReady) $("#ppeLoadingText").textContent = `YOLO11n · ${message.message}`;
  } else if (message.type === "model-progress") {
    if (!guard.modelReady) {
      const percent = message.percent || 0;
      $("#ppeLoading").style.setProperty("--model-progress", `${Math.min(90, percent)}%`);
      $("#ppeLoadingProgress").textContent = message.total ? `PERSON ${percent}%` : `${Math.round((message.loaded || 0) / 1048576)}MB`;
    }
  } else if (message.type === "model-ready") {
    guard.personModelReady = true;
    updateGuardUi();
    schedulePersonInference(100);
    maybeHideAiLoader();
  } else if (message.type === "model-error") {
    console.warn("YOLO11n model error", message.message);
    guard.personModelReady = false;
    toast(`YOLO11n 사람 감지 모델 오류: ${message.message}`, 6000);
    updateGuardUi();
  } else if (message.type === "result") {
    guard.personInferenceBusy = false;
    guard.personDetections = dedupeAnchors((message.detections || []).filter((item) => item.label === "Person")).slice(0, 30);
    guard.personInferenceFps = message.inferenceMs ? 1000 / message.inferenceMs : 0;
    guard.peopleCount = guard.personDetections.length || guard.latestAssessments.length;
    updateGuardUi();
    schedulePersonInference(inferenceProfile().personDelay);
  } else if (message.type === "inference-error") {
    guard.personInferenceBusy = false;
    console.warn(message.message);
    schedulePersonInference(Math.max(1600, inferenceProfile().personDelay));
  }
}

function scheduleGuardInference(delay) {
  clearTimeout(guard.inferenceTimer);
  if (!guard.active || !guard.modelReady) return;
  guard.inferenceTimer = setTimeout(runGuardInference, delay);
}

function schedulePersonInference(delay) {
  clearTimeout(guard.personInferenceTimer);
  if (!guard.active || !guard.personModelReady) return;
  guard.personInferenceTimer = setTimeout(runPersonInference, delay);
}

async function runGuardInference() {
  if (!guard.active || !guard.modelReady || guard.inferenceBusy) return;
  const video = $("#guardVideo");
  if (video.readyState < 2 || !video.videoWidth) return scheduleGuardInference(500);
  guard.inferenceBusy = true;
  try {
    await postInferenceFrame(guard.worker, Date.now(), guard.config.detection?.confidence || 0.31);
  } catch (error) {
    guard.inferenceBusy = false;
    console.warn("PPE inference frame error", error);
    scheduleGuardInference(Math.max(1200, inferenceProfile().ppeDelay));
  }
}

async function runPersonInference() {
  if (!guard.active || !guard.personModelReady || guard.personInferenceBusy) return;
  const video = $("#guardVideo");
  if (video.readyState < 2 || !video.videoWidth) return schedulePersonInference(500);
  guard.personInferenceBusy = true;
  try {
    await postInferenceFrame(guard.personWorker, Date.now(), isMobile() ? 0.34 : 0.30);
  } catch (error) {
    guard.personInferenceBusy = false;
    console.warn("Person inference frame error", error);
    schedulePersonInference(Math.max(1000, inferenceProfile().personDelay));
  }
}

function resizeGuardOverlay() {
  const video = $("#guardVideo");
  const canvas = $("#guardOverlay");
  if (!video.videoWidth) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

function clearGuardOverlay() {
  const canvas = $("#guardOverlay");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

function voiceAlertEnabled(key) {
  if (guard.config.voice?.enabled === false) return false;
  const alerts = guard.config.voice?.alerts || {};
  return alerts[key] !== false;
}

function processGuardDetections(message) {
  resizeGuardOverlay();
  const detections = message.detections || [];
  const assessments = buildPpeAssessments(detections, message.sourceWidth, message.sourceHeight, guard.personDetections);
  guard.peopleCount = guard.personDetections.length || assessments.length;
  guard.latestAssessments = assessments;
  guard.latestSourceWidth = message.sourceWidth || 0;
  guard.latestSourceHeight = message.sourceHeight || 0;
  updateTrainingFeedback(assessments);

  const rules = guard.config.rules || {};
  const violations = [];
  const noHarness = detections.filter((item) => item.label === "No_Harness");
  const falls = detections.filter((item) => item.label === "Fall-Detected");
  const zonePeople = assessments.map((item) => item.anchor);
  const zoneEntries = isGuardZoneActive()
    ? detectZoneEntries(zonePeople, message.sourceWidth, message.sourceHeight)
    : [];

  const ppeProblems = [];
  if (rules.helmet !== false) {
    const states = assessments.map((item) => item.helmet.state);
    if (states.includes("NF")) ppeProblems.push("안전모 미착용");
    else if (states.includes("CHECK")) ppeProblems.push("안전모 착용 상태 확인 필요");
  }
  if (rules.safetyGlasses !== false) {
    const states = assessments.map((item) => item.goggles.state);
    if (states.includes("NF")) ppeProblems.push("보안경 미착용");
    else if (states.includes("CHECK")) ppeProblems.push("보안경 착용 상태 확인 필요");
  }
  if (rules.mask !== false) {
    const states = assessments.map((item) => item.mask.state);
    if (states.includes("NF")) ppeProblems.push("마스크 미착용");
    else if (states.includes("CHECK")) ppeProblems.push("마스크 착용 상태 확인 필요");
  }

  if (ppeProblems.length) {
    const directMissing = [];
    const checkNeeded = [];
    const enabledPpeChecks = [
      ["helmet", "안전모", rules.helmet !== false],
      ["goggles", "보안경", rules.safetyGlasses !== false],
      ["mask", "마스크", rules.mask !== false],
    ];
    for (const item of assessments) {
      for (const [key, korean, enabled] of enabledPpeChecks) {
        if (!enabled) continue;
        if (item[key].state === "NF" && !directMissing.includes(korean)) directMissing.push(korean);
        if (item[key].state === "CHECK" && !checkNeeded.includes(korean)) checkNeeded.push(korean);
      }
    }
    const voiceParts = [];
    const voiceNames = {
      "안전모": "helmet",
      "보안경": "safetyGlasses",
      "마스크": "mask",
    };
    const directVoice = directMissing.filter((name) => voiceAlertEnabled(voiceNames[name]));
    const checkVoice = checkNeeded.filter((name) => voiceAlertEnabled(voiceNames[name]));
    if (directVoice.length) voiceParts.push(`${directVoice.join(", ")}를 착용해주세요.`);
    if (checkVoice.length) voiceParts.push(`${checkVoice.join(", ")} 착용 상태를 확인해주세요.`);
    const voice = voiceParts.join(" ");
    violations.push(["ppe-summary", {
      type: "PPE_CHECK_REQUIRED",
      category: "보호구",
      severity: directMissing.length ? "high" : "medium",
      message: ppeProblems.join(" · "),
      voice,
      metadata: { people: assessments.length, directMissing, checkNeeded }
    }]);
  }

  if (rules.harness && noHarness.length) violations.push(["harness", { type: "HARNESS_NOT_DETECTED", category: "보호구", severity: "high", message: "안전대 미착용 의심 상황이 감지되었습니다.", voice: "안전대를 착용해주세요.", voiceKey: "harness", metadata: { count: noHarness.length } }]);
  if (rules.fall !== false && falls.length) violations.push(["fall", { type: "FALL_CANDIDATE", category: "불안전 행동", severity: "critical", message: "넘어짐 의심 상황이 감지되었습니다.", voice: "넘어짐 위험이 감지되었습니다. 확인해주세요.", voiceKey: "fall", metadata: { count: falls.length } }]);
  if (zoneEntries.length) violations.push(["zone", { type: "DANGER_ZONE_ENTRY", category: "위험구역", severity: "high", message: `${zoneEntries[0].zone.name}에 작업자가 진입했습니다.`, voice: "위험구역입니다. 즉시 이동해주세요.", voiceKey: "dangerZone", metadata: { count: zoneEntries.length, zone: zoneEntries[0].zone.name } }]);

  const presentKeys = new Set(violations.map(([key]) => key));
  for (const key of ["ppe-summary", "harness", "fall", "zone"]) {
    if (!presentKeys.has(key)) guard.streaks.set(key, 0);
  }
  for (const [key, event] of violations) confirmViolation(key, event);
  guard.currentRisk = violations.length ? "위험" : "정상";
  drawGuardOverlay(detections, message.sourceWidth, message.sourceHeight, zoneEntries, assessments);
  updateGuardUi();
}

function detectionCenter(item) {
  return [item.x + item.width / 2, item.y + item.height / 2];
}

function boxIoU(a, b) {
  const ax2 = a.x + a.width, ay2 = a.y + a.height;
  const bx2 = b.x + b.width, by2 = b.y + b.height;
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(ax2, bx2), y2 = Math.min(ay2, by2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function overlapFraction(inner, outer) {
  const ix1 = Math.max(inner.x, outer.x), iy1 = Math.max(inner.y, outer.y);
  const ix2 = Math.min(inner.x + inner.width, outer.x + outer.width);
  const iy2 = Math.min(inner.y + inner.height, outer.y + outer.height);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  return inter / Math.max(1, inner.width * inner.height);
}

function dedupeAnchors(items) {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const item of sorted) {
    if (!kept.some((existing) => boxIoU(existing, item) > 0.45)) kept.push(item);
  }
  return kept;
}

function buildPpeAssessments(detections, sourceWidth, sourceHeight, yolo11Persons = []) {
  const personDetections = [...yolo11Persons, ...detections.filter((item) => item.label === "Person")];
  const headDetections = detections.filter((item) => ["Hardhat", "NO-Hardhat"].includes(item.label));

  // This model frequently emits NO-Hardhat as the worker/head box but omits Person.
  // Use Person boxes first, then add distinct hardhat/no-hardhat boxes as worker anchors.
  let anchors = dedupeAnchors(personDetections);
  for (const head of dedupeAnchors(headDetections)) {
    const belongsToExisting = anchors.some((person) => overlapFraction(head, person) > 0.60 || boxIoU(head, person) > 0.25);
    if (!belongsToExisting) anchors.push(head);
  }
  anchors = dedupeAnchors(anchors).slice(0, 20);

  const visibleMin = Math.max(44, Math.min(sourceWidth, sourceHeight) * 0.07);
  return anchors.map((anchor, index) => {
    const related = detections.filter((det) => {
      if (!["Hardhat", "NO-Hardhat", "Goggles", "NO-Goggles", "Mask", "NO-Mask"].includes(det.label)) return false;
      const [cx, cy] = detectionCenter(det);
      const ex = anchor.width * 0.20;
      const ey = anchor.height * 0.20;
      const centerInside = cx >= anchor.x - ex && cx <= anchor.x + anchor.width + ex && cy >= anchor.y - ey && cy <= anchor.y + anchor.height + ey;
      return centerInside || boxIoU(det, anchor) > 0.15 || overlapFraction(det, anchor) > 0.40;
    });

    const assess = (positive, negative) => {
      const pos = related.filter((d) => d.label === positive).sort((a, b) => b.score - a.score)[0];
      const neg = related.filter((d) => d.label === negative).sort((a, b) => b.score - a.score)[0];
      if (neg && (!pos || neg.score >= pos.score + 0.03)) return { state: "NF", score: neg.score, direct: true };
      if (pos && (!neg || pos.score >= neg.score + 0.03)) return { state: "OK", score: pos.score, direct: true };
      const sufficientlyVisible = anchor.width >= visibleMin && anchor.height >= visibleMin;
      return { state: "CHECK", score: Math.max(pos?.score || 0, neg?.score || 0), direct: false, sufficientlyVisible };
    };

    const headCandidates = related
      .filter((det) => ["Hardhat", "NO-Hardhat"].includes(det.label))
      .sort((a, b) => b.score - a.score);
    const head = anchor.label !== "Person"
      ? anchor
      : headCandidates.find((det) =>
        det.width <= anchor.width * 0.92 &&
        det.height <= anchor.height * 0.62 &&
        det.y <= anchor.y + anchor.height * 0.55
      );
    const displayBox = head || {
      x: anchor.x + anchor.width * 0.18,
      y: anchor.y + anchor.height * 0.02,
      width: anchor.width * 0.64,
      height: Math.min(anchor.height * 0.38, anchor.width * 0.72),
      score: anchor.score,
      label: "FACE-ROI",
    };

    return {
      id: index + 1,
      anchor,
      displayBox,
      helmet: assess("Hardhat", "NO-Hardhat"),
      goggles: assess("Goggles", "NO-Goggles"),
      mask: assess("Mask", "NO-Mask"),
    };
  });
}


function statusTextForTraining(status) {
  if (!status) return "-";
  const pct = status.score > 0 ? ` ${Math.round(status.score * 100)}%` : "";
  return `${status.state}${pct}`;
}

function updateTrainingFeedback(assessments = guard.latestAssessments || []) {
  const select = $("#guardTrainingWorker");
  if (!select) return;
  const previous = select.value;
  if (!assessments.length) {
    select.innerHTML = '<option value="">감지된 작업자 없음</option>';
    $("#trainingPredictionSummary").textContent = "현재 작업자가 감지되지 않았습니다.";
    return;
  }
  select.innerHTML = assessments.map((worker, index) => `<option value="${index}">작업자 #${worker.id}</option>`).join("");
  if (previous !== "" && Number(previous) < assessments.length) select.value = previous;
  const worker = assessments[Number(select.value || 0)];
  if (!worker) return;
  $("#trainingPredictionSummary").innerHTML = `<b>현재 AI</b> · HAT <strong>${statusTextForTraining(worker.helmet)}</strong> · GOG <strong>${statusTextForTraining(worker.goggles)}</strong> · MASK <strong>${statusTextForTraining(worker.mask)}</strong>`;
  $("#trainingSavedCount").textContent = `${guard.trainingSavedCount}건`;
}

function captureWorkerTrainingCrop(worker, quality = 0.62, maxSize = 512) {
  const video = $("#guardVideo");
  if (!video.videoWidth || !worker?.anchor || !guard.latestSourceWidth || !guard.latestSourceHeight) return null;
  const a = worker.anchor;
  const sxScale = video.videoWidth / guard.latestSourceWidth;
  const syScale = video.videoHeight / guard.latestSourceHeight;
  const padX = a.width * 0.18;
  const padY = a.height * 0.12;
  let sx = Math.max(0, (a.x - padX) * sxScale);
  let sy = Math.max(0, (a.y - padY) * syScale);
  let sw = Math.min(video.videoWidth - sx, (a.width + padX * 2) * sxScale);
  let sh = Math.min(video.videoHeight - sy, (a.height + padY * 2) * syScale);
  if (sw < 32 || sh < 32) return null;
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  canvas.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function computeWorkerTrainingFingerprint(worker) {
  const video = $("#guardVideo");
  if (!video.videoWidth || !worker?.anchor || !guard.latestSourceWidth || !guard.latestSourceHeight) return null;
  const a = worker.anchor;
  const sxScale = video.videoWidth / guard.latestSourceWidth;
  const syScale = video.videoHeight / guard.latestSourceHeight;
  const padX = a.width * 0.18;
  const padY = a.height * 0.12;
  const sx = Math.max(0, (a.x - padX) * sxScale);
  const sy = Math.max(0, (a.y - padY) * syScale);
  const sw = Math.min(video.videoWidth - sx, (a.width + padX * 2) * sxScale);
  const sh = Math.min(video.videoHeight - sy, (a.height + padY * 2) * syScale);
  if (sw < 32 || sh < 32) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 12;
  canvas.height = 12;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 12, 12);
  const pixels = ctx.getImageData(0, 0, 12, 12).data;
  const signature = new Uint8Array(144);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    signature[p] = Math.round((pixels[i] * 0.299) + (pixels[i + 1] * 0.587) + (pixels[i + 2] * 0.114));
  }
  return signature;
}

function trainingFingerprintDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}

function getTrainingLabels({ requireDefinite = false } = {}) {
  const labels = {
    helmet: $("#trainingHatLabel")?.value || "",
    goggles: $("#trainingGogLabel")?.value || "",
    mask: $("#trainingMaskLabel")?.value || "",
  };
  if (!labels.helmet || !labels.goggles || !labels.mask) return null;
  if (requireDefinite && Object.values(labels).some((value) => value === "unknown")) return null;
  return labels;
}

function formatTrainingBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function refreshTrainingStorageStats() {
  const deviceId = getGuardDeviceId();
  if (!deviceId || !$("#trainingStorageText")) return;
  try {
    const response = await api(`/api/training/stats?deviceId=${encodeURIComponent(deviceId)}`);
    const data = response.data || response;
    guard.trainingStorage = data;
    const softLimit = Number(data.softLimitBytes || (300 * 1024 * 1024));
    const globalBytes = Number(data.globalBytes || 0);
    const pct = Math.min(100, (globalBytes / softLimit) * 100);
    $("#trainingStorageText").textContent = `이 장치 ${data.deviceSamples || 0}건 · ${formatTrainingBytes(data.deviceBytes)} / 전체 학습이미지 ${formatTrainingBytes(globalBytes)}`;
    $("#trainingStorageBar").style.width = `${pct}%`;
    $("#trainingStorageBar").classList.toggle("warning", pct >= 80);
    $("#trainingStorageHint").textContent = pct >= 100
      ? "학습이미지 권장 한도 300MB에 도달했습니다. 내보낸 뒤 오래된 데이터를 정리하세요."
      : `무료 D1 500MB/DB 중 학습이미지는 300MB를 권장 상한으로 사용합니다. (${pct.toFixed(0)}%)`;
  } catch (error) {
    $("#trainingStorageText").textContent = "저장용량 조회 대기";
  }
}

async function saveTrainingSample(options = {}) {
  const { silent = false, auto = false, workerOverride = null, labelsOverride = null } = options;
  if (!guard.active) {
    if (!silent) toast("먼저 지킴이를 시작해주세요.");
    return false;
  }
  const index = Number($("#guardTrainingWorker")?.value || 0);
  const worker = workerOverride || guard.latestAssessments[index];
  if (!worker) {
    if (!silent) toast("학습할 작업자를 먼저 감지해주세요.");
    return false;
  }
  const labels = labelsOverride || getTrainingLabels();
  if (!labels) {
    if (!silent) toast("안전모·보안경·마스크 실제 상태를 모두 선택해주세요.", 4500);
    return false;
  }
  const snapshotBase64 = captureWorkerTrainingCrop(worker);
  if (!snapshotBase64) {
    if (!silent) toast("작업자 이미지를 캡처하지 못했습니다.");
    return false;
  }
  const predictions = {
    helmet: { state: worker.helmet.state, score: worker.helmet.score || 0 },
    goggles: { state: worker.goggles.state, score: worker.goggles.score || 0 },
    mask: { state: worker.mask.state, score: worker.mask.score || 0 },
    anchor: worker.anchor,
    _meta: { captureMode: auto ? "auto" : "manual" },
  };
  const button = $("#saveTrainingSample");
  const old = button?.textContent;
  if (!auto && button) {
    button.disabled = true;
    button.textContent = "저장 중...";
  }
  try {
    await api("/api/training/samples", {
      method: "POST",
      body: JSON.stringify({
        deviceId: getGuardDeviceId(),
        capturedAt: new Date().toISOString(),
        modelVersion: POSEIDON_BUILD,
        predictions,
        labels,
        snapshotBase64,
      }),
    });
    guard.trainingSavedCount += 1;
    localStorage.setItem("poseidon_training_saved", String(guard.trainingSavedCount));
    if ($("#trainingSavedCount")) $("#trainingSavedCount").textContent = `${guard.trainingSavedCount}건`;
    if (!silent) toast("학습 후보 데이터를 저장했습니다. 검수 후 모델 재학습에 사용합니다.", 5000);
    return true;
  } catch (error) {
    if (!silent) toast(`학습데이터 저장 실패: ${error.message}`, 5500);
    return false;
  } finally {
    if (!auto && button) {
      button.disabled = false;
      button.textContent = old;
    }
  }
}

function renderAutoTrainingStatus(message = "대기") {
  const state = guard.autoTraining;
  if (!$("#autoTrainingStatus")) return;
  const elapsed = state.active ? Math.min(state.durationSeconds, (Date.now() - state.startedAt) / 1000) : 0;
  const pct = state.active ? Math.min(100, (elapsed / state.durationSeconds) * 100) : 0;
  $("#autoTrainingStatus").textContent = message;
  $("#autoTrainingProgress").style.width = `${pct}%`;
  $("#autoTrainingCounts").textContent = `저장 ${state.saved} · 중복 제외 ${state.skipped} · 오류 ${state.errors}`;
}

async function runAutoTrainingCapture() {
  const state = guard.autoTraining;
  if (!state.active || state.busy) return;
  if (guard.latestAssessments.length !== 1) {
    state.skipped += 1;
    renderAutoTrainingStatus("화면에 작업자 1명만 유지해주세요.");
    return;
  }
  const globalBytes = Number(guard.trainingStorage?.globalBytes || 0);
  const softLimit = Number(guard.trainingStorage?.softLimitBytes || (300 * 1024 * 1024));
  if (globalBytes >= softLimit) {
    stopAutoTraining("저장 권장 한도에 도달해 자동수집을 중지했습니다.");
    return;
  }
  const worker = guard.latestAssessments[0];
  const fingerprint = computeWorkerTrainingFingerprint(worker);
  if (!fingerprint) {
    state.skipped += 1;
    renderAutoTrainingStatus("작업자 화면을 확인하는 중입니다.");
    return;
  }
  const distance = trainingFingerprintDistance(fingerprint, state.lastFingerprint);
  if (state.lastFingerprint && distance < 0.012) {
    state.skipped += 1;
    renderAutoTrainingStatus("거의 같은 장면은 자동으로 건너뜁니다. 고개·거리·각도를 조금 바꿔주세요.");
    return;
  }
  state.busy = true;
  const ok = await saveTrainingSample({ silent: true, auto: true, workerOverride: worker, labelsOverride: state.labels });
  state.busy = false;
  if (ok) {
    state.saved += 1;
    state.lastFingerprint = fingerprint;
    renderAutoTrainingStatus("학습 장면을 저장했습니다. 자세와 각도를 천천히 바꿔주세요.");
    if (state.saved % 5 === 0) refreshTrainingStorageStats();
  } else {
    state.errors += 1;
    renderAutoTrainingStatus("저장 오류가 발생했습니다. 연결 상태를 확인해주세요.");
  }
}

function startAutoTraining() {
  if (guard.autoTraining.active) return;
  if (!guard.active) return toast("먼저 지킴이를 시작해주세요.");
  if (guard.latestAssessments.length !== 1) return toast("정확한 학습을 위해 화면에 작업자 1명만 나오게 해주세요.", 5500);
  const labels = getTrainingLabels({ requireDefinite: true });
  if (!labels) return toast("자동학습은 안전모·보안경·마스크를 각각 '착용' 또는 '미착용'으로 선택해주세요.", 6000);
  if (Number(guard.trainingStorage?.globalBytes || 0) >= Number(guard.trainingStorage?.softLimitBytes || (300 * 1024 * 1024))) {
    return toast("학습 이미지 권장 저장 한도에 도달했습니다. 먼저 데이터를 내보내고 정리해주세요.", 6000);
  }
  const durationSeconds = Math.max(10, Math.min(180, Number($("#autoTrainingDuration").value || 30)));
  const intervalSeconds = Math.max(1, Math.min(10, Number($("#autoTrainingInterval").value || 2)));
  Object.assign(guard.autoTraining, {
    active: true,
    startedAt: Date.now(),
    durationSeconds,
    intervalSeconds,
    saved: 0,
    skipped: 0,
    errors: 0,
    busy: false,
    lastFingerprint: null,
    labels: { ...labels },
  });
  $("#autoTrainingStart").disabled = true;
  $("#autoTrainingStop").disabled = false;
  renderAutoTrainingStatus("자동수집 시작 · 고개·거리·각도를 천천히 바꿔주세요.");
  runAutoTrainingCapture();
  guard.autoTraining.intervalTimer = setInterval(runAutoTrainingCapture, intervalSeconds * 1000);
  guard.autoTraining.uiTimer = setInterval(() => {
    const elapsed = (Date.now() - guard.autoTraining.startedAt) / 1000;
    if (elapsed >= guard.autoTraining.durationSeconds) stopAutoTraining("자동수집 완료");
    else renderAutoTrainingStatus($("#autoTrainingStatus").textContent || "자동수집 중");
  }, 250);
}

function stopAutoTraining(message = "자동수집 중지") {
  const state = guard.autoTraining;
  if (state.intervalTimer) clearInterval(state.intervalTimer);
  if (state.uiTimer) clearInterval(state.uiTimer);
  state.intervalTimer = null;
  state.uiTimer = null;
  state.active = false;
  state.busy = false;
  if ($("#autoTrainingStart")) $("#autoTrainingStart").disabled = false;
  if ($("#autoTrainingStop")) $("#autoTrainingStop").disabled = true;
  if ($("#autoTrainingProgress")) $("#autoTrainingProgress").style.width = "100%";
  renderAutoTrainingStatus(`${message} · 저장 ${state.saved}건 / 중복 제외 ${state.skipped}건`);
  refreshTrainingStorageStats();
}

function confirmViolation(key, event) {
  const streak = (guard.streaks.get(key) || 0) + 1;
  guard.streaks.set(key, streak);
  const required = guard.config.detection?.consecutiveFrames || 2;
  const now = Date.now();
  const cooldown = (guard.config.voice?.cooldownSeconds || 12) * 1000;
  if (streak >= required && now - (guard.lastEvents.get(key) || 0) >= cooldown) {
    guard.lastEvents.set(key, now);
    triggerGuardEvent(event);
  }
}

function isGuardZoneActive() {
  const localEnabled = $("#guardZoneEnabled")?.checked === true;
  const remoteRuleEnabled = guard.config?.rules?.dangerZone !== false;
  return localEnabled && remoteRuleEnabled;
}

function detectZoneEntries(persons, sourceWidth, sourceHeight) {
  const zones = (guard.config.zones || []).filter((zone) => zone.enabled !== false && Array.isArray(zone.points) && zone.points.length >= 3);
  const entries = [];
  for (const person of persons) {
    const foot = [((person.x + person.width / 2) / sourceWidth), ((person.y + person.height) / sourceHeight)];
    for (const zone of zones) if (pointInPolygon(foot, zone.points)) entries.push({ person, zone, foot });
  }
  return entries;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function drawGuardOverlay(detections = [], sourceWidth = 0, sourceHeight = 0, zoneEntries = [], assessments = []) {
  const canvas = $("#guardOverlay");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const zones = isGuardZoneActive()
    ? (guard.config.zones || []).filter((zone) => zone.enabled !== false && Array.isArray(zone.points) && zone.points.length >= 3)
    : [];
  for (const zone of zones) {
    ctx.beginPath();
    zone.points.forEach(([x, y], index) => index ? ctx.lineTo(x * canvas.width, y * canvas.height) : ctx.moveTo(x * canvas.width, y * canvas.height));
    ctx.closePath();
    ctx.fillStyle = "rgba(255,55,82,.10)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,55,82,.85)";
    ctx.lineWidth = 3;
    ctx.stroke();
    const [firstX, firstY] = zone.points[0] || [0, 0];
    drawLabel(ctx, zone.name || "DANGER ZONE", firstX * canvas.width, firstY * canvas.height, "#ff3c58", "#16080c");
  }
  if (!sourceWidth || !sourceHeight) return;
  const scaleX = canvas.width / sourceWidth;
  const scaleY = canvas.height / sourceHeight;

  // Only draw non-PPE raw detections. PPE is rendered per worker as HAT/GOG/MASK tri-state.
  for (const item of detections) {
    if (["Hardhat", "NO-Hardhat", "Goggles", "NO-Goggles", "Mask", "NO-Mask", "Person"].includes(item.label)) continue;
    const style = detectionStyle(item.label);
    if (!style.show) continue;
    const x = item.x * scaleX, y = item.y * scaleY;
    const width = item.width * scaleX, height = item.height * scaleY;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.lineWidth;
    ctx.strokeRect(x, y, width, height);
    drawLabel(ctx, `${style.text} ${Math.round(item.score * 100)}%`, x, Math.max(2, y - 23), style.color, style.background);
  }

  for (const worker of assessments) drawWorkerPpe(ctx, worker, scaleX, scaleY);

  for (const entry of zoneEntries) {
    ctx.beginPath();
    ctx.arc(entry.foot[0] * canvas.width, entry.foot[1] * canvas.height, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#ff3c58";
    ctx.fill();
  }
}

function ppeStatusStyle(status) {
  if (status.state === "OK") return { color: "#65ff90", background: "#062414", suffix: "OK" };
  if (status.state === "NF") return { color: "#ff3558", background: "#2a0710", suffix: "NF" };
  return { color: "#ffae42", background: "#2a1703", suffix: "CHECK" };
}

function drawWorkerPpe(ctx, worker, scaleX, scaleY) {
  // AI internally keeps the full person box for counting, zone entry and tracking.
  // The operator screen intentionally shows only a compact head/face ROI for readability.
  const a = worker.displayBox || worker.anchor;
  const x = a.x * scaleX, y = a.y * scaleY;
  const w = a.width * scaleX, h = a.height * scaleY;
  const statuses = [
    ["HAT", worker.helmet],
    ["GOG", worker.goggles],
    ["MASK", worker.mask],
  ];
  const worst = statuses.some(([, status]) => status.state === "NF") ? "NF" : statuses.some(([, status]) => status.state === "CHECK") ? "CHECK" : "OK";
  const border = ppeStatusStyle({ state: worst });

  ctx.save();
  ctx.strokeStyle = border.color;
  ctx.lineWidth = worst === "NF" ? 4 : 3;
  ctx.strokeRect(x, y, w, h);

  // Small corner accents make the ROI visible without covering the face.
  const corner = Math.max(10, Math.min(w, h) * 0.13);
  ctx.lineWidth = 5;
  for (const [sx, sy, dx, dy] of [
    [x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(sx + dx * corner, sy);
    ctx.lineTo(sx, sy);
    ctx.lineTo(sx, sy + dy * corner);
    ctx.stroke();
  }
  ctx.restore();

  const lineHeight = 25;
  const labelY = Math.max(2, y - lineHeight * statuses.length - 3);
  statuses.forEach(([prefix, status], index) => {
    const st = ppeStatusStyle(status);
    const pct = status.score > 0 ? ` ${Math.round(status.score * 100)}%` : "";
    drawLabel(ctx, `${prefix}: ${st.suffix}${pct}`, x, labelY + index * lineHeight, st.color, st.background);
  });
}

function detectionStyle(label) {
  const styles = {
    Hardhat: ["HAT: OK", "#5cff91", "#06180e", 3],
    "NO-Hardhat": ["HAT: NF", "#ff3c58", "#22070c", 4],
    Goggles: ["GOG: OK", "#5cff91", "#06180e", 3],
    "NO-Goggles": ["GOG: NF", "#ff3c58", "#22070c", 4],
    Mask: ["MASK: OK", "#5cff91", "#06180e", 3],
    "NO-Mask": ["MASK: NF", "#ff3c58", "#22070c", 4],
    No_Harness: ["HARNESS: NF", "#ff3c58", "#22070c", 4],
    "Fall-Detected": ["FALL: CHECK", "#ff3c58", "#22070c", 4],
    Person: ["PERSON", "#59e0dc", "#06181c", 2],
  };
  const value = styles[label];
  return value ? { show: true, text: value[0], color: value[1], background: value[2], lineWidth: value[3] } : { show: false };
}

function drawLabel(ctx, text, x, y, color, background) {
  ctx.font = `700 ${Math.max(13, Math.round(ctx.canvas.width / 70))}px "Nanum Barun Gothic", sans-serif`;
  const paddingX = 7;
  const height = 23;
  const width = ctx.measureText(text).width + paddingX * 2;
  ctx.fillStyle = background;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = color;
  ctx.fillText(text, x + paddingX, y + 17);
}

async function triggerGuardEvent(event) {
  if (!guard.active) return;
  showGuardWarning(event.voice || event.message);
  const voiceAllowed = event.voiceKey ? voiceAlertEnabled(event.voiceKey) : true;
  if ($("#guardVoiceEnabled").checked && guard.config.voice?.enabled !== false && voiceAllowed && event.voice) speak(event.voice);
  const snapshotBase64 = captureGuardSnapshot();
  try {
    await api("/api/agents/event", { method: "POST", body: JSON.stringify({ deviceId: getGuardDeviceId(), id: uuid("evt"), occurredAt: new Date().toISOString(), type: event.type, category: event.category, severity: event.severity, message: event.message, metadata: event.metadata || {}, snapshotBase64 }) });
  } catch (error) { console.warn("event upload", error); }
}

function showGuardWarning(text) {
  const banner = $("#guardWarningBanner");
  banner.textContent = text;
  banner.classList.add("show");
  clearTimeout(guard.warningTimer);
  guard.warningTimer = setTimeout(() => banner.classList.remove("show"), 6000);
}

function captureGuardSnapshot(quality = 0.68, maxWidth = 960) {
  const video = $("#guardVideo");
  if (!video.videoWidth) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.drawImage($("#guardOverlay"), 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function uploadGuardPreview() {
  if (!guard.active) return;
  const dataUrl = captureGuardSnapshot(0.48, 640);
  if (!dataUrl) return;
  const blob = await (await fetch(dataUrl)).blob();
  try { await api(`/api/agents/preview/${encodeURIComponent(getGuardDeviceId())}`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob }); } catch { /* fallback only */ }
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ko-KR";
  utterance.rate = 0.93;
  utterance.pitch = 1;
  utterance.volume = guard.config.voice?.volume || 0.95;
  const voices = speechSynthesis.getVoices();
  utterance.voice = voices.find((voice) => voice.lang?.toLowerCase().startsWith("ko")) || null;
  speechSynthesis.speak(utterance);
}

async function runGuardTest(kind) {
  const map = {
    helmet: { type: "HELMET_NOT_DETECTED", category: "보호구", severity: "high", message: "안전모 미착용 의심 상황이 감지되었습니다.", voice: "안전모를 착용해주세요." },
    forklift: { type: "FORKLIFT_APPROACH", category: "중장비", severity: "high", message: "지게차 접근 경고를 시연했습니다.", voice: "지게차가 지나갑니다. 주의하세요." },
    zone: { type: "DANGER_ZONE_ENTRY", category: "위험구역", severity: "high", message: "위험구역 진입 경고를 시연했습니다.", voice: "위험구역입니다. 즉시 이동해주세요." },
    fall: { type: "FALL_CANDIDATE", category: "불안전 행동", severity: "critical", message: "넘어짐 의심 경고를 시연했습니다.", voice: "넘어짐 위험이 감지되었습니다. 확인해주세요." },
  };
  if (!guard.active) return toast("먼저 지킴이를 시작해주세요.");
  await triggerGuardEvent(map[kind]);
}

/* ---------- Zone and rules ---------- */

async function prepareZoneEditor() {
  if (!state.devices.length) return drawZoneCanvas();
  const select = $("#zoneDeviceSelect");
  if (!select.value) select.value = state.devices[0].id;
  await loadSelectedZone();
}

async function loadSelectedZone() {
  const deviceId = $("#zoneDeviceSelect").value;
  if (!deviceId) return;
  try {
    const config = await api(`/api/devices/${encodeURIComponent(deviceId)}/config`);
    state.zoneConfig = config;
    const zone = config.zones?.[0] || defaultConfig().zones[0];
    state.zonePoints = [...(Array.isArray(zone.points) ? zone.points : []).map(([x, y]) => [x, y])];
    $("#zoneName").value = zone.name || "출입 제한 구역";
    $("#zoneSeverity").value = zone.severity || "high";
    $("#zoneEnabledAdmin").checked = zone.enabled !== false && config.rules?.dangerZone !== false;
    const device = state.devices.find((item) => item.id === deviceId);
    state.zoneBackground = device?.previewUrl || null;
    drawZoneCanvas();
  } catch (error) { toast(error.message); }
}

function getLiveVideoForDevice(deviceId) {
  return $$(`.device-card[data-device-id="${CSS.escape(deviceId)}"] .device-video`).find((video) => !video.hidden && video.readyState >= 2) || null;
}

function drawZoneCanvas() {
  const canvas = $("#zoneCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#06131c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const deviceId = $("#zoneDeviceSelect")?.value;
  const liveVideo = deviceId ? getLiveVideoForDevice(deviceId) : null;
  if (liveVideo) {
    ctx.drawImage(liveVideo, 0, 0, canvas.width, canvas.height);
  } else if (state.zoneBackground) {
    const image = new Image();
    image.onload = () => { ctx.drawImage(image, 0, 0, canvas.width, canvas.height); drawZonePolygon(ctx, canvas); };
    image.src = `${state.zoneBackground}?zone=${Date.now()}`;
  }
  drawZonePolygon(ctx, canvas);
}

function drawZonePolygon(ctx, canvas) {
  if (!state.zonePoints.length) return;
  ctx.beginPath();
  state.zonePoints.forEach(([x, y], index) => index ? ctx.lineTo(x * canvas.width, y * canvas.height) : ctx.moveTo(x * canvas.width, y * canvas.height));
  if (state.zonePoints.length >= 3) ctx.closePath();
  ctx.fillStyle = "rgba(255,55,82,.14)";
  if (state.zonePoints.length >= 3) ctx.fill();
  ctx.strokeStyle = "#ff3c58";
  ctx.lineWidth = 4;
  ctx.stroke();
  for (const [x, y] of state.zonePoints) {
    ctx.beginPath(); ctx.arc(x * canvas.width, y * canvas.height, 8, 0, Math.PI * 2); ctx.fillStyle = "#ff3c58"; ctx.fill();
  }
}

async function saveZone() {
  const deviceId = $("#zoneDeviceSelect").value;
  if (!deviceId) return toast("대상 장치를 선택해주세요.");
  const enabled = $("#zoneEnabledAdmin")?.checked === true;
  if (enabled && state.zonePoints.length < 3) return toast("위험구역을 사용할 때는 꼭짓점을 3개 이상 지정해주세요.");
  const config = state.zoneConfig || await api(`/api/devices/${encodeURIComponent(deviceId)}/config`);
  config.rules = { ...(config.rules || {}), dangerZone: enabled };
  config.zones = [{
    id: "zone-main",
    name: $("#zoneName").value.trim() || "출입 제한 구역",
    severity: $("#zoneSeverity").value,
    enabled,
    points: state.zonePoints,
  }];
  state.zoneConfig = config;
  await api(`/api/devices/${encodeURIComponent(deviceId)}/config`, { method: "PUT", body: JSON.stringify({ config }) });
  toast(enabled ? "위험구역을 저장하고 감지를 활성화했습니다." : "위험구역 감지를 해제했습니다.");
}

function clearZone() {
  state.zonePoints = [];
  drawZoneCanvas();
}

function renderRuleGroups() {
  for (const [group, definitions] of Object.entries(ruleGroups)) {
    const container = $(`[data-rule-group="${group}"]`);
    if (!container) continue;
    container.innerHTML = definitions.map(([key, title, description, enabled]) => `<article class="feature-card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p><div class="feature-switch-stack"><label class="switch-row"><span><b>감지 기능</b><small>${enabled ? "활성 권장" : "선택 기능"} · 장치별 적용</small></span><input type="checkbox" data-rule="${escapeHtml(key)}" ${enabled ? "checked" : ""} /></label><label class="switch-row voice-rule-row"><span><b>자동 음성 경보</b><small>이 항목 감지 시 한국어 음성 안내</small></span><input type="checkbox" data-voice-rule="${escapeHtml(key)}" checked /></label></div></article>`).join("");
  }
}

async function loadRuleEditor(group) {
  const select = $(`#page-${group} .rule-device-select`);
  if (!select?.value && state.devices[0]) select.value = state.devices[0].id;
  const deviceId = select?.value;
  if (!deviceId) return;
  try {
    const config = await api(`/api/devices/${encodeURIComponent(deviceId)}/config`);
    $$(`#page-${group} [data-rule]`).forEach((input) => { input.checked = config.rules?.[input.dataset.rule] === true; });
    $$(`#page-${group} [data-voice-rule]`).forEach((input) => { input.checked = config.voice?.alerts?.[input.dataset.voiceRule] !== false; });
  } catch { /* noop */ }
}

async function saveCurrentRuleGroup(button) {
  const page = button.closest(".page");
  const group = page.id.replace("page-", "");
  const deviceId = $(".rule-device-select", page).value;
  if (!deviceId) return toast("대상 장치를 선택해주세요.");
  try {
    const config = await api(`/api/devices/${encodeURIComponent(deviceId)}/config`);
    config.rules ||= {};
    config.voice ||= { enabled: true, cooldownSeconds: 12, volume: 0.95 };
    config.voice.alerts ||= {};
    $$('[data-rule]', page).forEach((input) => { config.rules[input.dataset.rule] = input.checked; });
    $$('[data-voice-rule]', page).forEach((input) => { config.voice.alerts[input.dataset.voiceRule] = input.checked; });
    await api(`/api/devices/${encodeURIComponent(deviceId)}/config`, { method: "PUT", body: JSON.stringify({ config }) });
    toast("감지 규칙과 항목별 음성 경보를 저장했습니다.");
  } catch (error) { toast(error.message); }
}

function renderReports() {
  const chart = $("#trendChart");
  if (!chart) return;
  const days = [...Array(7)].map((_, index) => {
    const date = new Date(Date.now() - (6 - index) * 86400000);
    const key = date.toISOString().slice(0, 10);
    const count = state.events.filter((event) => event.occurredAt?.startsWith(key)).length;
    return { label: `${date.getMonth() + 1}/${date.getDate()}`, count };
  });
  const max = Math.max(1, ...days.map((day) => day.count));
  chart.innerHTML = days.map((day) => `<div class="trend-column"><i style="height:${Math.max(4, day.count / max * 190)}px"></i><span>${day.label}<br />${day.count}건</span></div>`).join("");
  const top = Object.entries(state.summary?.categoryCounts || {}).sort((a, b) => b[1] - a[1])[0];
  $("#recommendations").innerHTML = [top ? `가장 빈번한 ‘${top[0]}’ 이벤트를 중심으로 현장 점검과 TBM 교육을 강화하세요.` : "현재 누적 이벤트가 적어 안정적으로 운영되고 있습니다.", "보호구 AI 결과는 현장 관리자 확인 후 조치 자료로 활용하세요.", "무전 호출 이력과 고위험 이벤트를 함께 검토하면 대응 시간을 줄일 수 있습니다."].map((text) => `<div class="recommendation">${escapeHtml(text)}</div>`).join("");
}

/* ---------- QR, export and UI ---------- */

function guardLink() {
  return `${location.origin}/?mode=user`;
}

function showQrModal() {
  $("#qrModal").hidden = false;
  $("#guardLinkInput").value = guardLink();
  const container = $("#qrCode");
  container.innerHTML = "";
  if (window.QRCode) {
    new window.QRCode(container, { text: guardLink(), width: 200, height: 200, colorDark: "#07131d", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.H });
  } else {
    container.textContent = "QR 라이브러리 로딩 중";
    setTimeout(showQrModal, 500);
  }
}

async function copyGuardLink() {
  try { await navigator.clipboard.writeText(guardLink()); toast("현장 지킴이 링크를 복사했습니다."); } catch { $("#guardLinkInput").select(); document.execCommand("copy"); toast("링크를 복사했습니다."); }
}

function exportEvents() {
  const headers = ["발생시간", "장치", "유형", "등급", "내용", "상태"];
  const rows = state.events.map((event) => [event.occurredAt, event.deviceName, event.category, severityLabel(event.severity), event.message, event.status]);
  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `스마트안전지킴이_이벤트_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function handleGuardZoneToggle() {
  const enabled = $("#guardZoneEnabled").checked === true;
  const saved = JSON.parse(localStorage.getItem("ssg-guard-profile") || "{}");
  localStorage.setItem("ssg-guard-profile", JSON.stringify({ ...saved, zoneEnabled: enabled }));
  guard.streaks.set("zone", 0);
  if (!enabled) guard.lastEvents.delete("zone");
  drawGuardOverlay(guard.detections, guard.latestSourceWidth, guard.latestSourceHeight, [], guard.latestAssessments);
  toast(enabled ? "위험구역 감지를 켰습니다." : "위험구역 감지를 껐습니다. 구역 표시와 경고가 중지됩니다.");
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", login);
  $$('[data-login-role]').forEach((button) => button.addEventListener("click", () => setLoginRole(button.dataset.loginRole)));
  $("#logoutButton").addEventListener("click", logout);
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => goToPage(button.dataset.page)));
  $$('[data-goto]').forEach((button) => button.addEventListener("click", () => goToPage(button.dataset.goto)));
  $("#mobileMenu").addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  $("#sidebarScrim").addEventListener("click", () => document.body.classList.remove("sidebar-open"));

  [$("#guardStartButton"), $("#guardTopButton")].forEach((button) => button.addEventListener("click", toggleGuard));
  $("#guardSaveProfile").addEventListener("click", saveGuardProfile);
  $("#guardZoneEnabled").addEventListener("change", handleGuardZoneToggle);
  $("#guardCameraSelect").addEventListener("change", restartGuardCamera);
  $("#guardCallAdminButton").addEventListener("click", initiateGuardCall);
  $("#guardTrainingWorker").addEventListener("change", () => updateTrainingFeedback());
  $("#saveTrainingSample").addEventListener("click", () => saveTrainingSample());
  $("#autoTrainingStart")?.addEventListener("click", startAutoTraining);
  $("#autoTrainingStop")?.addEventListener("click", () => stopAutoTraining("사용자가 자동수집을 중지했습니다."));
  [$("#trainingHatLabel"), $("#trainingGogLabel"), $("#trainingMaskLabel")].forEach((select) => select?.addEventListener("change", () => {
    if (guard.autoTraining.active) stopAutoTraining("착용 상태가 변경되어 자동수집을 중지했습니다.");
  }));
  $$('[data-guard-test]').forEach((button) => button.addEventListener("click", () => runGuardTest(button.dataset.guardTest)));
  $("#guardVideo").addEventListener("loadedmetadata", resizeGuardOverlay);
  addEventListener("resize", () => { resizeGuardOverlay(); if (state.currentPage === "zones") drawZoneCanvas(); });

  [$("#qrOpenButton"), $("#heroQrButton"), $("#deviceQrButton"), $("#settingsQrButton")].forEach((button) => button?.addEventListener("click", showQrModal));
  $("#copyGuardLink").addEventListener("click", copyGuardLink);
  $$('[data-close-modal]').forEach((button) => button.addEventListener("click", () => { $("#" + button.dataset.closeModal).hidden = true; }));

  $("#acceptCallButton").addEventListener("click", acceptIncomingCall);
  $("#rejectCallButton").addEventListener("click", rejectIncomingCall);
  $("#endCallButton").addEventListener("click", () => endCall(true));
  $("#callCloseButton").addEventListener("click", () => callState.status === "incoming" ? rejectIncomingCall() : endCall(true));
  $("#floatingCallOpen").addEventListener("click", () => { $("#callModal").hidden = false; });
  $("#remoteAudioUnlock").addEventListener("click", async () => {
    unlockAudio();
    try {
      await $("#remoteCallAudio").play();
      callState.remoteAudioBlocked = false;
      $("#remoteAudioUnlock").hidden = true;
      toast("상대방 음성을 재생합니다.");
    } catch (error) {
      toast(`음성 재생을 시작할 수 없습니다: ${error.message}`, 5000);
    }
  });
  const ptt = $("#pttButton");
  ["pointerdown", "touchstart"].forEach((name) => ptt.addEventListener(name, (event) => { event.preventDefault(); setPushToTalk(true); }, { passive: false }));
  ["pointerup", "pointercancel", "pointerleave", "touchend"].forEach((name) => ptt.addEventListener(name, (event) => { event.preventDefault(); setPushToTalk(false); }, { passive: false }));

  $("#refreshLive").addEventListener("click", () => { for (const device of state.devices) requestWatch(device.id, true); loadDashboard(true); });
  $("#simulateEvent").addEventListener("click", simulateEvent);
  $("#applyEventFilter").addEventListener("click", renderEventTable);
  $("#exportEvents").addEventListener("click", exportEvents);
  $("#saveEventRetention")?.addEventListener("click", saveEventRetentionSettings);
  $("#cleanupEventsNow")?.addEventListener("click", cleanupExpiredEvents);
  $("#deleteAllEvents")?.addEventListener("click", deleteAllEvents);
  $("#printReport").addEventListener("click", () => print());

  $("#zoneDeviceSelect").addEventListener("change", loadSelectedZone);
  $("#zoneCanvas").addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    state.zonePoints.push([(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]);
    drawZoneCanvas();
  });
  $("#clearZone").addEventListener("click", clearZone);
  $("#saveZone").addEventListener("click", saveZone);

  $$(".rule-device-select").forEach((select) => select.addEventListener("change", () => loadRuleEditor(select.closest(".page").id.replace("page-", ""))));
  $$(".rule-save").forEach((button) => button.addEventListener("click", () => saveCurrentRuleGroup(button)));
  $$(".speak-sample").forEach((button) => button.addEventListener("click", () => { unlockAudio(); speak(button.dataset.text); }));

  addEventListener("beforeunload", () => {
    if (guard.autoTraining.active) stopAutoTraining("페이지 종료");
    if (guard.active) navigator.sendBeacon?.("/api/agents/offline", new Blob([JSON.stringify({ deviceId: getGuardDeviceId() })], { type: "application/json" }));
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.session?.role === "admin") syncAdminWatchRequests();
  });
}

async function init() {
  bindEvents();
  renderRuleGroups();
  loadGuardProfile();
  if ($("#trainingSavedCount")) $("#trainingSavedCount").textContent = `${guard.trainingSavedCount}건`;
  refreshTrainingStorageStats();
  $("#apiOrigin").textContent = location.origin;
  updateClock();
  setInterval(updateClock, 1000);
  await loadIceServers();
  await restoreSession();
  try {
    const health = await api("/api/health");
    $("#cloudStatusText").textContent = health.ok ? "연결 상태 정상" : "연결 확인 필요";
  } catch { $("#cloudStatusText").textContent = "연결 확인 필요"; }
  if ("Notification" in window && Notification.permission === "default") {
    document.addEventListener("click", () => Notification.requestPermission().catch(() => {}), { once: true });
  }
}

init();
