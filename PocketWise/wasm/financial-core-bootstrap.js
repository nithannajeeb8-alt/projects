/* Required Wasm startup gate. The application does not execute until the C++ financial core is ready. */
(function () {
  'use strict';

  const APP_SCRIPTS = [
    'finance-analytics.js',
    'wasm/shared-costs-api.js',
    'app.js',
    'onboarding.js',
    'statement-parser.js',
    'xlsx-reader.js',
    'local-ai.js',
    'statement-import.js'
  ];

  let scriptsStarted = false;
  let runtimeFailure = null;
  const gate = document.createElement('section');
  gate.id = 'pocketwise-financial-core-gate';
  gate.setAttribute('role', 'status');
  gate.setAttribute('aria-live', 'polite');
  gate.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647', 'display:grid', 'place-items:center',
    'padding:24px', 'box-sizing:border-box', 'background:#10131a', 'color:#f7f8fa',
    'font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,sans-serif', 'text-align:center'
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = 'width:min(100%,440px);padding:28px;border:1px solid #343b49;border-radius:20px;background:#191f2b;box-shadow:0 20px 60px #0008;box-sizing:border-box';
  const title = document.createElement('h1');
  title.textContent = 'Starting PocketWise';
  title.style.cssText = 'margin:0 0 10px;font-size:22px;font-weight:700';
  const message = document.createElement('p');
  message.textContent = 'Loading the required financial calculation engine…';
  message.style.cssText = 'margin:0;color:#c4cad4';
  const details = document.createElement('p');
  details.hidden = true;
  details.style.cssText = 'margin:14px 0 0;color:#f3b6b6;font-size:13px;overflow-wrap:anywhere';
  const action = document.createElement('button');
  action.type = 'button';
  action.textContent = 'Retry loading engine';
  action.hidden = true;
  action.style.cssText = 'margin:20px 0 0;padding:12px 18px;border:0;border-radius:12px;background:#fff;color:#10131a;font:600 15px system-ui;cursor:pointer';
  card.append(title, message, details, action);
  gate.appendChild(card);
  document.body.appendChild(gate);

  function showFailure(error, isRuntimeFailure) {
    if (!gate.isConnected) document.body.appendChild(gate);
    title.textContent = isRuntimeFailure ? 'Financial calculations stopped' : 'PocketWise could not load its financial engine';
    message.textContent = isRuntimeFailure
      ? 'The required WebAssembly calculation failed. No JavaScript substitute was used. Do not rely on financial figures until the app is reloaded and the engine is working.'
      : 'PocketWise requires its C++ WebAssembly financial engine. The app has not started, and no JavaScript calculation fallback will be used.';
    details.textContent = error && error.message ? error.message : String(error || 'Unknown engine error.');
    details.hidden = false;
    action.disabled = false;
    action.textContent = isRuntimeFailure ? 'Reload PocketWise' : 'Retry loading engine';
    action.hidden = false;
    gate.setAttribute('role', 'alert');
    action.onclick = isRuntimeFailure ? () => location.reload() : () => { void start(); };
  }

  function loadScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.async = false;
      script.src = new URL(path, document.baseURI).href;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load required PocketWise application asset: ' + path));
      document.body.appendChild(script);
    });
  }

  async function start() {
    if (scriptsStarted) return;
    action.disabled = true;
    action.textContent = 'Retrying…';
    title.textContent = 'Starting PocketWise';
    message.textContent = 'Checking the required C++ WebAssembly financial engine…';
    details.hidden = true;
    try {
      if (!window.PocketWiseWasm || typeof window.PocketWiseWasm.load !== 'function') {
        throw new Error('The WebAssembly bridge script is missing.');
      }
      await window.PocketWiseWasm.load();
      if (!window.PocketWiseWasm.isReady()) throw new Error('The WebAssembly engine did not enter the ready state.');
    } catch (error) {
      action.disabled = false;
      showFailure(error, false);
      return;
    }

    if (scriptsStarted) return;
    scriptsStarted = true;
    try {
      for (const path of APP_SCRIPTS) await loadScript(path);
      if (!runtimeFailure) gate.remove();
    } catch (error) {
      action.disabled = false;
      showFailure(error, true);
    }
  }

  window.addEventListener('pocketwise:financial-engine-error', event => {
    runtimeFailure = new Error(event && event.detail && event.detail.message || 'Unknown WebAssembly calculation failure.');
    showFailure(runtimeFailure, true);
  });

  void start();
})();
