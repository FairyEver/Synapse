# Workflow Token Usage Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workflow Runner `Token` tab that shows a single node-level token/cost ledger with a `合计` footer row.

**Architecture:** Agent Runtime continues to calculate local CNY cost from the effective model plus Synapse model price rules. Workflow receives the resulting model/cost metadata from scheduled Agent sends, persists a run-time usage-cost snapshot on each workflow node result, and the renderer only reads saved snapshots instead of repricing historical runs.

**Tech Stack:** Electron main process, React, TypeScript, shadcn/ui, Tailwind token classes, Vitest.

---

## File Structure

- Create `desktop/electron/services/usage-analysis/usage-cost-snapshot.ts`: shared main-process helper for normalizing token usage and estimating CNY cost snapshots from price rules.
- Create `desktop/electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts`: unit tests for priced, unpriced, missing usage/model, and mixed snake/camel token fields.
- Modify `desktop/electron/services/agent-runtime/conversation-router.ts`: replace local token/cost helper code with the shared helper.
- Modify `desktop/electron/services/agent-runtime/types.ts`: add `modelName?` and `costBreakdownCny?` to scheduled Agent send results.
- Modify `desktop/electron/services/agent-runtime/agent-runtime-service.ts`: return the terminal result model name and local CNY breakdown on scheduled/workflow sends.
- Modify `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`: prove scheduled sends return `modelName` and local CNY breakdown.
- Modify `desktop/workflow-nodes/types.ts`: add `modelName?` and `costBreakdownCny?` to Agent send and node execution results.
- Modify `desktop/workflow-nodes/prompt/executor.main.ts` and `desktop/workflow-nodes/switch/executor.main.ts`: propagate model/cost metadata from Agent runtime result to node execution result.
- Modify `desktop/src/types/workflow.ts`: add `WorkflowNodeUsageCostSnapshot` and `NodeRunResult.usageCost`.
- Modify `desktop/electron/services/workflow/workflow-scheduler.ts`: carry `usageCost` through `NodeExecOutcome`.
- Modify `desktop/electron/services/workflow/workflow-engine.ts`: build `usageCost` from Agent Runtime local cost metadata and include it in events, logs, and stored node results.
- Modify `desktop/electron/bootstrap/descriptors.ts`: propagate model/cost metadata from scheduled Agent sends.
- Modify `desktop/electron/services/__tests__/workflow-engine.test.ts`: prove workflow persists Agent Runtime local cost snapshots, ignores bare SDK cost fields, and preserves unpriced snapshots.
- Modify `desktop/electron/bootstrap/__tests__/descriptors.test.ts`: prove workflow Agent dependency returns model/cost metadata.
- Create `desktop/src/modules/workflow/runner/token-usage-view.tsx`: approved single-table Token tab UI.
- Create `desktop/src/modules/workflow/runner/token-usage-view-model.ts`: pure row building, totals, formatting, and sorting helpers.
- Create `desktop/src/modules/workflow/runner/__tests__/token-usage-view-model.test.ts`: pure helper tests.
- Create `desktop/src/modules/workflow/runner/__tests__/token-usage-view.test.tsx`: component rendering tests.
- Modify `desktop/src/modules/workflow/runner/runner-toolbar.tsx`: add `Token` view button.
- Modify `desktop/src/modules/workflow/runner/runner-app.tsx`: include `token` view mode and render `TokenUsageView`.
- Modify `desktop/src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx`: cover Token tracking.
- Modify `desktop/src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx`: cover Token view switching.
- Modify `RELEASE_NOTES_PENDING.md`: add a user-facing release note.

## Task 1: Shared Synapse Usage Cost Snapshot Helper

**Files:**
- Create: `desktop/electron/services/usage-analysis/usage-cost-snapshot.ts`
- Create: `desktop/electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts`
- Modify: `desktop/electron/services/usage-analysis/index.ts`

- [ ] **Step 1: Write failing tests for the shared helper**

Create `desktop/electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { UsageModelPriceRule } from "../pricing"
import {
  estimateSynapseUsageCostSnapshot,
  usageTokenBreakdownFromRecord,
} from "../usage-cost-snapshot"

const pricedRule: UsageModelPriceRule = {
  id: "test-model",
  modelPattern: "test-model",
  inputPer1M: 1000,
  outputPer1M: 2000,
  cacheReadPer1M: 10,
  cacheWritePer1M: 100,
  reasoningPer1M: 3000,
  currency: "CNY",
  enabled: true,
  source: "user",
  sortIndex: 0,
  updatedAt: "2026-06-03T00:00:00.000Z",
}

describe("usage cost snapshots", () => {
  it("normalizes snake_case and camelCase usage fields", () => {
    expect(usageTokenBreakdownFromRecord({
      input_tokens: 10,
      outputTokens: 2,
      cacheReadInputTokens: 30,
      cache_creation_input_tokens: 4,
      reasoning_tokens: 1,
    })).toEqual({
      input: 10,
      output: 2,
      cacheRead: 30,
      cacheWrite: 4,
      reasoning: 1,
    })
  })

  it("returns undefined when usage is missing or empty", () => {
    expect(usageTokenBreakdownFromRecord(undefined)).toBeUndefined()
    expect(usageTokenBreakdownFromRecord({})).toBeUndefined()
    expect(estimateSynapseUsageCostSnapshot({
      modelName: "test-model",
      usage: undefined,
      priceRules: [pricedRule],
    })).toBeUndefined()
  })

  it("returns undefined when model is missing", () => {
    expect(estimateSynapseUsageCostSnapshot({
      modelName: "",
      usage: { input_tokens: 1 },
      priceRules: [pricedRule],
    })).toBeUndefined()
  })

  it("estimates CNY cost and category breakdown from price rules", () => {
    expect(estimateSynapseUsageCostSnapshot({
      modelName: "test-model-v1",
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 4,
        reasoning_output_tokens: 1,
      },
      priceRules: [pricedRule],
    })).toEqual({
      modelName: "test-model-v1",
      costCny: 0.0177,
      costBreakdownCny: {
        input: 0.01,
        output: 0.004,
        cacheRead: 0.0003,
        cacheWrite: 0.0004,
        reasoning: 0.003,
      },
      costCurrency: "CNY",
      priceKnown: true,
      estimatedCost: true,
    })
  })

  it("returns an unpriced snapshot when no price rule matches", () => {
    expect(estimateSynapseUsageCostSnapshot({
      modelName: "unknown-model",
      usage: { input_tokens: 10, output_tokens: 2 },
      priceRules: [pricedRule],
    })).toEqual({
      modelName: "unknown-model",
      priceKnown: false,
      estimatedCost: false,
    })
  })
})
```

- [ ] **Step 2: Run the new helper tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts
```

Expected: FAIL because `usage-cost-snapshot.ts` does not exist.

- [ ] **Step 3: Implement the shared helper**

Create `desktop/electron/services/usage-analysis/usage-cost-snapshot.ts`:

```ts
import { estimateUsageCost, roundUsageCost, type UsageModelPriceRule } from "./pricing"
import type { UsageCostBreakdown, UsageTokenBreakdown } from "./types"

export interface SynapseUsageCostSnapshot {
  readonly modelName: string
  readonly costCny?: number
  readonly costBreakdownCny?: UsageCostBreakdown
  readonly costCurrency?: "CNY"
  readonly priceKnown: boolean
  readonly estimatedCost: boolean
}

export function usageTokenBreakdownFromRecord(
  usage: Record<string, unknown> | undefined,
): UsageTokenBreakdown | undefined {
  if (!usage) return undefined
  const breakdown = {
    input: usageTokenNumber(usage, ["input_tokens", "inputTokens"]),
    output: usageTokenNumber(usage, ["output_tokens", "outputTokens"]),
    cacheRead: usageTokenNumber(usage, ["cache_read_input_tokens", "cacheReadInputTokens", "cacheRead"]),
    cacheWrite: usageTokenNumber(usage, ["cache_creation_input_tokens", "cacheCreationInputTokens", "cacheWrite"]),
    reasoning: usageTokenNumber(usage, ["reasoning_output_tokens", "reasoningOutputTokens", "reasoning_tokens", "reasoningTokens"]),
  }
  return Object.values(breakdown).some((value) => value > 0) ? breakdown : undefined
}

export function estimateSynapseUsageCostSnapshot(input: {
  readonly modelName?: string
  readonly usage?: Record<string, unknown>
  readonly priceRules: readonly UsageModelPriceRule[]
}): SynapseUsageCostSnapshot | undefined {
  const modelName = input.modelName?.trim()
  if (!modelName) return undefined
  const tokens = usageTokenBreakdownFromRecord(input.usage)
  if (!tokens) return undefined
  const cost = estimateUsageCost(modelName, tokens, input.priceRules)
  if (!cost.priceKnown) {
    return {
      modelName,
      priceKnown: false,
      estimatedCost: false,
    }
  }
  return {
    modelName,
    costCny: roundUsageCost(cost.total),
    costBreakdownCny: {
      input: roundUsageCost(cost.input),
      output: roundUsageCost(cost.output),
      cacheRead: roundUsageCost(cost.cacheRead),
      cacheWrite: roundUsageCost(cost.cacheWrite),
      reasoning: roundUsageCost(cost.reasoning),
    },
    costCurrency: "CNY",
    priceKnown: true,
    estimatedCost: true,
  }
}

function usageTokenNumber(usage: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = usage[key]
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value
  }
  return 0
}
```

- [ ] **Step 4: Export helper types from usage-analysis index**

Modify `desktop/electron/services/usage-analysis/index.ts` by adding:

```ts
export {
  estimateSynapseUsageCostSnapshot,
  usageTokenBreakdownFromRecord,
  type SynapseUsageCostSnapshot,
} from "./usage-cost-snapshot"
```

- [ ] **Step 5: Verify helper tests pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit shared helper**

```bash
git add desktop/electron/services/usage-analysis/usage-cost-snapshot.ts \
  desktop/electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts \
  desktop/electron/services/usage-analysis/index.ts
git commit -m "feat(usage): add shared cost snapshot helper"
```

## Task 2: Reuse Shared Helper in Agent Conversation Costs

**Files:**
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`

- [ ] **Step 1: Replace pricing imports in conversation router**

In `desktop/electron/services/agent-runtime/conversation-router.ts`, replace:

```ts
import { estimateUsageCost, type UsageModelPriceRule } from "../usage-analysis/pricing"
import type { UsageTokenBreakdown } from "../usage-analysis/types"
```

with:

```ts
import type { UsageModelPriceRule } from "../usage-analysis/pricing"
import {
  estimateSynapseUsageCostSnapshot,
} from "../usage-analysis/usage-cost-snapshot"
```

- [ ] **Step 2: Replace local cost estimation body**

In `estimateLocalCostCny`, replace the body with:

```ts
  private estimateLocalCostCny(
    state: RuntimeSessionState,
    usage: Record<string, unknown> | undefined,
  ): { total: number; breakdown: Record<string, number> } | undefined {
    const snapshot = estimateSynapseUsageCostSnapshot({
      modelName: state.effectiveModel,
      usage,
      priceRules: this.deps.getUsagePriceRules?.() ?? [],
    })
    if (!snapshot?.priceKnown || snapshot.costCny === undefined || !snapshot.costBreakdownCny) return undefined
    return {
      total: roundCost(snapshot.costCny),
      breakdown: {
        input: roundCost(snapshot.costBreakdownCny.input),
        output: roundCost(snapshot.costBreakdownCny.output),
        cacheRead: roundCost(snapshot.costBreakdownCny.cacheRead),
        cacheWrite: roundCost(snapshot.costBreakdownCny.cacheWrite),
        reasoning: roundCost(snapshot.costBreakdownCny.reasoning),
      },
    }
  }
```

- [ ] **Step 3: Remove duplicate local usage token helpers**

Delete these local functions from `conversation-router.ts`:

```ts
function usageTokenBreakdown(usage: Record<string, unknown>): UsageTokenBreakdown {
  return {
    input: usageTokenNumber(usage, ["input_tokens", "inputTokens"]),
    output: usageTokenNumber(usage, ["output_tokens", "outputTokens"]),
    cacheRead: usageTokenNumber(usage, ["cache_read_input_tokens", "cacheReadInputTokens", "cacheRead"]),
    cacheWrite: usageTokenNumber(usage, ["cache_creation_input_tokens", "cacheCreationInputTokens", "cacheWrite"]),
    reasoning: usageTokenNumber(usage, ["reasoning_output_tokens", "reasoningOutputTokens", "reasoning_tokens", "reasoningTokens"]),
  }
}

function usageTokenNumber(usage: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = usage[key]
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value
  }
  return 0
}
```

- [ ] **Step 4: Run existing Agent pricing regression tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: PASS. The existing test `estimates result cost from the effective model and Synapse price rules` must still prove SDK-returned CNY is ignored.

- [ ] **Step 5: Commit Agent helper reuse**

```bash
git add desktop/electron/services/agent-runtime/conversation-router.ts
git commit -m "refactor(agent): reuse usage cost snapshot helper"
```

## Task 3: Return Effective Model and Local Cost Metadata from Scheduled Agent Sends

**Files:**
- Modify: `desktop/electron/services/agent-runtime/types.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`
- Modify: `desktop/electron/bootstrap/__tests__/descriptors.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/workflow-nodes/types.ts`

- [ ] **Step 1: Add failing scheduled send model/cost metadata test**

In `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`, add this test near `returns scheduled agent usage and cost from the terminal SDK result`:

```ts
  it("returns scheduled agent effective model and local CNY breakdown", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", { ANTHROPIC_MODEL: "glm-5.1" }) as unknown as ProviderService,
      getUsagePriceRules: () => [{
        id: "glm-5.1",
        modelPattern: "glm-5.1",
        inputPer1M: 1000,
        outputPer1M: 2000,
        cacheReadPer1M: 10,
        cacheWritePer1M: 100,
        reasoningPer1M: 3000,
        currency: "CNY",
        enabled: true,
        source: "user",
        sortIndex: 0,
        updatedAt: "2026-06-03T00:00:00.000Z",
      }],
      createSession: () => new ScriptedSession([
        {
          type: "result",
          content: "done",
          done: true,
          sdkSessionId: "sdk-1",
          metadata: { model: "glm-5.1" },
          usage: { input_tokens: 10, output_tokens: 2 },
          costCny: 99,
        },
      ], "sdk-1"),
      now: fixedNow,
    })

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "plan",
      prompt: "scheduled prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
    })

    expect(result).toMatchObject({
      status: "success",
      modelName: "glm-5.1",
      costCny: 0.014,
      costBreakdownCny: {
        input: 0.01,
        output: 0.004,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
      },
      costCurrency: "CNY",
    })
  })
```

- [ ] **Step 2: Run scheduled test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts -t "returns scheduled agent effective model and local CNY breakdown"
```

Expected: FAIL because scheduled sends do not return the local cost breakdown yet.

- [ ] **Step 3: Extend Agent runtime result types**

In `desktop/electron/services/agent-runtime/types.ts`, add this shared breakdown type near the runtime result types:

```ts
export interface AgentUsageCostBreakdownCny {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}
```

Update both `AgentRuntimeTurnResult` and `ScheduledAgentSendResult` so they include:

```ts
  readonly modelName?: string
  readonly costBreakdownCny?: AgentUsageCostBreakdownCny
```

`ScheduledAgentSendResult` should include these fields:

```ts
export type ScheduledAgentSendResult = {
  readonly conversationId: string
  readonly sessionKey: string
  readonly status: "success" | "error" | "timeout"
  readonly summary?: string
  readonly error?: string
  readonly durationMs: number
  readonly usage?: Record<string, unknown>
  readonly modelName?: string
  readonly costUsd?: number
  readonly costCny?: number
  readonly costBreakdownCny?: AgentUsageCostBreakdownCny
  readonly costCurrency?: "CNY"
}
```

In `desktop/workflow-nodes/types.ts`, update `AgentSendDeps["sendToAgent"]` result:

```ts
  }) => Promise<{
    status: "success" | "failed"
    response: string
    error?: string
    durationMs: number
    usage?: Record<string, unknown>
    modelName?: string
    costUsd?: number
    costCny?: number
    costBreakdownCny?: {
      readonly input: number
      readonly output: number
      readonly cacheRead: number
      readonly cacheWrite: number
      readonly reasoning: number
    }
    costCurrency?: "CNY"
    agentConversation?: SynapseAgentConversationTarget
  }>
```

- [ ] **Step 4: Return model and local breakdown from ConversationRouter**

In `desktop/electron/services/agent-runtime/conversation-router.ts`, after terminal metadata is finalized, include these fields in the returned `AgentRuntimeTurnResult`:

```ts
      modelName: metadataString(finalMetadata, "model") ?? state.effectiveModel,
      costBreakdownCny: metadataCostBreakdown(finalMetadata, "costBreakdownCny"),
```

Add small local helpers if they do not already exist:

```ts
function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function metadataCostBreakdown(
  metadata: Record<string, unknown> | undefined,
  key: string,
): AgentUsageCostBreakdownCny | undefined {
  const value = metadata?.[key]
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const input = finiteNumber(record.input)
  const output = finiteNumber(record.output)
  const cacheRead = finiteNumber(record.cacheRead)
  const cacheWrite = finiteNumber(record.cacheWrite)
  const reasoning = finiteNumber(record.reasoning)
  if ([input, output, cacheRead, cacheWrite, reasoning].some((part) => part === undefined)) return undefined
  return { input, output, cacheRead, cacheWrite, reasoning }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
```

Import `AgentUsageCostBreakdownCny` from `./types` where needed.

- [ ] **Step 5: Include model/cost metadata in scheduled results**

In `desktop/electron/services/agent-runtime/agent-runtime-service.ts`, add `modelName: result.modelName` to both scheduled result object literals that already include `usage`, `costUsd`, `costCny`, and `costCurrency`:

```ts
          usage: result.usage,
          modelName: result.modelName,
          costUsd: result.costUsd,
          costCny: result.costCny,
          costBreakdownCny: result.costBreakdownCny,
          costCurrency: result.costCurrency,
```

and:

```ts
        usage: result.usage,
        modelName: result.modelName,
        costUsd: result.costUsd,
        costCny: result.costCny,
        costBreakdownCny: result.costBreakdownCny,
        costCurrency: result.costCurrency,
```

- [ ] **Step 6: Include model/cost metadata in workflow Agent dependency result**

In `desktop/electron/bootstrap/descriptors.ts`, inside `sendToAgent`, add model/cost metadata beside `usage`:

```ts
          usage: result.usage,
          modelName: result.modelName,
          costUsd: result.costUsd,
          costCny: result.costCny,
          costBreakdownCny: result.costBreakdownCny,
          costCurrency: result.costCurrency,
```

- [ ] **Step 7: Add descriptor test for model/cost propagation**

In `desktop/electron/bootstrap/__tests__/descriptors.test.ts`, extend the existing workflow Agent dependency success test named `workflow Agent dependency converts node timeout minutes to milliseconds`. Add this assertion to the returned result shape:

```ts
expect(result).toMatchObject({
  status: "success",
  modelName: "glm-5.1",
  costBreakdownCny: {
    input: 0.01,
    output: 0.004,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  },
})
```

Mock the underlying `sendScheduled` result in that test as:

```ts
{
  status: "success",
  summary: "done",
  durationMs: 12,
  conversationId: "conversation-1",
  sessionKey: "workflow:project-1:conversation-1",
  modelName: "glm-5.1",
  costCny: 0.014,
  costBreakdownCny: {
    input: 0.01,
    output: 0.004,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  },
  costCurrency: "CNY",
}
```

- [ ] **Step 8: Run focused Agent runtime and descriptor tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts \
  electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit scheduled model/cost propagation**

```bash
git add desktop/electron/services/agent-runtime/types.ts \
  desktop/electron/services/agent-runtime/conversation-router.ts \
  desktop/electron/services/agent-runtime/agent-runtime-service.ts \
  desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts \
  desktop/electron/bootstrap/descriptors.ts \
  desktop/electron/bootstrap/__tests__/descriptors.test.ts \
  desktop/workflow-nodes/types.ts
git commit -m "feat(agent): return scheduled usage cost metadata"
```

## Task 4: Persist Workflow Node Usage Cost Snapshots

**Files:**
- Modify: `desktop/src/types/workflow.ts`
- Modify: `desktop/electron/services/workflow/workflow-scheduler.ts`
- Modify: `desktop/electron/services/workflow/workflow-engine.ts`
- Modify: `desktop/workflow-nodes/types.ts`
- Modify: `desktop/workflow-nodes/prompt/executor.main.ts`
- Modify: `desktop/workflow-nodes/switch/executor.main.ts`
- Modify: `desktop/electron/services/__tests__/workflow-engine.test.ts`

- [ ] **Step 1: Add failing workflow engine priced snapshot test**

In `desktop/electron/services/__tests__/workflow-engine.test.ts`, replace `preserves prompt node usage and cost in node results and completed events` with:

```ts
  it("stores workflow usage cost snapshots from Agent Runtime local cost metadata", async () => {
    const def: WorkflowDefinition = {
      id: "wf-usage", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [nodeA, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }
    const events: WorkflowEvent[] = []
    const usage = {
      input_tokens: 10,
      output_tokens: 2,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 4,
    }
    const engine = new WorkflowEngine(
      {
        sendToAgent: vi.fn().mockResolvedValue({
          status: "success" as const,
          response: "hello",
          durationMs: 5,
          usage,
          modelName: "test-model-v1",
          costUsd: 0.01,
          costCny: 0.0147,
          costBreakdownCny: {
            input: 0.01,
            output: 0.004,
            cacheRead: 0.0003,
            cacheWrite: 0.0004,
            reasoning: 0,
          },
          costCurrency: "CNY" as const,
        }),
      },
    )

    const result = await engine.run(def, {}, "run-usage", (event) => events.push(event))
    const completedNode = events.find((event) => event.type === "node:completed" && event.nodeId === "a")

    expect(result.nodeResults.a).toMatchObject({
      usage,
      costUsd: 0.01,
      costCny: 0.0147,
      usageCost: {
        modelName: "test-model-v1",
        costCny: 0.0147,
        costBreakdownCny: {
          input: 0.01,
          output: 0.004,
          cacheRead: 0.0003,
          cacheWrite: 0.0004,
          reasoning: 0,
        },
        costCurrency: "CNY",
        priceKnown: true,
        estimatedCost: true,
      },
    })
    expect(completedNode).toMatchObject({
      type: "node:completed",
      result: expect.objectContaining({
        usage,
        costCny: 0.0147,
        usageCost: expect.objectContaining({ costCny: 0.0147 }),
      }),
    })
    expect(logger.info).toHaveBeenCalledWith("node succeeded", expect.objectContaining({
      usage,
      costUsd: 0.01,
      costCny: 0.0147,
      usageCost: expect.objectContaining({ costCny: 0.0147 }),
    }))
  })
```

- [ ] **Step 2: Add failing bare SDK cost guard test**

Append this test in the same file:

```ts
  it("does not treat bare SDK cost fields as Synapse workflow cost snapshots", async () => {
    const def: WorkflowDefinition = {
      id: "wf-sdk-cost", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [nodeA, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }
    const usage = { input_tokens: 10, output_tokens: 2 }
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn().mockResolvedValue({
        status: "success" as const,
        response: "hello",
        durationMs: 5,
        usage,
        modelName: "unknown-model",
        costCny: 99,
      }),
    })

    const result = await engine.run(def, {}, "run-sdk-cost", () => {})

    expect(result.nodeResults.a).toMatchObject({
      usage,
      costCny: 99,
      usageCost: {
        modelName: "unknown-model",
        priceKnown: false,
        estimatedCost: false,
      },
    })
    expect(result.nodeResults.a.usageCost).not.toHaveProperty("costCny")
  })
```

- [ ] **Step 3: Add failing unpriced workflow snapshot test**

Append this test in the same file:

```ts
  it("stores unpriced workflow usage snapshots without CNY cost", async () => {
    const def: WorkflowDefinition = {
      id: "wf-unpriced", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [nodeA, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }
    const usage = { input_tokens: 10, output_tokens: 2 }
    const engine = new WorkflowEngine(
      {
        sendToAgent: vi.fn().mockResolvedValue({
          status: "success" as const,
          response: "hello",
          durationMs: 5,
          usage,
          modelName: "unknown-model",
        }),
      },
    )

    const result = await engine.run(def, {}, "run-unpriced", () => {})

    expect(result.nodeResults.a).toMatchObject({
      usage,
      usageCost: {
        modelName: "unknown-model",
        priceKnown: false,
        estimatedCost: false,
      },
    })
    expect(result.nodeResults.a.usageCost).not.toHaveProperty("costCny")
  })
```

- [ ] **Step 4: Run workflow engine tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-engine.test.ts -t "workflow"
```

Expected: FAIL because `usageCost` is not implemented.

- [ ] **Step 5: Add workflow usageCost types**

In `desktop/src/types/workflow.ts`, add before `NodeRunResult`:

```ts
export interface WorkflowUsageCostBreakdownCny {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export interface WorkflowNodeUsageCostSnapshot {
  readonly modelName?: string
  readonly costCny?: number
  readonly costBreakdownCny?: WorkflowUsageCostBreakdownCny
  readonly costCurrency?: "CNY"
  readonly priceKnown?: boolean
  readonly estimatedCost?: boolean
}
```

Then add to `NodeRunResult`:

```ts
  usageCost?: WorkflowNodeUsageCostSnapshot
```

- [ ] **Step 6: Add usageCost and local cost breakdown to workflow node execution types**

In `desktop/workflow-nodes/types.ts`, import the snapshot type:

```ts
import type { WorkflowNodeUsageCostSnapshot } from "../src/types/workflow"
```

Add to `NodeExecutionResult`:

```ts
  modelName?: string
  costBreakdownCny?: WorkflowNodeUsageCostSnapshot["costBreakdownCny"]
  usageCost?: WorkflowNodeUsageCostSnapshot
```

In `desktop/electron/services/workflow/workflow-scheduler.ts`, import the snapshot type:

```ts
import type { WorkflowNodeUsageCostSnapshot } from "../../../src/types/workflow"
```

Add to `NodeExecOutcome`:

```ts
  modelName?: string
  costBreakdownCny?: WorkflowNodeUsageCostSnapshot["costBreakdownCny"]
  usageCost?: WorkflowNodeUsageCostSnapshot
```

- [ ] **Step 7: Propagate model/cost metadata in prompt and switch node executors**

In `desktop/workflow-nodes/prompt/executor.main.ts`, add `modelName: result.modelName` and `costBreakdownCny: result.costBreakdownCny` to each returned object that currently includes `usage`.

Success return example:

```ts
    return {
      status: "success",
      output: result.response,
      durationMs,
      usage: result.usage,
      modelName: result.modelName,
      costUsd: result.costUsd,
      costCny: result.costCny,
      costBreakdownCny: result.costBreakdownCny,
      costCurrency: result.costCurrency,
      agentConversation: agentConversation ?? result.agentConversation,
    }
```

Apply the same metadata additions to both failed returns in this file.

In `desktop/workflow-nodes/switch/executor.main.ts`, add `modelName: agentResult.modelName` and `costBreakdownCny: agentResult.costBreakdownCny` to every return that includes `usage: agentResult.usage`.

- [ ] **Step 8: Build workflow usage snapshots from Agent Runtime metadata**

In `desktop/electron/services/workflow/workflow-engine.ts`, import the snapshot type:

```ts
import type { WorkflowNodeUsageCostSnapshot } from "../../../src/types/workflow"
```

Add this helper near the bottom of the file:

```ts
function buildWorkflowUsageCostSnapshot(result: NodeExecutionResult): WorkflowNodeUsageCostSnapshot | undefined {
  if (!result.usage || !result.modelName) return undefined
  if (
    result.costCurrency === "CNY" &&
    typeof result.costCny === "number" &&
    result.costBreakdownCny
  ) {
    return {
      modelName: result.modelName,
      costCny: result.costCny,
      costBreakdownCny: result.costBreakdownCny,
      costCurrency: "CNY",
      priceKnown: true,
      estimatedCost: true,
    }
  }
  return {
    modelName: result.modelName,
    priceKnown: false,
    estimatedCost: false,
  }
}
```

After `const execResult = await executor.execute(...)`, before the abort check, add:

```ts
          const usageCost = buildWorkflowUsageCostSnapshot(execResult)
```

In the returned `NodeExecOutcome`, add:

```ts
            modelName: execResult.modelName,
            usageCost,
```

- [ ] **Step 9: Store and emit usageCost in scheduler callbacks**

In `desktop/electron/services/workflow/workflow-engine.ts`, inside `onNodeDone`, after:

```ts
        nr.usage = outcome.usage
        nr.costUsd = outcome.costUsd
        nr.costCny = outcome.costCny
        nr.costCurrency = outcome.costCurrency
```

add:

```ts
        nr.usageCost = outcome.usageCost
```

In all `emit({ type: "node:completed" ... result: { ...nr, ... } })`, `emit({ type: "node:failed" ... })`, and logger metadata blocks that include usage/cost, add:

```ts
            ...(nr.usageCost !== undefined ? { usageCost: nr.usageCost } : {}),
```

- [ ] **Step 10: Run workflow engine and descriptor tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/__tests__/workflow-engine.test.ts \
  electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit workflow snapshots**

```bash
git add desktop/src/types/workflow.ts \
  desktop/workflow-nodes/types.ts \
  desktop/workflow-nodes/prompt/executor.main.ts \
  desktop/workflow-nodes/switch/executor.main.ts \
  desktop/electron/services/workflow/workflow-scheduler.ts \
  desktop/electron/services/workflow/workflow-engine.ts \
  desktop/electron/services/__tests__/workflow-engine.test.ts
git commit -m "feat(workflow): persist token cost snapshots"
```

## Task 5: Token Usage View Model

**Files:**
- Create: `desktop/src/modules/workflow/runner/token-usage-view-model.ts`
- Create: `desktop/src/modules/workflow/runner/__tests__/token-usage-view-model.test.ts`

- [ ] **Step 1: Write failing view model tests**

Create `desktop/src/modules/workflow/runner/__tests__/token-usage-view-model.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"
import {
  buildWorkflowTokenUsageTable,
  formatWorkflowCostCell,
  formatWorkflowTokenCell,
} from "../token-usage-view-model"

describe("workflow token usage view model", () => {
  it("builds rows sorted by startedAt and totals priced costs", () => {
    const table = buildWorkflowTokenUsageTable(definition(), {
      later: nodeResult({
        nodeId: "later",
        startedAt: 20,
        usage: { input_tokens: 10, output_tokens: 2 },
        usageCost: {
          modelName: "test-model",
          costCny: 0.014,
          costBreakdownCny: { input: 0.01, output: 0.004, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
          costCurrency: "CNY",
          priceKnown: true,
          estimatedCost: true,
        },
      }),
      earlier: nodeResult({
        nodeId: "earlier",
        startedAt: 10,
        usage: { input_tokens: 5, cache_read_input_tokens: 30 },
        usageCost: {
          modelName: "unknown-model",
          priceKnown: false,
          estimatedCost: false,
        },
      }),
      pending: { nodeId: "pending", status: "pending", input: { variables: {} } },
    })

    expect(table.rows.map((row) => row.nodeId)).toEqual(["earlier", "later"])
    expect(table.total).toMatchObject({
      input: 15,
      output: 2,
      cacheRead: 30,
      cacheWrite: 0,
      reasoning: 0,
      costCny: 0.014,
      pricedRows: 1,
      unpricedRows: 1,
      nodeCount: 2,
    })
    expect(table.showReasoning).toBe(false)
  })

  it("shows reasoning column when any row has reasoning tokens", () => {
    const table = buildWorkflowTokenUsageTable(definition(), {
      later: nodeResult({
        nodeId: "later",
        usage: { reasoning_output_tokens: 7 },
      }),
    })
    expect(table.showReasoning).toBe(true)
  })

  it("formats tokens and costs", () => {
    expect(formatWorkflowTokenCell(1234567)).toBe("1,234,567")
    expect(formatWorkflowCostCell({ costCny: 0.000123, priceKnown: true })).toBe("¥0.000123")
    expect(formatWorkflowCostCell({ priceKnown: false })).toBe("未定价")
    expect(formatWorkflowCostCell(undefined)).toBe("未定价")
  })
})

function definition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [
      { id: "earlier", name: "Earlier", type: "prompt", position: { x: 0, y: 0 }, config: {} },
      { id: "later", name: "Later", type: "prompt", position: { x: 0, y: 0 }, config: {} },
      { id: "pending", name: "Pending", type: "prompt", position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [],
  }
}

function nodeResult(input: Partial<NodeRunResult> & Pick<NodeRunResult, "nodeId">): NodeRunResult {
  return {
    status: "success",
    input: { variables: {} },
    ...input,
  }
}
```

- [ ] **Step 2: Run view model tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/token-usage-view-model.test.ts
```

Expected: FAIL because `token-usage-view-model.ts` does not exist.

- [ ] **Step 3: Implement the view model**

Create `desktop/src/modules/workflow/runner/token-usage-view-model.ts`:

```ts
import { formatSynapseCost } from "@/lib/cost-currency"
import { formatTokenUsageValue, normalizeClaudeSdkUsage } from "@/lib/token-usage"
import type {
  NodeRunResult,
  WorkflowDefinition,
  WorkflowNodeUsageCostSnapshot,
} from "@/types/workflow"

export interface WorkflowTokenUsageRow {
  readonly nodeId: string
  readonly nodeName: string
  readonly modelName?: string
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly usageCost?: WorkflowNodeUsageCostSnapshot
  readonly startedAt?: number
  readonly orderIndex: number
}

export interface WorkflowTokenUsageTotal {
  readonly nodeCount: number
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly costCny: number
  readonly pricedRows: number
  readonly unpricedRows: number
}

export interface WorkflowTokenUsageTable {
  readonly rows: readonly WorkflowTokenUsageRow[]
  readonly total: WorkflowTokenUsageTotal
  readonly showReasoning: boolean
}

export function buildWorkflowTokenUsageTable(
  definition: WorkflowDefinition,
  nodeResults: Record<string, NodeRunResult>,
): WorkflowTokenUsageTable {
  const order = new Map(definition.nodes.map((node, index) => [node.id, index]))
  const names = new Map(definition.nodes.map((node) => [node.id, node.name]))
  const rows = Object.values(nodeResults)
    .flatMap((result): WorkflowTokenUsageRow[] => {
      const usage = normalizeClaudeSdkUsage(result.usage)
      if (!usage) return []
      return [{
        nodeId: result.nodeId,
        nodeName: names.get(result.nodeId) ?? result.nodeId,
        modelName: result.usageCost?.modelName,
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadInputTokens,
        cacheWrite: usage.cacheCreationInputTokens,
        reasoning: usage.reasoningOutputTokens ?? 0,
        usageCost: result.usageCost,
        startedAt: result.startedAt,
        orderIndex: order.get(result.nodeId) ?? Number.MAX_SAFE_INTEGER,
      }]
    })
    .sort((a, b) => {
      if (a.startedAt !== undefined && b.startedAt !== undefined && a.startedAt !== b.startedAt) {
        return a.startedAt - b.startedAt
      }
      if (a.startedAt !== undefined && b.startedAt === undefined) return -1
      if (a.startedAt === undefined && b.startedAt !== undefined) return 1
      return a.orderIndex - b.orderIndex
    })

  const total = rows.reduce<WorkflowTokenUsageTotal>((acc, row) => {
    const priced = row.usageCost?.priceKnown === true && typeof row.usageCost.costCny === "number"
    return {
      nodeCount: acc.nodeCount + 1,
      input: acc.input + row.input,
      output: acc.output + row.output,
      cacheRead: acc.cacheRead + row.cacheRead,
      cacheWrite: acc.cacheWrite + row.cacheWrite,
      reasoning: acc.reasoning + row.reasoning,
      costCny: priced ? roundCost(acc.costCny + (row.usageCost?.costCny ?? 0)) : acc.costCny,
      pricedRows: acc.pricedRows + (priced ? 1 : 0),
      unpricedRows: acc.unpricedRows + (priced ? 0 : 1),
    }
  }, {
    nodeCount: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    costCny: 0,
    pricedRows: 0,
    unpricedRows: 0,
  })

  return {
    rows,
    total,
    showReasoning: rows.some((row) => row.reasoning > 0),
  }
}

export function formatWorkflowTokenCell(value: number): string {
  return formatTokenUsageValue(value)
}

export function formatWorkflowCostCell(usageCost: WorkflowNodeUsageCostSnapshot | undefined): string {
  if (usageCost?.priceKnown !== true || typeof usageCost.costCny !== "number") return "未定价"
  return formatSynapseCost(usageCost.costCny)
}

export function formatWorkflowTotalCost(total: WorkflowTokenUsageTotal): string {
  if (total.pricedRows === 0) return "未定价"
  const cost = formatSynapseCost(total.costCny)
  return total.unpricedRows > 0 ? `${cost} · 部分定价` : cost
}

function roundCost(value: number): number {
  return Number(value.toFixed(6))
}
```

- [ ] **Step 4: Run view model tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/token-usage-view-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit view model**

```bash
git add desktop/src/modules/workflow/runner/token-usage-view-model.ts \
  desktop/src/modules/workflow/runner/__tests__/token-usage-view-model.test.ts
git commit -m "feat(workflow): build token usage table model"
```

## Task 6: Token Usage Table UI

**Files:**
- Create: `desktop/src/modules/workflow/runner/token-usage-view.tsx`
- Create: `desktop/src/modules/workflow/runner/__tests__/token-usage-view.test.tsx`

- [ ] **Step 1: Write failing Token view component tests**

Create `desktop/src/modules/workflow/runner/__tests__/token-usage-view.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import type { WorkflowDefinition } from "@/types/workflow"
import { TokenUsageView } from "../token-usage-view"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ""
})

describe("TokenUsageView", () => {
  it("renders approved single table with footer totals and no summary cards", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <TokenUsageView
          definition={definition()}
          nodeResults={{
            "node-1": {
              nodeId: "node-1",
              status: "success",
              input: { variables: {} },
              startedAt: 10,
              usage: { input_tokens: 10, output_tokens: 2 },
              usageCost: {
                modelName: "test-model",
                costCny: 0.014,
                costBreakdownCny: { input: 0.01, output: 0.004, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
                costCurrency: "CNY",
                priceKnown: true,
                estimatedCost: true,
              },
            },
            "node-2": {
              nodeId: "node-2",
              status: "success",
              input: { variables: {} },
              startedAt: 20,
              usage: { input_tokens: 5, cache_read_input_tokens: 30 },
              usageCost: { modelName: "unknown-model", priceKnown: false, estimatedCost: false },
            },
          }}
        />,
      )
    })

    expect(container.textContent).toContain("Token 消耗")
    expect(container.textContent).toContain("Prompt node")
    expect(container.textContent).toContain("Unknown price node")
    expect(container.textContent).toContain("test-model")
    expect(container.textContent).toContain("unknown-model")
    expect(container.textContent).toContain("未定价")
    expect(container.textContent).toContain("合计")
    expect(container.textContent).toContain("2 个节点")
    expect(container.textContent).toContain("部分定价")
    expect(container.textContent).not.toContain("总费用")

    const rightAlignedCells = container.querySelectorAll(".text-right")
    expect(rightAlignedCells.length).toBeGreaterThan(0)

    await act(async () => {
      root.unmount()
    })
  })

  it("shows a compact empty state when no node has usage", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<TokenUsageView definition={definition()} nodeResults={{}} />)
    })

    expect(container.textContent).toContain("暂无 Token 消耗")

    await act(async () => {
      root.unmount()
    })
  })
})

function definition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [
      { id: "node-1", name: "Prompt node", type: "prompt", position: { x: 0, y: 0 }, config: {} },
      { id: "node-2", name: "Unknown price node", type: "prompt", position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [],
  }
}
```

- [ ] **Step 2: Run component tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/token-usage-view.test.tsx
```

Expected: FAIL because `token-usage-view.tsx` does not exist.

- [ ] **Step 3: Implement TokenUsageView**

Create `desktop/src/modules/workflow/runner/token-usage-view.tsx`:

```tsx
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"
import {
  buildWorkflowTokenUsageTable,
  formatWorkflowCostCell,
  formatWorkflowTokenCell,
  formatWorkflowTotalCost,
} from "./token-usage-view-model"

interface TokenUsageViewProps {
  readonly definition: WorkflowDefinition
  readonly nodeResults: Record<string, NodeRunResult>
}

export function TokenUsageView({ definition, nodeResults }: TokenUsageViewProps) {
  const table = buildWorkflowTokenUsageTable(definition, nodeResults)

  if (table.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        暂无 Token 消耗
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="min-w-0 p-4">
        <div className="overflow-hidden rounded-lg border bg-background">
          <div className="border-b px-3 py-2 text-sm font-medium">Token 消耗</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-48">节点</TableHead>
                <TableHead className="min-w-40">模型</TableHead>
                <TableHead className="text-right tabular-nums">输入</TableHead>
                <TableHead className="text-right tabular-nums">输出</TableHead>
                <TableHead className="text-right tabular-nums">缓存读</TableHead>
                <TableHead className="text-right tabular-nums">缓存写</TableHead>
                {table.showReasoning ? <TableHead className="text-right tabular-nums">思考</TableHead> : null}
                <TableHead className="text-right tabular-nums">费用</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((row) => (
                <TableRow key={row.nodeId}>
                  <TableCell className="max-w-64 truncate font-medium" title={row.nodeName}>{row.nodeName}</TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground" title={row.modelName ?? undefined}>
                    {row.modelName ?? "--"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(row.input)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(row.output)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(row.cacheRead)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(row.cacheWrite)}</TableCell>
                  {table.showReasoning ? (
                    <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(row.reasoning)}</TableCell>
                  ) : null}
                  <TableCell className="text-right tabular-nums">{formatWorkflowCostCell(row.usageCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter className="sticky bottom-0">
              <TableRow>
                <TableCell>合计</TableCell>
                <TableCell className="text-muted-foreground">{table.total.nodeCount} 个节点</TableCell>
                <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(table.total.input)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(table.total.output)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(table.total.cacheRead)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(table.total.cacheWrite)}</TableCell>
                {table.showReasoning ? (
                  <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(table.total.reasoning)}</TableCell>
                ) : null}
                <TableCell className="text-right tabular-nums">{formatWorkflowTotalCost(table.total)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </div>
    </ScrollArea>
  )
}
```

- [ ] **Step 4: Run Token view tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/workflow/runner/__tests__/token-usage-view-model.test.ts \
  src/modules/workflow/runner/__tests__/token-usage-view.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Token view**

```bash
git add desktop/src/modules/workflow/runner/token-usage-view.tsx \
  desktop/src/modules/workflow/runner/__tests__/token-usage-view.test.tsx
git commit -m "feat(workflow): add token usage table view"
```

## Task 7: Wire Token Tab into Workflow Runner

**Files:**
- Modify: `desktop/src/modules/workflow/runner/runner-toolbar.tsx`
- Modify: `desktop/src/modules/workflow/runner/runner-app.tsx`
- Modify: `desktop/src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx`
- Modify: `desktop/src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx`

- [ ] **Step 1: Add failing toolbar Token test**

In `desktop/src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx`, update the existing test to find and click the Token button:

```ts
    const tokenButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Token"))
    expect(tokenButton).toBeInstanceOf(HTMLButtonElement)
```

Add `tokenButton?.click()` inside the click `act`, and add:

```ts
    expect(onViewModeChange).toHaveBeenCalledWith("token")
    expect(track).toHaveBeenCalledWith({
      component: "button",
      name: "workflow-runner-view-token",
      action: "click",
    })
```

- [ ] **Step 2: Run toolbar test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx
```

Expected: FAIL because there is no Token button.

- [ ] **Step 3: Add Token view mode to toolbar**

In `desktop/src/modules/workflow/runner/runner-toolbar.tsx`, update:

```ts
type ViewMode = "dag" | "timeline" | "token"
```

Add `Coins` to the lucide import:

```ts
import { Square, RotateCcw, PenLine, LayoutDashboard, List, Loader2, Copy, Coins } from "lucide-react"
```

In the segmented view control, adjust rounded classes so three buttons share one group:

```tsx
          <Button
            size="sm"
            variant={viewMode === "token" ? "secondary" : "ghost"}
            className="rounded-l-none h-7"
            data-track="workflow-runner-view-token"
            onClick={() => onViewModeChange("token")}
          >
            <Coins className="h-3.5 w-3.5 mr-1" />Token
          </Button>
```

The `DAG` button remains `rounded-r-none`; the `时间线` button becomes `rounded-none`.

- [ ] **Step 4: Wire Token view into runner app**

In `desktop/src/modules/workflow/runner/runner-app.tsx`, import:

```ts
import { TokenUsageView } from "./token-usage-view"
```

Update:

```ts
type ViewMode = "dag" | "timeline" | "token"
```

Replace the view render conditional with:

```tsx
          {viewMode === "dag" ? (
            <DagView
              definition={definition}
              nodeResults={nodeResults}
              runState={runState}
              selectedNodeId={selectedNodeId}
              onNodeSelect={setSelectedNodeId}
            />
          ) : viewMode === "timeline" ? (
            <TimelineView
              definition={definition}
              nodeResults={nodeResults}
              selectedNodeId={selectedNodeId}
              onNodeSelect={setSelectedNodeId}
              onOpenAgentConversation={handleOpenAgentConversation}
            />
          ) : (
            <TokenUsageView
              definition={definition}
              nodeResults={nodeResults}
            />
          )}
```

- [ ] **Step 5: Add runner app Token view test**

In `desktop/src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx`, add this mock beside the `timeline-view` mock:

```ts
vi.mock("../token-usage-view", () => ({
  TokenUsageView: () => <div data-testid="token-usage-view" />,
}))
```

Add this test:

```tsx
  it("switches to the Token usage view", async () => {
    installWorkflowBridge({
      runStatus: vi.fn(async () => ({
        definition: workflowDefinition(),
        params: {},
      })),
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
    })

    const tokenButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Token"))
    expect(tokenButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      tokenButton?.click()
      await Promise.resolve()
    })

    expect(container.querySelector("[data-testid='token-usage-view']")).toBeInstanceOf(HTMLDivElement)
  })
```

- [ ] **Step 6: Run runner tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx \
  src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit runner wiring**

```bash
git add desktop/src/modules/workflow/runner/runner-toolbar.tsx \
  desktop/src/modules/workflow/runner/runner-app.tsx \
  desktop/src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx \
  desktop/src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx
git commit -m "feat(workflow): add token tab to runner"
```

## Task 8: Release Notes and Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add this bullet under `## 新增功能` in `RELEASE_NOTES_PENDING.md`:

```md
- 工作流运行结果新增 Token 消耗视图，可以按节点查看模型、输入、输出、缓存读写、思考 token 和运行时估算费用，并在表格底部汇总本次运行成本。
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts \
  electron/services/agent-runtime/__tests__/conversation-router.test.ts \
  electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts \
  electron/bootstrap/__tests__/descriptors.test.ts \
  electron/services/__tests__/workflow-engine.test.ts \
  src/modules/workflow/runner/__tests__/token-usage-view-model.test.ts \
  src/modules/workflow/runner/__tests__/token-usage-view.test.tsx \
  src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx \
  src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Run static UI/style guard**

Run:

```bash
rg -n "style=\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|from-|to-|gradient|console\\.log" desktop/src/modules/workflow desktop/src/components/token-usage-summary.tsx
```

Expected: no matches in files created or modified by this feature. If the command reports pre-existing matches in untouched workflow files, leave them unchanged and mention them in the verification notes.

- [ ] **Step 5: Commit release note**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs(workflow): note token usage tab"
```

## Final Verification

- [ ] Run `git status --short` and verify only expected files are clean or intentionally untracked.
- [ ] Run `git log --oneline -n 8` and verify the task commits are present.
- [ ] Do not start the desktop dev server unless the user explicitly asks for runtime validation.
