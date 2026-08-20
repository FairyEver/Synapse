# Drive Public Documents Design

Date: 2026-07-21
Scope: `shared/`, `server/`, `desktop/`, `dashboard/`, Drive MCP and system Skill documentation

## Goal

Extend Drive `公开素材` from image-only assets to a strict image-and-document allowlist while preserving stable `/files/<assetId>` URLs, Drive ownership, quota, audit, lifecycle, and storage behavior.

## Confirmed Decisions

- Supported images remain JPG, JPEG, PNG, WebP, GIF, AVIF, and ICO.
- Supported documents are PDF, DOCX, XLSX, PPTX, TXT, MD, and CSV.
- SVG, HTML, XML, JavaScript, CSS, archives, executables, legacy Office formats, and macro-enabled Office formats remain unsupported.
- Images use inline public responses. Documents always use attachment responses with `nosniff`, restrictive CSP, and `no-referrer` headers.
- Public responses use `Cross-Origin-Resource-Policy: cross-origin` so public images can be embedded by documents served from other origins.
- Public URLs remain anonymous, stable, and non-expiring. Password-protected or expiring documents use normal Drive shares instead.
- Upload, replace, and rename require a supported MIME type compatible with the filename extension. Upload completion validates image signatures, PDF headers, Office Open XML ZIP container signatures, or UTF-8 text prefixes.
- Replacement preserves the public URL and must stay within the current content category: image to image or document to document.
- Public TXT, MD, and CSV links may be read through Drive link intake with the existing byte limit. PDF and Office links are download-only.
- Markdown image insertion remains image-only even though the underlying public asset library also supports documents.
- No database migration, object-storage domain change, new dependency, malware scanner, Range support, or OOXML package parser is added.

## Security Boundary

Attachment delivery and content-type allowlisting reduce browser execution risk but do not prove that downloaded documents are harmless. Existing quota, upload throttling, audit, access logging, trash, and admin inspection continue to apply. Users must not place confidential documents in `公开素材`.
