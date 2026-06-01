# Agent Session Token Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent conversation replies display a bottom metadata row with cumulative per-field token usage for the current Synapse conversation.

**Architecture:** Keep the existing `agent.usage` raw per-result ledger. After each SDK result is recorded, aggregate the current conversation usage and persist that cumulative snapshot on the assistant history entry. Renderer usage display remains shared, but Agent messages opt into a `总计` prefix and keep the copy control separate from the cumulative usage row.

**Tech Stack:** Electron main process TypeScript, React, shadcn/Radix baseline, Vitest, pnpm monorepo.

---

## File Structure

- Modify `desktop/src/lib/token-usage.ts`: add optional reasoning aggregation and an optional display prefix.
- Modify `desktop/src/lib/__tests__/token-usage.test.ts`: update helper tests for reasoning aggregation and prefixed fields.
- Modify `desktop/electron/runtime/data-repo/schemas/placeholders.ts`: extend usage summary types/schema to allow optional reasoning tokens.
- Modify `desktop/electron/services/agent-runtime/session-repository.ts`: store reasoning summaries and keep conversation aggregation cumulative.
- Modify `desktop/electron/services/agent-runtime/conversation-router.ts`: persist cumulative usage snapshots on assistant messages after raw usage is recorded.
- Modify `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`: cover two-turn cumulative snapshots and raw per-result ledger behavior.
- Modify `desktop/src/modules/agent/components/agent-message-toolbar.tsx`: allow Agent messages to render cumulative usage as an always-visible bottom metadata row.
- Modify `desktop/src/modules/agent/components/agent-message-event.tsx`: pass the cumulative prefix for assistant messages.
- Modify `desktop/src/modules/agent/components/__tests__/agent-message-toolbar.test.tsx`: verify `总计` display and non-prefixed defaults.
- Modify `RELEASE_NOTES_PENDING.md`: add the user-visible behavior change.

## Task 1: Usage Helper Supports Cumulative Reasoning And Prefix

**Files:**
- Modify: `desktop/src/lib/token-usage.ts`
- Modify: `desktop/src/lib/__tests__/token-usage.test.ts`

- [ ] **Step 1: Write failing helper tests**

In `desktop/src/lib/__tests__/token-usage.test.ts`, replace the first two tests and add a prefix assertion:

```ts
it("normalizes Claude SDK usage with optional reasoning fields", () => {
  expect(normalizeClaudeSdkUsage({
    input_tokens: 10,
    output_tokens: 2,
    cache_creation_input_tokens: 4,
    cache_read_input_tokens: 30,
    reasoning_output_tokens: 7,
  })).toEqual({
    inputTokens: 10,
    outputTokens: 2,
    cacheCreationInputTokens: 4,
    cacheReadInputTokens: 30,
    reasoningOutputTokens: 7,
    totalTokens: 53,
  })
})

it("sums unique Claude SDK usage records with reasoning when present", () => {
  expect(sumClaudeSdkUsage([
    {
      input_tokens: 10,
      output_tokens: 2,
      cache_creation_input_tokens: 4,
      cache_read_input_tokens: 30,
      reasoning_output_tokens: 7,
    },
    {
      input_tokens: 1,
      output_tokens: 2,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: 3,
      reasoning_tokens: 5,
    },
  ])).toEqual({
    inputTokens: 11,
    outputTokens: 4,
    cacheCreationInputTokens: 4,
    cacheReadInputTokens: 33,
    reasoningOutputTokens: 12,
    totalTokens: 64,
  })
})

it("supports an optional summary prefix", () => {
  expect(tokenUsageFields({
    inputTokens: 1,
    outputTokens: 2,
  }, { prefix: "总计" })?.map((field) => field.label)).toEqual([
    "总计",
    "输入",
    "输出",
    "缓存读",
    "缓存写",
  ])
})
```

- [ ] **Step 2: Run helper tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/token-usage.test.ts
```

Expected: failure because `ClaudeSdkUsageSummary` lacks `reasoningOutputTokens`, totals do not include reasoning, and `tokenUsageFields` does not accept options.

- [ ] **Step 3: Implement helper changes**

In `desktop/src/lib/token-usage.ts`, change the summary interface and helper signatures:

```ts
export interface ClaudeSdkUsageSummary {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadInputTokens: number
  readonly cacheCreationInputTokens: number
  readonly reasoningOutputTokens?: number
  readonly totalTokens: number
}

interface TokenUsageFieldsOptions {
  readonly prefix?: string
}
```

Change `tokenUsageFields` to accept options and prepend a prefix field:

```ts
export function tokenUsageFields(
  usage: Record<string, unknown> | undefined,
  options: TokenUsageFieldsOptions = {},
): readonly TokenUsageField[] | undefined {
  if (!usage) return undefined
  const fields = TOKEN_USAGE_DEFINITIONS.map((definition) => ({
    label: definition.label,
    value: tokenNumber(usage, definition.keys),
    optional: definition.optional,
  }))
  if (!fields.some((field) => field.value !== undefined)) return undefined
  const rendered = fields.flatMap((field) => {
    if (field.optional && field.value === undefined) return []
    return [{ label: field.label, value: field.value ?? 0 }]
  })
  return options.prefix
    ? [{ label: options.prefix, value: Number.NaN }, ...rendered]
    : rendered
}
```

Update `normalizeClaudeSdkUsage` to read reasoning fields:

```ts
const reasoningOutputTokens = tokenNumber(usage, ["reasoning_output_tokens", "reasoning_tokens"])
```

Pass it into `usageSummary` only when present:

```ts
return usageSummary({
  inputTokens: inputTokens ?? 0,
  outputTokens: outputTokens ?? 0,
  cacheReadInputTokens: cacheReadInputTokens ?? 0,
  cacheCreationInputTokens: cacheCreationInputTokens ?? 0,
  ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
})
```

Update `sumClaudeSdkUsageSummaries` reducer:

```ts
reasoningOutputTokens: sumOptionalTokens(total.reasoningOutputTokens, summary.reasoningOutputTokens),
```

Add the helper:

```ts
function sumOptionalTokens(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined
  return (a ?? 0) + (b ?? 0)
}
```

Update `usageSummary` total:

```ts
totalTokens: input.inputTokens
  + input.outputTokens
  + input.cacheReadInputTokens
  + input.cacheCreationInputTokens
  + (input.reasoningOutputTokens ?? 0),
```

Because prefix rows are labels, update `TokenUsageSummary` in Task 3 before using this in UI. If helper tests inspect labels only, this task can pass before rendering changes.

- [ ] **Step 4: Run helper tests and confirm pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/token-usage.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/lib/token-usage.ts desktop/src/lib/__tests__/token-usage.test.ts
git commit -m "feat(agent): support cumulative usage summary fields"
```

## Task 2: Persist Cumulative Usage Snapshots

**Files:**
- Modify: `desktop/electron/runtime/data-repo/schemas/placeholders.ts`
- Modify: `desktop/electron/services/agent-runtime/session-repository.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`

- [ ] **Step 1: Write failing cumulative router test**

In `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`, add this test after `persists result usage on the assistant history entry`:

```ts
it("persists cumulative usage snapshots on assistant history entries", async () => {
  const agentUsage = new MemoryNamespace<AgentUsageEntryV1>("agent.usage")
  const firstSession = new ScriptedSession([
    {
      type: "result",
      content: "first answer",
      done: true,
      sdkResultUuid: "result-1",
      sdkSessionId: "sdk-1",
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 4,
        reasoning_output_tokens: 1,
      },
    },
  ], "sdk-1")
  const secondSession = new ScriptedSession([
    {
      type: "result",
      content: "second answer",
      done: true,
      sdkResultUuid: "result-2",
      sdkSessionId: "sdk-1",
      usage: {
        input_tokens: 5,
        output_tokens: 3,
        cache_read_input_tokens: 70,
        cache_creation_input_tokens: 6,
        reasoning_output_tokens: 2,
      },
    },
  ], "sdk-1")
  const { conversations, router } = createRouter({
    agentUsage,
    sessions: [firstSession, secondSession],
  })

  const first = await router.send(baseMessage("first"))
  await router.send({
    ...baseMessage("second"),
    conversationId: first.conversationId,
  })

  const savedConversation = await conversations.get(first.conversationId)
  const assistantEntries = savedConversation?.history.filter((entry) => entry.role === "assistant") ?? []
  const usageRows = await agentUsage.list()

  expect(assistantEntries).toHaveLength(2)
  expect(assistantEntries[0]?.metadata?.usage).toEqual({
    inputTokens: 10,
    outputTokens: 2,
    cacheReadInputTokens: 30,
    cacheCreationInputTokens: 4,
    reasoningOutputTokens: 1,
    totalTokens: 47,
  })
  expect(assistantEntries[1]?.metadata?.usage).toEqual({
    inputTokens: 15,
    outputTokens: 5,
    cacheReadInputTokens: 100,
    cacheCreationInputTokens: 10,
    reasoningOutputTokens: 3,
    totalTokens: 133,
  })
  expect(usageRows).toEqual([
    expect.objectContaining({
      id: "result-1",
      usageSummary: expect.objectContaining({
        inputTokens: 10,
        outputTokens: 2,
        cacheReadInputTokens: 30,
        cacheCreationInputTokens: 4,
        reasoningOutputTokens: 1,
        totalTokens: 47,
      }),
    }),
    expect.objectContaining({
      id: "result-2",
      usageSummary: expect.objectContaining({
        inputTokens: 5,
        outputTokens: 3,
        cacheReadInputTokens: 70,
        cacheCreationInputTokens: 6,
        reasoningOutputTokens: 2,
        totalTokens: 86,
      }),
    }),
  ])
})
```

- [ ] **Step 2: Run router test and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: failure because assistant metadata stores single-result usage and the schema/summary does not include reasoning.

- [ ] **Step 3: Extend data-repo usage summary type and schema**

In `desktop/electron/runtime/data-repo/schemas/placeholders.ts`, update `AgentUsageSummaryV1`:

```ts
export interface AgentUsageSummaryV1 extends Record<string, unknown> {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  reasoningOutputTokens?: number
  totalTokens: number
}
```

Update `isAgentUsageSummary` to allow optional `reasoningOutputTokens`:

```ts
&& isOptionalNumber((v as AgentUsageSummaryV1).reasoningOutputTokens)
```

Place it with the other numeric field checks before `totalTokens`.

- [ ] **Step 4: Store reasoning summaries**

In `desktop/electron/services/agent-runtime/session-repository.ts`, update `recordSdkResultUsage()` usage summary construction:

```ts
usageSummary: {
  inputTokens: summary.inputTokens,
  outputTokens: summary.outputTokens,
  cacheReadInputTokens: summary.cacheReadInputTokens,
  cacheCreationInputTokens: summary.cacheCreationInputTokens,
  ...(summary.reasoningOutputTokens !== undefined ? { reasoningOutputTokens: summary.reasoningOutputTokens } : {}),
  totalTokens: summary.totalTokens,
},
```

- [ ] **Step 5: Persist cumulative metadata after recording raw usage**

In `desktop/electron/services/agent-runtime/conversation-router.ts`, add a private helper near `saveExecutionResult`:

```ts
  private async cumulativeUsageMetadata(
    conversationId: string,
    metadata: ConversationEntryV1["history"][number]["metadata"] | undefined,
  ): Promise<ConversationEntryV1["history"][number]["metadata"] | undefined> {
    const usage = await this.repository.getUsageSummary(conversationId)
    if (!usage) return metadata
    return compactMetadata({
      ...(metadata ?? {}),
      usage,
    })
  }
```

In both result-handling paths where `resultMetadata = resultHistoryMetadata(event)` currently runs, keep that line, record raw usage, then set cumulative metadata before `break`:

```ts
resultMetadata = await this.cumulativeUsageMetadata(conversation.id, resultMetadata)
```

Place it after `await this.repository.recordSdkResultUsage(...)` and before `await this.repository.saveUsage(...)`.

Do not change `resultUsage` returned from `router.send`; scheduled tasks and workflow nodes should still receive the current SDK result usage.

- [ ] **Step 6: Update existing single-turn expectations**

In the existing `persists result usage on the assistant history entry` test, change expected assistant metadata usage from snake_case SDK raw fields to normalized cumulative camelCase fields:

```ts
usage: {
  inputTokens: 10,
  outputTokens: 2,
  cacheReadInputTokens: 30,
  cacheCreationInputTokens: 4,
  totalTokens: 46,
},
```

Keep `result.usage` and `agentUsage` row expectations as raw SDK usage.

- [ ] **Step 7: Run router test and confirm pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/runtime/data-repo/schemas/placeholders.ts desktop/electron/services/agent-runtime/session-repository.ts desktop/electron/services/agent-runtime/conversation-router.ts desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts
git commit -m "feat(agent): persist cumulative token usage snapshots"
```

## Task 3: Agent Message Footer Shows Cumulative Summary Row

**Files:**
- Modify: `desktop/src/components/token-usage-summary.tsx`
- Modify: `desktop/src/modules/agent/components/agent-message-toolbar.tsx`
- Modify: `desktop/src/modules/agent/components/agent-message-event.tsx`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-message-toolbar.test.tsx`

- [ ] **Step 1: Write failing toolbar test**

In `desktop/src/modules/agent/components/__tests__/agent-message-toolbar.test.tsx`, add a new assertion to the token usage test render:

```ts
usagePrefix="总计"
```

Then assert:

```ts
expect(container.textContent).toContain("总计")
expect(container.textContent).toContain("输入 1,234")
expect(container.textContent).toContain("输出 56")
expect(container.textContent).toContain("缓存读 7,890")
expect(container.textContent).toContain("缓存写 12")
```

Also add a small default case:

```ts
expect(container.textContent).not.toContain("总计")
```

for a toolbar rendered with `usage` but no `usagePrefix`.

- [ ] **Step 2: Run toolbar test and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-message-toolbar.test.tsx
```

Expected: failure because `AgentMessageToolbar` does not accept `usagePrefix` and `TokenUsageSummary` cannot render prefix labels safely.

- [ ] **Step 3: Render prefix labels without numeric values**

In `desktop/src/components/token-usage-summary.tsx`, change props:

```ts
interface TokenUsageSummaryProps {
  readonly usage?: Record<string, unknown>
  readonly prefix?: string
  readonly className?: string
  readonly itemClassName?: string
}
```

Call helper with options:

```ts
const fields = tokenUsageFields(usage, { prefix })
```

Render prefix rows without values:

```tsx
{fields?.map((field) => (
  <span key={field.label} className={cn("whitespace-nowrap", itemClassName)}>
    {Number.isNaN(field.value)
      ? field.label
      : `${field.label} ${formatTokenUsageValue(field.value)}`}
  </span>
))}
```

- [ ] **Step 4: Thread prefix through Agent toolbar**

In `desktop/src/modules/agent/components/agent-message-toolbar.tsx`, add prop:

```ts
readonly usagePrefix?: string
```

Destructure it and pass it:

```tsx
<TokenUsageSummary usage={usage} prefix={usagePrefix} />
```

- [ ] **Step 5: Pass prefix from assistant message events**

In `desktop/src/modules/agent/components/agent-message-event.tsx`, pass the prefix only for assistant usage:

```tsx
usagePrefix={hasUsage ? "总计" : undefined}
```

Keep user message toolbar unchanged.

- [ ] **Step 6: Run toolbar test and confirm pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-message-toolbar.test.tsx
```

Expected: all tests pass.

- [ ] **Step 7: Run timeline/message tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-message-toolbar.test.tsx src/modules/agent/components/__tests__/agent-timeline.test.tsx src/modules/agent/__tests__/agent-message-row.test.tsx
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/components/token-usage-summary.tsx desktop/src/modules/agent/components/agent-message-toolbar.tsx desktop/src/modules/agent/components/agent-message-event.tsx desktop/src/modules/agent/components/__tests__/agent-message-toolbar.test.tsx
git commit -m "feat(agent): show cumulative usage in reply footer"
```

## Task 4: Release Notes And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update release notes**

Add under `## 功能优化`:

```md
- Agent 对话里的 token 用量改为在回复底部显示当前会话截至该回复的累计分项统计，并用“总计”标明口径，避免误看成单轮消耗。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts src/lib/__tests__/token-usage.test.ts src/modules/agent/components/__tests__/agent-message-toolbar.test.tsx src/modules/agent/components/__tests__/agent-timeline.test.tsx src/modules/agent/__tests__/agent-message-row.test.tsx
```

Expected: all listed suites pass.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: command passes without new violations.

- [ ] **Step 4: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs(agent): note cumulative token usage display"
```

## Self-Review

Spec coverage:

- Cumulative per-conversation snapshots are covered in Task 2.
- Raw per-result ledger preservation is covered in Task 2 tests.
- Separate fields and optional reasoning display are covered in Tasks 1 and 3.
- Bottom metadata row UI is covered in Task 3.
- Release notes are covered in Task 4.

Placeholder scan:

- No red-flag placeholder terms remain.
- Each code-changing step includes concrete snippets and exact commands.

Type consistency:

- `reasoningOutputTokens` is used consistently across helper, data schema, repository summaries, and tests.
- `prefix` is used for shared `TokenUsageSummary`; `usagePrefix` is used only by `AgentMessageToolbar`.
