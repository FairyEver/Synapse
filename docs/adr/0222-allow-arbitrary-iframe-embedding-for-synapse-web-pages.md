# ADR 0222: Allow Arbitrary Iframe Embedding for Synapse Web Pages

## Status

Accepted

## Context

Synapse serves ordinary web applications, public shares, standalone HTML, compatibility readers, Drive Sites, and a desktop update page. Several responses previously set `X-Frame-Options` or CSP `frame-ancestors`, including a nested HTML render inside a public share. This made a Synapse share load correctly when opened directly but appear blank when the same share was itself embedded in a custom application iframe.

The product requirement is that every Synapse web page can be loaded by a page from any origin. The requirement also covers `/admin`, so this decision intentionally removes the browser-level clickjacking boundary rather than limiting the change to public content.

## Decision

- Synapse web responses do not send `X-Frame-Options`.
- Helmet keeps its other security headers and CSP directives but omits `frame-ancestors`.
- Drive reader, HTML render, standalone HTML, and Drive Site CSP strings omit `frame-ancestors`.
- The desktop update page keeps its focused CSP but also permits arbitrary ancestors.
- Authentication, authorization, password and expiry checks, page sandboxing, script restrictions, resource restrictions, and other CSP directives remain unchanged.

## Consequences

Synapse pages can be embedded by arbitrary origins, including nested share pages that contain their own rendered HTML iframe. Clickjacking protection at the frame-ancestor layer is intentionally no longer available; operators must not treat frame embedding as a trusted boundary.
