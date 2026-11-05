# PocketWise 2.4.62 — Regression Comparison

## Compared releases

- **2.4.59**: latest Smart UI Indicator Fix before the forecasting feature was introduced.
- **2.4.61**: immediate pre-change baseline and Forecast Teacher release.
- **2.4.62**: this release.

## UI comparison: 2.4.61 vs 2.4.62

The following user-facing shell files are byte-identical between 2.4.61 and 2.4.62:

| File | SHA-256 | Result |
|---|---|---|
| `index.html` | `632c03d19d3cb7e0434ba6f81582993f9325b72b8939c32c5b8adb93d85da3fc` | Identical |
| `styles.css` | `fd7d0c960a5fb209682345c6e2d4713e4f8f6465443c0fc027f185982c9d9705` | Identical |
| `splash-animation.js` | `26bc25912ed69b822d6b33039d75a5b179c070edcc4f3c660f050236e5f8efe9` | Identical |
| `theme-init.js` | `e9f07ecffeb0667c56cfa7bdb1e9bf39341224a1c534adae1de01ae549ac8894` | Identical |
| `manifest.webmanifest` | `cf3f830064a381bb5a3c308f033a231bcea15d53f247b92b414621b583b888c3` | Identical |
| `pwa.js` | `c6a1cce937b31486b9af479ee6f3968d1a99b3d2d203ab85dde560e64a0b3893` | Identical |
| `viewport-guard.js` | `dc04f5c0d122bf2f367f590e2c610d1c85f8103a6834f9c7ea0e1090cd8663b0` | Identical |

The existing forecast cards/learning panel, Insights renderer, settings renderer, `renderAll`, event binding function, and `addTransaction` function slices in `app.js` are byte-identical to 2.4.61. The app file itself changes only in forecast state migration, teacher lifecycle, forecast inputs/cache signature, and forecast learning import/export integration.

These existing modules are byte-identical to 2.4.61:

- `finance-analytics.js`
- `system-orchestrator.js`
- `reliability-store.js`
- `onboarding.js`
- `statement-parser.js`
- `receipt-ocr-parser.js`
- `paddleocr-pwa.js`

`sw.js` changes its app-shell cache name to `pocketwise-shell-v2.4.62-forecast-learning` and ensures forecast runtime files are precached. It does not otherwise alter navigation or finance behaviour.

## What is different from 2.4.59

The Spending Outlook interface was already introduced between 2.4.59 and 2.4.61 as part of the forecasting foundation/teacher work. Compared with 2.4.59, 2.4.61 added a dedicated Spending Outlook card in Insights, forecast range cards, the why panel, recurring-pattern inbox, measured-performance panel, and learning-data export/import/delete controls, plus corresponding `pw-forecast-*` styles and forecast script loading. **2.4.62 does not change that UI further**; it preserves the 2.4.61 UI byte-for-byte.

The splash animation, theme initializer, manifest, PWA bootstrap, and viewport guard remained byte-identical from 2.4.59 through 2.4.62.

## Functional changes in 2.4.62

Changed runtime files are limited to:

- `app.js`: schema v3 and forecast-teacher/forecast-state integration, with the original transaction pathways and render functions retained.
- `forecasting-core.js`: stream feedback, live expert statistics, equal-weight/learned tilt combination, circuit breaker, CUSUM regime detection, and opt-in adaptive lookback.
- `forecasting-teacher.js`: stream outcome grading, regime events, learned weight state, breaker lifecycle, and schema migration/validation.
- `sw.js`: cache version and forecast runtime precache.
- evaluation harness and new tests.

No new application dependency or remote model is added. The transaction/account data schema is unchanged.

## Forecast regression comparison

The same eight deterministic personas, seed `24874`, 240-day histories, origins, and forecast settings were run against 2.4.61 and 2.4.62 with adaptive regime lookback disabled (the default). All pooled values and per-persona outputs were identical:

| Window | 2.4.61 WIS gain vs seasonal-naive | 2.4.62 WIS gain | Exact match |
|---|---:|---:|---|
| 1 day | 62.3% | 62.3% | Yes |
| 7 days | 54.7% | 54.7% | Yes |
| 28 days | 25.3% | 25.3% | Yes |

Coverage also matched exactly: 93.8% for one day, 85.0% for seven days, and 72.5% for 28 days in this synthetic sample. This is a regression equivalence result, not a real-user accuracy claim.

## Regression suite

- 2.4.61 baseline: 26/26 tests passed.
- 2.4.62 complete suite: 50/50 tests passed.
- JavaScript syntax: every file passed `node --check`.
- UI/functionality hash assertions: 7/7 passed.

## Limits

Automated tests and static comparisons cannot prove correct rendering on every browser or physical device. The attempted headless browser smoke did not complete reliably here. Physical iPhone/iPad and Android testing remains outstanding.
