# PocketWise 2.4.60 - Forecasting Foundation

Base: `PocketWise-2.4.59-Smart-UI-Indicator-Fix.zip`

## Added

- Local spending and income outlook cards for tomorrow, the next 7 days, and the next 28 days (subject to history tier gates).
- Explanation panel separating scheduled events, recurring signals, and range uncertainty.
- Recurring-pattern inbox with confirm, reject, restore, mute/unmute, and amount edit controls.
- Forecast learning panel with historical backtest metrics.
- Forecast learning JSON export/import/delete controls.
- Deterministic statistical forecasting core and worker-first execution bridge.
- Service-worker caching for forecasting modules and worker.

## Fixed during verification

- Corrected the weekday sampler to use the next forecast day rather than the origin day.
- Corrected WIS interval pairing so alpha=0.2 uses q0.1/q0.9, alpha=0.4 uses q0.2/q0.8, alpha=0.6 uses q0.3/q0.7, and alpha=0.8 uses q0.4/q0.6.
- Retried queued forecast/backtest requests on the main thread when the Web Worker fails to start.

## Compatibility

- Preserves the existing vanilla JavaScript/static PWA stack.
- Preserves the existing transaction schema and `PocketwiseDB` state store.
- No new runtime package or remote forecasting model is downloaded.
- New service-worker cache name: `pocketwise-shell-v2.4.60-forecasting-foundation`.

## Release gate

This is a foundation release. Do not describe it as the complete forecasting specification. See `FORECASTING-FOUNDATION.md` and `TEST-REPORT-2.4.60.md` for implemented scope, limitations, and synthetic results.
