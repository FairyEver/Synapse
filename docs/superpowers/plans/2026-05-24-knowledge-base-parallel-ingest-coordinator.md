# Knowledge Base Parallel Ingest Coordinator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-scoped Knowledge Base ingest worker agents and batch-safe manifest finalization so parallel source processing does not corrupt shared wiki or manifest state.

**Architecture:** The main Knowledge Base conversation stays the coordinator. Synapse injects a programmatic Claude SDK subagent only for local-renderer Knowledge Base sessions, and the worker is restricted to source-owned `wiki/sources/` pages. Manifest finalization gains a batch API under the existing project lock.

**Tech Stack:** Electron main process, TypeScript, Claude Agent SDK, Vitest.

---

### Task 1: Add SDK Agent Contribution Plumbing

**Files:**
- Modify: `desktop/electron/services/agent-runtime/project-contributions.ts`
- Modify: `desktop/electron/services/agent-runtime/session-manager.ts`
- Modify: `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts`

- [x] Add `AgentSdkAgentDefinition` and `sdkAgents()` to project contributions.
- [x] Forward merged agents from `SessionManager` into `CreateAgentLiveSessionInput`.
- [x] Pass `agents` into Claude Agent SDK query options.
- [x] Verify tests fail before implementation and pass after implementation.

### Task 2: Add Internal Knowledge Base Ingest Worker Agent

**Files:**
- Create: `desktop/electron/services/knowledge-base/ingest-worker-agent.ts`
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

- [x] Define `synapse-kb-ingest-worker` as a programmatic SDK agent.
- [x] Restrict it to local-renderer Knowledge Base sessions.
- [x] Assert scheduled/automation style turns receive no worker agent.

### Task 3: Tighten Coordinator and Skill Instructions

**Files:**
- Modify: `desktop/resources/knowledge-base/prompts/ingest.md`
- Modify: `desktop/resources/knowledge-base/claude-plugin/skills/wiki-ingest/SKILL.md`
- Modify: `desktop/electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

- [x] Add coordinator ownership rules for parallel source-summary workers.
- [x] Forbid worker edits to shared maintenance pages and manifest/address state.
- [x] Keep the final report contract as exactly one main-thread `synapse_kb_ingest_report`.

### Task 4: Add Batch-Safe Manifest Finalization

**Files:**
- Modify: `desktop/electron/services/knowledge-base/manifest-finalizer.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts`

- [x] Add `finalizeBatch()` under the existing project manifest lock.
- [x] Refactor `finalize()` to call `finalizeBatch()` with one item.
- [x] Reject duplicate source entries after the first accepted entry.
- [x] Warn when multiple sources claim the same non-maintenance wiki page in one batch.
- [x] Preserve current single-turn finalizer behavior.

### Task 5: Export and Verify

**Files:**
- Modify: `desktop/electron/services/knowledge-base/index.ts`

- [x] Export the new worker agent helper and batch finalizer types.
- [x] Run focused Knowledge Base and agent-runtime tests.
- [x] Run hard-constraints if the focused tests pass.
