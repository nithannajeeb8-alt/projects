/* PocketWise WebAssembly adapter. Migrated financial aggregation is Wasm-only. */
(function (root, factory) {
  const sourceScriptUrl = typeof document !== 'undefined' && document.currentScript ? document.currentScript.src : '';
  const api = factory(root, sourceScriptUrl);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PocketWiseWasm = api;
  // Prewarm the engine. The app bootstrap separately awaits this promise and
  // refuses to start the application if the required financial core is absent.
  api.load().catch(() => {});
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, sourceScriptUrl) {
  'use strict';
  const TYPE_CODES = Object.freeze({ income: 1, expense: 2, refund: 3, borrowed: 4, lent: 5, repay_in: 6, repay_out: 7, transfer: 8 });
  const RESULT_FIELDS = 23;
  const RESULT_BYTES = 192;
  let instancePromise = null;
  let engine = null;
  let loadError = null;

  function wasmUrl() {
    if (sourceScriptUrl) return new URL('pocketwise-engine.wasm', sourceScriptUrl).href;
    if (typeof __dirname !== 'undefined') return __dirname + '/pocketwise-engine.wasm';
    return 'wasm/pocketwise-engine.wasm';
  }

  function notifyFailure(error) {
    try {
      if (root && typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('pocketwise:financial-engine-error', {
          detail: { message: error.message }
        }));
      }
    } catch (_) { /* Error reporting must never mask the calculation failure. */ }
    return error;
  }

  function failure(message, cause) {
    const error = new Error(message);
    error.name = 'PocketWiseFinancialEngineError';
    error.pocketWiseFinancialCore = true;
    if (cause) error.cause = cause;
    return notifyFailure(error);
  }

  async function instantiate() {
    if (typeof WebAssembly === 'undefined') throw new Error('This browser does not support WebAssembly.');
    let result;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      const fs = require('fs');
      const bytes = fs.readFileSync(wasmUrl());
      result = await WebAssembly.instantiate(bytes, {});
    } else {
      const response = await fetch(wasmUrl(), { cache: 'force-cache', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Financial engine asset could not be loaded (' + response.status + ').');
      if (WebAssembly.instantiateStreaming && /application\/wasm/i.test(response.headers.get('content-type') || '')) {
        try {
          result = await WebAssembly.instantiateStreaming(Promise.resolve(response), {});
        } catch (_) {
          const retry = await fetch(wasmUrl(), { cache: 'force-cache', credentials: 'same-origin' });
          if (!retry.ok) throw new Error('Financial engine asset could not be reloaded (' + retry.status + ').');
          result = await WebAssembly.instantiate(await retry.arrayBuffer(), {});
        }
      } else {
        result = await WebAssembly.instantiate(await response.arrayBuffer(), {});
      }
    }
    const exports = result.instance ? result.instance.exports : result.exports;
    if (!exports || !exports.memory || typeof exports.pw_alloc !== 'function' || typeof exports.pw_reset !== 'function' || typeof exports.pw_aggregate !== 'function') {
      throw new Error('Financial engine exports are incomplete.');
    }
    engine = exports;
    return true;
  }

  function load() {
    if (engine) return Promise.resolve(true);
    if (!instancePromise) {
      instancePromise = instantiate().then(value => {
        loadError = null;
        return value;
      }).catch(error => {
        loadError = error;
        instancePromise = null;
        throw error;
      });
    }
    return instancePromise;
  }

  function aggregate(transactions, toMinor, bucketFor) {
    if (!engine) {
      throw failure(loadError
        ? 'The required WebAssembly financial engine is unavailable. Reload or reinstall PocketWise after its engine assets are available.'
        : 'The required WebAssembly financial engine has not finished loading.');
    }
    if (!Array.isArray(transactions)) throw failure('Financial engine input must be an array of transactions.');
    if (transactions.length > 1000000) throw failure('Financial engine input exceeds the supported limit of 1,000,000 transactions.');
    if (typeof toMinor !== 'function') throw failure('Financial engine amount converter is missing.');

    try {
      engine.pw_reset();
      const count = transactions.length;
      const inputBytes = Math.max(1, count * 16);
      const inputPtr = engine.pw_alloc(inputBytes);
      const outputPtr = engine.pw_alloc(RESULT_BYTES);
      if (!inputPtr || !outputPtr) throw new Error('WebAssembly linear-memory allocation failed.');
      const inputEnd = inputPtr + inputBytes;
      const outputEnd = outputPtr + RESULT_BYTES;
      if (!Number.isSafeInteger(inputEnd) || !Number.isSafeInteger(outputEnd) || inputEnd > 0xFFFFFFFF || outputEnd > 0xFFFFFFFF) {
        throw new Error('WebAssembly memory address calculation overflowed.');
      }

      const memory = engine.memory;
      const requiredEnd = Math.max(inputEnd, outputEnd);
      if (requiredEnd > memory.buffer.byteLength) {
        const pages = Math.ceil((requiredEnd - memory.buffer.byteLength) / 65536);
        memory.grow(pages);
      }
      if (requiredEnd > memory.buffer.byteLength) throw new Error('WebAssembly memory could not be expanded for this calculation.');

      const buffer = memory.buffer;
      const words = new Uint32Array(buffer, inputPtr, count * 4);
      let absoluteTotal = 0;
      for (let i = 0; i < count; i += 1) {
        const tx = transactions[i];
        if (!tx || typeof tx !== 'object') throw new TypeError('Transaction row ' + i + ' is not a valid object.');
        const amount = Number(toMinor(tx.amount));
        if (!Number.isSafeInteger(amount)) throw new RangeError('Transaction row ' + i + ' is outside the safe integer-paise range.');
        absoluteTotal += Math.abs(amount);
        // JS-facing rupee numbers cannot preserve a total larger than MAX_SAFE_INTEGER paise.
        // Stop rather than silently substituting a JavaScript calculation.
        if (!Number.isSafeInteger(absoluteTotal)) throw new RangeError('This transaction batch exceeds the exact paise range supported by PocketWise.');

        const type = TYPE_CODES[String(tx.type || '')] || 0;
        let bucket = 0;
        if (typeof bucketFor === 'function') {
          const rawBucket = Number(bucketFor(tx));
          if (!Number.isInteger(rawBucket) || rawBucket < 0 || rawBucket > 6) {
            throw new TypeError('Transaction row ' + i + ' produced an invalid cash-flow bucket.');
          }
          bucket = rawBucket;
        }
        // Pack signed safe-integer paise into the C++ int64_t ABI without BigInt marshalling.
        words[i * 4] = amount >>> 0;
        words[i * 4 + 1] = Math.floor(amount / 4294967296) >>> 0;
        words[i * 4 + 2] = type;
        words[i * 4 + 3] = bucket;
      }

      const status = engine.pw_aggregate(inputPtr, count, outputPtr);
      if (status !== 0) throw new Error('C++ financial engine rejected the calculation (status ' + status + ').');
      const statusView = new Uint32Array(buffer, outputPtr + 188, 1);
      if (statusView[0] !== 0) throw new Error('C++ financial engine returned a non-zero result status.');
      const values = new Uint32Array(buffer, outputPtr, RESULT_FIELDS * 2);
      const numbers = Array.from({ length: RESULT_FIELDS }, (_, index) => {
        const high = values[index * 2 + 1] | 0;
        const number = high * 4294967296 + values[index * 2];
        return Number.isSafeInteger(number) ? number : null;
      });
      if (numbers.some(value => value === null)) throw new RangeError('C++ financial engine returned a value outside JavaScript exact-integer range.');
      const countView = new Uint32Array(buffer, outputPtr + 184, 1);
      if (countView[0] !== count) throw new Error('C++ financial engine returned an inconsistent transaction count.');

      return {
        totalsPaise: {
          income: numbers[0], grossExpenses: numbers[1], refunds: numbers[2], borrowed: numbers[3],
          lent: numbers[4], repaymentsReceived: numbers[5], debtRepayments: numbers[6],
          operatingCashFlow: numbers[7], netCashMovement: numbers[8]
        },
        cashFlowPaise: {
          salary: numbers[9], otherIncome: numbers[10], refunds: numbers[11], repaymentsReceived: numbers[12],
          borrowed: numbers[13], otherInflow: numbers[14], everydayExpenses: numbers[15], bills: numbers[16],
          shopping: numbers[17], subscriptions: numbers[18], debtRepayments: numbers[19], moneyLent: numbers[20],
          otherOutflow: numbers[21], internalTransfers: numbers[22]
        },
        transactionCount: countView[0]
      };
    } catch (error) {
      if (error && error.pocketWiseFinancialCore) throw error;
      throw failure('WebAssembly financial calculation failed: ' + (error && error.message ? error.message : 'unknown engine error') + '. No JavaScript calculation was substituted.', error);
    }
  }

  return Object.freeze({
    load,
    isReady: () => !!engine,
    getLoadError: () => loadError,
    aggregate,
    typeCodes: TYPE_CODES
  });
});
