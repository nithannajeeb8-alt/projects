# PocketWise 2.4.62 — Stream Learning and Regime Guard

## Summary

This release extends the local forecasting engine with per-stream outcome learning, a guarded learned ensemble, and regime-shift detection. It is based on PocketWise 2.4.61 Forecast Teacher.

## Added

- Per-recurring-stream live and reconstructed outcome records: hit/miss counts, amount error, timing error, and miss streak.
- Confirmed recurring streams can lose their confidence floor after consecutive missed events. A first miss lowers the event probability; a second consecutive miss can demote the stream to dormant.
- Per-expert weighted interval score (WIS) history and a conservative learned ensemble tilt. The tilt is shrunk toward equal weighting, waits for sufficient live observations, caps each expert's weight, and is protected by a circuit breaker.
- The circuit breaker compares the learned tilt with the equal-weight challenger using paired live grades. It disables tilt when the challenger is consistently better and only recovers after sustained evidence that tilt has improved.
- CUSUM-style change detection over completed weekly residual totals. Regime events are stored locally and can increase ACI learning rate for a limited period.
- Optional adaptive lookback after regime changes is explicitly disabled by default. It did not show a statistically reliable majority-persona gain in the synthetic ablation.
- Teacher-state schema v3 with bounded import normalization and backward-compatible import of learning export versions 1 and 2.
- New automated tests for stream feedback, circuit-breaker trip/recovery, regime leakage, model weight caps, and UI regression.

## Preserved

- No transaction schema migration and no change to existing account, transaction, OCR, finance analytics, onboarding, or reliability modules.
- No new third-party dependency and no remotely downloaded forecasting model.
- No change to visual markup, styles, splash animation, theme initializer, navigation, or the existing forecast/Insights renderers compared with 2.4.61.
- Existing forecasting exports v1/v2 remain importable. New exports use version 3.

## Evaluation

- 50/50 automated tests pass; predecessor 2.4.61 suite also passes 26/26.
- 2.4.62 default forecasts reproduce the 2.4.61 synthetic eight-persona results exactly when optional regime adaptation is disabled.
- Eight-persona evaluation and limitations are documented in `FORECASTING-EVALUATION-2.4.62.md`.

All forecast accuracy figures in the evaluation are synthetic engineering benchmarks, not real-user performance claims.
