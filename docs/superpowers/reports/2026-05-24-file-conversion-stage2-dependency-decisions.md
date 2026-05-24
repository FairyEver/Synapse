# File Conversion Stage 2 Dependency Decisions

Date: 2026-05-24

## Verification Commands

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__ electron/services/knowledge-base/__tests__/source-staging-fixtures.test.ts` | Pass | 5 test files and 29 tests passed. |
| `pnpm --filter @synapse/desktop run typecheck` | Pass | Ran `generate:definitions-registry`, renderer TypeScript, Electron TypeScript, and test TypeScript checks. |
| `pnpm --filter @synapse/desktop run check:hard-constraints` | Pass | `All hard-constraint checks passed.` |
| `pnpm --filter @synapse/desktop run build:electron` | Pass after narrow fix | Initial run failed because file-conversion code declared top-level `require` bindings in TS modules. Renamed those local CommonJS interop bindings; rerun exited 0. |
| `pnpm --filter @synapse/desktop run build:renderer` | Pass with existing warnings | Vite build exited 0. It reported chunk-size warnings for existing large bundles. |
| `pnpm --filter @synapse/desktop exec electron-builder --dir --mac --arm64 --publish never` | Pass with packaging warnings | Directory build produced `desktop/release/mac-arm64/Synapse.app` and skipped notarization because notarize options were not generated. Electron-builder warned that optional platform packages for `@napi-rs/canvas` and `@anthropic-ai/claude-agent-sdk` were missing `package.json` files in pnpm paths. |
| `pnpm --filter @synapse/desktop why pdf-parse` | Pass | `@synapse/desktop` depends directly on `pdf-parse 2.4.5`. |
| `pnpm --filter @synapse/desktop why officeparser` | Pass | `@synapse/desktop` depends directly on `officeparser 7.0.3`. |
| `pnpm --filter @synapse/desktop why @napi-rs/canvas` | Pass | `officeparser 7.0.3 -> pdfjs-dist 5.6.205 -> @napi-rs/canvas 0.1.100`; `pdf-parse 2.4.5 -> @napi-rs/canvas 0.1.80` and `pdf-parse 2.4.5 -> pdfjs-dist 5.4.296 -> @napi-rs/canvas 0.1.80`. |
| `find node_modules desktop/node_modules -path '*@napi-rs*' -o -path '*pdfjs-dist*' \| head -200` | Pass | Found root pnpm entries for `@napi-rs/canvas 0.1.80`, `pdfjs-dist 5.4.296`, and `officeparser`'s `pdfjs-dist` dependency. |
| `find node_modules desktop/node_modules -name '*.node' -o -name '*.dylib' -o -name '*.so' -o -name '*.dll' \| rg '(@napi-rs\|canvas\|pdfjs\|pdf-parse\|officeparser)'` | Pass | Found native `skia.darwin-arm64.node` files for `@napi-rs/canvas-darwin-arm64` versions `0.1.80` and `0.1.100` under `node_modules`. |
| `find desktop/release/mac-arm64 -path '*@napi-rs*' -o -path '*pdfjs-dist*' \| head -200` | Pass | Packaged output includes `app.asar.unpacked/node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node` and an `officeparser` nested copy of the same Darwin arm64 native package. |
| `find desktop/release/mac-arm64 -name '*.node' -o -name '*.dylib' -o -name '*.so' -o -name '*.dll' \| rg '(@napi-rs\|canvas\|pdfjs\|pdf-parse\|officeparser)'` | Pass | Packaged output includes two `skia.darwin-arm64.node` files: one for `pdf-parse`'s graph and one nested under `officeparser`. |
| `rg -n "fetch\\(\|https?:\|http\\.\|https\\.\|axios\|request\\(" desktop/electron/services/file-conversion desktop/electron/services/knowledge-base` | Pass | No matches found in the conversion service or Knowledge Base staging service. |

## Dependency Decisions

| Format | Dependency | Decision | Reason |
| --- | --- | --- | --- |
| DOCX | `mammoth` | Keep | Real DOCX fixture tests pass and preserve useful heading/table text through HTML-to-Markdown normalization. Build and package checks pass after the narrow TypeScript interop fix. |
| XLSX | `xlsx` | Keep | Real XLSX fixture tests pass with multi-sheet Markdown tables and truncation warning coverage. Build and package checks pass. |
| PDF | `pdf-parse` | Keep with monitoring | Real text PDF fixture tests pass, parser errors and empty-text scanned PDFs are classified, and the macOS arm64 directory package includes the required `@napi-rs/canvas-darwin-arm64` native file under `app.asar.unpacked`. Keep monitoring because `pdf-parse 2.4.5` pulls `@napi-rs/canvas 0.1.80` directly and through `pdfjs-dist 5.4.296`. |
| PPTX | `officeparser` | Keep with limitation and packaging monitoring | Real PPTX fixture tests extract useful title/body text. Slide boundaries remain limited and are represented by `presentation_structure_limited`. `officeparser 7.0.3` pulls `pdfjs-dist 5.6.205 -> @napi-rs/canvas 0.1.100`; this native dependency remains a packaging risk to keep monitoring. |
| Native canvas | `@napi-rs/canvas` | Keep under observation | The local macOS arm64 dir package completed and included Darwin arm64 `.node` files in `app.asar.unpacked`, but electron-builder emitted optional-platform package warnings for `@napi-rs/canvas` packages. Windows/Linux packaging still need release-lane verification. |

## Notes

- All file conversion is local-only. The Stage 2 implementation does not use online parsing APIs, OCR services, vision APIs, or remote conversion APIs.
- Dependency inspection confirms `officeparser` pulls `pdfjs-dist -> @napi-rs/canvas`; this remains a packaging risk to keep monitoring even though the local macOS arm64 directory build completed.
- Task 7 manifest disposition: Knowledge Base upload staging records conversion metadata in generated Markdown frontmatter and upload results today. `.raw/.manifest.json` does not currently store per-upload conversion-original metadata.
- The packaging command used was exactly `pnpm --filter @synapse/desktop exec electron-builder --dir --mac --arm64 --publish never`; no alternate package script was needed.
