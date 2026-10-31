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
    const required = ['pw_alloc', 'pw_reset', 'pw_aggregate', 'pw_equal_split', 'pw_percentage_split', 'pw_amount_split', 'pw_sum_minor', 'pw_cash_delta_minor', 'pw_account_balance', 'pw_debt_remaining', 'pw_salary_allocate', 'pw_category_buckets', 'pw_cash_projection', 'pw_ratio_round_minor'];
    if (!exports || !exports.memory || required.some(name => typeof exports[name] !== 'function')) {
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

  function requireEngine() {
    if (!engine) throw failure(loadError
      ? 'The required C++ WebAssembly financial engine is unavailable. Reload or reinstall PocketWise after its engine assets are available.'
      : 'The required C++ WebAssembly financial engine has not finished loading.');
    return engine;
  }

  function ensureScratch(inputBytes, outputBytes) {
    const wasm = requireEngine();
    wasm.pw_reset();
    const inputPtr = wasm.pw_alloc(Math.max(1, inputBytes));
    const outputPtr = wasm.pw_alloc(Math.max(1, outputBytes));
    if (!inputPtr || !outputPtr) throw new Error('WebAssembly linear-memory allocation failed.');
    const requiredEnd = Math.max(inputPtr + Math.max(1, inputBytes), outputPtr + Math.max(1, outputBytes));
    if (!Number.isSafeInteger(requiredEnd) || requiredEnd > 0xFFFFFFFF) throw new Error('WebAssembly memory address calculation overflowed.');
    if (requiredEnd > wasm.memory.buffer.byteLength) {
      wasm.memory.grow(Math.ceil((requiredEnd - wasm.memory.buffer.byteLength) / 65536));
    }
    if (requiredEnd > wasm.memory.buffer.byteLength) throw new Error('WebAssembly memory could not be expanded for this operation.');
    return { wasm, inputPtr, outputPtr, buffer: wasm.memory.buffer };
  }

  function writeI64(words, index, value) {
    if (!Number.isSafeInteger(value)) throw new RangeError('Money must be represented as an exact integer number of paise.');
    const high = Math.floor(value / 4294967296);
    const low = value - high * 4294967296;
    words[index * 2] = low >>> 0;
    words[index * 2 + 1] = high >>> 0;
  }

  function readI64(words, index) {
    const high = words[index * 2 + 1] | 0;
    const value = high * 4294967296 + words[index * 2];
    if (!Number.isSafeInteger(value)) throw new RangeError('C++ returned an amount outside JavaScript exact-integer range.');
    return value;
  }

  function readStatus(status, operation) {
    if (status === 0) return;
    let message = ({
      1: 'Invalid arguments or unsupported input size',
      2: 'Invalid value or arithmetic overflow',
      3: 'Allocation percentages or totals do not reconcile',
      4: 'The calculation could not be reconciled exactly'
    })[status] || ('status ' + status);
    if (operation === 'percentage split' && status === 3) message = 'Percentages must add up to exactly 100%.';
    if (operation === 'exact-amount split' && status === 4) message = 'The entered shares must add up to the full amount';
    throw new Error('C++ ' + operation + ' failed: ' + message + '.');
  }

  function equalSplit(totalMinor, count) {
    try {
      const { wasm, outputPtr, buffer } = ensureScratch(1, count * 8);
      const status = wasm.pw_equal_split(BigInt(totalMinor), count, outputPtr);
      readStatus(status, 'equal split');
      const values = new Uint32Array(buffer, outputPtr, count * 2);
      return Array.from({ length: count }, (_, i) => readI64(values, i));
    } catch (error) { throw failure('WebAssembly equal-split calculation failed: ' + error.message, error); }
  }

  function percentageSplit(totalMinor, basisPoints) {
    try {
      const count = basisPoints.length;
      const { wasm, inputPtr, outputPtr, buffer } = ensureScratch(count * 4, count * 8);
      const input = new Int32Array(buffer, inputPtr, count);
      basisPoints.forEach((value, i) => { input[i] = value; });
      const status = wasm.pw_percentage_split(BigInt(totalMinor), inputPtr, count, outputPtr);
      readStatus(status, 'percentage split');
      const output = new Uint32Array(buffer, outputPtr, count * 2);
      return Array.from({ length: count }, (_, i) => readI64(output, i));
    } catch (error) { throw failure('WebAssembly percentage allocation failed: ' + error.message, error); }
  }

  function amountSplit(totalMinor, amounts) {
    try {
      const count = amounts.length;
      const { wasm, inputPtr, outputPtr, buffer } = ensureScratch(count * 8, count * 8);
      const input = new Uint32Array(buffer, inputPtr, count * 2);
      amounts.forEach((value, i) => writeI64(input, i, value));
      const status = wasm.pw_amount_split(BigInt(totalMinor), inputPtr, count, outputPtr);
      readStatus(status, 'exact-amount split');
      const output = new Uint32Array(buffer, outputPtr, count * 2);
      return Array.from({ length: count }, (_, i) => readI64(output, i));
    } catch (error) { throw failure('WebAssembly exact-amount allocation failed: ' + error.message, error); }
  }

  function sum(values) {
    try {
      if (!Array.isArray(values) || values.length > 1000000) throw new TypeError('The sum input must be an array with at most 1,000,000 values.');
      const count = values.length;
      const { wasm, inputPtr, outputPtr, buffer } = ensureScratch(count * 8, 8);
      const input = new Uint32Array(buffer, inputPtr, Math.max(1, count * 2));
      values.forEach((value, i) => writeI64(input, i, value));
      const status = wasm.pw_sum_minor(inputPtr, count, outputPtr);
      readStatus(status, 'integer-paise sum');
      return readI64(new Uint32Array(buffer, outputPtr, 2), 0);
    } catch (error) { throw failure('WebAssembly sum failed: ' + error.message, error); }
  }

  function cashDelta(amountMinor, typeCode) {
    try {
      if (!Number.isSafeInteger(amountMinor) || !Number.isInteger(typeCode)) throw new TypeError('Cash-flow delta input is invalid.');
      const { wasm, outputPtr, buffer } = ensureScratch(1, 8);
      const status = wasm.pw_cash_delta_minor(BigInt(amountMinor), typeCode, outputPtr);
      readStatus(status, 'cash-flow delta');
      return readI64(new Uint32Array(buffer, outputPtr, 2), 0);
    } catch (error) { throw failure('WebAssembly cash-flow delta failed: ' + error.message, error); }
  }

  function accountBalance(openingMinor, rows) {
    try {
      if (!Array.isArray(rows) || rows.length > 1000000) throw new TypeError('Account-balance input is invalid or too large.');
      const count = rows.length;
      const { wasm, inputPtr, outputPtr, buffer } = ensureScratch(count * 16, 8);
      const words = new Uint32Array(buffer, inputPtr, Math.max(1, count * 4));
      rows.forEach((row, i) => {
        if (!row || !Number.isInteger(row.typeCode) || !Number.isSafeInteger(row.amountMinor)) throw new TypeError('Invalid account transaction at row ' + i + '.');
        writeI64(words, i * 2, row.amountMinor);
        words[i * 4 + 2] = row.typeCode >>> 0;
        words[i * 4 + 3] = ((row.fromAccount ? 1 : 0) | (row.toAccount ? 2 : 0)) >>> 0;
      });
      const status = wasm.pw_account_balance(BigInt(openingMinor), inputPtr, count, outputPtr);
      readStatus(status, 'account balance');
      return readI64(new Uint32Array(buffer, outputPtr, 2), 0);
    } catch (error) { throw failure('WebAssembly account-balance calculation failed: ' + error.message, error); }
  }

  function debtRemaining(originalMinor, repayments) {
    try {
      if (!Array.isArray(repayments) || repayments.length > 1000000) throw new TypeError('Debt repayment input is invalid or too large.');
      const count = repayments.length;
      const { wasm, inputPtr, outputPtr, buffer } = ensureScratch(count * 8, 8);
      const input = new Uint32Array(buffer, inputPtr, Math.max(1, count * 2));
      repayments.forEach((value, i) => writeI64(input, i, value));
      const status = wasm.pw_debt_remaining(BigInt(originalMinor), inputPtr, count, outputPtr);
      readStatus(status, 'debt remaining');
      return readI64(new Uint32Array(buffer, outputPtr, 2), 0);
    } catch (error) { throw failure('WebAssembly debt calculation failed: ' + error.message, error); }
  }

  function salaryAllocate(baseMinor, perCycleBaseMinor, payCycles, perCyclePercentDenominator, rules) {
    try {
      if (!Array.isArray(rules) || rules.length > 1000 || !Number.isInteger(payCycles) || payCycles < 0 || payCycles > 520) {
        throw new TypeError('Salary allocation input is invalid or too large.');
      }
      const count = rules.length;
      const { wasm, inputPtr, outputPtr, buffer } = ensureScratch(count * 16, count * 16 + 24);
      const input = new Uint32Array(buffer, inputPtr, Math.max(1, count * 4));
      rules.forEach((rule, i) => {
        if (!rule || !Number.isSafeInteger(rule.valueScaled) || !['percent', 'fixed'].includes(rule.mode) || (rule.mode === 'percent' && Math.abs(rule.valueScaled) > 100000000) || (rule.mode === 'fixed' && (rule.valueScaled < 0 || rule.valueScaled > Number.MAX_SAFE_INTEGER))) throw new TypeError('Invalid salary allocation rule at row ' + i + '.');
        writeI64(input, i * 2, rule.valueScaled);
        input[i * 4 + 2] = rule.mode === 'percent' ? 1 : 0;
        input[i * 4 + 3] = 0;
      });
      const summaryPtr = outputPtr + count * 16;
      const status = wasm.pw_salary_allocate(BigInt(baseMinor), BigInt(perCycleBaseMinor), payCycles, perCyclePercentDenominator, inputPtr, count, outputPtr, summaryPtr);
      readStatus(status, 'salary allocation');
      const output = new Uint32Array(buffer, outputPtr, Math.max(1, count * 4));
      const summary = new Uint32Array(buffer, summaryPtr, 6);
      return {
        rows: Array.from({ length: count }, (_, i) => ({ periodMinor: readI64(output, i * 2), perCycleMinor: readI64(output, i * 2 + 1) })),
        allocatedMinor: readI64(summary, 0),
        fixedMinor: readI64(summary, 1),
        percentageScaled: readI64(summary, 2)
      };
    } catch (error) { throw failure('WebAssembly salary-allocation calculation failed: ' + error.message, error); }
  }

  function categoryBuckets(rows, groupCount, bucketCount) {
    try {
      if (!Array.isArray(rows) || rows.length > 1000000 || !Number.isInteger(groupCount) || groupCount < 1 || groupCount > 5000 || !Number.isInteger(bucketCount) || bucketCount < 1 || bucketCount > 12) {
        throw new TypeError('Category comparison input is invalid or too large.');
      }
      const count = rows.length;
      const outputCount = groupCount * bucketCount * 2;
      const { wasm, inputPtr, outputPtr, buffer } = ensureScratch(count * 24, outputCount * 8);
      const input = new Uint32Array(buffer, inputPtr, Math.max(1, count * 6));
      rows.forEach((row, i) => {
        if (!row || !Number.isSafeInteger(row.amountMinor) || !Number.isInteger(row.groupIndex) || !Number.isInteger(row.bucketIndex) || !Number.isInteger(row.periodIndex) || ![1, -1].includes(row.sign)) {
          throw new TypeError('Invalid category comparison transaction at row ' + i + '.');
        }
        writeI64(input, i * 3, row.amountMinor);
        input[i * 6 + 2] = row.groupIndex >>> 0;
        input[i * 6 + 3] = row.bucketIndex >>> 0;
        input[i * 6 + 4] = row.periodIndex >>> 0;
        input[i * 6 + 5] = row.sign >>> 0;
      });
      const status = wasm.pw_category_buckets(inputPtr, count, groupCount, bucketCount, outputPtr);
      readStatus(status, 'category comparison');
      const output = new Uint32Array(buffer, outputPtr, outputCount * 2);
      return Array.from({ length: outputCount }, (_, i) => readI64(output, i));
    } catch (error) { throw failure('WebAssembly category-comparison calculation failed: ' + error.message, error); }
  }

  function cashProjection(openingMinor, deltas) {
    try {
      if (!Array.isArray(deltas) || deltas.length > 1000000) throw new TypeError('Cash projection input is invalid or too large.');
      const count = deltas.length;
      const { wasm, inputPtr, outputPtr, buffer } = ensureScratch(count * 8, 40);
      const input = new Uint32Array(buffer, inputPtr, Math.max(1, count * 2));
      deltas.forEach((value, i) => writeI64(input, i, value));
      const status = wasm.pw_cash_projection(BigInt(openingMinor), inputPtr, count, outputPtr);
      readStatus(status, 'cash projection');
      const output = new Uint32Array(buffer, outputPtr, 10);
      return { endingMinor: readI64(output, 0), minimumMinor: readI64(output, 1), shortageMinor: readI64(output, 2), shortageIndex: readI64(output, 3), minimumIndex: readI64(output, 4) };
    } catch (error) { throw failure('WebAssembly cash projection failed: ' + error.message, error); }
  }

  function ratioRound(amountMinor, numerator, denominator) {
    try {
      if (!Number.isSafeInteger(amountMinor) || !Number.isInteger(numerator) || !Number.isInteger(denominator)) throw new TypeError('Rounded ratio input is invalid.');
      const { wasm, outputPtr, buffer } = ensureScratch(1, 8);
      const status = wasm.pw_ratio_round_minor(BigInt(amountMinor), numerator, denominator, outputPtr);
      readStatus(status, 'rounded monetary ratio');
      return readI64(new Uint32Array(buffer, outputPtr, 2), 0);
    } catch (error) { throw failure('WebAssembly monetary projection failed: ' + error.message, error); }
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
    equalSplit, percentageSplit, amountSplit, sum, cashDelta, accountBalance, debtRemaining,
    salaryAllocate, categoryBuckets, cashProjection, ratioRound,
    typeCodes: TYPE_CODES
  });
});
