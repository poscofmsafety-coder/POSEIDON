/* global ort */

const ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/";
const MODEL_URL = "/models/person.onnx";
const INPUT_SIZE = 640;
const PERSON_CLASS_ID = 0; // COCO: person

let session = null;
let loadingPromise = null;
let canvas = null;
let ctx = null;

function post(type, payload = {}) { self.postMessage({ type, ...payload }); }

async function loadRuntime() {
  if (self.ort) return;
  importScripts(`${ORT_BASE}ort.min.js`);
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
}

async function fetchWithProgress(url) {
  const response = await fetch(url, { cache: "force-cache", credentials: "same-origin" });
  if (!response.ok) throw new Error(`YOLO11n 모델 다운로드 실패 (${response.status})`);
  const total = Number(response.headers.get("content-length") || 0);
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    post("model-progress", { loaded: received, total, percent: total ? Math.min(99, Math.round(received / total * 100)) : 0 });
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return merged.buffer;
}

async function ensureSession() {
  if (session) return session;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    post("model-status", { message: "실행환경 준비 중" });
    await loadRuntime();
    post("model-status", { message: "YOLO11n 사람 감지 모델 다운로드 중" });
    const modelBuffer = await fetchWithProgress(MODEL_URL);
    post("model-status", { message: "YOLO11n 최적화 중" });
    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      enableCpuMemArena: true,
      enableMemPattern: true,
    });
    post("model-ready", { inputName: session.inputNames[0], outputName: session.outputNames[0], model: "YOLO11n", task: "person" });
    return session;
  })().catch((error) => {
    post("model-error", { message: error?.message || String(error) });
    loadingPromise = null;
    throw error;
  });
  return loadingPromise;
}

function ensureCanvas() {
  if (!canvas) {
    canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  }
}

function rgbaToInput(rgba) {
  const plane = INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(plane * 3);
  for (let i = 0, pixel = 0; i < rgba.length; i += 4, pixel += 1) {
    input[pixel] = rgba[i] / 255;
    input[plane + pixel] = rgba[i + 1] / 255;
    input[plane * 2 + pixel] = rgba[i + 2] / 255;
  }
  return input;
}

function preprocess(bitmap) {
  ensureCanvas();
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const scale = Math.min(INPUT_SIZE / sourceWidth, INPUT_SIZE / sourceHeight);
  const drawWidth = Math.round(sourceWidth * scale);
  const drawHeight = Math.round(sourceHeight * scale);
  const padX = Math.floor((INPUT_SIZE - drawWidth) / 2);
  const padY = Math.floor((INPUT_SIZE - drawHeight) / 2);
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(bitmap, padX, padY, drawWidth, drawHeight);
  bitmap.close();
  return { input: rgbaToInput(ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data), sourceWidth, sourceHeight, scale, padX, padY };
}

function preprocessRgba(rgbaBuffer, meta = {}) {
  const rgba = new Uint8ClampedArray(rgbaBuffer);
  const expected = INPUT_SIZE * INPUT_SIZE * 4;
  if (rgba.length !== expected) throw new Error(`RGBA 입력 크기 오류: ${rgba.length} / ${expected}`);
  return { input: rgbaToInput(rgba), sourceWidth: Number(meta.sourceWidth || INPUT_SIZE), sourceHeight: Number(meta.sourceHeight || INPUT_SIZE), scale: Number(meta.scale || 1), padX: Number(meta.padX || 0), padY: Number(meta.padY || 0) };
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  return inter / Math.max(1e-6, areaA + areaB - inter);
}
function nms(items, threshold = 0.45, max = 30) {
  const list = [...items].sort((a, b) => b.score - a.score);
  const kept = [];
  while (list.length && kept.length < max) {
    const current = list.shift();
    kept.push(current);
    for (let i = list.length - 1; i >= 0; i -= 1) if (iou(current, list[i]) > threshold) list.splice(i, 1);
  }
  return kept;
}

function parseOutput(tensor, meta, threshold) {
  const dims = tensor.dims;
  const data = tensor.data;
  if (dims.length !== 3) throw new Error(`지원하지 않는 YOLO11n 출력 형태: ${dims.join("x")}`);
  let channels, anchors, channelFirst;
  if (dims[1] < dims[2]) { channels = dims[1]; anchors = dims[2]; channelFirst = true; }
  else { anchors = dims[1]; channels = dims[2]; channelFirst = false; }
  if (channels < 5) throw new Error(`YOLO11n 출력 채널 오류: ${channels}`);
  const at = channelFirst ? (a, c) => data[c * anchors + a] : (a, c) => data[a * channels + c];
  const candidates = [];
  for (let a = 0; a < anchors; a += 1) {
    const score = Number(at(a, 4 + PERSON_CLASS_ID));
    if (score < threshold) continue;
    const cx = at(a, 0), cy = at(a, 1), width = at(a, 2), height = at(a, 3);
    let x1 = (cx - width / 2 - meta.padX) / meta.scale;
    let y1 = (cy - height / 2 - meta.padY) / meta.scale;
    let x2 = (cx + width / 2 - meta.padX) / meta.scale;
    let y2 = (cy + height / 2 - meta.padY) / meta.scale;
    x1 = clamp(x1, 0, meta.sourceWidth); y1 = clamp(y1, 0, meta.sourceHeight);
    x2 = clamp(x2, 0, meta.sourceWidth); y2 = clamp(y2, 0, meta.sourceHeight);
    if (x2 - x1 < 8 || y2 - y1 < 12) continue;
    candidates.push({ classId: PERSON_CLASS_ID, label: "Person", score, x1, y1, x2, y2, x: x1, y: y1, width: x2 - x1, height: y2 - y1, sourceModel: "YOLO11n" });
  }
  return nms(candidates);
}

async function inferPrepared(meta, threshold = 0.30) {
  const activeSession = await ensureSession();
  const started = performance.now();
  const tensor = new ort.Tensor("float32", meta.input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const outputs = await activeSession.run({ [activeSession.inputNames[0]]: tensor });
  const output = outputs[activeSession.outputNames[0]];
  return { detections: parseOutput(output, meta, threshold), sourceWidth: meta.sourceWidth, sourceHeight: meta.sourceHeight, inferenceMs: performance.now() - started };
}

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "load") {
    try { await ensureSession(); } catch { /* posted above */ }
    return;
  }
  try {
    if (message.type === "infer" && message.bitmap) {
      const result = await inferPrepared(preprocess(message.bitmap), Number(message.threshold || 0.30));
      post("result", { requestId: message.requestId, ...result });
      return;
    }
    if (message.type === "infer-rgba" && message.rgba) {
      const result = await inferPrepared(preprocessRgba(message.rgba, message.meta || {}), Number(message.threshold || 0.30));
      post("result", { requestId: message.requestId, ...result });
    }
  } catch (error) {
    try { message.bitmap?.close?.(); } catch { /* noop */ }
    post("inference-error", { requestId: message.requestId, message: error?.message || String(error) });
  }
};
