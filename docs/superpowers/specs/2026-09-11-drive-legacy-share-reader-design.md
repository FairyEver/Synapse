# Drive Legacy Share Reader Design

Date: 2026-09-11
Scope: public Drive share pages, Dashboard bootstrap, server routing

## Goal

Public Drive shares remain readable when the browser cannot run the full Dashboard UI. The known incident environment is Windows 7 with Chrome 91, while the compatibility page itself targets Chrome 49 and IE11-grade HTML and CSS.

## Product Behavior

- Canonical share pages keep the existing interactive Dashboard experience in capable browsers.
- A classic script runs before the Dashboard module and redirects canonical root or child share paths when required CSS or runtime capabilities are missing.
- The compatibility endpoints are public at `/share/:shareId/reader` and `/share/:shareId/items/:itemId/reader`. Modern browsers may open them directly, but the interactive share page does not expose a switch.
- The reader has no application header, sidebar, editor, comments, outline rail, theme controls, or client telemetry.
- Markdown uses the existing sanitized server projection. Text and HTML source are escaped, images use the existing protected download path, folders render a paginated link list, and unsupported files retain a download link.
- Password entry, invalid-password feedback, expired links, and nested folder navigation remain functional without JavaScript.

## Compatibility And Security

- The redirect uses feature detection rather than operating-system or browser-version matching. Reader, download, and render routes are excluded from redirect matching.
- Reader HTML uses only server-rendered semantic markup and conservative CSS. It does not use CSS variables, cascade layers, modern color functions, custom fonts, or JavaScript.
- Share access continues through the existing resolver and HttpOnly access cookie. Password query parameters are removed after successful access.
- Reader responses are private and non-cacheable, cannot be framed, do not send referrers, and use a CSP that permits inline page CSS and safe same-origin or HTTPS images but no scripts.
- Existing Markdown sanitization remains the only boundary allowed to emit source-derived HTML. All other text and attribute values are escaped.

## Verification

- Unit coverage verifies redirect path mapping and capability gates, server-rendered content variants, escaping, folder pagination, password behavior, response headers, and reverse-proxy routing.
- Release acceptance covers automatic fallback on Windows 7 + Chrome 91, direct reader access in IE11, and unchanged interactive sharing in current Chrome, Edge, Safari, and Firefox.
