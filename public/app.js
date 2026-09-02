const POSEIDON_BUILD = "6.16.0";
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
  law: "스마트 안전보건법령",
  msds: "스마트 MSDS",
  emergency: "119 신고",
  dsafety: "D-안전소통보드",
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
  privacy: { faceMosaic: false },
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
  stopWorkSeenIds: new Set(),
  stopWorkAlertInitialized: false,
  emergencySeenIds: new Set(),
  emergencyAlertInitialized: false,
  msds: { items: [], selectedId: null, query: "", stats: { count: 0, totalBytes: 0, softLimitBytes: 0 }, selectedFile: null },
  emergency: { config: null, position: null, chartScale: 1 },
  dSafety: { boards: [], selectedId: null, current: null, preview: null, siteFilter: "", dateFilter: "", retention: null },
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
  privacyCanvas: null,
  privacyTempCanvas: null,
  privacyStream: null,
  privacyRaf: 0,
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

const stopWorkState = {
  preRecorder: null,
  preStream: null,
  preChunks: [],
  preStartedAt: 0,
  preRotateTimer: null,
  lastBeforeBlob: null,
  lastBeforeDurationMs: 0,
  postRecorder: null,
  postStream: null,
  incident: null,
  countdownTimer: null,
  segmentMs: 10000,
};

const guardZoneEditor = {
  mode: "polygon",
  points: [],
  enabled: false,
  dirty: false,
  drag: null,
  pointerStart: null,
  suppressAdd: false,
  loopTimer: null,
  view: { x: 0, y: 0, width: 1280, height: 720 },
};

const adminZoneEditor = {
  mode: "polygon",
  drag: null,
  pointerStart: null,
  suppressAdd: false,
  view: { x: 0, y: 0, width: 1280, height: 720 },
  backgroundImage: null,
  backgroundUrl: null,
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
  const isFormDataBody = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body && !isFormDataBody && !(options.body instanceof Blob) && !(options.body instanceof ArrayBuffer) && !headers.has("content-type")) {
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
  if (state.session?.role === "user" && !["guard", "emergency", "dsafety", "law", "msds", "user-help"].includes(page)) page = "guard";
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
  if (page === "msds") loadMsdsDocuments();
  if (page === "emergency") loadEmergencyConfig();
  if (page === "dsafety") loadDSafetyBoards();
  if (page === "settings" && state.session?.role === "admin") loadPrivacyAdminEditor();
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
    checkAdminStopWorkAlerts(events);
    checkAdminEmergencyAlerts(events);
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

const lawSearchState = {
  lastQuery: "",
  loading: false,
};

function lawCategoryLabel(type) {
  if (type === "law") return "법령";
  if (type === "guide") return "KOSHA GUIDE";
  if (type === "media") return "안전보건 자료";
  return "공식자료";
}

function lawResultCard(item, type) {
  const badge = lawCategoryLabel(type);
  const category = item.categoryName || badge;
  const content = item.content || "검색된 공식 자료의 원문을 확인하세요.";
  const source = item.source || (type === "law" ? "국가법령정보센터" : "한국산업안전보건공단");
  const link = item.link || "";
  const directMatch = ["title-phrase", "content-phrase", "title-all-terms", "content-all-terms"].includes(item.matchType);
  return `<article class="law-result-card" data-law-type="${escapeHtml(type)}">
    <div class="law-result-head">
      <div class="law-result-badge-row"><span class="law-result-badge ${escapeHtml(type)}">${escapeHtml(badge)}</span>${directMatch ? `<span class="law-match-badge">검색어 일치</span>` : ""}</div>
      <small>${escapeHtml(source)}</small>
    </div>
    <h3>${escapeHtml(item.title || "제목 없음")}</h3>
    <p class="law-result-category">${escapeHtml(category)}</p>
    <div class="law-result-scroll-wrap">
      <div class="law-result-content" data-law-content tabindex="0" role="region" aria-label="${escapeHtml(item.title || "법령")} 내용">${escapeHtml(content)}</div>
      <span class="law-scroll-hint" aria-hidden="true">↕ 스크롤해서 전체 내용 보기</span>
    </div>
    <div class="law-result-actions">
      ${link ? `<a class="secondary-button" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">공식 원문 열기 ↗</a>` : ""}
    </div>
  </article>`;
}

function renderLawResults(data, query) {
  const law = Array.isArray(data?.law) ? data.law : [];
  const guide = Array.isArray(data?.guide) ? data.guide : [];
  const media = Array.isArray(data?.media) ? data.media : [];
  const total = law.length + guide.length + media.length;
  const summary = $("#lawResultSummary");
  summary.hidden = false;
  summary.innerHTML = `<div><b>“${escapeHtml(query)}”</b> 검색 결과 <strong>${total}건</strong></div><div class="law-count-pills"><span>법령 ${law.length}</span><span>KOSHA GUIDE ${guide.length}</span><span>자료 ${media.length}</span></div>`;

  const groups = [
    ["law", "관련 법령", law],
    ["guide", "KOSHA GUIDE", guide],
    ["media", "안전보건 자료", media],
  ].filter(([, , items]) => items.length);
  if (!groups.length) {
    $("#lawResults").innerHTML = `<div class="law-empty-state"><span>⌕</span><h3>검색 결과가 없습니다</h3><p>검색어를 짧게 바꿔보세요. 예: “밀폐공간 적정공기” → “적정공기”</p></div>`;
    return;
  }
  $("#lawResults").innerHTML = groups.map(([type, title, items]) => `<section class="law-result-group"><div class="law-group-title"><h3>${escapeHtml(title)}</h3><span>${items.length}건</span></div><div class="law-result-grid">${items.map((item) => lawResultCard(item, type)).join("")}</div></section>`).join("");
}

async function searchSafetyLaw(query, { navigate = true } = {}) {
  const q = String(query || "").trim();
  if (!q) { toast("검색어를 입력해주세요."); return; }
  if (navigate) goToPage("law");
  const input = $("#lawSearchInput");
  if (input) input.value = q;
  lawSearchState.lastQuery = q;
  lawSearchState.loading = true;
  const stateBox = $("#lawSearchState");
  stateBox?.classList.add("loading");
  if (stateBox) stateBox.innerHTML = `<span class="law-state-orb"></span><b>공식자료 검색 중</b><small>${escapeHtml(q)} 관련 법령과 안전보건 자료를 확인하고 있습니다.</small>`;
  if ($("#lawSearchButton")) $("#lawSearchButton").disabled = true;
  try {
    const data = await api(`/api/safety-law/search?q=${encodeURIComponent(q)}`);
    renderLawResults(data, q);
    if (stateBox) stateBox.innerHTML = `<span class="law-state-orb ready"></span><b>검색 완료</b><small>공식 데이터 검색 결과 · ${escapeHtml(data.searchedAtLabel || "방금")}</small>`;
  } catch (error) {
    if ($("#lawResultSummary")) $("#lawResultSummary").hidden = true;
    if ($("#lawResults")) $("#lawResults").innerHTML = `<div class="law-empty-state law-error-state"><span>!</span><h3>법령 검색을 연결하지 못했습니다</h3><p>${escapeHtml(error.message)}</p><small>관리자는 Cloudflare Secret의 KOSHA_API_KEY 설정을 확인해주세요.</small></div>`;
    if (stateBox) stateBox.innerHTML = `<span class="law-state-orb error"></span><b>검색 연결 확인 필요</b><small>공식 API 연결 상태를 확인해주세요.</small>`;
  } finally {
    lawSearchState.loading = false;
    stateBox?.classList.remove("loading");
    if ($("#lawSearchButton")) $("#lawSearchButton").disabled = false;
  }
}

function submitQuickLawSearch(inputId) {
  const input = $(inputId);
  const q = input?.value?.trim();
  if (!q) { toast("검색어를 입력해주세요."); input?.focus(); return; }
  searchSafetyLaw(q);
}

function renderKpis() {
  const s = state.summary || {};
  const cards = [
    { value: `${s.online || 0}/${s.totalDevices || 0}`, label: "정상 연결", target: "online" },
    { value: s.people || 0, label: "AI 감지 인원", target: "people" },
    { value: s.highRisk || 0, label: "고위험 이벤트", target: "high-risk" },
    { value: s.stopWork || 0, label: "작업중지권 발동", target: "stop-work", danger: true },
    { value: s.unacknowledged || 0, label: "관리자 조치 필요", target: "pending" },
  ];
  const grid = $("#kpiGrid");
  grid.innerHTML = cards.map((card) => `<button class="kpi-card${card.danger ? " stop-work-kpi" : ""}" type="button" data-kpi-target="${escapeHtml(card.target)}" aria-label="${escapeHtml(card.label)} 데이터 보기"><b>${escapeHtml(card.value)}</b><span>${escapeHtml(card.label)}</span><small>클릭하여 상세 보기 →</small></button>`).join("");
  $$('[data-kpi-target]', grid).forEach((button) => button.addEventListener("click", () => openKpiDrilldown(button.dataset.kpiTarget)));
}

function resetEventFilters() {
  if ($("#eventDeviceFilter")) $("#eventDeviceFilter").value = "";
  if ($("#eventCategoryFilter")) $("#eventCategoryFilter").value = "";
  if ($("#eventSeverityFilter")) $("#eventSeverityFilter").value = "";
  if ($("#eventStatusFilter")) $("#eventStatusFilter").value = "";
  if ($("#eventTimeFilter")) $("#eventTimeFilter").value = "";
}

function openKpiDrilldown(target) {
  if (target === "online" || target === "people") {
    goToPage("live");
    setTimeout(() => document.querySelector("#liveDevices")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    return;
  }
  goToPage("events");
  resetEventFilters();
  if (target === "high-risk") {
    if ($("#eventSeverityFilter")) $("#eventSeverityFilter").value = "highplus";
    if ($("#eventStatusFilter")) $("#eventStatusFilter").value = "pending";
  }
  if (target === "stop-work") {
    if ($("#eventCategoryFilter")) $("#eventCategoryFilter").value = "작업중지권";
    if ($("#eventStatusFilter")) $("#eventStatusFilter").value = "pending";
  }
  if (target === "pending" && $("#eventStatusFilter")) $("#eventStatusFilter").value = "pending";
  renderEventTable();
  setTimeout(() => document.querySelector("#eventTableBody")?.closest(".table-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
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
  const statusFilter = $("#eventStatusFilter")?.value || "";
  const timeFilter = $("#eventTimeFilter")?.value || "";
  const now = Date.now();
  const cutoff = timeFilter === "24h" ? now - 86400000 : timeFilter === "7d" ? now - 7 * 86400000 : 0;
  const items = state.events.filter((event) => {
    const eventTime = new Date(event.occurredAt).getTime();
    const severityOk = !severityFilter || (severityFilter === "highplus" ? ["high", "critical"].includes(event.severity) : event.severity === severityFilter);
    const statusOk = !statusFilter || (statusFilter === "pending" ? !event.acknowledged : statusFilter === "done" ? Boolean(event.acknowledged) : true);
    return (!deviceFilter || event.deviceId === deviceFilter)
      && (!categoryFilter || event.category === categoryFilter)
      && severityOk
      && statusOk
      && (!cutoff || eventTime >= cutoff);
  });
  body.innerHTML = items.map((event) => `<tr class="${event.type === "STOP_WORK_REQUEST" ? "stop-work-event-row" : ""}"><td>${formatDate(event.occurredAt)}</td><td>${escapeHtml(event.deviceName)}</td><td>${escapeHtml(event.category)}</td><td><span class="severity-pill ${escapeHtml(event.severity)}">${severityLabel(event.severity)}</span></td><td>${eventMessageHtml(event)}</td><td>${escapeHtml(event.status)}</td><td><div class="event-actions">${event.acknowledged ? "<span>완료</span>" : `<button class="table-action" data-event-ack="${escapeHtml(event.id)}">확인 완료</button>`}<button class="table-action danger-action" data-event-delete="${escapeHtml(event.id)}">삭제</button></div></td></tr>`).join("") || `<tr><td colspan="7">조회된 이벤트가 없습니다.</td></tr>`;
  $$('[data-event-ack]', body).forEach((button) => button.addEventListener("click", () => acknowledgeEvent(button.dataset.eventAck)));
  $$('[data-event-delete]', body).forEach((button) => button.addEventListener("click", () => deleteEvent(button.dataset.eventDelete)));
  $$('[data-event-stop-video]', body).forEach((button) => button.addEventListener("click", () => {
    const event = state.events.find((item) => item.id === button.dataset.eventStopVideo);
    if (event) openStopWorkVideo(event.metadata?.beforeClipUrl, event.metadata?.afterClipUrl, event.metadata?.clipUrl);
  }));
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
  const points = [top ? `최근 24시간 가장 많이 발생한 유형은 ‘${top[0]}’ ${top[1]}건입니다.` : "최근 24시간 누적 이벤트가 없습니다.", `${s.online || 0}대의 현장 지킴이가 중앙 관제에 연결되어 있습니다.`, s.unacknowledged ? `확인이 필요한 이벤트가 ${s.unacknowledged}건 남아 있습니다.` : "모든 이벤트가 확인된 상태입니다."];
  $("#aiBriefing").innerHTML = `<div class="brief-main">${main}</div><div class="ai-points">${points.map((point) => `<div class="ai-point"><i></i><span>${escapeHtml(point)}</span></div>`).join("")}</div>`;
}

function updateDeviceSelects() {
  const options = state.devices.map((device) => `<option value="${escapeHtml(device.id)}">${escapeHtml(device.name)} · ${escapeHtml(device.area)}</option>`).join("");
  [$("#zoneDeviceSelect"), $("#privacyDeviceSelect"), ...$$(".rule-device-select")].filter(Boolean).forEach((select) => {
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
    $("#eventRetentionStats").textContent = `현재 ${data.eventCount || 0}건 · 이벤트 미디어 ${formatTrainingBytes(data.snapshotBytes || 0)} · 매일 자동 정리`;
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
  const outboundStream = getGuardOutboundVideoStream();
  for (const track of outboundStream.getVideoTracks()) pc.addTrack(track, outboundStream);
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
  $("#guardFaceMosaic").checked = saved.faceMosaic === true;
  guard.config.privacy ||= {};
  guard.config.privacy.faceMosaic = saved.faceMosaic === true;
}

function saveGuardProfile() {
  localStorage.setItem("ssg-guard-profile", JSON.stringify({
    name: $("#guardDeviceName").value.trim(),
    site: $("#guardSite").value.trim(),
    area: $("#guardArea").value.trim(),
    cameraId: $("#guardCameraSelect").value,
    voiceEnabled: $("#guardVoiceEnabled").checked,
    zoneEnabled: $("#guardZoneEnabled").checked,
    faceMosaic: $("#guardFaceMosaic").checked,
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
    startStopWorkRollingBuffer();
    await registerGuard();
    await fetchGuardConfig();
    drawGuardZoneEditor();
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
  stopStopWorkRollingBuffer();
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
  stopGuardPrivacyStream();
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
  localStorage.setItem("ssg-guard-profile", JSON.stringify({ ...profile, cameraId: $("#guardCameraSelect").value, voiceEnabled: $("#guardVoiceEnabled").checked, zoneEnabled: $("#guardZoneEnabled").checked, faceMosaic: $("#guardFaceMosaic")?.checked === true }));
  await api("/api/agents/register", { method: "POST", body: JSON.stringify({ deviceId: getGuardDeviceId(), ...profile, cameraLabel: $("#guardCameraSelect").selectedOptions[0]?.textContent || "브라우저 카메라", agentVersion: "browser-yolo11n-3.0", config: guard.config }) });
}

async function fetchGuardConfig() {
  if (!guard.active) return;
  try {
    guard.config = await api(`/api/devices/${encodeURIComponent(getGuardDeviceId())}/config`);
    $("#guardVoiceEnabled").checked = guard.config.voice?.enabled !== false;
    if ($("#guardFaceMosaic")) $("#guardFaceMosaic").checked = guard.config.privacy?.faceMosaic === true;
    refreshGuardPrivacyTracks();
    if (!guardZoneEditor.dirty) syncGuardZoneEditorFromConfig();
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
  if (!video.videoWidth || !video.videoHeight) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const stage = $("#guardCameraStage");
  if (stage) stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  drawGuardZoneEditor();
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
    // 화면 표시 ROI는 안전모뿐 아니라 보안경·마스크까지 한 번에 보이도록
    // 머리 꼭대기부터 턱 아래까지 넉넉히 포함합니다. 내부 person anchor는 그대로 유지합니다.
    const roiBase = head || anchor;
    const roi = head
      ? {
          x: roiBase.x - roiBase.width * 0.08,
          y: roiBase.y - roiBase.height * 0.05,
          width: roiBase.width * 1.16,
          height: roiBase.height * 1.62,
        }
      : {
          x: anchor.x + anchor.width * 0.14,
          y: anchor.y + anchor.height * 0.01,
          width: anchor.width * 0.72,
          height: Math.min(anchor.height * 0.56, anchor.width * 0.98),
        };
    const displayBox = {
      x: Math.max(0, roi.x),
      y: Math.max(0, roi.y),
      width: Math.max(8, Math.min(sourceWidth - Math.max(0, roi.x), roi.width)),
      height: Math.max(8, Math.min(sourceHeight - Math.max(0, roi.y), roi.height)),
      score: roiBase.score,
      label: "HEAD-FACE-MASK-ROI",
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

function faceMosaicEnabled() {
  return guard.config?.privacy?.faceMosaic === true;
}

function getFaceMosaicRegions() {
  const regions = [];
  const srcW = guard.latestSourceWidth || $("#guardVideo")?.videoWidth || 0;
  const srcH = guard.latestSourceHeight || $("#guardVideo")?.videoHeight || 0;
  if (!srcW || !srcH) return regions;
  for (const worker of guard.latestAssessments || []) {
    const box = worker.displayBox || worker.anchor;
    if (box?.width > 2 && box?.height > 2) regions.push({ x: box.x, y: box.y, width: box.width, height: box.height });
  }
  if (!regions.length) {
    for (const person of guard.personDetections || []) {
      regions.push({ x: person.x + person.width * 0.18, y: Math.max(0, person.y - person.height * 0.03), width: person.width * 0.64, height: person.height * 0.42 });
    }
  }
  return regions;
}

function drawPixelatedRegion(ctx, video, sourceBox, destScaleX = 1, destScaleY = 1) {
  if (!video?.videoWidth || !sourceBox?.width || !sourceBox?.height) return;
  guard.privacyTempCanvas ||= document.createElement("canvas");
  const temp = guard.privacyTempCanvas;
  const sx = Math.max(0, sourceBox.x), sy = Math.max(0, sourceBox.y);
  const sw = Math.min(video.videoWidth - sx, sourceBox.width), sh = Math.min(video.videoHeight - sy, sourceBox.height);
  if (sw <= 1 || sh <= 1) return;
  const pixel = Math.max(8, Math.min(22, Math.round(Math.min(sw, sh) / 14)));
  temp.width = Math.max(4, Math.round(sw / pixel));
  temp.height = Math.max(4, Math.round(sh / pixel));
  const tctx = temp.getContext("2d");
  tctx.imageSmoothingEnabled = true;
  tctx.clearRect(0, 0, temp.width, temp.height);
  tctx.drawImage(video, sx, sy, sw, sh, 0, 0, temp.width, temp.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(temp, 0, 0, temp.width, temp.height, sx * destScaleX, sy * destScaleY, sw * destScaleX, sh * destScaleY);
  ctx.restore();
}

function drawFaceMosaicOverlay(ctx, scaleX, scaleY) {
  if (!faceMosaicEnabled()) return;
  const video = $("#guardVideo");
  for (const region of getFaceMosaicRegions()) drawPixelatedRegion(ctx, video, region, scaleX, scaleY);
}

function ensureGuardPrivacyStream() {
  if (!faceMosaicEnabled() || !guard.active) return guard.stream;
  const video = $("#guardVideo");
  if (!video?.videoWidth || typeof HTMLCanvasElement === "undefined") return guard.stream;
  guard.privacyCanvas ||= document.createElement("canvas");
  const canvas = guard.privacyCanvas;
  if (!canvas.captureStream) return guard.stream;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  if (!guard.privacyStream) guard.privacyStream = canvas.captureStream(isMobile() ? 12 : 18);
  if (!guard.privacyRaf) {
    const loop = () => {
      guard.privacyRaf = 0;
      if (!guard.active || !faceMosaicEnabled()) return;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      for (const region of getFaceMosaicRegions()) drawPixelatedRegion(ctx, video, region, 1, 1);
      guard.privacyRaf = requestAnimationFrame(loop);
    };
    guard.privacyRaf = requestAnimationFrame(loop);
  }
  return guard.privacyStream || guard.stream;
}

function stopGuardPrivacyStream() {
  if (guard.privacyRaf) cancelAnimationFrame(guard.privacyRaf);
  guard.privacyRaf = 0;
  guard.privacyStream?.getTracks().forEach((track) => track.stop());
  guard.privacyStream = null;
}

function getGuardOutboundVideoStream() {
  return faceMosaicEnabled() ? ensureGuardPrivacyStream() : guard.stream;
}

async function refreshGuardPrivacyTracks() {
  if (!guard.active) return;
  if (faceMosaicEnabled()) ensureGuardPrivacyStream();
  const stream = getGuardOutboundVideoStream();
  const track = stream?.getVideoTracks?.()[0];
  if (!track) return;
  for (const pc of realtime.guardVideoPeers.values()) {
    const sender = pc.getSenders().find((item) => item.track?.kind === "video");
    if (sender) try { await sender.replaceTrack(track); } catch { /* reconnect will recover */ }
  }
  if (!faceMosaicEnabled()) stopGuardPrivacyStream();
  drawGuardOverlay(guard.detections, guard.latestSourceWidth, guard.latestSourceHeight, [], guard.latestAssessments);
}

async function saveGuardPrivacySetting() {
  const enabled = $("#guardFaceMosaic")?.checked === true;
  guard.config.privacy ||= {};
  guard.config.privacy.faceMosaic = enabled;
  const saved = JSON.parse(localStorage.getItem("ssg-guard-profile") || "{}");
  localStorage.setItem("ssg-guard-profile", JSON.stringify({ ...saved, faceMosaic: enabled }));
  await refreshGuardPrivacyTracks();
  if (guard.active) {
    try { await api("/api/guard/privacy", { method: "PUT", body: JSON.stringify({ deviceId: getGuardDeviceId(), faceMosaic: enabled }) }); } catch (error) { toast(`비식별화 설정 저장 실패: ${error.message}`); }
  }
  toast(enabled ? "얼굴 비식별화 모자이크를 켰습니다." : "얼굴 비식별화를 껐습니다.");
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
  drawFaceMosaicOverlay(ctx, scaleX, scaleY);

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

function chooseStopWorkMimeType() {
  if (!("MediaRecorder" in window)) return "";
  const candidates = [
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

function createStopWorkRecorder(onFinished) {
  if (!guard.stream || !("MediaRecorder" in window)) return null;
  const recordingSource = guard.config.privacy?.faceMosaic === true ? getGuardOutboundVideoStream() : guard.stream;
  const videoTracks = recordingSource.getVideoTracks().filter((track) => track.readyState === "live");
  if (!videoTracks.length) return null;
  const stream = new MediaStream(videoTracks.map((track) => track.clone()));
  const mimeType = chooseStopWorkMimeType();
  const chunks = [];
  const startedAt = Date.now();
  try {
    const recorder = new MediaRecorder(stream, {
      videoBitsPerSecond: isMobile() ? 220000 : 320000,
      ...(mimeType ? { mimeType } : {}),
    });
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = (event) => console.warn("stop-work recorder", event?.error || event);
    recorder.onstop = () => {
      const durationMs = Math.max(0, Date.now() - startedAt);
      const type = recorder.mimeType || mimeType || chunks[0]?.type || "video/webm";
      const blob = chunks.length ? new Blob(chunks, { type }) : null;
      stream.getTracks().forEach((track) => track.stop());
      onFinished?.({ blob, durationMs, type });
    };
    recorder.start();
    return { recorder, stream, startedAt };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    console.warn("stop-work recorder start", error);
    return null;
  }
}

function startStopWorkPreSegment() {
  if (!guard.active || stopWorkState.incident) return;
  clearTimeout(stopWorkState.preRotateTimer);
  const pack = createStopWorkRecorder(({ blob, durationMs }) => {
    stopWorkState.preRecorder = null;
    stopWorkState.preStream = null;
    if (blob?.size) {
      stopWorkState.lastBeforeBlob = blob;
      stopWorkState.lastBeforeDurationMs = durationMs;
    }
    if (guard.active && !stopWorkState.incident) startStopWorkPreSegment();
  });
  if (!pack) {
    updateStopWorkRecordStatus("이 브라우저는 작업중지 사전 영상 기록을 지원하지 않습니다. 사유와 현장 사진은 정상 전송됩니다.", "warn");
    return;
  }
  stopWorkState.preRecorder = pack.recorder;
  stopWorkState.preStream = pack.stream;
  stopWorkState.preStartedAt = pack.startedAt;
  stopWorkState.preRotateTimer = setTimeout(() => {
    if (stopWorkState.preRecorder?.state === "recording" && !stopWorkState.incident) {
      try { stopWorkState.preRecorder.stop(); } catch { /* noop */ }
    }
  }, stopWorkState.segmentMs);
}

function startStopWorkRollingBuffer() {
  stopStopWorkRollingBuffer(false);
  if (!guard.stream || !("MediaRecorder" in window)) {
    updateStopWorkRecordStatus("이 브라우저는 사전 영상 버퍼를 지원하지 않습니다. 요청 내용은 정상 전송됩니다.", "warn");
    return;
  }
  startStopWorkPreSegment();
}

function stopStopWorkRollingBuffer(clearIncident = true) {
  clearInterval(stopWorkState.countdownTimer);
  clearTimeout(stopWorkState.preRotateTimer);
  stopWorkState.countdownTimer = null;
  stopWorkState.preRotateTimer = null;
  for (const recorder of [stopWorkState.preRecorder, stopWorkState.postRecorder]) {
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* noop */ }
    }
  }
  stopWorkState.preRecorder = null;
  stopWorkState.postRecorder = null;
  stopWorkState.preStream?.getTracks().forEach((track) => track.stop());
  stopWorkState.postStream?.getTracks().forEach((track) => track.stop());
  stopWorkState.preStream = null;
  stopWorkState.postStream = null;
  stopWorkState.lastBeforeBlob = null;
  stopWorkState.lastBeforeDurationMs = 0;
  if (clearIncident) stopWorkState.incident = null;
}

function startStopWorkPostRecording() {
  const incident = stopWorkState.incident;
  if (!incident) return;
  const pack = createStopWorkRecorder(({ blob, durationMs }) => {
    stopWorkState.postRecorder = null;
    stopWorkState.postStream = null;
    if (!stopWorkState.incident || stopWorkState.incident !== incident) return;
    incident.afterClip = blob?.size ? blob : null;
    incident.afterDurationMs = durationMs;
    incident.recording = false;
    clearInterval(stopWorkState.countdownTimer);
    stopWorkState.countdownTimer = null;
    const beforeText = incident.beforeClip ? `전 ${Math.max(1, Math.round((incident.beforeDurationMs || 0) / 1000))}초` : "전 영상 없음";
    const afterText = incident.afterClip ? `후 ${Math.max(1, Math.round((incident.afterDurationMs || 0) / 1000))}초` : "후 영상 없음";
    updateStopWorkRecordStatus(`영상 준비 완료 · ${beforeText} / ${afterText}`, incident.beforeClip || incident.afterClip ? "ready" : "warn");
    $("#submitStopWork").disabled = false;
  });
  if (!pack) {
    incident.recording = false;
    updateStopWorkRecordStatus("사후 영상 기록을 시작하지 못했습니다. 사유와 현장 사진은 전송할 수 있습니다.", "warn");
    $("#submitStopWork").disabled = false;
    return;
  }
  stopWorkState.postRecorder = pack.recorder;
  stopWorkState.postStream = pack.stream;
  let remaining = 10;
  updateStopWorkRecordStatus(`발동 전 영상 확보 · 발동 후 ${remaining}초 기록 중`, "recording");
  clearInterval(stopWorkState.countdownTimer);
  stopWorkState.countdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) updateStopWorkRecordStatus(`발동 전 영상 확보 · 발동 후 ${remaining}초 기록 중`, "recording");
  }, 1000);
  setTimeout(() => {
    if (stopWorkState.postRecorder === pack.recorder && pack.recorder.state === "recording") {
      try { pack.recorder.stop(); } catch { /* noop */ }
    }
  }, 10000);
}

function updateStopWorkRecordStatus(text, tone = "") {
  const target = $("#stopWorkRecordStatus");
  if (!target) return;
  target.textContent = text;
  target.dataset.tone = tone;
}

function beginStopWorkRequest() {
  if (!guard.active) return toast("작업중지권 기록을 위해 먼저 지킴이를 시작해주세요.", 4500);
  if (stopWorkState.incident?.recording) return toast("작업중지권 영상 기록이 진행 중입니다.");
  unlockAudio();
  const saved = JSON.parse(localStorage.getItem("poseidon-stop-work-reporter") || "{}");
  $("#stopWorkReporterName").value = saved.name || "";
  $("#stopWorkReporterContact").value = saved.contact || "";
  $("#stopWorkReason").value = "";
  $("#stopWorkModal").hidden = false;
  $("#submitStopWork").disabled = true;

  const clickedAt = Date.now();
  const incident = stopWorkState.incident = {
    clickedAt,
    beforeClip: null,
    beforeDurationMs: 0,
    afterClip: null,
    afterDurationMs: 0,
    recording: true,
    snapshotBase64: captureGuardSnapshot(0.62, 840),
  };

  clearTimeout(stopWorkState.preRotateTimer);
  stopWorkState.preRotateTimer = null;
  const currentDuration = Math.max(0, clickedAt - (stopWorkState.preStartedAt || clickedAt));
  const previousBlob = stopWorkState.lastBeforeBlob;
  const previousDuration = stopWorkState.lastBeforeDurationMs;
  const currentRecorder = stopWorkState.preRecorder;

  if (currentRecorder && currentRecorder.state === "recording") {
    const currentStream = stopWorkState.preStream;
    const currentStartedAt = stopWorkState.preStartedAt;
    const chunks = [];
    // Rebind handlers so stopping the current segment yields one valid standalone media file.
    currentRecorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    currentRecorder.onstop = () => {
      const durationMs = Math.max(0, Date.now() - currentStartedAt);
      const type = currentRecorder.mimeType || chooseStopWorkMimeType() || chunks[0]?.type || "video/webm";
      const currentBlob = chunks.length ? new Blob(chunks, { type }) : null;
      currentStream?.getTracks().forEach((track) => track.stop());
      stopWorkState.preRecorder = null;
      stopWorkState.preStream = null;
      // 클릭 직후라 현재 조각이 너무 짧으면 직전의 완성된 약 10초 파일을 사용합니다.
      if (currentBlob?.size && durationMs >= 2200) {
        incident.beforeClip = currentBlob;
        incident.beforeDurationMs = durationMs;
      } else if (previousBlob?.size) {
        incident.beforeClip = previousBlob;
        incident.beforeDurationMs = previousDuration;
      } else if (currentBlob?.size) {
        incident.beforeClip = currentBlob;
        incident.beforeDurationMs = durationMs;
      }
      startStopWorkPostRecording();
    };
    try { currentRecorder.stop(); } catch { startStopWorkPostRecording(); }
  } else {
    if (previousBlob?.size) {
      incident.beforeClip = previousBlob;
      incident.beforeDurationMs = previousDuration || currentDuration;
    }
    startStopWorkPostRecording();
  }
}

function closeStopWorkModal() {
  clearInterval(stopWorkState.countdownTimer);
  stopWorkState.countdownTimer = null;
  const postRecorder = stopWorkState.postRecorder;
  stopWorkState.incident = null;
  if (postRecorder && postRecorder.state !== "inactive") {
    try { postRecorder.stop(); } catch { /* noop */ }
  }
  stopWorkState.postRecorder = null;
  stopWorkState.postStream?.getTracks().forEach((track) => track.stop());
  stopWorkState.postStream = null;
  $("#stopWorkModal").hidden = true;
  if (guard.active && !stopWorkState.preRecorder) setTimeout(startStopWorkPreSegment, 80);
}

async function submitStopWorkRequest() {
  const incident = stopWorkState.incident;
  if (!incident) return;
  if (incident.recording) return toast("사고 이후 10초 영상을 기록 중입니다. 잠시만 기다려주세요.", 4500);
  const reason = $("#stopWorkReason").value.trim();
  const reporterName = $("#stopWorkReporterName").value.trim();
  const reporterContact = $("#stopWorkReporterContact").value.trim();
  if (!reason) return toast("작업중지 사유를 작성해주세요.");
  if (!reporterName) return toast("발동자 이름을 입력해주세요.");

  const button = $("#submitStopWork");
  button.disabled = true;
  button.textContent = "관리자에게 전송 중...";
  try {
    const form = new FormData();
    form.append("deviceId", getGuardDeviceId());
    form.append("reporterName", reporterName);
    form.append("reporterContact", reporterContact);
    form.append("reason", reason);
    form.append("occurredAt", new Date(incident.clickedAt).toISOString());
    if (incident.snapshotBase64) form.append("snapshotBase64", incident.snapshotBase64);
    if (incident.beforeClip) {
      const ext = (incident.beforeClip.type || "").includes("mp4") ? "mp4" : "webm";
      form.append("beforeClip", incident.beforeClip, `stop-work-before-${Date.now()}.${ext}`);
    }
    if (incident.afterClip) {
      const ext = (incident.afterClip.type || "").includes("mp4") ? "mp4" : "webm";
      form.append("afterClip", incident.afterClip, `stop-work-after-${Date.now()}.${ext}`);
    }
    const result = await api("/api/stop-work", { method: "POST", body: form });
    localStorage.setItem("poseidon-stop-work-reporter", JSON.stringify({ name: reporterName, contact: reporterContact }));
    closeStopWorkModal();
    showGuardWarning("작업중지권이 관리자에게 접수되었습니다.");
    speak("작업중지 요청이 관리자에게 접수되었습니다.");
    toast(result.notificationSummary || "작업중지권을 관리자에게 전송했습니다.", 6000);
    // 접수 직후 현장과 관제센터가 바로 대화할 수 있도록 무전 호출도 시도합니다.
    if (callState.status === "idle") setTimeout(() => initiateGuardCall(), 500);
  } catch (error) {
    toast(`작업중지권 전송 실패: ${error.message}`, 6000);
  } finally {
    button.disabled = false;
    button.textContent = "작업중지 요청 보내기";
  }
}

function eventMessageHtml(event) {
  const links = [];
  if (event.snapshotUrl) links.push(`<a href="${escapeHtml(event.snapshotUrl)}" target="_blank" rel="noopener">현장 사진</a>`);
  const hasStopWorkVideo = Boolean(event.metadata?.beforeClipUrl || event.metadata?.afterClipUrl || event.metadata?.clipUrl);
  if (hasStopWorkVideo) links.push(`<button class="event-video-button" type="button" data-event-stop-video="${escapeHtml(event.id)}">전후 영상</button>`);
  if (event.type === "EMERGENCY_119" && event.metadata?.mapUrl) links.push(`<a href="${escapeHtml(event.metadata.mapUrl)}" target="_blank" rel="noopener">GPS 지도</a>`);
  const details = event.type === "STOP_WORK_REQUEST"
    ? `<small class="stop-work-event-detail">발동자 ${escapeHtml(event.metadata?.reporterName || "-")} · ${escapeHtml(event.metadata?.reporterContact || "연락처 미입력")}</small>`
    : event.type === "EMERGENCY_119"
      ? `<small class="stop-work-event-detail">신고자 ${escapeHtml(event.metadata?.reporterName || "-")} · GPS ${escapeHtml(String(event.metadata?.latitude ?? "-"))}, ${escapeHtml(String(event.metadata?.longitude ?? "-"))}</small>`
      : "";
  return `<div class="event-message-cell"><b>${escapeHtml(event.message)}</b>${details}${links.length ? `<div class="event-media-links">${links.join("")}</div>` : ""}</div>`;
}

function checkAdminStopWorkAlerts(events = []) {
  if (state.session?.role !== "admin") return;
  const stopEvents = events.filter((event) => event.type === "STOP_WORK_REQUEST");
  if (!state.stopWorkAlertInitialized) {
    state.stopWorkAlertInitialized = true;
    stopEvents.forEach((event) => state.stopWorkSeenIds.add(event.id));
    const latestOpen = stopEvents.find((event) => !event.acknowledged);
    if (latestOpen) showAdminStopWorkAlert(latestOpen);
    return;
  }
  for (const event of [...stopEvents].reverse()) {
    if (state.stopWorkSeenIds.has(event.id)) continue;
    state.stopWorkSeenIds.add(event.id);
    showAdminStopWorkAlert(event);
  }
}

function checkAdminEmergencyAlerts(events = []) {
  if (state.session?.role !== "admin") return;
  const emergencyEvents = events.filter((event) => event.type === "EMERGENCY_119");
  if (!state.emergencyAlertInitialized) {
    state.emergencyAlertInitialized = true;
    emergencyEvents.forEach((event) => state.emergencySeenIds.add(event.id));
    const latestOpen = emergencyEvents.find((event) => !event.acknowledged);
    if (latestOpen) showAdminEmergencyAlert(latestOpen);
    return;
  }
  for (const event of [...emergencyEvents].reverse()) {
    if (state.emergencySeenIds.has(event.id)) continue;
    state.emergencySeenIds.add(event.id);
    showAdminEmergencyAlert(event);
  }
}

function showAdminEmergencyAlert(event) {
  $(".admin-emergency-alert")?.remove();
  const card = document.createElement("aside");
  card.className = "admin-stop-work-alert admin-emergency-alert";
  card.innerHTML = `<div class="admin-stop-work-alert-icon">119</div><div class="admin-stop-work-alert-copy"><span>긴급 · 119 GPS 비상신고</span><b>${escapeHtml(event.deviceName || event.deviceId)}</b><p>${escapeHtml(event.metadata?.note || event.message || "비상상황")}</p><small>GPS ${escapeHtml(String(event.metadata?.latitude ?? "-"))}, ${escapeHtml(String(event.metadata?.longitude ?? "-"))}</small></div><div class="admin-stop-work-alert-actions">${event.metadata?.mapUrl ? `<button type="button" data-emergency-map>GPS 지도</button>` : ""}<button type="button" data-emergency-open>이벤트 확인</button></div>`;
  document.body.append(card);
  $("[data-emergency-map]", card)?.addEventListener("click", () => window.open(event.metadata.mapUrl, "_blank", "noopener"));
  $("[data-emergency-open]", card)?.addEventListener("click", () => { card.remove(); goToPage("events"); if ($("#eventCategoryFilter")) $("#eventCategoryFilter").value = "비상신고"; renderEventTable(); });
  setTimeout(() => { if (card.isConnected) card.remove(); }, 30000);
}

function showAdminStopWorkAlert(event) {
  $(".admin-stop-work-alert")?.remove();
  const card = document.createElement("aside");
  card.className = "admin-stop-work-alert";
  const reason = event.metadata?.reason || event.message || "작업중지 요청";
  card.innerHTML = `
    <div class="admin-stop-work-alert-icon">!</div>
    <div class="admin-stop-work-alert-copy">
      <span>긴급 · 작업중지권 발동</span>
      <b>${escapeHtml(event.deviceName || event.deviceId)}</b>
      <p>${escapeHtml(reason)}</p>
    </div>
    <div class="admin-stop-work-alert-actions">
      ${(event.metadata?.beforeClipUrl || event.metadata?.afterClipUrl || event.metadata?.clipUrl) ? `<button type="button" data-stop-work-video>전후 영상</button>` : ""}
      <button type="button" data-stop-work-call>현장 무전</button>
      <button type="button" data-stop-work-open>이벤트 확인</button>
    </div>`;
  document.body.append(card);
  $("[data-stop-work-video]", card)?.addEventListener("click", () => { card.remove(); openStopWorkVideo(event.metadata?.beforeClipUrl, event.metadata?.afterClipUrl, event.metadata?.clipUrl); });
  $("[data-stop-work-open]", card)?.addEventListener("click", () => {
    card.remove();
    goToPage("events");
  });
  $("[data-stop-work-call]", card)?.addEventListener("click", () => { card.remove(); initiateAdminCall(event.deviceId); });
  setTimeout(() => card.remove(), 30000);
  toast(`작업중지권 발동 · ${event.deviceName || event.deviceId}`, 7000);
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("POSEIDON 작업중지권 발동", {
        body: `${event.deviceName || event.deviceId} · ${reason}`,
        tag: `stop-work-${event.id}`,
      });
    } catch { /* noop */ }
  }
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

/* ---------- Field danger-zone editor ---------- */

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function isAxisAlignedRectangle(points = []) {
  if (points.length !== 4) return false;
  const epsilon = 0.02;
  const [a, b, c, d] = points;
  return Math.abs(a[1] - b[1]) < epsilon && Math.abs(b[0] - c[0]) < epsilon && Math.abs(c[1] - d[1]) < epsilon && Math.abs(d[0] - a[0]) < epsilon;
}

function defaultGuardRectangle() {
  return [[0.18, 0.20], [0.82, 0.20], [0.82, 0.82], [0.18, 0.82]];
}

function syncGuardZoneEditorFromConfig() {
  const zone = guard.config?.zones?.[0] || defaultConfig().zones[0];
  const points = Array.isArray(zone.points) ? zone.points.map(([x, y]) => [clamp01(x), clamp01(y)]) : [];
  guardZoneEditor.points = points;
  guardZoneEditor.enabled = zone.enabled !== false && guard.config?.rules?.dangerZone !== false;
  guardZoneEditor.mode = zone.shape === "rectangle" || isAxisAlignedRectangle(points) ? "rectangle" : "polygon";
  guardZoneEditor.dirty = false;
  if ($("#guardZoneName")) $("#guardZoneName").value = zone.name || "출입 제한 구역";
  if ($("#guardZoneSeverity")) $("#guardZoneSeverity").value = zone.severity || "high";
  if ($("#guardZoneEditorEnabled")) $("#guardZoneEditorEnabled").checked = guardZoneEditor.enabled;
  if ($("#guardZoneEnabled")) $("#guardZoneEnabled").checked = guardZoneEditor.enabled;
  updateGuardZoneModeUi();
  drawGuardZoneEditor();
}

function updateGuardZoneModeUi() {
  $$('[data-guard-zone-mode]').forEach((button) => button.classList.toggle("active", button.dataset.guardZoneMode === guardZoneEditor.mode));
  const rectangle = guardZoneEditor.mode === "rectangle";
  if ($("#guardZoneEditorHint")) $("#guardZoneEditorHint").textContent = rectangle
    ? "사각형 모드 · 안쪽 드래그=이동 · 8개 손잡이=크기조절 · X/Delete=삭제"
    : "다각형 모드 · 화면을 3곳 이상 터치하세요. 빨간 점도 끌어서 조정할 수 있습니다.";
  if ($("#guardZoneHelp")) $("#guardZoneHelp").innerHTML = rectangle
    ? "<b>PPT처럼 편집</b><span>사각형 안쪽을 끌어 이동하고 8개 흰색 손잡이로 크기를 조절합니다. 빨간 X 또는 Delete 키로 삭제한 뒤 저장하세요.</span>"
    : "<b>다각형 사용법</b><span>카메라 화면을 3곳 이상 터치하면 선이 연결됩니다. 빨간 점은 다시 끌어서 위치를 조정할 수 있습니다.</span>";
  if ($("#guardZoneUndo")) $("#guardZoneUndo").disabled = rectangle || !guardZoneEditor.points.length;
}

function setGuardZoneMode(mode) {
  if (!["polygon", "rectangle"].includes(mode)) return;
  guardZoneEditor.mode = mode;
  guardZoneEditor.dirty = true;
  if (mode === "rectangle" && !isAxisAlignedRectangle(guardZoneEditor.points)) guardZoneEditor.points = defaultGuardRectangle();
  if (mode === "polygon" && isAxisAlignedRectangle(guardZoneEditor.points)) guardZoneEditor.points = [];
  updateGuardZoneModeUi();
  drawGuardZoneEditor();
}

function startGuardZoneEditorLoop() {
  clearInterval(guardZoneEditor.loopTimer);
  guardZoneEditor.loopTimer = setInterval(() => {
    if (state.session?.role === "user" && state.currentPage === "guard" && !document.hidden) drawGuardZoneEditor();
  }, 220);
}

function drawGuardZoneEditor() {
  const canvas = $("#guardZoneCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const video = $("#guardVideo");
  ctx.fillStyle = "#06131c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let view = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  if (guard.active && video?.readyState >= 2 && video.videoWidth && video.videoHeight) {
    const sourceRatio = video.videoWidth / video.videoHeight;
    const targetRatio = canvas.width / canvas.height;
    if (sourceRatio > targetRatio) {
      view.width = canvas.width;
      view.height = canvas.width / sourceRatio;
      view.x = 0;
      view.y = (canvas.height - view.height) / 2;
    } else {
      view.height = canvas.height;
      view.width = canvas.height * sourceRatio;
      view.y = 0;
      view.x = (canvas.width - view.width) / 2;
    }
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, view.x, view.y, view.width, view.height);
  } else {
    ctx.fillStyle = "rgba(145,169,178,.92)";
    ctx.font = "600 24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("지킴이를 시작하면 현재 카메라 화면이 표시됩니다.", canvas.width / 2, canvas.height / 2);
  }
  guardZoneEditor.view = view;

  const points = guardZoneEditor.points;
  if (!points.length) return;
  const px = (x) => view.x + x * view.width;
  const py = (y) => view.y + y * view.height;
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)));
  if (points.length >= 3) ctx.closePath();
  if (points.length >= 3) {
    ctx.fillStyle = guardZoneEditor.enabled ? "rgba(255,53,94,.18)" : "rgba(255,157,87,.11)";
    ctx.fill();
  }
  ctx.strokeStyle = guardZoneEditor.enabled ? "#ff355e" : "#ff9d57";
  ctx.lineWidth = 5;
  ctx.stroke();
  drawZoneSelectionControls(ctx, canvas, points, guardZoneEditor.mode, view);
}

function guardZonePointerPosition(event) {
  const canvas = $("#guardZoneCanvas");
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);
  const canvasX = (event.clientX - rect.left) * scaleX;
  const canvasY = (event.clientY - rect.top) * scaleY;
  const view = guardZoneEditor.view || { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const inside = canvasX >= view.x && canvasX <= view.x + view.width && canvasY >= view.y && canvasY <= view.y + view.height;
  return {
    x: clamp01((canvasX - view.x) / Math.max(1, view.width)),
    y: clamp01((canvasY - view.y) / Math.max(1, view.height)),
    rect,
    view,
    inside,
    canvasX,
    canvasY,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  };
}

function zoneBounds(points = []) {
  if (!points.length) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

function rectangleHandlePoints(points = []) {
  const b = zoneBounds(points);
  if (!b) return [];
  const cx = (b.left + b.right) / 2;
  const cy = (b.top + b.bottom) / 2;
  return [
    ["nw", b.left, b.top], ["n", cx, b.top], ["ne", b.right, b.top],
    ["e", b.right, cy], ["se", b.right, b.bottom], ["s", cx, b.bottom],
    ["sw", b.left, b.bottom], ["w", b.left, cy],
  ];
}

function zoneDeleteControl(points = []) {
  const b = zoneBounds(points);
  if (!b) return null;
  const placeRight = b.right <= 0.92;
  const placeAbove = b.top >= 0.10;
  return {
    x: clamp01(placeRight ? b.right + 0.038 : b.right - 0.038),
    y: clamp01(placeAbove ? b.top - 0.060 : b.top + 0.060),
  };
}

function hitNormalizedPoint(position, point, radiusCss = 24) {
  if (!point) return false;
  const contentCssWidth = position.rect.width * (position.view.width / Math.max(1, position.canvasWidth));
  const contentCssHeight = position.rect.height * (position.view.height / Math.max(1, position.canvasHeight));
  const radiusX = radiusCss / Math.max(180, contentCssWidth);
  const radiusY = radiusCss / Math.max(120, contentCssHeight);
  return (((position.x - point[0]) / radiusX) ** 2 + ((position.y - point[1]) / radiusY) ** 2) <= 1;
}

function hitZoneHandle(position, points, mode) {
  if (mode === "rectangle" && points.length === 4) {
    for (const [name, x, y] of rectangleHandlePoints(points)) {
      if (hitNormalizedPoint(position, [x, y], 25)) return name;
    }
    return null;
  }
  let best = -1;
  let bestDistance = Infinity;
  points.forEach(([x, y], index) => {
    const distance = Math.hypot(position.x - x, position.y - y);
    if (hitNormalizedPoint(position, [x, y], 25) && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best >= 0 ? best : null;
}

function resizeRectangleByHandle(points, handle, position) {
  const b = zoneBounds(points);
  if (!b) return points;
  const minSize = 0.05;
  let { left, right, top, bottom } = b;
  if (handle.includes("w")) left = Math.min(clamp01(position.x), right - minSize);
  if (handle.includes("e")) right = Math.max(clamp01(position.x), left + minSize);
  if (handle.includes("n")) top = Math.min(clamp01(position.y), bottom - minSize);
  if (handle.includes("s")) bottom = Math.max(clamp01(position.y), top + minSize);
  return [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => [clamp01(x), clamp01(y)]);
}

function moveZonePoints(deltaX, deltaY, originPoints) {
  if (!originPoints.length) return originPoints;
  const xs = originPoints.map(([x]) => x), ys = originPoints.map(([, y]) => y);
  const dx = Math.max(-Math.min(...xs), Math.min(1 - Math.max(...xs), deltaX));
  const dy = Math.max(-Math.min(...ys), Math.min(1 - Math.max(...ys), deltaY));
  return originPoints.map(([x, y]) => [x + dx, y + dy]);
}

function drawZoneSelectionControls(ctx, canvas, points, mode, view = { x: 0, y: 0, width: canvas.width, height: canvas.height }) {
  if (!points.length) return;
  const px = (x) => view.x + x * view.width;
  const py = (y) => view.y + y * view.height;
  const cssRect = canvas.getBoundingClientRect();
  const scale = cssRect.width ? canvas.width / cssRect.width : 1;
  const handleSize = Math.max(12, 12 * scale);

  if (mode === "rectangle" && points.length === 4) {
    for (const [, x, y] of rectangleHandlePoints(points)) {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#ff355e";
      ctx.lineWidth = Math.max(2, 2.5 * scale);
      ctx.fillRect(px(x) - handleSize / 2, py(y) - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(px(x) - handleSize / 2, py(y) - handleSize / 2, handleSize, handleSize);
    }
  } else {
    const radius = Math.max(9, 10 * scale);
    points.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(px(x), py(y), radius, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = Math.max(2, 2.5 * scale);
      ctx.strokeStyle = "#ff355e";
      ctx.stroke();
    });
  }

  const del = zoneDeleteControl(points);
  if (del) {
    const r = Math.max(15, 16 * scale);
    const dx = px(del.x), dy = py(del.y);
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#ef233c";
    ctx.fill();
    ctx.lineWidth = Math.max(2, 2 * scale);
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(3, 3 * scale);
    ctx.lineCap = "round";
    const k = r * 0.40;
    ctx.beginPath();
    ctx.moveTo(dx - k, dy - k); ctx.lineTo(dx + k, dy + k);
    ctx.moveTo(dx + k, dy - k); ctx.lineTo(dx - k, dy + k);
    ctx.stroke();
  }
}

function guardZoneHitDelete(position) {
  const del = zoneDeleteControl(guardZoneEditor.points);
  return del && hitNormalizedPoint(position, [del.x, del.y], 30);
}

function deleteGuardZoneEditor() {
  if (!guardZoneEditor.points.length) return;
  guardZoneEditor.points = [];
  guardZoneEditor.enabled = false;
  guardZoneEditor.dirty = true;
  if ($("#guardZoneEditorEnabled")) $("#guardZoneEditorEnabled").checked = false;
  if ($("#guardZoneEnabled")) $("#guardZoneEnabled").checked = false;
  updateGuardZoneModeUi();
  drawGuardZoneEditor();
  toast("위험구역을 삭제했습니다. '위험구역 저장'을 눌러 적용해주세요.", 4200);
}

function onGuardZonePointerDown(event) {
  const canvas = $("#guardZoneCanvas");
  if (!canvas) return;
  event.preventDefault();
  try { canvas.setPointerCapture(event.pointerId); } catch { /* noop */ }
  const position = guardZonePointerPosition(event);
  if (!position.inside) { guardZoneEditor.pointerStart = null; guardZoneEditor.drag = null; return; }
  if (guardZoneHitDelete(position)) {
    guardZoneEditor.pointerStart = null;
    guardZoneEditor.drag = null;
    deleteGuardZoneEditor();
    return;
  }
  const handle = hitZoneHandle(position, guardZoneEditor.points, guardZoneEditor.mode);
  guardZoneEditor.pointerStart = { x: position.x, y: position.y };
  guardZoneEditor.suppressAdd = false;
  if (handle !== null) {
    guardZoneEditor.drag = { type: "handle", handle, originPoints: guardZoneEditor.points.map((point) => [...point]) };
  } else if (guardZoneEditor.mode === "rectangle" && guardZoneEditor.points.length >= 3 && pointInPolygon([position.x, position.y], guardZoneEditor.points)) {
    guardZoneEditor.drag = { type: "move", startX: position.x, startY: position.y, originPoints: guardZoneEditor.points.map((point) => [...point]) };
  } else {
    guardZoneEditor.drag = null;
  }
}

function onGuardZonePointerMove(event) {
  if (!guardZoneEditor.pointerStart) return;
  const position = guardZonePointerPosition(event);
  const moved = Math.hypot(position.x - guardZoneEditor.pointerStart.x, position.y - guardZoneEditor.pointerStart.y);
  if (moved > 0.008) guardZoneEditor.suppressAdd = true;
  if (!guardZoneEditor.drag) return;
  event.preventDefault();
  guardZoneEditor.dirty = true;
  if (guardZoneEditor.drag.type === "move") guardZoneEditor.points = moveZonePoints(position.x - guardZoneEditor.drag.startX, position.y - guardZoneEditor.drag.startY, guardZoneEditor.drag.originPoints);
  else if (guardZoneEditor.drag.type === "handle") {
    if (guardZoneEditor.mode === "rectangle") guardZoneEditor.points = resizeRectangleByHandle(guardZoneEditor.points, guardZoneEditor.drag.handle, position);
    else if (Number.isInteger(guardZoneEditor.drag.handle)) guardZoneEditor.points[guardZoneEditor.drag.handle] = [position.x, position.y];
  }
  drawGuardZoneEditor();
}

function onGuardZonePointerUp(event) {
  if (!guardZoneEditor.pointerStart) return;
  const position = guardZonePointerPosition(event);
  if (guardZoneEditor.mode === "polygon" && !guardZoneEditor.drag && !guardZoneEditor.suppressAdd) {
    guardZoneEditor.points.push([position.x, position.y]);
    guardZoneEditor.dirty = true;
  }
  guardZoneEditor.drag = null;
  guardZoneEditor.pointerStart = null;
  guardZoneEditor.suppressAdd = false;
  updateGuardZoneModeUi();
  drawGuardZoneEditor();
}

function resetGuardZoneEditor() {
  guardZoneEditor.points = guardZoneEditor.mode === "rectangle" ? defaultGuardRectangle() : [];
  guardZoneEditor.dirty = true;
  updateGuardZoneModeUi();
  drawGuardZoneEditor();
}

function undoGuardZonePoint() {
  if (guardZoneEditor.mode !== "polygon" || !guardZoneEditor.points.length) return;
  guardZoneEditor.points.pop();
  guardZoneEditor.dirty = true;
  updateGuardZoneModeUi();
  drawGuardZoneEditor();
}

async function saveGuardZoneFromUser() {
  if (!guard.active) return toast("현재 카메라 화면에 맞춰 설정하려면 먼저 지킴이를 시작해주세요.", 4500);
  const enabled = $("#guardZoneEditorEnabled")?.checked === true;
  if (enabled && guardZoneEditor.points.length < 3) return toast("위험구역을 사용하려면 점을 3개 이상 지정해주세요.");
  const payload = {
    deviceId: getGuardDeviceId(),
    enabled,
    zone: {
      id: "zone-main",
      name: $("#guardZoneName").value.trim() || "출입 제한 구역",
      severity: $("#guardZoneSeverity").value,
      shape: guardZoneEditor.mode,
      points: guardZoneEditor.points.map(([x, y]) => [Number(clamp01(x).toFixed(5)), Number(clamp01(y).toFixed(5))]),
    },
  };
  const button = $("#guardZoneSave");
  button.disabled = true;
  button.textContent = "저장 중...";
  try {
    const result = await api("/api/guard/zone", { method: "PUT", body: JSON.stringify(payload) });
    guard.config = result.config || guard.config;
    guardZoneEditor.enabled = enabled;
    guardZoneEditor.dirty = false;
    $("#guardZoneEnabled").checked = enabled;
    const saved = JSON.parse(localStorage.getItem("ssg-guard-profile") || "{}");
    localStorage.setItem("ssg-guard-profile", JSON.stringify({ ...saved, zoneEnabled: enabled }));
    drawGuardOverlay(guard.detections, guard.latestSourceWidth, guard.latestSourceHeight, [], guard.latestAssessments);
    toast(enabled ? "현장 위험구역을 저장하고 감지를 시작했습니다." : "현장 위험구역 감지를 해제했습니다.", 4500);
  } catch (error) {
    toast(`위험구역 저장 실패: ${error.message}`, 5500);
  } finally {
    button.disabled = false;
    button.textContent = "위험구역 저장";
  }
}

function openStopWorkVideo(beforeUrl, afterUrl, legacyUrl = null) {
  if (!beforeUrl && !afterUrl && !legacyUrl) return toast("저장된 전후 영상이 없습니다.");
  const modal = $("#stopWorkVideoModal");
  const beforePlayer = $("#stopWorkBeforePlayer");
  const afterPlayer = $("#stopWorkAfterPlayer");
  const beforePane = $("#stopWorkBeforePane");
  const afterPane = $("#stopWorkAfterPane");
  const safeBefore = beforeUrl || null;
  const safeAfter = afterUrl || legacyUrl || null;
  beforePane.hidden = !safeBefore;
  afterPane.hidden = !safeAfter;
  if (safeBefore) beforePlayer.src = safeBefore;
  if (safeAfter) afterPlayer.src = safeAfter;
  modal.hidden = false;
  (safeBefore ? beforePlayer : afterPlayer)?.play().catch(() => {});
}

function closeStopWorkVideo() {
  const modal = $("#stopWorkVideoModal");
  [$("#stopWorkBeforePlayer"), $("#stopWorkAfterPlayer")].forEach((player) => {
    if (!player) return;
    try { player.pause(); } catch { /* noop */ }
    player.removeAttribute("src");
    player.load();
  });
  modal.hidden = true;
}

/* ---------- Zone and rules ---------- */

async function prepareZoneEditor() {
  if (!state.devices.length) return drawZoneCanvas();
  const select = $("#zoneDeviceSelect");
  if (!select.value) select.value = state.devices[0].id;
  await loadSelectedZone();
}

function updateAdminZoneModeUi() {
  $$('[data-admin-zone-mode]').forEach((button) => button.classList.toggle("active", button.dataset.adminZoneMode === adminZoneEditor.mode));
  const rectangle = adminZoneEditor.mode === "rectangle";
  if ($("#adminZoneHint")) $("#adminZoneHint").textContent = rectangle
    ? "사각형 · 내부 드래그=이동 · 8개 손잡이=크기조절 · X/Delete=삭제"
    : "다각형 · 빈 곳을 클릭해 점 추가 · 점 드래그=조절 · X/Delete=삭제";
  if ($("#adminZoneHelp")) $("#adminZoneHelp").innerHTML = rectangle
    ? "<b>PPT 사각형 방식</b><span>사각형 안쪽을 마우스·손가락으로 끌어 이동하고 8개 흰색 손잡이로 크기를 조절하세요. 빨간 X나 Delete 키로 삭제할 수 있습니다.</span>"
    : "<b>다각형 방식</b><span>화면을 3곳 이상 클릭해 구역을 만들고 각 점을 드래그해 조정합니다. 빨간 X나 Delete 키로 전체 구역을 삭제할 수 있습니다.</span>";
}

function setAdminZoneMode(mode) {
  if (!["polygon", "rectangle"].includes(mode)) return;
  adminZoneEditor.mode = mode;
  if (mode === "rectangle" && !isAxisAlignedRectangle(state.zonePoints)) state.zonePoints = defaultGuardRectangle();
  if (mode === "polygon" && isAxisAlignedRectangle(state.zonePoints)) state.zonePoints = [];
  updateAdminZoneModeUi();
  drawZoneCanvas();
}

async function loadSelectedZone() {
  const deviceId = $("#zoneDeviceSelect").value;
  if (!deviceId) return;
  try {
    const config = await api(`/api/devices/${encodeURIComponent(deviceId)}/config`);
    state.zoneConfig = config;
    const zone = config.zones?.[0] || defaultConfig().zones[0];
    state.zonePoints = [...(Array.isArray(zone.points) ? zone.points : []).map(([x, y]) => [clamp01(x), clamp01(y)])];
    adminZoneEditor.mode = zone.shape === "rectangle" || isAxisAlignedRectangle(state.zonePoints) ? "rectangle" : "polygon";
    $("#zoneName").value = zone.name || "출입 제한 구역";
    $("#zoneSeverity").value = zone.severity || "high";
    $("#zoneEnabledAdmin").checked = zone.enabled !== false && config.rules?.dangerZone !== false;
    const device = state.devices.find((item) => item.id === deviceId);
    state.zoneBackground = device?.previewUrl || null;
    loadAdminZoneBackground(state.zoneBackground);
    updateAdminZoneModeUi();
    drawZoneCanvas();
  } catch (error) { toast(error.message); }
}

function getLiveVideoForDevice(deviceId) {
  return $$(`.device-card[data-device-id="${CSS.escape(deviceId)}"] .device-video`).find((video) => !video.hidden && video.readyState >= 2) || null;
}

function loadAdminZoneBackground(url) {
  if (!url) {
    adminZoneEditor.backgroundImage = null;
    adminZoneEditor.backgroundUrl = null;
    drawZoneCanvas();
    return;
  }
  if (adminZoneEditor.backgroundUrl === url && adminZoneEditor.backgroundImage?.complete) return;
  adminZoneEditor.backgroundUrl = url;
  const image = new Image();
  image.onload = () => {
    if (adminZoneEditor.backgroundUrl !== url) return;
    adminZoneEditor.backgroundImage = image;
    drawZoneCanvas();
  };
  image.onerror = () => { if (adminZoneEditor.backgroundUrl === url) adminZoneEditor.backgroundImage = null; };
  image.src = `${url}${url.includes("?") ? "&" : "?"}zone=${Date.now()}`;
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
  } else if (adminZoneEditor.backgroundImage?.complete) {
    ctx.drawImage(adminZoneEditor.backgroundImage, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "rgba(145,169,178,.86)";
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("현장 프리뷰를 불러오는 중입니다.", canvas.width / 2, canvas.height / 2);
  }
  drawZonePolygon(ctx, canvas);
}

function drawZonePolygon(ctx, canvas) {
  if (!state.zonePoints.length) return;
  ctx.beginPath();
  state.zonePoints.forEach(([x, y], index) => index ? ctx.lineTo(x * canvas.width, y * canvas.height) : ctx.moveTo(x * canvas.width, y * canvas.height));
  if (state.zonePoints.length >= 3) ctx.closePath();
  ctx.fillStyle = "rgba(255,55,82,.16)";
  if (state.zonePoints.length >= 3) ctx.fill();
  ctx.strokeStyle = "#ff355e";
  ctx.lineWidth = 5;
  ctx.stroke();
  drawZoneSelectionControls(ctx, canvas, state.zonePoints, adminZoneEditor.mode, { x: 0, y: 0, width: canvas.width, height: canvas.height });
}

function adminZonePointerPosition(event) {
  const canvas = $("#zoneCanvas");
  const rect = canvas.getBoundingClientRect();
  const canvasX = (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width);
  const canvasY = (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height);
  return {
    x: clamp01(canvasX / canvas.width), y: clamp01(canvasY / canvas.height), rect,
    view: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    inside: canvasX >= 0 && canvasY >= 0 && canvasX <= canvas.width && canvasY <= canvas.height,
    canvasX, canvasY, canvasWidth: canvas.width, canvasHeight: canvas.height,
  };
}

function adminZoneHitDelete(position) {
  const del = zoneDeleteControl(state.zonePoints);
  return del && hitNormalizedPoint(position, [del.x, del.y], 30);
}

function deleteAdminZone() {
  if (!state.zonePoints.length) return;
  state.zonePoints = [];
  $("#zoneEnabledAdmin").checked = false;
  adminZoneEditor.drag = null;
  drawZoneCanvas();
  toast("위험구역을 삭제했습니다. '설정 저장'을 눌러 현장에 적용해주세요.", 4200);
}

function onAdminZonePointerDown(event) {
  const canvas = $("#zoneCanvas");
  if (!canvas) return;
  event.preventDefault();
  try { canvas.setPointerCapture(event.pointerId); } catch { /* noop */ }
  const position = adminZonePointerPosition(event);
  if (!position.inside) return;
  if (adminZoneHitDelete(position)) { deleteAdminZone(); return; }
  const handle = hitZoneHandle(position, state.zonePoints, adminZoneEditor.mode);
  adminZoneEditor.pointerStart = { x: position.x, y: position.y };
  adminZoneEditor.suppressAdd = false;
  if (handle !== null) {
    adminZoneEditor.drag = { type: "handle", handle, originPoints: state.zonePoints.map((point) => [...point]) };
  } else if (adminZoneEditor.mode === "rectangle" && state.zonePoints.length >= 3 && pointInPolygon([position.x, position.y], state.zonePoints)) {
    adminZoneEditor.drag = { type: "move", startX: position.x, startY: position.y, originPoints: state.zonePoints.map((point) => [...point]) };
  } else {
    adminZoneEditor.drag = null;
  }
}

function onAdminZonePointerMove(event) {
  if (!adminZoneEditor.pointerStart) return;
  const position = adminZonePointerPosition(event);
  const moved = Math.hypot(position.x - adminZoneEditor.pointerStart.x, position.y - adminZoneEditor.pointerStart.y);
  if (moved > 0.008) adminZoneEditor.suppressAdd = true;
  if (!adminZoneEditor.drag) return;
  event.preventDefault();
  if (adminZoneEditor.drag.type === "move") {
    state.zonePoints = moveZonePoints(position.x - adminZoneEditor.drag.startX, position.y - adminZoneEditor.drag.startY, adminZoneEditor.drag.originPoints);
  } else if (adminZoneEditor.drag.type === "handle") {
    if (adminZoneEditor.mode === "rectangle") state.zonePoints = resizeRectangleByHandle(state.zonePoints, adminZoneEditor.drag.handle, position);
    else if (Number.isInteger(adminZoneEditor.drag.handle)) state.zonePoints[adminZoneEditor.drag.handle] = [position.x, position.y];
  }
  drawZoneCanvas();
}

function onAdminZonePointerUp(event) {
  if (!adminZoneEditor.pointerStart) return;
  const position = adminZonePointerPosition(event);
  if (adminZoneEditor.mode === "polygon" && !adminZoneEditor.drag && !adminZoneEditor.suppressAdd && position.inside) state.zonePoints.push([position.x, position.y]);
  adminZoneEditor.drag = null;
  adminZoneEditor.pointerStart = null;
  adminZoneEditor.suppressAdd = false;
  drawZoneCanvas();
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
    shape: adminZoneEditor.mode,
    points: state.zonePoints.map(([x, y]) => [Number(clamp01(x).toFixed(5)), Number(clamp01(y).toFixed(5))]),
  }];
  state.zoneConfig = config;
  await api(`/api/devices/${encodeURIComponent(deviceId)}/config`, { method: "PUT", body: JSON.stringify({ config }) });
  toast(enabled ? "위험구역을 저장하고 감지를 활성화했습니다." : "위험구역 감지를 해제했습니다.");
}

function clearZone() {
  state.zonePoints = adminZoneEditor.mode === "rectangle" ? defaultGuardRectangle() : [];
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


/* ---------- Emergency 119 / GPS / editable contacts ---------- */

function phoneHref(phone) {
  return `tel:${String(phone || "").replace(/[^0-9+*#]/g, "")}`;
}

function emergencySavedSite() {
  try {
    const saved = JSON.parse(localStorage.getItem("ssg-guard-profile") || "{}");
    return String(saved.site || $("#guardSite")?.value || "").trim();
  } catch { return String($("#guardSite")?.value || "").trim(); }
}

function chooseEmergencyCallId(config) {
  const options = Array.isArray(config?.callOptions) ? config.callOptions : [];
  if (!options.length) return "";
  if (state.emergency.selectedCallId && options.some((item) => item.id === state.emergency.selectedCallId)) return state.emergency.selectedCallId;
  const site = emergencySavedSite().replace(/\s+/g, "");
  if (site.includes("광양")) return options.find((item) => `${item.site} ${item.label}`.includes("광양"))?.id || config.defaultCallId || options[0].id;
  if (site.includes("포항")) return options.find((item) => `${item.site} ${item.label}`.includes("포항"))?.id || config.defaultCallId || options[0].id;
  return config.defaultCallId || options[0].id;
}

function selectedEmergencyCall() {
  const config = state.emergency.config || {};
  const options = Array.isArray(config.callOptions) ? config.callOptions : [];
  const id = state.emergency.selectedCallId || chooseEmergencyCallId(config);
  return options.find((item) => item.id === id) || options[0] || { id: "", site: "공통", label: "119", phone: "119" };
}

function updateEmergencyCallUi(refreshEditor = false) {
  const config = state.emergency.config || {};
  const options = Array.isArray(config.callOptions) ? config.callOptions : [];
  const select = $("#emergencyCallSelect");
  if (select) {
    if (!state.emergency.selectedCallId) state.emergency.selectedCallId = chooseEmergencyCallId(config);
    select.innerHTML = options.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} · ${escapeHtml(item.phone)}</option>`).join("");
    select.value = state.emergency.selectedCallId || options[0]?.id || "";
  }
  const call = selectedEmergencyCall();
  const button = $("#emergencyCallButton");
  if (button) button.href = phoneHref(call.phone || "119");
  if ($("#emergencyCallHeroNumber")) $("#emergencyCallHeroNumber").textContent = call.phone || "119";
  if ($("#emergencyCallHeroLabel")) $("#emergencyCallHeroLabel").textContent = call.label || "119 전화 연결";
  if ($("#emergencyCallCurrent")) $("#emergencyCallCurrent").textContent = `${call.label || "비상전화"} · ${call.phone || "번호 미등록"}`;
  if (refreshEditor && state.session?.role === "admin") renderEmergencyCallEditor();
}

function renderEmergencyCallEditor() {
  const box = $("#emergencyCallEditor");
  if (!box) return;
  const config = state.emergency.config || { callOptions: [] };
  const options = Array.isArray(config.callOptions) ? config.callOptions : [];
  box.innerHTML = options.map((item, index) => `<div class="emergency-call-edit-row" data-call-index="${index}"><label class="call-default-radio" title="기본 전화"><input type="radio" name="defaultEmergencyCall" value="${escapeHtml(item.id)}" ${item.id === config.defaultCallId ? "checked" : ""} /><span>기본</span></label><input data-call-field="site" value="${escapeHtml(item.site || "")}" placeholder="사업장/지역" /><input data-call-field="label" value="${escapeHtml(item.label || "")}" placeholder="표시명 (예: 광양제철소 119)" /><input data-call-field="phone" value="${escapeHtml(item.phone || "")}" inputmode="tel" placeholder="전화번호" /><button class="danger-button contact-row-delete" type="button" data-call-delete="${index}" aria-label="삭제">×</button></div>`).join("");
  $$('[data-call-delete]', box).forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.callDelete);
    const removed = state.emergency.config.callOptions[index];
    state.emergency.config.callOptions.splice(index, 1);
    if (removed?.id === state.emergency.config.defaultCallId) state.emergency.config.defaultCallId = state.emergency.config.callOptions[0]?.id || "";
    if (removed?.id === state.emergency.selectedCallId) state.emergency.selectedCallId = state.emergency.config.defaultCallId || state.emergency.config.callOptions[0]?.id || "";
    updateEmergencyCallUi(true);
  }));
}

function addEmergencyCallRow() {
  state.emergency.config ||= { contacts: [], callOptions: [], defaultCallId: "", chartUrl: null };
  state.emergency.config.callOptions ||= [];
  const id = uuid("call");
  state.emergency.config.callOptions.push({ id, site: "공통", label: "새 비상전화", phone: "" });
  if (!state.emergency.config.defaultCallId) state.emergency.config.defaultCallId = id;
  renderEmergencyCallEditor();
}

async function saveEmergencyCallOptions() {
  const current = state.emergency.config || { contacts: [] };
  const callOptions = $$('[data-call-index]', $("#emergencyCallEditor")).map((row) => {
    const index = Number(row.dataset.callIndex);
    const value = (field) => $(`[data-call-field="${field}"]`, row)?.value?.trim() || "";
    return {
      id: current.callOptions?.[index]?.id || uuid("call"),
      site: value("site") || "공통",
      label: value("label") || "비상전화",
      phone: value("phone"),
    };
  }).filter((item) => item.label && item.phone);
  if (!callOptions.length) return toast("비상전화 번호를 1개 이상 등록해주세요.");
  const checked = $('input[name="defaultEmergencyCall"]:checked', $("#emergencyCallEditor"));
  const defaultCallId = checked?.value && callOptions.some((item) => item.id === checked.value) ? checked.value : callOptions[0].id;
  try {
    const data = await api("/api/emergency/config", { method: "PUT", body: JSON.stringify({ callOptions, defaultCallId }) });
    state.emergency.config = data;
    state.emergency.selectedCallId = chooseEmergencyCallId(data);
    updateEmergencyCallUi(true);
    toast("119·비상전화 설정을 저장했습니다.");
  } catch (error) { toast(error.message); }
}

function emergencyContactRegions(contacts) {
  const preferred = ["공통", "포항", "광양", "세종", "구미"];
  const found = [...new Set((contacts || []).map((item) => item.region || "공통"))];
  return [...preferred.filter((r) => found.includes(r)), ...found.filter((r) => !preferred.includes(r)).sort()];
}

function renderEmergencyRegionFilter(contacts) {
  const select = $("#emergencyRegionFilter");
  if (!select) return;
  const current = select.value || state.emergency.regionFilter || "";
  const regions = emergencyContactRegions(contacts);
  select.innerHTML = `<option value="">전체 지역</option>${regions.map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`).join("")}`;
  if (["", ...regions].includes(current)) select.value = current;
}

function renderEmergencyContacts() {
  const config = state.emergency.config || { contacts: [] };
  const contacts = Array.isArray(config.contacts) ? config.contacts : [];
  renderEmergencyRegionFilter(contacts);
  const selectedRegion = $("#emergencyRegionFilter")?.value || state.emergency.regionFilter || "";
  state.emergency.regionFilter = selectedRegion;
  const visible = selectedRegion ? contacts.filter((item) => (item.region || "공통") === selectedRegion) : contacts;
  const list = $("#emergencyContactList");
  if (list) list.innerHTML = visible.map((item) => {
    const department = item.department || item.name || "연락처";
    const person = item.name && item.name !== department ? item.name : "";
    const meta = [item.region || "공통", item.type || "비상"].filter(Boolean).join(" · ");
    const sub = [person ? `이름: ${person}` : "", item.note || ""].filter(Boolean).join(" · ");
    return `<article class="emergency-contact-item"><span>${escapeHtml(meta)}</span><div><b>${escapeHtml(department)}</b><small>${escapeHtml(sub)}</small></div>${item.phone ? `<a href="${phoneHref(item.phone)}" aria-label="${escapeHtml(department)} ${escapeHtml(item.phone)} 전화 연결"><strong>${escapeHtml(item.phone)}</strong></a>` : `<em>번호 미등록</em>`}</article>`;
  }).join("") || `<div class="law-empty-state"><span>☎</span><h3>해당 지역 연락처가 없습니다</h3><p>관리자가 부서·기관·이름·연락처를 추가할 수 있습니다.</p></div>`;
  if ($("#emergencyContactCount")) $("#emergencyContactCount").textContent = selectedRegion ? `${visible.length}개 / 전체 ${contacts.length}개` : `${contacts.length}개`;
}

function renderEmergencyContactEditor() {
  const box = $("#emergencyContactEditor");
  if (!box) return;
  const contacts = state.emergency.config?.contacts || [];
  box.innerHTML = contacts.map((item, index) => `<div class="emergency-contact-edit-row" data-contact-index="${index}"><input data-contact-field="region" value="${escapeHtml(item.region || "공통")}" placeholder="지역" /><input data-contact-field="type" value="${escapeHtml(item.type || "")}" placeholder="구분" /><input data-contact-field="department" value="${escapeHtml(item.department || "")}" placeholder="부서/기관" /><input data-contact-field="name" value="${escapeHtml(item.name || "")}" placeholder="이름(선택)" /><input data-contact-field="phone" value="${escapeHtml(item.phone || "")}" inputmode="tel" placeholder="연락처" /><input data-contact-field="note" value="${escapeHtml(item.note || "")}" placeholder="비고" /><button class="danger-button contact-row-delete" type="button" data-contact-delete="${index}" aria-label="삭제">×</button></div>`).join("");
  $$('[data-contact-delete]', box).forEach((button) => button.addEventListener("click", () => {
    state.emergency.config.contacts.splice(Number(button.dataset.contactDelete), 1);
    renderEmergencyContacts();
    renderEmergencyContactEditor();
  }));
}

function addEmergencyContactRow() {
  state.emergency.config ||= { contacts: [], callOptions: [], chartUrl: null };
  state.emergency.config.contacts ||= [];
  state.emergency.config.contacts.push({ id: uuid("contact"), region: "공통", type: "기타", department: "", name: "", phone: "", note: "" });
  renderEmergencyContacts();
  renderEmergencyContactEditor();
  requestAnimationFrame(() => $("#emergencyContactEditor")?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
}

async function saveEmergencyContacts() {
  const current = state.emergency.config || { contacts: [] };
  const contacts = $$('[data-contact-index]', $("#emergencyContactEditor")).map((row) => {
    const index = Number(row.dataset.contactIndex);
    const value = (field) => $(`[data-contact-field="${field}"]`, row)?.value?.trim() || "";
    return {
      id: current.contacts?.[index]?.id || uuid("contact"),
      region: value("region") || "공통",
      type: value("type") || "기타",
      department: value("department"),
      name: value("name"),
      phone: value("phone"),
      note: value("note"),
    };
  }).filter((item) => item.department || item.name || item.phone);
  try {
    const data = await api("/api/emergency/config", { method: "PUT", body: JSON.stringify({ contacts }) });
    state.emergency.config = data;
    renderEmergencyContacts();
    renderEmergencyContactEditor();
    renderEmergencyChart();
    updateEmergencyCallUi(true);
    toast("비상연락망을 저장했습니다.");
  } catch (error) { toast(error.message); }
}

function renderEmergencyChart() {
  const img = $("#emergencyChartImage");
  const empty = $("#emergencyChartEmpty");
  const deleteButton = $("#deleteEmergencyChart");
  const url = state.emergency.config?.chartUrl;
  if (url) {
    img.src = `${url}?v=${Date.now()}`;
    img.hidden = false;
    empty.hidden = true;
    if (deleteButton) deleteButton.hidden = state.session?.role !== "admin";
  } else {
    img.removeAttribute("src");
    img.hidden = true;
    empty.hidden = false;
    if (deleteButton) deleteButton.hidden = true;
  }
  applyEmergencyChartZoom();
}

async function loadEmergencyConfig() {
  try {
    state.emergency.config = await api("/api/emergency/config");
    if (!state.emergency.selectedCallId) state.emergency.selectedCallId = chooseEmergencyCallId(state.emergency.config);
    updateEmergencyCallUi(true);
    renderEmergencyContacts();
    if (state.session?.role === "admin") renderEmergencyContactEditor();
    renderEmergencyChart();
  } catch (error) { toast(`비상대응 정보 조회 실패: ${error.message}`); }
}

function applyEmergencyChartZoom() {
  const box = $("#emergencyChartDocument");
  if (!box) return;
  const scale = Math.max(.25, Math.min(3, Number(state.emergency.chartScale || 1)));
  state.emergency.chartScale = scale;
  box.style.transform = `scale(${scale})`;
  box.style.marginBottom = `${Math.max(0, box.offsetHeight * (scale - 1))}px`;
  $("#emergencyChartZoomRate").textContent = `${Math.round(scale * 100)}%`;
}

function fitEmergencyChart() {
  const viewport = $("#emergencyChartViewport");
  const img = $("#emergencyChartImage");
  if (!viewport || !img || img.hidden) return;
  const natural = img.naturalWidth || 1536;
  state.emergency.chartScale = Math.min(1, Math.max(.25, (viewport.clientWidth - 24) / natural));
  applyEmergencyChartZoom();
}

async function compressEmergencyChart(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("PNG/JPG/WEBP 이미지를 선택해주세요.");
  const bitmap = await createImageBitmap(file);
  const maxW = 1800, maxH = 2400;
  const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let quality = .86, blob = null;
  for (let i = 0; i < 5; i += 1) {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= 1_400_000) break;
    quality -= .12;
  }
  bitmap.close?.();
  if (!blob || blob.size > 1_450_000) throw new Error("이미지를 1.45MB 이하로 압축하지 못했습니다. 원본 해상도를 조금 낮춰주세요.");
  return blob;
}

async function uploadEmergencyChart(file) {
  if (!file) return;
  try {
    const blob = await compressEmergencyChart(file);
    state.emergency.config = await api("/api/emergency/chart", { method: "POST", headers: { "content-type": blob.type || "image/jpeg" }, body: blob });
    renderEmergencyChart();
    updateEmergencyCallUi(false);
    renderEmergencyContacts();
    toast("비상상황 보고체계도를 등록했습니다.");
  } catch (error) { toast(error.message, 6000); }
  finally { $("#emergencyChartFile").value = ""; }
}

async function deleteEmergencyChart() {
  if (state.session?.role !== "admin") return;
  if (!state.emergency.config?.chartUrl) return toast("삭제할 보고체계도 이미지가 없습니다.");
  if (!confirm("등록된 비상상황 보고체계도 이미지를 삭제할까요?")) return;
  try {
    state.emergency.config = await api("/api/emergency/chart", { method: "DELETE" });
    state.emergency.chartScale = 1;
    renderEmergencyChart();
    toast("보고체계도 이미지를 삭제했습니다.");
  } catch (error) { toast(error.message, 6000); }
}

function getEmergencyPosition() {
  if (!navigator.geolocation) return Promise.reject(new Error("이 브라우저는 GPS 위치 기능을 지원하지 않습니다."));
  $("#gpsStatus").textContent = "GPS 확인 중";
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }));
}

async function updateEmergencyPosition() {
  try {
    const pos = await getEmergencyPosition();
    state.emergency.position = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp };
    $("#gpsStatus").textContent = "위치 확인됨";
    $("#gpsLat").textContent = pos.coords.latitude.toFixed(6);
    $("#gpsLng").textContent = pos.coords.longitude.toFixed(6);
    $("#gpsAccuracy").textContent = `약 ${Math.round(pos.coords.accuracy)}m`;
    $("#gpsDescription").textContent = "현재 위치를 관리자에게 전송하거나 지도에서 확인할 수 있습니다.";
    $("#openEmergencyMap").disabled = false;
    $("#copyEmergencyCoordinates").disabled = false;
    return state.emergency.position;
  } catch (error) {
    const map = { 1: "위치 권한이 거부되었습니다.", 2: "현재 위치를 확인할 수 없습니다.", 3: "GPS 위치 확인 시간이 초과되었습니다." };
    $("#gpsStatus").textContent = "위치 확인 실패";
    toast(map[error.code] || error.message || "GPS 위치 확인 실패", 5500);
    throw error;
  }
}

function emergencyMapUrl() {
  const p = state.emergency.position;
  return p ? `https://www.google.com/maps?q=${p.latitude},${p.longitude}` : "";
}

async function sendEmergencyLocationToAdmin() {
  let p = state.emergency.position;
  if (!p) try { p = await updateEmergencyPosition(); } catch { return; }
  const button = $("#sendEmergencyLocation");
  button.disabled = true;
  button.textContent = "전송 중...";
  try {
    await api("/api/emergency/report", { method: "POST", body: JSON.stringify({ deviceId: getGuardDeviceId(), reporterName: $("#emergencyReporterName").value.trim(), reporterContact: $("#emergencyReporterContact").value.trim(), note: $("#emergencyNote").value.trim(), latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy, occurredAt: new Date().toISOString() }) });
    toast("GPS 위치와 비상상황을 관리자에게 전송했습니다.", 6000);
  } catch (error) { toast(`비상 위치 전송 실패: ${error.message}`, 6000); }
  finally { button.disabled = false; button.textContent = "관리자에게 위치 전송"; }
}

/* ---------- D-safety meeting ---------- */

function parseDSafetyExcelRow(text) {
  const fields = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      if (inQuote && text[i + 1] === '"') { cur += '"'; i += 1; }
      else inQuote = !inQuote;
    } else if (c === "\t" && !inQuote) { fields.push(cur); cur = ""; }
    else cur += c;
  }
  fields.push(cur);
  return fields;
}

function findDSafetyDataRow(fullText) {
  const rows = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < fullText.length; i += 1) {
    const c = fullText[i];
    if (c === '"') { inQuote = !inQuote; cur += c; }
    else if ((c === "\n" || c === "\r") && !inQuote) {
      if (cur.trim()) rows.push(cur); cur = "";
      if (c === "\r" && fullText[i + 1] === "\n") i += 1;
    } else cur += c;
  }
  if (cur.trim()) rows.push(cur);
  for (const row of rows) if (/^(?:\d{1,2}\/\d{1,2}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/.test((row.split("\t")[0] || "").trim())) return row;
  return rows[rows.length - 1] || "";
}

function normalizeDSafetyMarker(value) {
  const raw = String(value || "").trim().replace(/\.$/, "");
  if (raw === "*") return "*";
  const match = raw.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return raw || "-";
  return match[2] ? `${Number(match[1])}-${Number(match[2])}` : String(Number(match[1]));
}

function splitDSafetyNumbered(text) {
  const source = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return [];

  // D-안전회의 원문은 셀 안 줄바꿈이 없어져 "...위험 1-1 굴착기..."처럼
  // 하위 순번이 문장 중간에 붙는 경우가 있어 줄 시작뿐 아니라 공백 뒤 순번도 인식합니다.
  // 상위 순번은 "1." 형식, 하위 순번은 "1-1" 또는 "1-1." 형식을 허용합니다.
  const markerPattern = /(^|[\s])((?:\d{1,2}-\d{1,2})(?:\.)?|\d{1,2}\.|\*)[ \t]+/gm;
  const matches = [...source.matchAll(markerPattern)];
  if (!matches.length) return [{ no: "-", text: source.replace(/\s+/g, " ").trim() }];

  const items = [];
  const leadingText = source.slice(0, matches[0].index).replace(/\s+/g, " ").trim();
  const firstNo = normalizeDSafetyMarker(matches[0][2]);
  const parentMatch = firstNo.match(/^(\d+)-\d+$/);
  if (leadingText && parentMatch) items.push({ no: parentMatch[1], text: leadingText });
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const next = matches[i + 1];
    const no = normalizeDSafetyMarker(match[2]);
    const start = match.index + match[0].length;
    const end = next ? next.index : source.length;
    const itemText = source.slice(start, end).replace(/\s+/g, " ").trim();
    if (itemText || no === "*") items.push({ no, text: itemText });
  }
  return items;
}

function dSafetyNoSortValue(no) {
  const normalized = normalizeDSafetyMarker(no);
  if (normalized === "-") return [-1, -1, 0];
  if (normalized === "*") return [9999, 9999, 2];
  const match = normalized.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return [9998, 9998, 1];
  return [Number(match[1]), match[2] ? Number(match[2]) : -1, 0];
}

function compareDSafetyNo(a, b) {
  const aa = dSafetyNoSortValue(a), bb = dSafetyNoSortValue(b);
  for (let i = 0; i < aa.length; i += 1) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return String(a).localeCompare(String(b), "ko");
}

function mergeDSafetyNumbered(risks = [], actions = []) {
  const collect = (items) => {
    const map = new Map();
    for (const item of items) {
      const no = normalizeDSafetyMarker(item?.no);
      const text = String(item?.text || "").replace(/\s+/g, " ").trim();
      if (!map.has(no)) map.set(no, []);
      if (text && !map.get(no).includes(text)) map.get(no).push(text);
    }
    return map;
  };
  const riskMap = collect(risks), actionMap = collect(actions);
  const nos = [...new Set([...riskMap.keys(), ...actionMap.keys()])].sort(compareDSafetyNo);
  return nos.map((no) => ({ no, risk: (riskMap.get(no) || []).join("\n"), action: (actionMap.get(no) || []).join("\n") }));
}

function normalizeDSafetyRows(rows = []) {
  const risks = [], actions = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const no = normalizeDSafetyMarker(row?.no);
    const prefix = no === "*" ? "* " : (no && no !== "-" ? `${no}. ` : "");
    if (String(row?.risk || "").trim()) risks.push(...splitDSafetyNumbered(`${prefix}${row.risk}`));
    if (String(row?.action || "").trim()) actions.push(...splitDSafetyNumbered(`${prefix}${row.action}`));
  }
  return mergeDSafetyNumbered(risks, actions);
}

function splitDSafetyJobs(text) {
  const source = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return [];
  const markerPattern = /(^|[\s])(\d{1,2}\.)[ \t]+/gm;
  const matches = [...source.matchAll(markerPattern)];
  if (!matches.length) return [...new Set(source.split(/\n+/).map((item) => item.trim()).filter(Boolean))];
  const jobs = [];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i], next = matches[i + 1];
    const no = normalizeDSafetyMarker(match[2]);
    const start = match.index + match[0].length;
    const end = next ? next.index : source.length;
    const value = source.slice(start, end).replace(/\s+/g, " ").trim();
    if (value) jobs.push(`${no}. ${value}`);
  }
  return [...new Set(jobs)];
}

function parseDSafetyExcel(raw) {
  const row = findDSafetyDataRow(raw);
  const f = parseDSafetyExcelRow(row);
  if (f.length < 16) throw new Error("D-안전회의 엑셀 행의 열 수가 부족합니다. 엑셀에서 전체 행을 복사해주세요.");
  const risks = splitDSafetyNumbered(f[14] || "");
  const actions = splitDSafetyNumbered(f[15] || "");
  const plant = (f[4] || "").trim(), place = (f[6] || "").trim();
  return {
    site: plant,
    meetingDate: f[0] || "", workTime: f[9] || "", location: plant && place && plant.replace(/\s+/g, "") !== place.replace(/\s+/g, "") ? `${plant} / ${place}` : (plant || place),
    jobName: f[7] || "", peopleCount: parseInt(f[8], 10) || 1, contractor: f[10] || "", workManager: f[12] || "", contractorManager: f[13] || "",
    monitorDept: (f[f.length - 3] || "").trim(), monitorName: (f[f.length - 2] || "").trim(), cctv: (f[f.length - 1] || "").trim(),
    rows: mergeDSafetyNumbered(risks, actions), rawText: raw,
  };
}

function normalizeDSafetyDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
  m = text.match(/^(\d{1,2})[/.](\d{1,2})$/);
  if (m) return `${new Date().getFullYear()}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
  return text.slice(0,10);
}

function dSafetySiteOf(board) {
  return String(board?.site || String(board?.location || "").split("/")[0] || "미지정").trim() || "미지정";
}

function filteredDSafetyBoards() {
  const site = state.dSafety.siteFilter || "";
  const date = state.dSafety.dateFilter || "";
  return (state.dSafety.boards || []).filter((board) => (!site || dSafetySiteOf(board) === site) && (!date || normalizeDSafetyDate(board.meetingDate) === date));
}

function renderDSafetySiteTabs() {
  const box = $("#dSafetySiteTabs");
  if (!box) return;
  const sites = [...new Set((state.dSafety.boards || []).map(dSafetySiteOf).filter(Boolean))].sort((a,b) => a.localeCompare(b,"ko"));
  if (state.dSafety.siteFilter && !sites.includes(state.dSafety.siteFilter)) state.dSafety.siteFilter = "";
  box.innerHTML = [`<button type="button" data-dsafety-site="" class="${!state.dSafety.siteFilter ? "active" : ""}">전체 사업장</button>`, ...sites.map((site) => `<button type="button" data-dsafety-site="${escapeHtml(site)}" class="${state.dSafety.siteFilter === site ? "active" : ""}">${escapeHtml(site)}</button>`)].join("");
  $$('[data-dsafety-site]', box).forEach((button) => button.addEventListener("click", async () => {
    state.dSafety.siteFilter = button.dataset.dsafetySite || "";
    renderDSafetySiteTabs();
    renderDSafetySelect(true);
    if (state.dSafety.selectedId) await openDSafetyBoard(state.dSafety.selectedId); else renderDSafetyBoard(null);
  }));
}

function renderDSafetyOpinionJobs(board) {
  const select = $("#dSafetyOpinionJob");
  if (!select) return;
  const current = select.value;
  const jobs = board ? splitDSafetyJobs(board.jobName) : [];
  select.innerHTML = jobs.length
    ? jobs.map((job) => `<option value="${escapeHtml(job)}">${escapeHtml(job)}</option>`).join("")
    : `<option value="">작업명 미입력</option>`;
  select.disabled = !board || !jobs.length;
  if (jobs.includes(current)) select.value = current;
  else if (jobs[0]) select.value = jobs[0];
}

function renderDSafetyBoard(board) {
  const viewer = $("#dSafetyViewer");
  if (!viewer) return;
  if (!board) {
    viewer.innerHTML = `<div class="law-empty-state"><span>☷</span><h3>D-안전소통보드 자료가 없습니다</h3><p>선택한 사업장·날짜 조건에 등록된 회의가 없습니다.</p></div>`;
    $("#dSafetyOpinionList").innerHTML = "";
    renderDSafetyOpinionJobs(null);
    return;
  }
  // 과거 버전에서 1-1 같은 하위 순번이 1번 본문에 합쳐져 저장된 경우도 화면에서 재분해/재정렬합니다.
  const rows = normalizeDSafetyRows(board.rows);
  const site = dSafetySiteOf(board);
  const monitor = [board.monitorName, board.monitorDept ? `(${board.monitorDept})` : ""].filter(Boolean).join(" ") || "-";
  viewer.innerHTML = `<section class="panel dsafety-board-card"><div class="dsafety-board-title"><div><p class="eyebrow">D-SAFETY COMMUNICATION BOARD</p><h3>${escapeHtml(board.meetingDate || "D-안전회의")} · ${escapeHtml(board.location || "작업장")}</h3></div><div><span class="dsafety-board-site">${escapeHtml(site)}</span><span>${escapeHtml(String(board.peopleCount || 0))}명</span></div></div><div class="dsafety-info-grid dsafety-info-grid-v2"><div class="dsafety-meta-site"><span>사업장</span><b>${escapeHtml(site)}</b></div><div class="dsafety-meta-time"><span>작업시간</span><b>${escapeHtml(board.workTime || "-")}</b></div><div class="dsafety-meta-job"><span>작업명</span><b>${escapeHtml(board.jobName || "-")}</b></div><div class="dsafety-meta-monitor"><span>안전Monitoring 요원</span><b>${escapeHtml(monitor)}</b></div><div class="dsafety-meta-contractor"><span>수행사</span><b>${escapeHtml(board.contractor || "-")}</b></div><div class="dsafety-meta-manager"><span>작업담당자</span><b>${escapeHtml(board.workManager || "-")}</b></div><div class="dsafety-meta-contractor-manager"><span>수행사 담당자</span><b>${escapeHtml(board.contractorManager || "-")}</b></div></div><div class="dsafety-risk-table-wrap"><table class="data-table dsafety-risk-table"><thead><tr><th>No.</th><th>⚠ 잠재위험</th><th>✓ 안전 조치사항</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.no)}</td><td>${escapeHtml(row.risk)}</td><td>${escapeHtml(row.action)}</td></tr>`).join("") || `<tr><td colspan="3">등록된 위험요인이 없습니다.</td></tr>`}</tbody></table></div></section>`;
  renderDSafetyOpinionJobs(board);
  renderDSafetyOpinions(board.opinions || []);
}

function renderDSafetyOpinions(opinions = []) {
  const list = $("#dSafetyOpinionList");
  if (!list) return;
  list.innerHTML = opinions.length ? `<div class="divider-label">접수된 종사자 의견 ${opinions.length}건</div>${opinions.map((item) => `<article class="dsafety-opinion-item"><div><b>${escapeHtml(item.name)} · ${escapeHtml(item.affiliation)}</b><time>${formatDate(item.createdAt)}</time></div>${item.jobName ? `<span class="dsafety-opinion-job">작업 · ${escapeHtml(item.jobName)}</span>` : ""}<p>${escapeHtml(item.content)}</p></article>`).join("")}` : `<div class="dsafety-opinion-empty">아직 등록된 종사자 의견이 없습니다.</div>`;
}

function renderDSafetySelect(resetSelection = false) {
  const select = $("#dSafetyBoardSelect");
  const boards = filteredDSafetyBoards().slice().sort((a,b) => (normalizeDSafetyDate(b.meetingDate) || b.createdAt || "").localeCompare(normalizeDSafetyDate(a.meetingDate) || a.createdAt || ""));
  select.innerHTML = boards.map((board) => `<option value="${escapeHtml(board.id)}">${escapeHtml(board.meetingDate || "날짜 미입력")} · ${escapeHtml(dSafetySiteOf(board))} · ${escapeHtml(board.jobName || board.location || "D-안전회의")}</option>`).join("") || `<option value="">등록된 D-안전소통보드 없음</option>`;
  if (!resetSelection && boards.some((item) => item.id === state.dSafety.selectedId)) select.value = state.dSafety.selectedId;
  else if (boards[0]) { state.dSafety.selectedId = boards[0].id; select.value = boards[0].id; }
  else state.dSafety.selectedId = null;
}

async function loadDSafetyRetention() {
  if (state.session?.role !== "admin") return;
  try {
    state.dSafety.retention = await api("/api/d-safety/retention");
    if ($("#dSafetyRetentionEnabled")) $("#dSafetyRetentionEnabled").checked = state.dSafety.retention.enabled !== false;
    if ($("#dSafetyRetentionDays")) $("#dSafetyRetentionDays").value = String(state.dSafety.retention.days || 180);
    if ($("#dSafetyRetentionStatus")) $("#dSafetyRetentionStatus").textContent = `현재 ${state.dSafety.retention.boardCount || 0}건 · 종사자 의견 ${state.dSafety.retention.opinionCount || 0}건 · 기본 보관 ${state.dSafety.retention.days || 180}일`;
  } catch (error) { if ($("#dSafetyRetentionStatus")) $("#dSafetyRetentionStatus").textContent = `보관현황 조회 실패: ${error.message}`; }
}

async function loadDSafetyBoards() {
  try {
    state.dSafety.boards = await api("/api/d-safety/boards");
    renderDSafetySiteTabs();
    renderDSafetySelect();
    if (state.dSafety.selectedId) await openDSafetyBoard(state.dSafety.selectedId); else renderDSafetyBoard(null);
    await loadDSafetyRetention();
  } catch (error) { toast(`D-안전회의 조회 실패: ${error.message}`); }
}

async function openDSafetyBoard(id) {
  if (!id) { state.dSafety.selectedId = null; return renderDSafetyBoard(null); }
  state.dSafety.selectedId = id;
  try { state.dSafety.current = await api(`/api/d-safety/boards/${encodeURIComponent(id)}`); renderDSafetyBoard(state.dSafety.current); }
  catch (error) { toast(error.message); }
}

function previewDSafetyExcel() {
  try {
    const parsed = parseDSafetyExcel($("#dSafetyExcelInput").value);
    const siteInput = $("#dSafetySiteInput");
    parsed.site = siteInput.value.trim() || parsed.site || "";
    if (!parsed.site) throw new Error("사업장을 입력해주세요.");
    siteInput.value = parsed.site;
    localStorage.setItem("poseidon-dsafety-site", parsed.site);
    state.dSafety.preview = parsed;
    renderDSafetyBoard({ ...state.dSafety.preview, id: "preview", opinions: [] });
    $("#dSafetyImportStatus").textContent = `변환 완료 · ${parsed.site} · 위험/조치 ${parsed.rows.length}개 · 작업인원 ${parsed.peopleCount}명`;
    $("#saveDSafetyBoard").disabled = false;
  } catch (error) { state.dSafety.preview = null; $("#saveDSafetyBoard").disabled = true; toast(error.message, 6000); }
}

async function saveDSafetyBoard() {
  if (!state.dSafety.preview) return toast("먼저 엑셀 데이터를 변환해주세요.");
  try {
    const saved = await api("/api/d-safety/boards", { method: "POST", body: JSON.stringify(state.dSafety.preview) });
    toast(`${saved.site || "사업장"} D-안전회의 소통보드를 저장했습니다.`);
    state.dSafety.preview = null;
    $("#saveDSafetyBoard").disabled = true;
    $("#dSafetyExcelInput").value = "";
    state.dSafety.siteFilter = saved.site || state.dSafety.siteFilter;
    state.dSafety.dateFilter = normalizeDSafetyDate(saved.meetingDate);
    if ($("#dSafetyDateFilter")) $("#dSafetyDateFilter").value = state.dSafety.dateFilter;
    await loadDSafetyBoards();
    state.dSafety.selectedId = saved.id;
    renderDSafetySelect();
    await openDSafetyBoard(saved.id);
  } catch (error) { toast(error.message); }
}

async function submitDSafetyOpinion() {
  const id = state.dSafety.selectedId;
  if (!id) return toast("의견을 등록할 D-안전회의를 먼저 선택해주세요.");
  const affiliation = $("#dSafetyOpinionDept").value.trim();
  const name = $("#dSafetyOpinionName").value.trim();
  const jobName = $("#dSafetyOpinionJob")?.value.trim() || "";
  const content = $("#dSafetyOpinionContent").value.trim();
  if (!affiliation || !name || !content) return toast("소속, 이름, 의견을 모두 입력해주세요.");
  if (!jobName && splitDSafetyJobs(state.dSafety.current?.jobName || "").length) return toast("의견을 남길 작업명을 선택해주세요.");
  try {
    await api(`/api/d-safety/boards/${encodeURIComponent(id)}/opinions`, { method: "POST", body: JSON.stringify({ affiliation, name, jobName, content }) });
    localStorage.setItem("poseidon-dsafety-opinion-user", JSON.stringify({ affiliation, name }));
    $("#dSafetyOpinionContent").value = "";
    toast("종사자 의견이 접수되었습니다.");
    await openDSafetyBoard(id);
  } catch (error) { toast(error.message); }
}

async function deleteDSafetyBoard() {
  if (!state.dSafety.selectedId || !confirm("선택한 D-안전회의와 연결된 종사자 의견을 삭제할까요?")) return;
  try { await api(`/api/d-safety/boards/${encodeURIComponent(state.dSafety.selectedId)}`, { method: "DELETE" }); state.dSafety.selectedId = null; await loadDSafetyBoards(); toast("D-안전회의 자료를 삭제했습니다."); }
  catch (error) { toast(error.message); }
}

function clearDSafetyFilters() {
  state.dSafety.siteFilter = "";
  state.dSafety.dateFilter = "";
  if ($("#dSafetyDateFilter")) $("#dSafetyDateFilter").value = "";
  renderDSafetySiteTabs();
  renderDSafetySelect(true);
  if (state.dSafety.selectedId) openDSafetyBoard(state.dSafety.selectedId); else renderDSafetyBoard(null);
}

async function saveDSafetyRetention() {
  const enabled = $("#dSafetyRetentionEnabled")?.checked !== false;
  const days = Number($("#dSafetyRetentionDays")?.value || 180);
  try { state.dSafety.retention = await api("/api/d-safety/retention", { method: "PUT", body: JSON.stringify({ enabled, days }) }); toast(`D-안전회의 보관기간을 ${days}일로 저장했습니다.`); await loadDSafetyRetention(); }
  catch (error) { toast(error.message); }
}

async function cleanupDSafetyData() {
  const days = Number($("#dSafetyRetentionDays")?.value || 180);
  if (!confirm(`${days}일보다 오래 저장된 D-안전회의와 연결 의견을 정리할까요? 필요하면 먼저 JSON 백업을 받아주세요.`)) return;
  try { const result = await api("/api/d-safety/cleanup", { method: "POST", body: JSON.stringify({ days }) }); toast(`기간 지난 D-안전회의 ${result.deleted || 0}건을 정리했습니다.`); state.dSafety.selectedId = null; await loadDSafetyBoards(); }
  catch (error) { toast(error.message); }
}

async function backupDSafetyData() {
  try {
    const data = await api("/api/d-safety/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `POSEIDON_D-Safety_Backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast(`D-안전회의 ${data.boards?.length || 0}건을 백업했습니다.`);
  } catch (error) { toast(`백업 실패: ${error.message}`); }
}

async function loadPrivacyAdminEditor() {
  const select = $("#privacyDeviceSelect");
  if (!select) return;
  if (!select.value && state.devices[0]) select.value = state.devices[0].id;
  const id = select.value;
  if (!id) { $("#adminFaceMosaic").checked = false; return; }
  try { const config = await api(`/api/devices/${encodeURIComponent(id)}/config`); $("#adminFaceMosaic").checked = config.privacy?.faceMosaic === true; }
  catch { /* noop */ }
}

async function saveAdminPrivacy() {
  const deviceId = $("#privacyDeviceSelect")?.value;
  if (!deviceId) return toast("대상 장치를 선택해주세요.");
  try { await api("/api/guard/privacy", { method: "PUT", body: JSON.stringify({ deviceId, faceMosaic: $("#adminFaceMosaic").checked }) }); toast("얼굴 비식별화 설정을 저장했습니다. 현장 장치에 최대 15초 내 반영됩니다."); }
  catch (error) { toast(error.message); }
}

/* ---------- Smart MSDS library ---------- */

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function msdsFileUrl(id, download = false) {
  const base = `/api/msds/${encodeURIComponent(id)}/file`;
  return download ? `${base}?download=1` : base;
}

function setMsdsSelectedFile(file) {
  state.msds.selectedFile = file || null;
  const label = $("#msdsFileLabel");
  if (!label) return;
  if (!file) {
    label.textContent = "PDF 파일 선택 또는 여기로 끌어놓기";
    return;
  }
  label.textContent = `${file.name} · ${formatBytes(file.size)}`;
  const titleInput = $("#msdsTitleInput");
  if (titleInput && !titleInput.value.trim()) titleInput.value = file.name.replace(/\.pdf$/i, "");
}

async function validateMsdsPdfFile(file) {
  if (!file) return { ok: false, message: "등록할 MSDS PDF를 선택해주세요." };
  const nameLooksPdf = /\.pdf$/i.test(file.name || "");
  const mimeLooksPdf = !file.type || file.type === "application/pdf" || file.type === "application/octet-stream";
  if (!nameLooksPdf && !mimeLooksPdf) return { ok: false, message: "PDF 파일만 등록할 수 있습니다." };
  if (file.size > 12 * 1024 * 1024) return { ok: false, message: "MSDS PDF는 파일 1개당 12MB 이하로 등록해주세요." };
  if (!file.size) return { ok: false, message: "빈 PDF 파일은 등록할 수 없습니다." };
  try {
    const head = new Uint8Array(await file.slice(0, Math.min(file.size, 4096)).arrayBuffer());
    const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
    const maxOffset = Math.max(0, head.length - signature.length);
    let found = false;
    outer: for (let offset = 0; offset <= maxOffset; offset += 1) {
      for (let index = 0; index < signature.length; index += 1) {
        if (head[offset + index] !== signature[index]) continue outer;
      }
      found = true;
      break;
    }
    if (!found) return { ok: false, message: "선택한 파일에서 PDF 헤더를 찾지 못했습니다. PDF로 다시 저장한 뒤 시도해주세요." };
  } catch {
    // 일부 모바일 브라우저에서 로컬 파일 앞부분 읽기가 제한되더라도
    // 서버에서 다시 검증하므로 업로드 자체는 막지 않습니다.
  }
  return { ok: true };
}

function renderMsdsStorage(stats = state.msds.stats) {
  state.msds.stats = stats || state.msds.stats;
  const storage = $("#msdsStorageText");
  const count = $("#msdsCountBadge");
  if (storage) {
    const limit = Number(stats?.softLimitBytes || 0);
    const used = Number(stats?.totalBytes || 0);
    storage.textContent = limit > 0
      ? `MSDS ${stats?.count || 0}건 · ${formatBytes(used)} / 권장 ${formatBytes(limit)}`
      : `MSDS ${stats?.count || 0}건 · ${formatBytes(used)}`;
  }
  if (count) count.textContent = `${stats?.count || 0}건`;
}

function renderMsdsDocuments() {
  const list = $("#msdsDocumentList");
  if (!list) return;
  const items = state.msds.items || [];
  if (!items.length) {
    list.innerHTML = `<div class="msds-empty-list"><span>▧</span><b>${state.msds.query ? "검색 결과가 없습니다" : "등록된 MSDS가 없습니다"}</b><small>${state.msds.query ? "다른 물질명·제조사·CAS 번호로 검색해보세요." : "관리자가 PDF를 등록하면 여기에 표시됩니다."}</small></div>`;
    clearMsdsViewer();
    return;
  }
  list.innerHTML = items.map((item) => `<button class="msds-document-item ${item.id === state.msds.selectedId ? "active" : ""}" data-msds-id="${escapeHtml(item.id)}" type="button">
    <span class="msds-doc-icon">PDF</span>
    <span class="msds-doc-main"><b>${escapeHtml(item.title || item.originalName || "MSDS")}</b><small>${escapeHtml(item.manufacturer || "제조사 미입력")} · ${formatBytes(item.byteLength)}</small><em>${escapeHtml(item.originalName || "")}</em></span>
    <span class="msds-doc-arrow">›</span>
  </button>`).join("");
  $$('[data-msds-id]', list).forEach((button) => button.addEventListener("click", () => openMsdsDocument(button.dataset.msdsId)));
}

function clearMsdsViewer() {
  state.msds.selectedId = null;
  const frame = $("#msdsPdfFrame");
  if (frame) { frame.hidden = true; frame.removeAttribute("src"); }
  if ($("#msdsViewerEmpty")) $("#msdsViewerEmpty").hidden = false;
  if ($("#msdsViewerTitle")) $("#msdsViewerTitle").textContent = "MSDS 자료를 선택하세요";
  if ($("#msdsViewerMeta")) $("#msdsViewerMeta").textContent = "왼쪽 자료목록에서 문서를 선택하면 이 화면에서 바로 열립니다.";
  [$("#msdsOpenNewTab"), $("#msdsDownloadLink"), $("#msdsDeleteButton")].forEach((el) => { if (el) el.hidden = true; });
}

function openMsdsDocument(id) {
  const item = (state.msds.items || []).find((entry) => entry.id === id);
  if (!item) return;
  state.msds.selectedId = id;
  renderMsdsDocuments();
  const inlineUrl = `${msdsFileUrl(id)}#toolbar=1&navpanes=0&view=FitH`;
  const frame = $("#msdsPdfFrame");
  if (frame) { frame.src = inlineUrl; frame.hidden = false; }
  if ($("#msdsViewerEmpty")) $("#msdsViewerEmpty").hidden = true;
  if ($("#msdsViewerTitle")) $("#msdsViewerTitle").textContent = item.title || item.originalName || "MSDS";
  if ($("#msdsViewerMeta")) {
    const details = [item.manufacturer || "제조사 미입력", formatBytes(item.byteLength), `등록 ${formatDate(item.uploadedAt)}`];
    if (item.keywords) details.push(item.keywords);
    $("#msdsViewerMeta").textContent = details.join(" · ");
  }
  const newTab = $("#msdsOpenNewTab");
  if (newTab) { newTab.href = msdsFileUrl(id); newTab.hidden = false; }
  const download = $("#msdsDownloadLink");
  if (download) { download.href = msdsFileUrl(id, true); download.download = item.originalName || `${item.title || "MSDS"}.pdf`; download.hidden = false; }
  const del = $("#msdsDeleteButton");
  if (del && state.session?.role === "admin") del.hidden = false;
}

async function loadMsdsDocuments(query = state.msds.query, { preserveSelection = true } = {}) {
  const q = String(query || "").trim();
  state.msds.query = q;
  const list = $("#msdsDocumentList");
  if (list) list.innerHTML = `<div class="msds-loading"><span class="law-state-orb"></span><b>MSDS 자료 불러오는 중</b></div>`;
  try {
    const data = await api(`/api/msds${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    state.msds.items = Array.isArray(data?.items) ? data.items : [];
    renderMsdsStorage(data?.stats || {});
    const selectedStillExists = preserveSelection && state.msds.items.some((item) => item.id === state.msds.selectedId);
    renderMsdsDocuments();
    if (selectedStillExists) openMsdsDocument(state.msds.selectedId);
    else if (state.msds.items.length) openMsdsDocument(state.msds.items[0].id);
    else clearMsdsViewer();
  } catch (error) {
    if (list) list.innerHTML = `<div class="msds-empty-list error"><span>!</span><b>MSDS 자료를 불러오지 못했습니다</b><small>${escapeHtml(error.message)}</small></div>`;
    toast(error.message);
  }
}

async function uploadMsdsDocument(event) {
  event?.preventDefault?.();
  if (state.session?.role !== "admin") return;
  const file = state.msds.selectedFile || $("#msdsFileInput")?.files?.[0];
  const title = $("#msdsTitleInput")?.value?.trim() || "";
  if (!file) { toast("등록할 MSDS PDF를 선택해주세요."); return; }
  if (!title) { toast("물질명 또는 제품명을 입력해주세요."); return; }
  const validation = await validateMsdsPdfFile(file);
  if (!validation.ok) { toast(validation.message, 5000); return; }
  const button = $("#msdsUploadButton");
  if (button) { button.disabled = true; button.textContent = "업로드 중..."; }
  try {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("title", title);
    form.append("manufacturer", $("#msdsManufacturerInput")?.value?.trim() || "");
    form.append("keywords", $("#msdsKeywordsInput")?.value?.trim() || "");
    const data = await api("/api/msds", { method: "POST", body: form });
    toast("MSDS 자료를 등록했습니다.");
    $("#msdsUploadForm")?.reset();
    setMsdsSelectedFile(null);
    state.msds.query = "";
    if ($("#msdsSearchInput")) $("#msdsSearchInput").value = "";
    await loadMsdsDocuments("", { preserveSelection: false });
    if (data?.id) openMsdsDocument(data.id);
  } catch (error) {
    toast(error.message, 5000);
  } finally {
    if (button) { button.disabled = false; button.textContent = "MSDS 업로드"; }
  }
}

async function deleteSelectedMsds() {
  if (state.session?.role !== "admin" || !state.msds.selectedId) return;
  const item = state.msds.items.find((entry) => entry.id === state.msds.selectedId);
  if (!item) return;
  if (!confirm(`“${item.title || item.originalName}” MSDS 자료를 삭제하시겠습니까?`)) return;
  try {
    await api(`/api/msds/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    toast("MSDS 자료를 삭제했습니다.");
    state.msds.selectedId = null;
    await loadMsdsDocuments(state.msds.query, { preserveSelection: false });
  } catch (error) { toast(error.message, 5000); }
}

async function handleMsdsFileSelection(file) {
  if (!file) { setMsdsSelectedFile(null); return; }
  const validation = await validateMsdsPdfFile(file);
  if (!validation.ok) { toast(validation.message, 5000); setMsdsSelectedFile(null); return; }
  setMsdsSelectedFile(file);
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
  if ($("#guardZoneEditorEnabled")) $("#guardZoneEditorEnabled").checked = enabled;
  guardZoneEditor.enabled = enabled;
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
  $("#lawSearchForm")?.addEventListener("submit", (event) => { event.preventDefault(); searchSafetyLaw($("#lawSearchInput")?.value, { navigate: false }); });
  $("#adminLawQuickForm")?.addEventListener("submit", (event) => { event.preventDefault(); submitQuickLawSearch("#adminLawQuickInput"); });
  $("#guardLawQuickForm")?.addEventListener("submit", (event) => { event.preventDefault(); submitQuickLawSearch("#guardLawQuickInput"); });
  $$('[data-law-query]').forEach((button) => button.addEventListener("click", () => searchSafetyLaw(button.dataset.lawQuery)));
  $("#msdsSearchForm")?.addEventListener("submit", (event) => { event.preventDefault(); loadMsdsDocuments($("#msdsSearchInput")?.value || "", { preserveSelection: false }); });
  $("#msdsResetSearch")?.addEventListener("click", () => { if ($("#msdsSearchInput")) $("#msdsSearchInput").value = ""; loadMsdsDocuments("", { preserveSelection: false }); });
  $("#msdsUploadForm")?.addEventListener("submit", uploadMsdsDocument);
  $("#msdsFileInput")?.addEventListener("change", (event) => handleMsdsFileSelection(event.target.files?.[0]));
  $("#msdsDeleteButton")?.addEventListener("click", deleteSelectedMsds);
  $("#getEmergencyLocation")?.addEventListener("click", updateEmergencyPosition);
  $("#sendEmergencyLocation")?.addEventListener("click", sendEmergencyLocationToAdmin);
  $("#openEmergencyMap")?.addEventListener("click", () => { const url = emergencyMapUrl(); if (url) window.open(url, "_blank", "noopener"); });
  $("#copyEmergencyCoordinates")?.addEventListener("click", async () => { const p = state.emergency.position; if (!p) return; try { await navigator.clipboard.writeText(`${p.latitude},${p.longitude}`); toast("GPS 좌표를 복사했습니다."); } catch { toast("좌표 복사에 실패했습니다."); } });
  $("#emergencyCallSelect")?.addEventListener("change", (event) => { state.emergency.selectedCallId = event.target.value; updateEmergencyCallUi(); });
  $("#emergencyRegionFilter")?.addEventListener("change", (event) => { state.emergency.regionFilter = event.target.value; renderEmergencyContacts(); });
  $("#addEmergencyCall")?.addEventListener("click", addEmergencyCallRow);
  $("#saveEmergencyCalls")?.addEventListener("click", saveEmergencyCallOptions);
  $("#addEmergencyContact")?.addEventListener("click", addEmergencyContactRow);
  $("#saveEmergencyContacts")?.addEventListener("click", saveEmergencyContacts);
  $("#emergencyChartFile")?.addEventListener("change", (event) => uploadEmergencyChart(event.target.files?.[0]));
  $("#deleteEmergencyChart")?.addEventListener("click", deleteEmergencyChart);
  $("#emergencyChartZoomIn")?.addEventListener("click", () => { state.emergency.chartScale += .1; applyEmergencyChartZoom(); });
  $("#emergencyChartZoomOut")?.addEventListener("click", () => { state.emergency.chartScale -= .1; applyEmergencyChartZoom(); });
  $("#emergencyChartReset")?.addEventListener("click", () => { state.emergency.chartScale = 1; applyEmergencyChartZoom(); });
  $("#emergencyChartFit")?.addEventListener("click", fitEmergencyChart);
  $("#previewDSafety")?.addEventListener("click", previewDSafetyExcel);
  $("#saveDSafetyBoard")?.addEventListener("click", saveDSafetyBoard);
  $("#dSafetyBoardSelect")?.addEventListener("change", (event) => openDSafetyBoard(event.target.value));
  $("#dSafetyDateFilter")?.addEventListener("change", async (event) => { state.dSafety.dateFilter = event.target.value || ""; renderDSafetySelect(true); if (state.dSafety.selectedId) await openDSafetyBoard(state.dSafety.selectedId); else renderDSafetyBoard(null); });
  $("#dSafetyClearFilters")?.addEventListener("click", clearDSafetyFilters);
  $("#submitDSafetyOpinion")?.addEventListener("click", submitDSafetyOpinion);
  $("#deleteDSafetyBoard")?.addEventListener("click", deleteDSafetyBoard);
  $("#saveDSafetyRetention")?.addEventListener("click", saveDSafetyRetention);
  $("#backupDSafety")?.addEventListener("click", backupDSafetyData);
  $("#cleanupDSafety")?.addEventListener("click", cleanupDSafetyData);
  $("#privacyDeviceSelect")?.addEventListener("change", loadPrivacyAdminEditor);
  $("#saveAdminPrivacy")?.addEventListener("click", saveAdminPrivacy);
  const msdsDropZone = $("#msdsDropZone");
  msdsDropZone?.addEventListener("click", () => $("#msdsFileInput")?.click());
  msdsDropZone?.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); $("#msdsFileInput")?.click(); } });
  ["dragenter", "dragover"].forEach((name) => msdsDropZone?.addEventListener(name, (event) => { event.preventDefault(); msdsDropZone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => msdsDropZone?.addEventListener(name, (event) => { event.preventDefault(); msdsDropZone.classList.remove("dragging"); }));
  msdsDropZone?.addEventListener("drop", (event) => handleMsdsFileSelection(event.dataTransfer?.files?.[0]));
  $$('[data-goto]').forEach((button) => button.addEventListener("click", () => goToPage(button.dataset.goto)));
  $("#mobileMenu").addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  $("#sidebarScrim").addEventListener("click", () => document.body.classList.remove("sidebar-open"));

  [$("#guardStartButton"), $("#guardTopButton")].forEach((button) => button.addEventListener("click", toggleGuard));
  $("#guardSaveProfile").addEventListener("click", saveGuardProfile);
  $("#guardZoneEnabled").addEventListener("change", handleGuardZoneToggle);
  $("#guardFaceMosaic")?.addEventListener("change", saveGuardPrivacySetting);
  $$("[data-guard-zone-mode]").forEach((button) => button.addEventListener("click", () => setGuardZoneMode(button.dataset.guardZoneMode)));
  $("#guardZoneEditorEnabled")?.addEventListener("change", () => {
    const enabled = $("#guardZoneEditorEnabled").checked;
    guardZoneEditor.enabled = enabled;
    guardZoneEditor.dirty = true;
    $("#guardZoneEnabled").checked = enabled;
    handleGuardZoneToggle();
    drawGuardZoneEditor();
  });
  $("#guardZoneUndo")?.addEventListener("click", undoGuardZonePoint);
  $("#guardZoneReset")?.addEventListener("click", resetGuardZoneEditor);
  $("#guardZoneDelete")?.addEventListener("click", deleteGuardZoneEditor);
  $("#guardZoneSave")?.addEventListener("click", saveGuardZoneFromUser);
  $("#guardZoneName")?.addEventListener("input", () => { guardZoneEditor.dirty = true; });
  $("#guardZoneSeverity")?.addEventListener("change", () => { guardZoneEditor.dirty = true; });
  const guardZoneCanvas = $("#guardZoneCanvas");
  guardZoneCanvas?.addEventListener("pointerdown", onGuardZonePointerDown, { passive: false });
  guardZoneCanvas?.addEventListener("pointermove", onGuardZonePointerMove, { passive: false });
  guardZoneCanvas?.addEventListener("pointerup", onGuardZonePointerUp, { passive: false });
  guardZoneCanvas?.addEventListener("pointercancel", () => { guardZoneEditor.drag = null; guardZoneEditor.pointerStart = null; });
  $("#guardCameraSelect").addEventListener("change", restartGuardCamera);
  $("#guardCallAdminButton").addEventListener("click", initiateGuardCall);
  $("#stopWorkButton")?.addEventListener("click", beginStopWorkRequest);
  $("#submitStopWork")?.addEventListener("click", submitStopWorkRequest);
  $("#cancelStopWork")?.addEventListener("click", closeStopWorkModal);
  $("#stopWorkModalClose")?.addEventListener("click", closeStopWorkModal);
  $("#stopWorkVideoClose")?.addEventListener("click", closeStopWorkVideo);
  $("#stopWorkVideoModal")?.addEventListener("click", (event) => { if (event.target === event.currentTarget) closeStopWorkVideo(); });
  $("#guardTrainingWorker").addEventListener("change", () => updateTrainingFeedback());
  $("#saveTrainingSample").addEventListener("click", () => saveTrainingSample());
  $("#autoTrainingStart")?.addEventListener("click", startAutoTraining);
  $("#autoTrainingStop")?.addEventListener("click", () => stopAutoTraining("사용자가 자동수집을 중지했습니다."));
  [$("#trainingHatLabel"), $("#trainingGogLabel"), $("#trainingMaskLabel")].forEach((select) => select?.addEventListener("change", () => {
    if (guard.autoTraining.active) stopAutoTraining("착용 상태가 변경되어 자동수집을 중지했습니다.");
  }));
  $$('[data-guard-test]').forEach((button) => button.addEventListener("click", () => runGuardTest(button.dataset.guardTest)));
  $("#guardVideo").addEventListener("loadedmetadata", resizeGuardOverlay);
  addEventListener("resize", () => { resizeGuardOverlay(); drawGuardZoneEditor(); if (state.currentPage === "zones") drawZoneCanvas(); });

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
  $$('[data-admin-zone-mode]').forEach((button) => button.addEventListener("click", () => setAdminZoneMode(button.dataset.adminZoneMode)));
  const adminZoneCanvas = $("#zoneCanvas");
  adminZoneCanvas.addEventListener("pointerdown", onAdminZonePointerDown, { passive: false });
  adminZoneCanvas.addEventListener("pointermove", onAdminZonePointerMove, { passive: false });
  adminZoneCanvas.addEventListener("pointerup", onAdminZonePointerUp, { passive: false });
  adminZoneCanvas.addEventListener("pointercancel", () => { adminZoneEditor.drag = null; adminZoneEditor.pointerStart = null; });
  $("#clearZone").addEventListener("click", clearZone);
  $("#deleteZone")?.addEventListener("click", deleteAdminZone);
  $("#saveZone").addEventListener("click", saveZone);

  $$(".rule-device-select").forEach((select) => select.addEventListener("change", () => loadRuleEditor(select.closest(".page").id.replace("page-", ""))));
  $$(".rule-save").forEach((button) => button.addEventListener("click", () => saveCurrentRuleGroup(button)));
  $$(".speak-sample").forEach((button) => button.addEventListener("click", () => { unlockAudio(); speak(button.dataset.text); }));

  document.addEventListener("keydown", (event) => {
    if (!["Delete", "Backspace"].includes(event.key)) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
    if (state.session?.role === "admin" && state.currentPage === "zones" && state.zonePoints.length) {
      event.preventDefault();
      deleteAdminZone();
      return;
    }
    if (state.session?.role === "user" && state.currentPage === "guard" && guardZoneEditor.points.length) {
      event.preventDefault();
      deleteGuardZoneEditor();
    }
  });

  addEventListener("beforeunload", () => {
    if (guard.autoTraining.active) stopAutoTraining("페이지 종료");
    stopStopWorkRollingBuffer();
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
  const savedOpinionUser = JSON.parse(localStorage.getItem("poseidon-dsafety-opinion-user") || "{}");
  if ($("#dSafetyOpinionDept")) $("#dSafetyOpinionDept").value = savedOpinionUser.affiliation || "";
  if ($("#dSafetyOpinionName")) $("#dSafetyOpinionName").value = savedOpinionUser.name || "";
  if ($("#dSafetySiteInput")) $("#dSafetySiteInput").value = localStorage.getItem("poseidon-dsafety-site") || "";
  updateGuardZoneModeUi();
  startGuardZoneEditorLoop();
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
