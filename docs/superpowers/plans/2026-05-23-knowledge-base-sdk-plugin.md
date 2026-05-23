# Knowledge Base SDK Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load Synapse-owned knowledge-base Claude Code skills through the Claude Agent SDK for knowledge-base conversations, without writing runnable skill/plugin files into the user vault.

**Architecture:** Add a project contribution field for SDK plugins, let knowledge-base projects contribute a local plugin path from Synapse resources, and pass that path into `ClaudeSDKSession` as `plugins`. The user vault remains data-only: `.raw/.manifest.json`, `wiki/*`, `_attachments`, and optional Obsidian data.

**Tech Stack:** Electron main process, TypeScript, Claude Agent SDK, Vitest, Synapse knowledge-base resources.

---

### Task 1: Pass project SDK plugins into ClaudeSDKSession

**Files:**
- Modify: `desktop/electron/services/agent-runtime/project-contributions.ts`
- Modify: `desktop/electron/services/agent-runtime/session-manager.ts`
- Modify: `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts`

- [x] **Step 1: Write failing SDK option test**

Add a test to `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`:

```ts
it("passes local SDK plugins to Claude Agent SDK", () => {
  const { factory, getOptions } = createQueryFactory()
  createSession(factory, {
    plugins: [{ type: "local", path: "/Applications/Synapse/resources/knowledge-base/claude-plugin" }],
  })

  expect(getOptions()).toMatchObject({
    plugins: [{ type: "local", path: "/Applications/Synapse/resources/knowledge-base/claude-plugin" }],
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts --testNamePattern "passes local SDK plugins"
```

Expected: FAIL because `ClaudeSDKSessionOptions` does not accept or pass `plugins`.

- [x] **Step 3: Implement SDK plugin option**

In `desktop/electron/services/agent-runtime/project-contributions.ts`, define:

```ts
export type AgentSdkPluginSpec = {
  readonly type: "local"
  readonly path: string
}
```

Add `sdkPlugins?: readonly AgentSdkPluginSpec[]` to `AgentProjectContribution`, and merge with:

```ts
sdkPlugins: contributions.flatMap((contribution) => contribution.sdkPlugins ?? []),
```

In `desktop/electron/services/agent-runtime/claude-sdk-session.ts`, add:

```ts
import type { AgentSdkPluginSpec } from "./project-contributions"
```

Add to `ClaudeSDKSessionOptions`:

```ts
readonly plugins?: readonly AgentSdkPluginSpec[]
```

Then in `buildQueryOptions`, after constructing `queryOptions`:

```ts
if (options.plugins?.length) {
  queryOptions.plugins = [...options.plugins]
}
```

In `desktop/electron/services/agent-runtime/session-manager.ts`, add to `CreateAgentLiveSessionInput`:

```ts
readonly plugins?: readonly AgentSdkPluginSpec[]
```

Import the type, pass `input.plugins` into `new ClaudeSDKSession`, and add `plugins?: readonly AgentSdkPluginSpec[]` to `SessionManagerDeps`.

In `getOrCreateSession`, pass `plugins: this.deps.sdkPlugins`.

In `desktop/electron/services/agent-runtime/index.ts`, resolve contribution plugins and pass them into `AgentRuntimeService`/`SessionManager` through the service dependency path already used for `prepareMessage` and commands.

- [x] **Step 4: Run SDK test to verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts --testNamePattern "passes local SDK plugins"
```

Expected: PASS.

### Task 2: Contribute a Synapse-owned knowledge-base plugin

**Files:**
- Create: `desktop/resources/knowledge-base/claude-plugin/.claude-plugin/plugin.json`
- Create: `desktop/resources/knowledge-base/claude-plugin/skills/wiki/SKILL.md`
- Create: `desktop/resources/knowledge-base/claude-plugin/skills/wiki-ingest/SKILL.md`
- Create: `desktop/resources/knowledge-base/claude-plugin/skills/wiki-query/SKILL.md`
- Create: `desktop/resources/knowledge-base/claude-plugin/skills/save/SKILL.md`
- Create: `desktop/resources/knowledge-base/claude-plugin/skills/wiki-lint/SKILL.md`
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

- [x] **Step 1: Write failing contribution tests**

Add tests to `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`:

```ts
it("contributes the Synapse knowledge-base SDK plugin outside the vault", async () => {
  const projectPath = await tempDir()
  const contribution = await createKnowledgeBaseAgentContribution({
    project: knowledgeBaseProject(projectPath),
  })

  expect(contribution?.sdkPlugins).toHaveLength(1)
  expect(contribution?.sdkPlugins?.[0]).toMatchObject({ type: "local" })
  expect(contribution?.sdkPlugins?.[0]?.path).toContain(
    path.join("resources", "knowledge-base", "claude-plugin"),
  )
  expect(contribution?.sdkPlugins?.[0]?.path.startsWith(projectPath)).toBe(false)
})

it("keeps natural-language ingest requests unchanged because plugin skills handle routing", async () => {
  const projectPath = await tempDir()
  const contribution = await createKnowledgeBaseAgentContribution({
    project: knowledgeBaseProject(projectPath),
  })

  const prepared = await Promise.resolve(contribution?.prepareMessage?.(
    baseMessage("汲取知识"),
    { isNewLiveSession: false },
  ))

  expect(prepared?.content).toBe("汲取知识")
  expect(contribution?.sdkPlugins?.[0]?.path.startsWith(projectPath)).toBe(false)
})
```

Update or replace the existing natural-language ingest test name if needed.

- [x] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts --testNamePattern "SDK plugin|plugin skills"
```

Expected: FAIL because `sdkPlugins` is not contributed yet.

- [x] **Step 3: Add internal plugin resources**

Create the plugin under `desktop/resources/knowledge-base/claude-plugin/`.

`plugin.json`:

```json
{
  "name": "synapse-knowledge-base",
  "version": "1.0.0",
  "description": "Synapse knowledge-base maintenance skills for Obsidian-compatible vaults.",
  "author": {
    "name": "Synapse"
  }
}
```

Create skills with concise descriptions. `wiki-ingest` description must include Chinese triggers:

```md
---
name: wiki-ingest
description: "Ingest sources into the Synapse knowledge base. Use when the user says ingest, process this source, add this to the wiki, 汲取知识, 提取知识, 入库, 导入, 处理这些来源, 把这些资料整理进知识库."
---

# wiki-ingest

Use the Synapse knowledge-base ingest protocol in this vault. Read `.raw/.manifest.json`, compare source hashes when facts are available, write generated knowledge under `wiki/`, and update `.raw/.manifest.json` after ingest. Do not modify source files under `.raw/` except `.raw/.manifest.json`.
```

Keep the other skills short and point them at Synapse's existing vault protocol: `wiki`, `wiki-query`, `save`, `wiki-lint`.

- [x] **Step 4: Resolve plugin path in knowledge-base contribution**

In `desktop/electron/services/knowledge-base/agent-contribution.ts`, add a resolver similar to `resolvePromptRoots`, but pointing to `knowledge-base/claude-plugin`.

Return:

```ts
sdkPlugins: [{ type: "local", path: resolveKnowledgeBasePluginPath() }],
```

For packaged apps, prefer `path.join(process.resourcesPath, "knowledge-base", "claude-plugin")`. For dev, use `desktop/resources/knowledge-base/claude-plugin`.

- [x] **Step 5: Run contribution tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: PASS.

### Task 3: Verify user vault boundary and focused runtime behavior

**Files:**
- Test: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`

- [x] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts \
  electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts \
  electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: PASS.

- [x] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [x] **Step 3: Inspect diff**

Run:

```bash
git diff --stat
git diff -- desktop/resources/knowledge-base desktop/electron/services/agent-runtime desktop/electron/services/knowledge-base
```

Expected: Changes are limited to SDK plugin loading, internal knowledge-base plugin resources, and tests. No user vault template contains `.claude`, `.agents`, `.codex`, `commands`, `hooks`, `agents`, or `CLAUDE.md`.

---

## Self-Review

- Covers the required new scheme: internal SDK plugin, no runnable capability files in user vault, natural language ingest through skill descriptions, and manifest/hot/index/log staying in the vault.
- Keeps hooks disabled and does not copy original `claude-obsidian` hooks into the vault.
- Keeps the initial implementation narrow: no DragonScale scripts, no Obsidian plugin setup, no canvas implementation beyond a future skill placeholder.
