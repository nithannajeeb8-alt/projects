# Deployment security headers

The `_headers` file is ready for Cloudflare Pages and Netlify. It applies
`nosniff`, a restrictive referrer policy, and a limited Permissions Policy
site-wide. It applies clickjacking protection only to the main app document.

**The OCR sandbox exception is intentional.** `paddleocr-sandbox.html` is
loaded in a hidden, script-only iframe by the main app. Do not apply
`X-Frame-Options: DENY` or `frame-ancestors 'none'` site-wide, or the OCR
iframe will be blocked. The sandbox has its own restrictive meta CSP and the
parent validates `postMessage` source and payload types.

The main app's meta CSP restricts scripts to same-origin plus the pinned runtime
origins, blocks ordinary JavaScript eval, and permits only Wasm compilation via
`'wasm-unsafe-eval'`. The response header adds `frame-ancestors 'none'` for the
main page. Do not widen `script-src` to `'unsafe-inline'` or `'unsafe-eval'` to
fix a deployment error; diagnose the blocked asset instead.

If the site is hosted on GitHub Pages, `_headers` is not applied by GitHub Pages.
Configure equivalent response headers at the reverse proxy/CDN/DNS provider
that actually serves `nithan.in`. Response headers cannot reliably be set from
HTML meta tags (notably `frame-ancestors`, `X-Frame-Options`, and HSTS).

HSTS is intentionally not enabled here because it must be configured only after
all relevant hostnames and subdomains are confirmed to support HTTPS.
