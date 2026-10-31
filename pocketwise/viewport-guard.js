/* PocketWise viewport guard. Keep normal one-finger scrolling, but cancel
 * Safari's proprietary multi-touch page-scale gestures. Form controls and
 * contenteditable paste targets are not affected by these gesture listeners. */
(function installPocketWiseViewportGuard(root) {
  'use strict';

  const doc = root.document;
  if (!doc || typeof doc.addEventListener !== 'function') return;

  function preventPageScale(event) {
    if (event && event.cancelable) event.preventDefault();
  }

  // Safari on iOS still dispatches these proprietary events for page pinching.
  // touch-action on html/body is the standards-based guard for other engines.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    doc.addEventListener(type, preventPageScale, { capture: true, passive: false });
  }
})(typeof window !== 'undefined' ? window : globalThis);
