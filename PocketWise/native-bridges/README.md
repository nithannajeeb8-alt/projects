# PocketWise native OCR bridge interfaces

PocketWise remains a local-first PWA. The new adaptive router probes for a native OCR provider when running inside a native shell; a normal browser-installed PWA does not acquire native Vision/ML Kit access merely because these source files exist.

## Provider contract

The JavaScript OCR adapter accepts `window.Capacitor.Plugins.PocketWiseNativeOCR` or `window.PocketWiseNativeOCR` with:

- `isAvailable()` returning `true` or `{ available: true }`.
- `recognize({ imageDataUrl, mimeType, width, height, languageHints, purpose, requestId })` returning `{ engine, model, text, items }`.
- Each item has `text`, `confidence` (0..1), and `boundingBox: { x, y, width, height }` in top-left image pixels.

The PWA's existing `flattenNativeItems()` normalizes native output and submits it to the same amount/rupee/merchant/quality checks used by PaddleOCR. The route result is reviewed before save; OCR never silently creates a financial transaction.

## Platform implementations

- iOS: `ios/PocketWiseNativeOCRPlugin.swift` uses Apple Vision `VNRecognizeTextRequest` with accurate recognition, supported-language selection, and text correction disabled to avoid rewriting merchant strings, IDs or references.
- Android: `android/PocketWiseNativeOCRPlugin.kt` uses bundled Google ML Kit Latin and optional Devanagari models. Bundling makes first-use recognition offline-ready at the cost of app size.

## Reliability privacy model

Provider-health records are keyed by a coarse browser/platform/capability profile and capability name. Stored fields are provider ID, success/failure counts, outcome, latency, circuit state and cooldown. The subsystem does not store images, OCR text, extracted amounts, bank narration, transaction contents, IP addresses or exact device models. Records age out after 90 days. The router uses C++/Wasm to rank routes and update circuit-breaker health; JavaScript performs capability probing, native calls, worker lifecycle, IndexedDB and fallback execution.
