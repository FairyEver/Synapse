# Knowledge Base Completion Package Check

Date: 2026-05-24

## Summary

The focused Knowledge Base completion work passed local type, hard-constraint, renderer build, Electron build, and macOS arm64 directory packaging checks.

The exact macOS packaging command from the plan reached `codesign` and then stalled on the local signing chain. I stopped that run and reran the same directory package with `CSC_IDENTITY_AUTO_DISCOVERY=false`; the unsigned/ad-hoc macOS arm64 directory package completed and produced `desktop/release/mac-arm64/Synapse.app`.

## Command Results

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm --filter @synapse/desktop run typecheck` | Pass | Ran definition registry generation plus renderer, Electron, and test TypeScript projects. |
| `pnpm --filter @synapse/desktop run check:hard-constraints` | Pass | `All hard-constraint checks passed.` |
| `pnpm --filter @synapse/desktop run build:electron` | Pass | Generated IPC channels and compiled Electron TypeScript. |
| `pnpm --filter @synapse/desktop run build:renderer` | Pass with existing warning | Vite exited 0 and reported existing chunk-size warnings. |
| `pnpm --filter @synapse/desktop exec electron-builder --dir --mac --arm64 --publish never` | Stalled at signing | Packaging reached `codesign` for `Synapse.app`, then produced no output for several minutes. The process was stopped. |
| `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @synapse/desktop exec electron-builder --dir --mac --arm64 --publish never` | Pass with packaging warnings | Produced `desktop/release/mac-arm64/Synapse.app`; used ad-hoc macOS signature and skipped notarization. |
| `pnpm --filter @synapse/desktop why pdf-parse` | Pass | Direct dependency: `pdf-parse 2.4.5`. |
| `pnpm --filter @synapse/desktop why officeparser` | Pass | Direct dependency: `officeparser 7.0.3`. |
| `pnpm --filter @synapse/desktop why @napi-rs/canvas` | Pass | `officeparser -> pdfjs-dist -> @napi-rs/canvas 0.1.100`; `pdf-parse -> @napi-rs/canvas 0.1.80` and `pdfjs-dist -> @napi-rs/canvas 0.1.80`. |
| `pnpm --filter @synapse/desktop why tesseract.js` | Pass | Transitive dependency through `officeparser 7.0.3`. Synapse OCR runtime does not use it directly. |
| `find node_modules desktop/node_modules -name '*.node' ...` | Pass | Found local Darwin arm64 `@napi-rs/canvas` native files for versions `0.1.80` and `0.1.100`. |
| `find desktop/release/mac-arm64 -name '*.node' ...` | Pass | Packaged output includes two Darwin arm64 `skia.darwin-arm64.node` files under `app.asar.unpacked`. |
| `find node_modules desktop/node_modules | rg '(traineddata\|worker\|tesseract\|ocr)'` | Informational | Found `pdf.worker` assets and `officeparser -> tesseract.js -> tesseract.js-core` files in local dependencies. |
| `find desktop/release/mac-arm64 | rg '(tesseract\|traineddata\|ocrUtils\|pdf\\.worker\|wasm)'` | Pass | No matching packaged paths were found in the directory package scan. |
| `pnpm approve-builds` implications | No change required | This completion pass did not add a real OCR runtime dependency or require new build-script approvals. Future OCR adapters must update this report if they introduce native build scripts, WASM workers, or trained-data assets. |

## Dependency Graph

| Dependency | Source | Packaging Status |
| --- | --- | --- |
| `pdf-parse 2.4.5` | Direct dependency of `@synapse/desktop` | Present in dependency graph; macOS directory package completed. |
| `officeparser 7.0.3` | Direct dependency of `@synapse/desktop` | Present in dependency graph; macOS directory package completed. |
| `@napi-rs/canvas 0.1.80` | `pdf-parse` and its `pdfjs-dist` dependency | Darwin arm64 native file present under `app.asar.unpacked`. |
| `@napi-rs/canvas 0.1.100` | `officeparser -> pdfjs-dist` | Darwin arm64 native file present under nested `officeparser/node_modules` in `app.asar.unpacked`. |
| `tesseract.js 7.0.0` / `tesseract.js-core 7.0.0` | Transitive through `officeparser` | Present in local dependency graph. Not used by Synapse's default OCR adapter, and not found by the macOS directory package path scan. |

## Native Asset Summary

Local dependency scan found:

- `node_modules/.pnpm/@napi-rs+canvas-darwin-arm64@0.1.80/.../skia.darwin-arm64.node`
- `node_modules/.pnpm/@napi-rs+canvas-darwin-arm64@0.1.100/.../skia.darwin-arm64.node`

Packaged macOS arm64 output includes:

- `desktop/release/mac-arm64/Synapse.app/Contents/Resources/app.asar.unpacked/node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node`
- `desktop/release/mac-arm64/Synapse.app/Contents/Resources/app.asar.unpacked/node_modules/officeparser/node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node`

Electron-builder still reports missing `package.json` warnings for optional platform packages in the pnpm store, including non-Darwin `@napi-rs/canvas-*` and `@anthropic-ai/claude-agent-sdk-*` packages. The current macOS arm64 directory package completes despite those warnings.

## Platform Status

| Platform | Status | Notes |
| --- | --- | --- |
| macOS arm64 | Pass locally with ad-hoc signing | Exact signed command stalled at local `codesign`; unsigned directory package completed. Release signing/notarization should still be verified in the release lane. |
| Windows | Not verified locally | Requires Windows runner or CI-equivalent packaging lane. Native `@napi-rs/canvas` optional package warnings remain a release risk to watch. |
| Linux | Not verified locally | Requires Linux runner or CI-equivalent packaging lane. Native `@napi-rs/canvas` optional package warnings remain a release risk to watch. |

## Remaining Release Risks

- Release signing/notarization was not proven locally because the signed directory package stalled at `codesign`.
- Windows and Linux package lanes were not executed on this macOS host.
- `@napi-rs/canvas` appears twice through different dependency versions, and optional-platform package warnings remain.
- `officeparser` brings `tesseract.js` transitively, even though Synapse's implemented OCR abstraction defaults to a local unavailable adapter and does not call online OCR.
