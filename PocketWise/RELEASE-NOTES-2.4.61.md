# PocketWise 2.4.61 · Forecast Teacher

## Built

- Added a local live teacher that logs one-day, seven-day and 28-day forecast origins and grades completed windows exactly once.
- Added WIS, pinball-loss, outer/core coverage, point and streak tracking.
- Added per-component grading and EW-WIS diagnostics for hurdle, block-bootstrap, seasonal-naive and equal-weight forecasts.
- Added ACI-style interval adaptation with a backtest-seeded conformity buffer and a 20-live-grade gate before live calibration replaces the backtest range.
- Added chronological catch-up for missed app-open days, with strict origin-date transaction filtering and no use of later user labels or model selections.
- Separated actual live grades from reconstructed catch-up grades. Only true live grades count toward the live skill tier, points and streak.
- Delayed first live teacher forecast until the matching transaction/label rolling-origin backtest completes or fails.
- Bounded teacher history, score buffers and foreground catch-up work.
- Updated forecast cards to distinguish live-calibrated ranges from backtest-calibrated and exploratory ranges.
- Added repeatable eight-persona evaluation and paired ablations.

## Preserved

- Existing PocketWise transaction schema and IndexedDB/localStorage persistence.
- Existing static PWA runtime and no-new-dependency deployment model.
- Worker-first operation with main-thread fallback.
- Existing user-controlled recurrence labels and export/import/delete learning-data controls.

## Not included

Chronos/ONNX, Chronos-2, TTM, ETS, TF.js, category hierarchy, per-stream live hit/miss updates, automatic learned ensemble weights/circuit breaker, safe-to-spend, anomaly cards and monthly forecast PDF reports.
