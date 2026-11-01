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
  let scriptsLoaded = false;
  let appReady = false;
  let runtimeFailure = null;
  const gate = document.createElement('section');
  gate.id = 'pocketwise-financial-core-gate';
  gate.setAttribute('role', 'status');
  gate.setAttribute('aria-live', 'polite');
  gate.setAttribute('aria-label', 'Pocketwise is starting');
  gate.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647', 'display:grid', 'place-items:center',
    'padding:24px', 'box-sizing:border-box', 'background:#f6f8f5', 'color:#172019',
    'font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,sans-serif', 'text-align:center'
  ].join(';');

  const card = document.createElement('div');
  card.className = 'pw-splash-content';
  card.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;width:min(100%,320px);box-sizing:border-box';

  const brandMark = document.createElement('div');
  brandMark.className = 'pw-splash-mark';
  brandMark.setAttribute('aria-hidden', 'true');
  brandMark.style.cssText = 'width:76px;height:76px;display:grid;place-items:center;color:#172019;margin-bottom:19px';
  brandMark.innerHTML = '<svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true"><path d="M7 13a4 4 0 0 1 4-4h21v5H11a4 4 0 0 0-4 4v-5Z" fill="currentColor" opacity=".72"/><path d="M7 18a4 4 0 0 1 4-4h22v16a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4V18Z" fill="currentColor"/><path d="M25 20h7a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3Z" fill="#000000"/><circle cx="26.5" cy="24.5" r="1.2" fill="currentColor"/></svg>';

  const title = document.createElement('h1');
  title.textContent = 'Pocketwise';
  title.style.cssText = 'margin:0;font-size:25px;line-height:1.2;letter-spacing:-.035em;font-weight:700;color:inherit';
  const tagline = document.createElement('p');
  tagline.textContent = 'money, made clearer';
  tagline.style.cssText = 'margin:7px 0 0;font-size:12px;letter-spacing:.075em;text-transform:lowercase;color:currentColor;opacity:.62';

  const spinner = document.createElement('span');
  spinner.className = 'pw-splash-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  spinner.style.cssText = 'width:20px;height:20px;box-sizing:border-box;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;opacity:.55;margin-top:42px;animation:pw-splash-spin .8s linear infinite';

  const message = document.createElement('p');
  message.textContent = 'Getting your workspace ready…';
  message.style.cssText = 'margin:12px 0 0;color:inherit;opacity:.58;font-size:12px';
  const details = document.createElement('p');
  details.hidden = true;
  details.style.cssText = 'margin:14px 0 0;color:#b42318;font-size:13px;overflow-wrap:anywhere;max-width:320px';
  const action = document.createElement('button');
  action.type = 'button';
  action.textContent = 'Retry';
  action.hidden = true;
  action.style.cssText = 'margin:20px 0 0;padding:12px 18px;border:0;border-radius:12px;background:#172019;color:#fff;font:600 15px system-ui;cursor:pointer';

  card.append(brandMark, title, tagline, spinner, message, details, action);
  gate.appendChild(card);
  document.body.appendChild(gate);

  /* The visual is an overlay only. Existing app markup and its layout are untouched. */
  const splashThemeStyle = document.createElement('style');
  splashThemeStyle.textContent = [
    '@keyframes pw-splash-spin{to{transform:rotate(360deg)}}',
    ':root[data-theme="dark"] #pocketwise-financial-core-gate{background:#000;color:#f7f8fa}',
    ':root[data-theme="dark"] #pocketwise-financial-core-gate .pw-splash-mark{color:#f7f8fa}',
    ':root[data-theme="dark"] #pocketwise-financial-core-gate button{background:#f7f8fa;color:#10131a}'
  ].join('');
  document.head.appendChild(splashThemeStyle);

  function maybeHideSplash() {
    if (scriptsLoaded && appReady && !runtimeFailure && gate.isConnected) gate.remove();
  }

  function showFailure(error, failureType) {
    if (!gate.isConnected) document.body.appendChild(gate);
    title.textContent = failureType === 'app' ? 'Pocketwise couldn’t finish loading' : 'Pocketwise couldn’t start';
    message.textContent = failureType === 'runtime'
      ? 'Pocketwise couldn’t finish a required calculation. Reload the app before relying on financial figures.'
      : failureType === 'app'
        ? 'Pocketwise couldn’t prepare your workspace. Your saved records have not been cleared. Reload to try again.'
        : failureType === 'asset'
          ? 'Pocketwise couldn’t load a required app file. Check your deployment and reload to try again.'
          : 'Pocketwise couldn’t prepare the app. Check your connection and reload to try again.';
    details.textContent = error && error.message ? error.message : String(error || 'Unknown engine error.');
    details.hidden = false;
    action.disabled = false;
    action.textContent = 'Reload Pocketwise';
    action.hidden = false;
    gate.setAttribute('role', 'alert');
    action.onclick = () => location.reload();
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
    message.textContent = 'Getting your workspace ready…';
    details.hidden = true;
    try {
      if (!window.PocketWiseWasm || typeof window.PocketWiseWasm.load !== 'function') {
        throw new Error('The WebAssembly bridge script is missing.');
      }
      await window.PocketWiseWasm.load();
      if (!window.PocketWiseWasm.isReady()) throw new Error('The WebAssembly engine did not enter the ready state.');
    } catch (error) {
      action.disabled = false;
      showFailure(error, 'wasm');
      return;
    }

    if (scriptsStarted) return;
    scriptsStarted = true;
    try {
      for (const path of APP_SCRIPTS) await loadScript(path);
      scriptsLoaded = true;
      message.textContent = 'Almost ready…';
      maybeHideSplash();
    } catch (error) {
      action.disabled = false;
      showFailure(error, 'asset');
    }
  }


  window.addEventListener('pocketwise:app-ready', () => {
    appReady = true;
    maybeHideSplash();
  }, { once: true });

  window.addEventListener('pocketwise:financial-engine-error', event => {
    runtimeFailure = new Error(event && event.detail && event.detail.message || 'Unknown WebAssembly calculation failure.');
    showFailure(runtimeFailure, 'runtime');
  });

  window.addEventListener('pocketwise:app-init-error', event => {
    runtimeFailure = new Error(event && event.detail && event.detail.message || 'The workspace could not be initialized.');
    showFailure(runtimeFailure, 'app');
  }, { once: true });

  void start();
})();
