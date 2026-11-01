# iOS Vision bridge

Add `PocketWiseNativeOCRPlugin.swift` to the Capacitor iOS app target and confirm the target links the Vision framework. The class uses the Capacitor `CAPBridgedPlugin` registration contract. The PWA cannot invoke Apple Vision when opened in Safari or installed directly from Safari; this bridge is available only in the native Capacitor shell or a host that explicitly exposes the same Promise-based interface.

The bridge returns top-left pixel bounding boxes. Vision returns normalized coordinates with a lower-left origin, so the adapter converts them before returning to `paddleocr-pwa.js`.
