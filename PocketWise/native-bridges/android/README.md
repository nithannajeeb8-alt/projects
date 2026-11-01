# Android ML Kit bridge

Add `PocketWiseNativeOCRPlugin.kt` to the Capacitor Android app source set and register the plugin through Capacitor's normal plugin discovery/registration. Add the dependencies from `DEPENDENCIES.gradle.txt` and use `minSdkVersion 23` or later.

The dependencies use bundled on-device models for Latin and Devanagari, so recognition does not need a first-run model download. The Hindi/Devanagari recognizer is invoked only when `hi` appears in the bridge language hints. The bridge returns structured line geometry and confidence to the same OCR quality gate used by PaddleOCR.
