# Screenshot Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified screenshot capability for system App UI, Agent composer, MCP tools, and Workflow nodes.

**Architecture:** Create `desktop/app-capabilities/screenshot/` following the existing document-template capability package. Keep capture as the source ability that returns a PNG artifact; clipboard and file output are separate adapters over that artifact. MCP and Workflow use the same main-process service and schemas as the UI bridge.

**Tech Stack:** Electron 41, React 19, TypeScript 6, zod, shadcn/ui, Tailwind tokens, `node-screenshots` for native screen capture.

---

### File Structure

- Create `desktop/app-capabilities/screenshot/shared/capability.ts` for app id, capability ids, MCP tool names, workflow node type.
- Create `desktop/app-capabilities/screenshot/shared/schema.ts` for capture, save, clipboard, and result schemas.
- Create `desktop/app-capabilities/screenshot/main/service.ts` for capture core, native provider loading, artifact metadata, save, and clipboard output.
- Create `desktop/app-capabilities/screenshot/main/dispatcher.ts` for MCP/action-router dispatch and permission checks.
- Create `desktop/app-capabilities/screenshot/main/ipc.ts` for renderer calls.
- Create `desktop/app-capabilities/screenshot/renderer/index.tsx`, `app-definition.ts`, `app-manifest.ts` for the test App UI.
- Create `desktop/app-capabilities/screenshot/renderer/overlay.tsx` for interactive region selection.
- Create `desktop/app-capabilities/screenshot/workflow-node/*` for workflow integration.
- Modify app registry, IPC registry/codegen source, preload bridge/types, MCP app-domain, workflow registries, Agent composer, renderer bootstrap, packaging config, release notes.

### Tasks

- [ ] Write failing service tests for injected capture provider: fullscreen, region crop, save, and clipboard adapters.
- [ ] Implement `shared/schema.ts` and `main/service.ts` with provider injection and PNG artifact metadata.
- [ ] Write failing dispatcher and IPC tests for capture/save/copy contracts.
- [ ] Implement `main/dispatcher.ts` and `main/ipc.ts`.
- [ ] Register MCP app tools and add an app dispatcher aggregator so document-template and screenshot coexist.
- [ ] Add screenshot system App registration and minimal renderer UI.
- [ ] Add overlay renderer and Electron overlay window support for interactive region selection.
- [ ] Add Agent composer screenshot button that creates an existing image attachment.
- [ ] Add Workflow node schema, executor, panel, card, and registrations.
- [ ] Add `node-screenshots` dependency and package/asar checks for native optional packages.
- [ ] Regenerate IPC channels, update release notes, and run focused tests plus typecheck where practical.

### Verification

- Run focused Vitest suites for screenshot service, dispatcher, IPC, renderer App, Agent composer, and workflow executor.
- Run `pnpm --filter @synapse/desktop run generate:ipc`.
- Run `pnpm --filter @synapse/desktop run typecheck`.
- If packaging config changes, run or document `pnpm --filter @synapse/desktop run check:packaged-asar` after a packaged build is available.
