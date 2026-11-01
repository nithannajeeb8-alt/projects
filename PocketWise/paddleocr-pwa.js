/*
 * PocketWise PaddleOCR browser integration.
 * Uses the official @paddleocr/paddleocr-js PP-OCRv6 small models and local OCR.
 * Paddle model archives are cached on this origin after first download for offline use.
 * The eval-dependent runtime is isolated in a script-only opaque-origin iframe; the main app CSP stays strict.
 * Receipt pixels are passed to that local browser runtime only; they are never uploaded.
 */
(function () {
  'use strict';

  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm';
  // Tiny is the fast local AI recognizer. Small is the existing, larger PaddleOCR fallback.
  // Keep the v243 CacheStorage namespace so previously downloaded Small archives remain usable.
  const MODEL_PROFILES = Object.freeze({
    tiny: Object.freeze({ det: 'PP-OCRv6_tiny_det', rec: 'PP-OCRv6_tiny_rec', label: 'PP-OCRv6 Tiny' }),
    small: Object.freeze({ det: 'PP-OCRv6_small_det', rec: 'PP-OCRv6_small_rec', label: 'PP-OCRv6 Small' })
  });
  const MODEL_CACHE = 'pocketwise-paddle-models-v243';
  const SANDBOX_FILE = 'paddleocr-sandbox.html';
  const SCRIPT_BASE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  const MODEL_BOS = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/';
  const MODEL_HF = 'https://huggingface.co/PaddlePaddle/';
  const MAX_TILE_SIDE = 2200;
  const TILE_OVERLAP = 260;
  let enginePromise = null;
  let engineProfile = null;

  // Android Chromium can expose WebGPU before every operator/runtime path used by
  // PaddleOCR is reliable on that device. Prefer the supported CPU/WASM provider
  // there; desktop browsers may still use auto (WebGPU when it is genuinely usable).
  function isAndroidBrowser() {
    try {
      const nav = window.navigator || {};
      return /Android/i.test(String(nav.userAgent || '')) || String(nav.userAgentData && nav.userAgentData.platform || '') === 'Android';
    } catch (_) { return false; }
  }
  function backendOrder() { return isAndroidBrowser() ? ['wasm'] : ['auto', 'wasm']; }
  let sandboxFrame = null;
  let sandboxReadyPromise = null;
  let sandboxReadyResolve = null;
  let sandboxRequestSequence = 0;
  const pendingSandboxRequests = new Map();

  function report(onStatus, message) {
    if (typeof onStatus === 'function') { try { onStatus(message); } catch (_) { /* status is non-critical */ } }
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function makeKey(name) { return new Request(new URL('/__pocketwise_ocr_models__/' + name + '.tar', location.origin).href); }

  async function readCachedModel(name) {
    try {
      if (!('caches' in window)) return null;
      const cache = await caches.open(MODEL_CACHE);
      const hit = await cache.match(makeKey(name));
      return hit ? await hit.blob() : null;
    } catch (_) { return null; }
  }
  async function cacheModel(name, blob) {
    try {
      if (!('caches' in window)) return false;
      const cache = await caches.open(MODEL_CACHE);
      await cache.put(makeKey(name), new Response(blob, { headers: { 'Content-Type': 'application/x-tar' } }));
      return true;
    } catch (error) {
      console.warn('PocketWise could not persist PaddleOCR model cache.', error);
      return false;
    }
  }
  async function fetchBytes(url, minimumBytes) {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error('PaddleOCR model download failed (' + response.status + ').');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < (Number.isFinite(minimumBytes) ? minimumBytes : 100000)) throw new Error('PaddleOCR model asset is unexpectedly small.');
    return bytes;
  }
  function writeText(view, offset, length, value) {
    const bytes = new TextEncoder().encode(String(value));
    view.set(bytes.subarray(0, length), offset);
  }
  function writeOctal(view, offset, length, value) {
    const text = Math.floor(value).toString(8).padStart(length - 1, '0') + '\0';
    writeText(view, offset, length, text);
  }
  function tarHeader(name, size) {
    const header = new Uint8Array(512), view = new DataView(header.buffer);
    writeText(header, 0, 100, name);
    writeOctal(header, 100, 8, 0o644); writeOctal(header, 108, 8, 0); writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, size); writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
    for (let i = 148; i < 156; i++) header[i] = 32;
    header[156] = 48; writeText(header, 257, 6, 'ustar\0'); writeText(header, 263, 2, '00');
    let checksum = 0; for (let i = 0; i < header.length; i++) checksum += header[i];
    writeText(header, 148, 8, checksum.toString(8).padStart(6, '0') + '\0 ');
    return header;
  }
  function buildUstar(files) {
    const chunks = [], zero = new Uint8Array(512);
    files.forEach(function (file) {
      const data = file.bytes, header = tarHeader(file.name, data.length);
      chunks.push(header, data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) chunks.push(new Uint8Array(pad));
    });
    chunks.push(zero, zero);
    return new Blob(chunks, { type: 'application/x-tar' });
  }
  async function downloadModel(name, onStatus) {
    const cached = await readCachedModel(name);
    if (cached) { report(onStatus, 'Using cached PaddleOCR model: ' + name + '.'); return cached; }
    report(onStatus, 'Downloading PaddleOCR model ' + name + ' (first use only)…');
    let blob = null, lastError = null;
    // Paddle's official model host occasionally omits CORS headers on a shared cache entry.
    const attempts = [MODEL_BOS + name + '_onnx_infer.tar?src=pocketwise', MODEL_BOS + name + '_onnx_infer.tar?retry=' + Math.random().toString(36).slice(2)];
    for (const url of attempts) {
      try { blob = new Blob([await fetchBytes(url)], { type: 'application/x-tar' }); break; }
      catch (error) { lastError = error; }
    }
    if (!blob) {
      report(onStatus, 'Trying PaddleOCR model mirror…');
      try {
        const base = MODEL_HF + name + '_onnx/resolve/main/';
        const [onnx, yml] = await Promise.all([fetchBytes(base + 'inference.onnx', 100000), fetchBytes(base + 'inference.yml', 20)]);
        blob = buildUstar([{ name: 'inference.onnx', bytes: onnx }, { name: 'inference.yml', bytes: yml }]);
      } catch (error) { lastError = error; }
    }
    if (!blob) throw new Error('PaddleOCR could not download ' + name + '. Connect once to install its offline model. ' + (lastError && lastError.message || ''));
    const saved = await cacheModel(name, blob);
    report(onStatus, saved
      ? 'PaddleOCR model cached for later use: ' + name + '.'
      : 'PaddleOCR model loaded, but browser storage could not cache it. Offline scans are not guaranteed.');
    return blob;
  }


  function handleSandboxMessage(event) {
    if (!sandboxFrame || event.source !== sandboxFrame.contentWindow) return;
    const data = event.data;
    if (!data || data.channel !== 'pocketwise-paddle-sandbox') return;
    if (data.type === 'ready') {
      if (sandboxReadyResolve) sandboxReadyResolve();
      return;
    }
    if (data.type !== 'response' || !data.id) return;
    const pending = pendingSandboxRequests.get(data.id);
    if (!pending) return;
    pendingSandboxRequests.delete(data.id);
    clearTimeout(pending.timer);
    if (data.ok) pending.resolve(data.result);
    else pending.reject(new Error(String(data.error || 'The isolated OCR engine could not complete the request.')));
  }
  if (typeof window.addEventListener === 'function') window.addEventListener('message', handleSandboxMessage, false);

  function getSandbox() {
    if (sandboxReadyPromise) return sandboxReadyPromise;
    sandboxReadyPromise = new Promise(function (resolve, reject) {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      frame.setAttribute('title', 'PocketWise local OCR engine');
      frame.style.cssText = 'position:absolute;width:1px;height:1px;left:-10000px;top:0;border:0;opacity:0;pointer-events:none;';
      sandboxFrame = frame;
      let settled = false;
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        sandboxReadyPromise = null;
        sandboxReadyResolve = null;
        try { frame.remove(); } catch (_) {}
        if (sandboxFrame === frame) sandboxFrame = null;
        reject(new Error('The isolated OCR runtime did not start. Reopen PocketWise and try again.'));
      }, 20000);
      sandboxReadyResolve = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sandboxReadyResolve = null;
        resolve(frame);
      };
      frame.addEventListener('error', function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sandboxReadyPromise = null;
        sandboxReadyResolve = null;
        if (sandboxFrame === frame) sandboxFrame = null;
        reject(new Error('The isolated OCR runtime could not be loaded.'));
      }, { once: true });
      frame.src = new URL(SANDBOX_FILE, SCRIPT_BASE || document.baseURI).href;
      document.body.appendChild(frame);
    });
    return sandboxReadyPromise;
  }

  async function sandboxRequest(type, payload, timeoutMs) {
    const frame = await getSandbox();
    const id = 'pw-ocr-' + (++sandboxRequestSequence);
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        pendingSandboxRequests.delete(id);
        reject(new Error(type === 'predict'
          ? 'OCR took too long on this device. Try a smaller screenshot.'
          : 'The local OCR runtime timed out while starting.'));
      }, Number.isFinite(timeoutMs) ? timeoutMs : 120000);
      pendingSandboxRequests.set(id, { resolve: resolve, reject: reject, timer: timer });
      try {
        frame.contentWindow.postMessage(Object.assign({
          channel: 'pocketwise-paddle-sandbox', type: type, id: id
        }, payload || {}), '*');
      } catch (error) {
        clearTimeout(timer);
        pendingSandboxRequests.delete(id);
        reject(error);
      }
    });
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      if (!canvas || typeof canvas.toBlob !== 'function') {
        reject(new Error('This browser cannot prepare the image for local OCR.'));
        return;
      }
      try {
        canvas.toBlob(function (blob) {
          if (!blob || !blob.size) reject(new Error('The screenshot could not be prepared for OCR.'));
          else resolve(blob);
        }, 'image/png');
      } catch (error) { reject(error); }
    });
  }

  async function createEngine(profileName, onStatus, backend) {
    const profile = MODEL_PROFILES[profileName];
    if (!profile) throw new Error('Unknown local OCR model profile.');
    const runtimeBackend = backend === 'wasm' ? 'wasm' : 'auto';
    const engineKey = profileName + ':' + runtimeBackend;
    if (enginePromise && engineProfile === engineKey) return enginePromise;
    engineProfile = engineKey;
    const requestedPromise = (async function () {
      report(onStatus, profileName === 'tiny'
        ? 'Preparing lightweight AI OCR model (PP-OCRv6 Tiny)…'
        : 'Preparing PaddleOCR fallback model (PP-OCRv6 Small)…');
      const [detBlob, recBlob] = await Promise.all([
        downloadModel(profile.det, onStatus), downloadModel(profile.rec, onStatus)
      ]);
      report(onStatus, 'Starting isolated ' + profile.label + ' runtime…');
      await sandboxRequest('init', {
        detectionModel: detBlob,
        recognitionModel: recBlob,
        detectionModelName: profile.det,
        recognitionModelName: profile.rec,
        backend: runtimeBackend
      }, 180000);
      return {
        profile: profileName,
        predict: async function (canvas, options) {
          const image = await canvasToBlob(canvas);
          const result = await sandboxRequest('predict', { image: image, options: options || {} }, 120000);
          return result ? [result] : [];
        },
        dispose: async function () {
          try { await sandboxRequest('dispose', {}, 15000); } catch (_) { /* iframe may already be gone */ }
        }
      };
    })();
    enginePromise = requestedPromise;
    try {
      return await requestedPromise;
    } catch (error) {
      if (enginePromise === requestedPromise) {
        enginePromise = null;
        engineProfile = null;
      }
      throw error;
    }
  }

  async function toCanvas(input) {
    if (input && input.getContext && Number(input.width) && Number(input.height)) return input;
    let bitmap;
    if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(input);
    else {
      const url = URL.createObjectURL(input);
      try {
        const img = new Image(); img.decoding = 'async'; img.src = url;
        await (img.decode ? img.decode() : new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; }));
        const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0); return canvas;
      } finally { URL.revokeObjectURL(url); }
    }
    try {
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas is unavailable for local OCR.');
      ctx.drawImage(bitmap, 0, 0); return canvas;
    } finally { bitmap.close && bitmap.close(); }
  }
  function tileRects(width, height) {
    const rects = [];
    function starts(size) {
      if (size <= MAX_TILE_SIDE) return [0];
      const stride = MAX_TILE_SIDE - TILE_OVERLAP, result = [0];
      let pos = 0;
      while (pos + MAX_TILE_SIDE < size) {
        let next = pos + stride;
        // If the next standard tile would leave only a sliver uncovered, shift that
        // final tile to the edge instead of adding a near-duplicate crop.
        const uncovered = size - (next + MAX_TILE_SIDE);
        if (uncovered > 0 && uncovered < TILE_OVERLAP) next = size - MAX_TILE_SIDE;
        if (next <= pos || result.includes(next)) break;
        result.push(next);
        pos = next;
      }
      return result;
    }
    const xs = starts(width), ys = starts(height);
    ys.forEach(y => xs.forEach(x => rects.push({ x, y, width: Math.min(MAX_TILE_SIDE, width - x), height: Math.min(MAX_TILE_SIDE, height - y) })));
    return rects;
  }
  function canvasTile(source, rect, invert) {
    const canvas = document.createElement('canvas'); canvas.width = rect.width; canvas.height = rect.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height), data = image.data;
    // PaddleOCR's Latin recognizer is strongest with dark characters on a light paper field.
    // Invert dark-mode cards locally; do not force an inverted version for normal receipts.
    const step = Math.max(4, Math.floor((data.length / 4) / 2400)); let dark = 0, samples = 0;
    for (let p = 0; p < data.length; p += step * 4) { const g = data[p] * .299 + data[p + 1] * .587 + data[p + 2] * .114; if (g < 118) dark++; samples++; }
    const darkRatio = samples ? dark / samples : 0;
    const shouldInvert = invert === true || (invert !== false && darkRatio > .56);
    for (let p = 0; p < data.length; p += 4) {
      const gray = data[p] * .299 + data[p + 1] * .587 + data[p + 2] * .114;
      let v = shouldInvert ? 255 - gray : gray;
      // Mild local contrast expansion helps compressed screenshots without binarising strokes.
      v = clamp((v - 126) * 1.10 + 126, 0, 255);
      data[p] = data[p + 1] = data[p + 2] = v;
    }
    ctx.putImageData(image, 0, 0);
    return { canvas: canvas, inverted: shouldInvert, darkRatio: darkRatio };
  }
  function polygonBounds(poly) {
    if (!Array.isArray(poly) || !poly.length) return null;
    const points = Array.isArray(poly[0]) ? poly : [];
    if (!points.length) return null;
    const xs = points.map(p => Number(p[0])).filter(Number.isFinite), ys = points.map(p => Number(p[1])).filter(Number.isFinite);
    if (!xs.length || !ys.length) return null;
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  function overlapRatio(a, b) {
    const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0), x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
    const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const areaA = Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0)), areaB = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
    return intersection / Math.min(areaA, areaB);
  }
  function dedupeItems(items) {
    const sorted = items.filter(item => item.text && item.poly).sort((a, b) => (b.score || 0) - (a.score || 0));
    const kept = [];
    sorted.forEach(item => {
      const box = polygonBounds(item.poly); if (!box) return;
      const textKey = item.text.toLowerCase().replace(/[^a-z0-9₹@.]/g, '');
      const duplicate = kept.find(other => {
        const otherBox = polygonBounds(other.poly);
        return other.text.toLowerCase().replace(/[^a-z0-9₹@.]/g, '') === textKey && otherBox && overlapRatio(box, otherBox) > .48;
      });
      if (!duplicate) kept.push(item);
    });
    return kept.sort((a, b) => {
      const A = polygonBounds(a.poly), B = polygonBounds(b.poly);
      return (A.y0 + A.y1) - (B.y0 + B.y1) || A.x0 - B.x0;
    });
  }
  async function predictOne(engine, canvas, relaxed) {
    const options = relaxed ? {
      textDetLimitSideLen: 1600, textDetLimitType: 'max', textDetMaxSideLimit: 2400,
      textDetThresh: .22, textDetBoxThresh: .34, textDetUnclipRatio: 1.9, textRecScoreThresh: 0
    } : {
      textDetLimitSideLen: 1600, textDetLimitType: 'max', textDetMaxSideLimit: 2400,
      textDetThresh: .28, textDetBoxThresh: .44, textDetUnclipRatio: 1.7, textRecScoreThresh: 0
    };
    const results = await engine.predict(canvas, options);
    return Array.isArray(results) && results[0] ? results[0] : null;
  }
  function assessTinyResult(result) {
    const text = String(result && result.text || '').trim();
    const items = Array.isArray(result && result.items) ? result.items : [];
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const scores = items.map(item => Number(item && item.score)).filter(score => Number.isFinite(score) && score > 0);
    const averageScore = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
    const numericLines = lines.filter(line => /\d/.test(line)).length;
    const hasCurrencyCue = /₹|\bINR\b|\bRs\.?\s*\d/i.test(text);
    const hasPaymentCue = /\b(paid|payment|received|sent|upi|transaction|successful|completed|ref(?:erence)?|utr|rrn|amount)\b/i.test(text);
    const reasons = [];
    if (!text || !items.length) reasons.push('no readable text');
    if (lines.length < 4) reasons.push('too few text lines');
    if (numericLines < 1) reasons.push('no amount or reference digits');
    if (!hasCurrencyCue) reasons.push('no reliable currency marker');
    if (!scores.length || averageScore < 0.48) reasons.push('low or missing recognition confidence');
    if (!hasPaymentCue && lines.length < 7) reasons.push('weak payment context');

    // Presence of a rupee glyph alone is not proof that Tiny captured the full
    // amount. A common mobile failure is to return only the leading digit (₹2)
    // while dropping the remaining digits. Reuse the same conservative spatial
    // receipt parser used by the review flow before deciding that Tiny succeeded.
    let structuredAmount = null;
    const receiptParser = window.PocketWiseReceiptParser;
    if (receiptParser && typeof receiptParser.extract === 'function' && items.length) {
      try {
        const fields = receiptParser.extract({ text: text, items: items });
        structuredAmount = fields && fields.amount || null;
        // Text-only test doubles and some simplified export paths do not retain
        // geometry. In that case the parser may keep a clear currency candidate
        // just below its stricter review threshold. Accept it for fallback gating
        // only when it is a multi-digit amount with a currency marker; never use
        // this heuristic to save a transaction.
        const candidateAmount = !structuredAmount && fields && Array.isArray(fields.candidates)
          ? fields.candidates.find(function (candidate) {
            return candidate && candidate.hasCurrency && Number(candidate.value) >= 10 && Number(candidate.confidence) >= .55;
          }) : null;
        if (candidateAmount) structuredAmount = candidateAmount;
        if (!structuredAmount) reasons.push('no confidently identified payment amount');
        else if (Number(structuredAmount.value) > 0 && Number(structuredAmount.value) < 10) {
          reasons.push('suspiciously short amount; possible dropped digits');
        }
      } catch (error) {
        reasons.push('receipt amount validation failed');
      }
    }
    return {
      useFallback: reasons.length > 0,
      reasons: reasons,
      averageScore: averageScore,
      lineCount: lines.length,
      hasCurrencyCue: hasCurrencyCue,
      amountValue: structuredAmount ? Number(structuredAmount.value) : null,
      amountConfidence: structuredAmount ? Number(structuredAmount.confidence) || 0 : 0
    };
  }

  async function recognizeWithEngine(engine, source, onStatus, profileName) {
    const width = source.width, height = source.height;
    if (!width || !height) throw new Error('The selected image has no readable pixels.');
    const tiles = tileRects(width, height), collected = [], timings = [];
    const label = MODEL_PROFILES[profileName].label;
    report(onStatus, 'Reading receipt with ' + label + '…');
    for (let i = 0; i < tiles.length; i++) {
      const rect = tiles[i];
      const normal = canvasTile(source, rect, null);
      const variants = [normal];
      // Mixed receipts sometimes contain a dark card on a light page. Scan its inverse too.
      if (normal.darkRatio > .30 && normal.darkRatio <= .56) variants.push(canvasTile(source, rect, true));
      for (let v = 0; v < variants.length; v++) {
        const result = await predictOne(engine, variants[v].canvas, false);
        if (!result || !Array.isArray(result.items)) continue;
        (result.items || []).forEach(item => {
          const poly = item && item.poly;
          if (!Array.isArray(poly) || !poly.length) return;
          const mapped = poly.map(point => [Number(point[0]) + rect.x, Number(point[1]) + rect.y]);
          collected.push({ text: String(item.text || '').trim(), score: Number(item.score) || 0, poly: mapped });
        });
        if (result.metrics) timings.push(result.metrics);
      }
      report(onStatus, label + ' reading receipt regions… ' + Math.round((i + 1) / tiles.length * 100) + '%');
    }
    let items = dedupeItems(collected);
    // Retry weak detection once at a lower threshold. Missing ₹ must not suppress this pass.
    const hasCurrencyCue = items.some(item => /₹|\bINR\b|\bRs\.?/i.test(item.text));
    if (items.length < 3 || !hasCurrencyCue) {
      report(onStatus, 'Retrying faint text with a more sensitive ' + label + ' detector…');
      for (const rect of tiles) {
        const tile = canvasTile(source, rect, null);
        const result = await predictOne(engine, tile.canvas, true);
        if (!result || !Array.isArray(result.items)) continue;
        result.items.forEach(item => {
          if (!Array.isArray(item.poly)) return;
          collected.push({ text: String(item.text || '').trim(), score: Number(item.score) || 0, poly: item.poly.map(point => [Number(point[0]) + rect.x, Number(point[1]) + rect.y]) });
        });
      }
      items = dedupeItems(collected);
    }
    const text = items.map(item => item.text).filter(Boolean).join('\n').trim();
    return {
      text: text,
      engine: label,
      items: items,
      image: { width: width, height: height, tiles: tiles.length },
      metrics: timings
    };
  }

  async function recognize(input, onStatus) {
    if (!input) throw new TypeError('PaddleOCR requires a receipt image.');
    const source = await toCanvas(input);
    const backends = backendOrder();
    let tinyFailure = null, fallbackFailure = null, usableFallback = null;

    for (let backendIndex = 0; backendIndex < backends.length; backendIndex++) {
      const backend = backends[backendIndex];
      const backendLabel = backend === 'wasm' ? 'CPU/WASM' : 'automatic WebGPU/WASM';
      if (backendIndex > 0) report(onStatus, 'Retrying local OCR with the compatibility ' + backendLabel + ' runtime…');

      try {
        const tinyEngine = await createEngine('tiny', onStatus, backend);
        const tinyResult = await recognizeWithEngine(tinyEngine, source, onStatus, 'tiny');
        const assessment = assessTinyResult(tinyResult);
        if (!assessment.useFallback) {
          tinyResult.engine = 'PP-OCRv6 Tiny (local AI)';
          tinyResult.model = 'PP-OCRv6_tiny';
          tinyResult.backend = backend;
          tinyResult.fallbackUsed = false;
          return tinyResult;
        }
        tinyFailure = new Error(assessment.reasons.join(', '));
        report(onStatus, 'Lightweight OCR result is incomplete (' + assessment.reasons.join(', ') + '). Switching to PaddleOCR Small…');
      } catch (error) {
        tinyFailure = error;
        report(onStatus, 'Lightweight OCR could not run on ' + backendLabel + '. Switching to PaddleOCR Small…');
      }

      try {
        const fallbackEngine = await createEngine('small', onStatus, backend);
        const fallbackResult = await recognizeWithEngine(fallbackEngine, source, onStatus, 'small');
        if (!fallbackResult.text) throw new Error('The fallback model found no readable text.');
        fallbackResult.engine = 'PaddleOCR.js PP-OCRv6 Small fallback';
        fallbackResult.model = 'PP-OCRv6_small';
        fallbackResult.backend = backend;
        fallbackResult.fallbackUsed = true;
        fallbackResult.fallbackReason = tinyFailure && String(tinyFailure.message || tinyFailure).slice(0, 180);
        usableFallback = fallbackResult;
        const fallbackAssessment = assessTinyResult(fallbackResult);
        if (!fallbackAssessment.useFallback || backendIndex === backends.length - 1) return fallbackResult;
        fallbackFailure = new Error('Small result was incomplete: ' + fallbackAssessment.reasons.join(', '));
        report(onStatus, 'PaddleOCR Small returned incomplete fields. Retrying with the compatibility ' + backends[backendIndex + 1] + ' runtime…');
      } catch (error) {
        fallbackFailure = error;
        report(onStatus, 'PaddleOCR Small could not run on ' + backendLabel + '.');
      }
    }

    if (usableFallback) return usableFallback;
    console.warn('PocketWise OCR primary and fallback models both failed.', tinyFailure, fallbackFailure);
    const detail = fallbackFailure && String(fallbackFailure.message || fallbackFailure).slice(0, 120);
    throw new Error('The lightweight OCR and PaddleOCR Small fallback could not complete. ' + (detail || 'Connect once to install/cache the models, then retry.') + ' You can also choose the screenshot again or enter the payment details manually.');
  }

  window.PocketWisePaddleWebOCR = Object.freeze({
    recognize: recognize,
    // Exposed for deterministic geometry regression tests; the app UI does not call this.
    getTilePlan: function (width, height) { return tileRects(width, height).map(rect => Object.assign({}, rect)); },
    getModelConfig: function (name) { const profile = MODEL_PROFILES[name]; return profile ? Object.assign({}, profile) : null; },
    assessTinyResult: assessTinyResult,
    getBackendOrder: backendOrder,
    clearEngine: async function () {
      if (enginePromise) { try { const engine = await enginePromise; if (engine && typeof engine.dispose === 'function') await engine.dispose(); } catch (_) {} }
      enginePromise = null;
      engineProfile = null;
    }
  });
}());
