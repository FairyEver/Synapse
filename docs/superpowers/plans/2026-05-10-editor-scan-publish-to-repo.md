# 扫描详情新增"发布到仓库" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让扫描详情弹窗对 Synapse 安装的 Skill / Rule 新增 `发布到仓库` 操作，支持选择"覆盖现有内容"或"发布为新"。

**Architecture:** 在 `ContentOpenRequest` 上加一种新的 `kind: "edit-overwrite"`，由 `App.tsx` 已有的订阅链路一直透传到 `ContentDetailDialog`；后者收到后自动进入编辑态，并用本地侧的 body 与 Skill 附件覆写编辑表单的初始值，其它字段保留仓库现值。新建路径完全复用现有 `publishAsNew` 流程。无主进程改动。

**Tech Stack:** React + TypeScript + shadcn/Radix（`AlertDialog`、`DropdownMenu`、`Button`），Vitest（源码字符串断言风格）。

**测试约定（重要，请先读）：** 本仓库 renderer 测试沿用 **源码字符串断言** 风格，例：

```ts
const source = await readFile(new URL("../components/foo.tsx", import.meta.url), "utf8")
expect(source).toContain("某段文案或代码")
```

不引入 React Testing Library。新增测试请遵循同样风格。

---

## 涉及文件

- 新增：无
- 修改：
  - `desktop/src/app-shell/content-navigation.ts` —— 扩展请求联合类型 + 新增 dispatcher
  - `desktop/src/modules/content/components/content-browser-page.tsx` —— 处理 `edit-overwrite` 并把 prefill 透传到 `renderDetailDialog`
  - `desktop/src/modules/content/create-content-module.tsx` —— 转发 prefill 到 `<config.DetailDialog>`
  - `desktop/src/modules/content/components/content-detail-dialog.tsx` —— 新 prop `overwritePrefill`，消费时自动进入编辑态并合并 `initialValue`
  - `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx` —— 新增 `发布到仓库` 菜单项 + 选择弹窗 + 两个 handler
- 测试：
  - `desktop/src/app-shell/__tests__/content-navigation.test.ts`（NEW）
  - `desktop/src/modules/content/__tests__/content-detail-dialog-overwrite.test.ts`（NEW）
  - `desktop/src/modules/content/__tests__/content-browser-page-overwrite.test.ts`（NEW）
  - `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`（扩展 `it()` 块）

---

## Task 1：扩展 `ContentOpenRequest` 与 dispatcher

**Files:**
- Modify: `desktop/src/app-shell/content-navigation.ts`
- Test: `desktop/src/app-shell/__tests__/content-navigation.test.ts`（NEW）

`SkillCreateFilePayloadDraft` 已经在 `desktop/src/modules/skills/types.ts:3-9` 定义为 `{ originalName, sha256?, size, file?, bytes? }`，覆盖路径直接复用。

- [ ] **Step 1：写失败测试**

新建 `desktop/src/app-shell/__tests__/content-navigation.test.ts`：

```ts
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("content navigation edit-overwrite request", () => {
  it("declares the edit-overwrite kind on the union", async () => {
    const source = await readFile(
      new URL("../content-navigation.ts", import.meta.url),
      "utf8",
    )

    expect(source).toContain('kind: "edit-overwrite"')
    expect(source).toContain("contentId: string")
    expect(source).toContain("prefill")
    expect(source).toContain("sourceLabel: string")
  })

  it("exports a dispatcher for the edit-overwrite kind", async () => {
    const source = await readFile(
      new URL("../content-navigation.ts", import.meta.url),
      "utf8",
    )

    expect(source).toContain("function requestOpenContentEditOverwrite")
    expect(source).toContain("requestOpenContentEditOverwrite,")
    expect(source).toContain('kind: "edit-overwrite"')
  })

  it("exposes a Rule prefill shape with content", async () => {
    const source = await readFile(
      new URL("../content-navigation.ts", import.meta.url),
      "utf8",
    )

    expect(source).toContain("EditOverwriteRulePrefill")
    expect(source).toContain('contentType: "rule"')
    expect(source).toContain("content: string")
  })

  it("exposes a Skill prefill shape with files", async () => {
    const source = await readFile(
      new URL("../content-navigation.ts", import.meta.url),
      "utf8",
    )

    expect(source).toContain("EditOverwriteSkillPrefill")
    expect(source).toContain('contentType: "skill"')
    expect(source).toContain("files: SkillCreateFilePayloadDraft[]")
  })
})
```

- [ ] **Step 2：跑测试确认 RED**

```bash
pnpm --filter @synapse/desktop run test src/app-shell/__tests__/content-navigation.test.ts
```

预期：4 条 it 全部失败（字符串都不存在）。

- [ ] **Step 3：实现**

修改 `desktop/src/app-shell/content-navigation.ts` 全文为：

```ts
import type { CreateSkillPayload, SkillCreateFilePayloadDraft } from "@/modules/skills/types"
import type { ContentCreateNotice } from "@/modules/content/types/create-notice"
import type { SynapseCreateRulePayload } from "@/types/content"

const OPEN_CONTENT_REQUEST_EVENT = "synapse:open-content-request"

export type EditOverwriteRulePrefill = {
  contentType: "rule"
  content: string
}

export type EditOverwriteSkillPrefill = {
  contentType: "skill"
  content: string
  files: SkillCreateFilePayloadDraft[]
}

export type ContentOpenRequest =
  | {
      kind: "create"
      requestId: string
      contentType: "rule"
      initialValue: SynapseCreateRulePayload
      sourceLabel: string
      notices?: ContentCreateNotice[]
    }
  | {
      kind: "create"
      requestId: string
      contentType: "skill"
      initialValue: CreateSkillPayload
      sourceLabel: string
      notices?: ContentCreateNotice[]
    }
  | {
      kind: "detail"
      requestId: string
      contentType: "rule" | "skill"
      contentId: string
    }
  | {
      kind: "edit-overwrite"
      requestId: string
      contentType: "rule"
      contentId: string
      prefill: EditOverwriteRulePrefill
      sourceLabel: string
    }
  | {
      kind: "edit-overwrite"
      requestId: string
      contentType: "skill"
      contentId: string
      prefill: EditOverwriteSkillPrefill
      sourceLabel: string
    }

function createContentOpenRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function requestOpenContentCreate(request: Extract<ContentOpenRequest, { kind: "create" }>): void {
  window.dispatchEvent(new CustomEvent(OPEN_CONTENT_REQUEST_EVENT, { detail: request }))
}

function requestOpenContentDetail(request: Extract<ContentOpenRequest, { kind: "detail" }>): void {
  window.dispatchEvent(new CustomEvent(OPEN_CONTENT_REQUEST_EVENT, { detail: request }))
}

function requestOpenContentEditOverwrite(
  request: Extract<ContentOpenRequest, { kind: "edit-overwrite" }>,
): void {
  window.dispatchEvent(new CustomEvent(OPEN_CONTENT_REQUEST_EVENT, { detail: request }))
}

function subscribeContentOpenRequest(
  listener: (request: ContentOpenRequest) => void,
): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<ContentOpenRequest>).detail)
  }

  window.addEventListener(OPEN_CONTENT_REQUEST_EVENT, handleEvent)

  return () => {
    window.removeEventListener(OPEN_CONTENT_REQUEST_EVENT, handleEvent)
  }
}

export {
  createContentOpenRequestId,
  requestOpenContentCreate,
  requestOpenContentDetail,
  requestOpenContentEditOverwrite,
  subscribeContentOpenRequest,
}
```

- [ ] **Step 4：跑测试确认 GREEN**

```bash
pnpm --filter @synapse/desktop run test src/app-shell/__tests__/content-navigation.test.ts
```

预期：4 条 it 全部通过。

- [ ] **Step 5：跑 typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

预期：通过。

- [ ] **Step 6：commit**

```bash
git add desktop/src/app-shell/content-navigation.ts desktop/src/app-shell/__tests__/content-navigation.test.ts
git commit -m "feat(content-nav): add edit-overwrite request kind and dispatcher"
```

---

## Task 2：把 `overwritePrefill` 串到 `renderDetailDialog`

**Files:**
- Modify: `desktop/src/modules/content/components/content-browser-page.tsx`
- Modify: `desktop/src/modules/content/create-content-module.tsx`
- Test: `desktop/src/modules/content/__tests__/content-browser-page-overwrite.test.ts`（NEW）

`ContentBrowserPage` 当前只识别 `kind === "detail"` 的请求。本任务让它在 `kind === "edit-overwrite"` 时同样选中目标 item，并额外把 prefill 透传给 `renderDetailDialog`；`createContentModule` 把 prefill 落到 `<config.DetailDialog overwritePrefill={...} />`。

- [ ] **Step 1：写失败测试**

新建 `desktop/src/modules/content/__tests__/content-browser-page-overwrite.test.ts`：

```ts
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("content browser page edit-overwrite plumbing", () => {
  it("widens the detail dialog props with overwritePrefill", async () => {
    const source = await readFile(
      new URL("../components/content-browser-page.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("overwritePrefill")
    expect(source).toContain("EditOverwriteRulePrefill | EditOverwriteSkillPrefill")
  })

  it("opens the matching item when receiving an edit-overwrite request", async () => {
    const source = await readFile(
      new URL("../components/content-browser-page.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain('request.kind === "detail" || request.kind === "edit-overwrite"')
    expect(source).toContain("setOverwritePrefill")
  })

  it("forwards overwritePrefill from createContentModule to the detail dialog", async () => {
    const source = await readFile(
      new URL("../create-content-module.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("overwritePrefill")
    expect(source).toContain("config.DetailDialog")
  })
})
```

- [ ] **Step 2：跑测试确认 RED**

```bash
pnpm --filter @synapse/desktop run test src/modules/content/__tests__/content-browser-page-overwrite.test.ts
```

预期：3 条全部 FAIL。

- [ ] **Step 3：修改 `ContentBrowserPage` 类型与 effect**

打开 `desktop/src/modules/content/components/content-browser-page.tsx`：

3a. 在 import 区加入：

```ts
import type {
  ContentOpenRequest,
  EditOverwriteRulePrefill,
  EditOverwriteSkillPrefill,
} from "@/app-shell/content-navigation"
```

（如果 `ContentOpenRequest` 已在 import，只补 prefill 两个类型即可。）

3b. 把 `ContentBrowserDetailDialogProps` 改为：

```ts
type ContentBrowserDetailDialogProps = {
  item: SynapseContentMeta | null
  onOpenChange: (open: boolean) => void
  open: boolean
  overwritePrefill: { requestId: string; prefill: EditOverwriteRulePrefill | EditOverwriteSkillPrefill } | null
}
```

3c. 在组件内部新增本地状态：

```ts
const [overwritePrefill, setOverwritePrefill] = useState<
  { requestId: string; prefill: EditOverwriteRulePrefill | EditOverwriteSkillPrefill } | null
>(null)
```

3d. 把现有处理 `kind === "detail"` 的 useEffect 扩展为同时处理 `edit-overwrite`：

找到这段（约在第 167–187 行）：

```ts
useEffect(() => {
  const request = pendingContentOpenRequest
  if (!request || request.contentType !== contentType || request.kind !== "detail"
    || consumedOpenRequestIdRef.current === request.requestId || isLoading) return
  // ...
}, [...])
```

替换为：

```ts
useEffect(() => {
  const request = pendingContentOpenRequest
  if (
    !request
    || request.contentType !== contentType
    || !(request.kind === "detail" || request.kind === "edit-overwrite")
    || consumedOpenRequestIdRef.current === request.requestId
    || isLoading
  ) {
    return
  }
  const item = items.find((c) => c.id === request.contentId) ?? null
  if (!item && items.length === 0 && refreshedOpenRequestIdRef.current !== request.requestId) {
    refreshedOpenRequestIdRef.current = request.requestId
    void refresh()
    return
  }
  consumedOpenRequestIdRef.current = request.requestId
  if (item) {
    logger.info("Content detail opened from external request.", {
      contentId: item.id,
      contentType: item.type,
      kind: request.kind,
    })
    setActiveCategoryId(SYNAPSE_ALL_CATEGORY_ID)
    addRecentlyViewed(contentType, item.id)
    setSelectedItem(item)
    if (request.kind === "edit-overwrite") {
      setOverwritePrefill({ requestId: request.requestId, prefill: request.prefill })
    } else {
      setOverwritePrefill(null)
    }
  } else {
    logger.warn("Content detail external request target not found.", { contentId: request.contentId, contentType })
  }
  onPendingContentOpenRequestConsumed?.(request.requestId)
}, [addRecentlyViewed, contentType, isLoading, items, logger, onPendingContentOpenRequestConsumed, pendingContentOpenRequest, refresh, setActiveCategoryId])
```

3e. 切换 selectedItem 关闭时清掉 prefill：找到 `setSelectedItem(null)` 的地方（包含 `onOpenChange` 那个 callback），改成：

```ts
{renderDetailDialog({
  item: selectedItem,
  open: selectedItem !== null,
  onOpenChange: (open) => {
    if (!open) {
      setSelectedItem(null)
      setOverwritePrefill(null)
    }
  },
  overwritePrefill,
})}
```

- [ ] **Step 4：修改 `createContentModule` 转发 prefill**

打开 `desktop/src/modules/content/create-content-module.tsx`，找到 `renderDetailDialog={({ item, onOpenChange, open }) => (...)}` 那段：

替换为：

```ts
renderDetailDialog={({ item, onOpenChange, open, overwritePrefill }) => (
  <config.DetailDialog
    item={item?.type === config.contentType ? item as SynapseContentMeta<T> : null}
    open={open}
    onOpenChange={onOpenChange}
    overwritePrefill={overwritePrefill}
  />
)}
```

类型 `SynapseContentMeta<T>` 等已有 import，无需新增。`overwritePrefill` 由上层 page 传，这里只需向下透传——`config.DetailDialog` 在 Task 3 会接住这个新 prop。

- [ ] **Step 5：跑测试确认 GREEN**

```bash
pnpm --filter @synapse/desktop run test src/modules/content/__tests__/content-browser-page-overwrite.test.ts
```

预期：3 条全部 PASS。

- [ ] **Step 6：跑 typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

预期：通过。注意：此时 `<config.DetailDialog overwritePrefill={...} />` 还没有声明 `overwritePrefill` 这个 prop。如果 typecheck 因此失败，**先去 Task 3 落地 prop 再跑通**——两个任务是耦合的，可以视为同一个 commit。

> 实施提示：如果觉得 typecheck 一定会因 Task 3 未做而失败，可以把 Task 2 与 Task 3 合并为一个 commit。下面我提供两个 commit 的版本；如果合并就把 commit 信息合并即可。

- [ ] **Step 7：commit**

```bash
git add desktop/src/modules/content/components/content-browser-page.tsx \
        desktop/src/modules/content/create-content-module.tsx \
        desktop/src/modules/content/__tests__/content-browser-page-overwrite.test.ts
git commit -m "feat(content): forward edit-overwrite prefill through browser page"
```

---

## Task 3：`ContentDetailDialog` 消费 `overwritePrefill`

**Files:**
- Modify: `desktop/src/modules/content/components/content-detail-dialog.tsx`
- 同时：`desktop/src/modules/rules/components/rule-detail-dialog.tsx`、`desktop/src/modules/skills/components/skill-detail-dialog.tsx`（任意作为薄壳层会把 props 透传到 `ContentDetailDialog` 的位置；需要把新的 `overwritePrefill` prop 也透下去）
- Test: `desktop/src/modules/content/__tests__/content-detail-dialog-overwrite.test.ts`（NEW）

`ContentDetailDialog` 是泛型组件，`renderCreateDialog` 会在 `isEditOpen` 时拿 `buildInitialValue(detail)` 当 initialValue。`overwritePrefill` 的语义：

- 当 `detail` 加载完成且当前 `overwritePrefill.requestId` 还没被消费过：调用 `setIsEditOpen(true)`，并在 `renderCreateDialog` 调用处把 `initialValue` 用 prefill 合并（Rule 覆写 `content`；Skill 覆写 `content` 与 `files`）。
- 用 `useRef` 记录已消费的 `requestId`，避免重复触发。
- 切换内容（`detail.id` 改变）时清掉记录。

- [ ] **Step 1：写失败测试**

新建 `desktop/src/modules/content/__tests__/content-detail-dialog-overwrite.test.ts`：

```ts
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("content detail dialog overwrite prefill", () => {
  it("declares the overwritePrefill prop", async () => {
    const source = await readFile(
      new URL("../components/content-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("overwritePrefill")
    expect(source).toContain("EditOverwriteRulePrefill | EditOverwriteSkillPrefill")
  })

  it("auto enters edit mode once detail loaded with prefill", async () => {
    const source = await readFile(
      new URL("../components/content-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("consumedOverwriteRequestIdRef")
    expect(source).toContain("setIsEditOpen(true)")
  })

  it("merges Rule prefill content into initialValue", async () => {
    const source = await readFile(
      new URL("../components/content-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toMatch(/overwritePrefill[\s\S]{0,80}contentType === "rule"/)
    expect(source).toContain("content: overwritePrefill.prefill.content")
  })

  it("merges Skill prefill content and files into initialValue", async () => {
    const source = await readFile(
      new URL("../components/content-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toMatch(/overwritePrefill[\s\S]{0,80}contentType === "skill"/)
    expect(source).toContain("files: overwritePrefill.prefill.files")
  })
})
```

- [ ] **Step 2：跑测试确认 RED**

```bash
pnpm --filter @synapse/desktop run test src/modules/content/__tests__/content-detail-dialog-overwrite.test.ts
```

预期：4 条全部 FAIL。

- [ ] **Step 3：实现 `ContentDetailDialog`**

3a. 在 `desktop/src/modules/content/components/content-detail-dialog.tsx` 顶部 import 区加：

```ts
import type {
  EditOverwriteRulePrefill,
  EditOverwriteSkillPrefill,
} from "@/app-shell/content-navigation"
```

3b. 在 `ContentDetailDialogProps<TPayload, TContentType>` 类型里加：

```ts
overwritePrefill?: {
  requestId: string
  prefill: EditOverwriteRulePrefill | EditOverwriteSkillPrefill
} | null
```

3c. 在组件参数解构里加 `overwritePrefill = null`。

3d. 在已有 `useState` 区附近声明：

```ts
const consumedOverwriteRequestIdRef = useRef<string | null>(null)
```

3e. 加一个新的 effect（紧挨着 `setIsEditOpen` 已有 effect）：

```ts
useEffect(() => {
  if (!open) return
  if (!detail) return
  if (!overwritePrefill) return
  if (overwritePrefill.prefill.contentType !== detail.type) return
  if (consumedOverwriteRequestIdRef.current === overwritePrefill.requestId) return
  consumedOverwriteRequestIdRef.current = overwritePrefill.requestId
  setIsEditOpen(true)
}, [detail, open, overwritePrefill])
```

3f. 在 `open` 变 false 的清理 effect 里加：

```ts
if (!open) {
  // ... 既有清理
  consumedOverwriteRequestIdRef.current = null
}
```

（找到现有处理 `open=false` 的 useEffect，在末尾追加这一行。）

3g. 找到 `renderCreateDialog({ ... initialValue: buildInitialValue(detail), ... })` 调用处（约 586–595 行附近），把 `initialValue` 改为按需合并：

先在 `if (!detail || isReadonly) return null` 之后、`renderCreateDialog` 调用之前，定义合并函数：

```ts
const mergedInitialValue = (() => {
  const base = buildInitialValue(detail)
  if (!overwritePrefill) return base
  if (overwritePrefill.prefill.contentType !== detail.type) return base
  if (consumedOverwriteRequestIdRef.current !== overwritePrefill.requestId) return base
  if (overwritePrefill.prefill.contentType === "rule") {
    return {
      ...base,
      content: overwritePrefill.prefill.content,
    }
  }
  if (overwritePrefill.prefill.contentType === "skill") {
    return {
      ...base,
      content: overwritePrefill.prefill.content,
      files: overwritePrefill.prefill.files,
    }
  }
  return base
})()
```

然后把 `renderCreateDialog` 调用里 `initialValue: buildInitialValue(detail)` 改成 `initialValue: mergedInitialValue`。

> 注意：`mergedInitialValue` 用了 IIFE 形式，避免每次 render 都新建函数，但又能让类型推导沿用 `buildInitialValue` 的返回值类型。如果 lint 不允许类型不严格匹配（Rule 是 `SynapseCreateRulePayload`、Skill 是 `CreateSkillPayload`），需要在 `return base` 处补 `as TPayload`。具体看实施时 `tsc` 的反馈。

3h. **薄壳层透传**：`rule-detail-dialog.tsx` 与 `skill-detail-dialog.tsx` 是把 `ContentDetailDialog` 包一层固定 props 的薄壳。打开它们：

- 在 props 类型定义加上 `overwritePrefill?: ContentDetailDialogProps[...]["overwritePrefill"]`，或者直接 `overwritePrefill?: { requestId: string; prefill: ... } | null`，import 类型同 3a。
- 在 JSX 把 `overwritePrefill` 透传给 `<ContentDetailDialog ... />`。

如果发现 rule/skill 薄壳层是用 spread `{...props}` 透传的，可能不需要改，但请确认 props 类型里包含了这个字段。

- [ ] **Step 4：跑测试确认 GREEN**

```bash
pnpm --filter @synapse/desktop run test src/modules/content/__tests__/content-detail-dialog-overwrite.test.ts
```

预期：4 条 PASS。

- [ ] **Step 5：跑全套 typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

预期：通过。如果失败，多半在薄壳层 props 类型上——按错误信息把字段补上。

- [ ] **Step 6：commit**

```bash
git add desktop/src/modules/content/components/content-detail-dialog.tsx \
        desktop/src/modules/rules/components/rule-detail-dialog.tsx \
        desktop/src/modules/skills/components/skill-detail-dialog.tsx \
        desktop/src/modules/content/__tests__/content-detail-dialog-overwrite.test.ts
git commit -m "feat(content-detail): consume overwritePrefill into edit form"
```

---

## Task 4：扫描详情新增 `发布到仓库` + 选择弹窗 + handler

**Files:**
- Modify: `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
- Test：扩展 `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`

- [ ] **Step 1：扩展失败测试**

打开 `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`，在文件末尾（`})`闭合大 describe 之前）追加：

```ts
  it("offers a publish-to-repo action for synapse-installed scan items", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("发布到仓库")
    expect(source).toContain("canPublishToRepo")
    expect(source).toContain('item.source === "synapse"')
  })

  it("asks user to choose between overwrite and publish-as-new", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("覆盖现有内容")
    expect(source).toContain("发布为新内容")
    expect(source).toContain("isPublishChoiceOpen")
  })

  it("dispatches edit-overwrite for the overwrite choice", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("requestOpenContentEditOverwrite")
    expect(source).toContain("prepareQuickPublishDraft")
    expect(source).toContain('kind: "edit-overwrite"')
  })

  it("falls back to publish-as-new when linked content is unavailable on overwrite", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("setFallbackReason")
    expect(source).toContain("handlePublishOverwrite")
  })
```

- [ ] **Step 2：跑测试确认 RED**

```bash
pnpm --filter @synapse/desktop run test src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
```

预期：原有 it 仍 PASS，4 条新 it FAIL。

- [ ] **Step 3：实现 scan dialog 改动**

打开 `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`：

3a. 把现有的 `from "@/app-shell/content-navigation"` import 块（约第 5–9 行）替换为：

```ts
import {
  createContentOpenRequestId,
  requestOpenContentCreate,
  requestOpenContentDetail,
  requestOpenContentEditOverwrite,
} from "@/app-shell/content-navigation"
```

新增的只是 `requestOpenContentEditOverwrite`。

3b. 在 state 区（`useState` 一组里）追加：

```ts
const [isPublishChoiceOpen, setIsPublishChoiceOpen] = useState(false)
const [isOverwriteBusy, setIsOverwriteBusy] = useState(false)
```

3c. 在已有的 `canReinstall` 旁边加：

```ts
const canPublishToRepo = item.source === "synapse" && Boolean(item.synapseContentId)
```

3d. 新增 `handlePublishOverwrite`（紧挨着 `publishAsNew` 之后）：

```ts
const handlePublishOverwrite = useCallback(async () => {
  if (!item || !item.synapseContentId || disabledReason) return
  setIsOverwriteBusy(true)
  setQuickPublishError(null)

  try {
    const bridge = getSynapseBridge()
    if (!bridge) {
      throw new Error("当前窗口无法读取本地内容。")
    }

    // 先确认仓库内容仍然存在；不存在则降级走"作为新内容导入"。
    const detail = await readDetail(item.type, item.synapseContentId)
    if (detail.deleted) {
      setFallbackReason("仓库内容已删除。")
      return
    }

    const draft = await bridge.editorScan.prepareQuickPublishDraft({
      itemType: item.type,
      itemPath: item.path,
      itemName: item.name,
      ruleContent: item.type === "rule" ? item.content : undefined,
      metadata: item.metadata,
    })

    const sourceLabel = formatQuickPublishSourceLabel(item)
    const requestId = createContentOpenRequestId()

    if (draft.itemType === "rule") {
      requestOpenContentEditOverwrite({
        kind: "edit-overwrite",
        requestId,
        contentType: "rule",
        contentId: item.synapseContentId,
        prefill: { contentType: "rule", content: draft.content },
        sourceLabel,
      })
    } else {
      requestOpenContentEditOverwrite({
        kind: "edit-overwrite",
        requestId,
        contentType: "skill",
        contentId: item.synapseContentId,
        prefill: {
          contentType: "skill",
          content: draft.content,
          files: draft.files.map((file) => ({
            originalName: file.originalName,
            size: file.size,
            bytes: file.bytes,
          })),
        },
        sourceLabel,
      })
    }

    logger.info("Publish-to-repo overwrite dispatched.", {
      contentId: item.synapseContentId,
      contentType: item.type,
      editorId: item.editorId,
      requestId,
      scope: item.scope,
    })

    setIsPublishChoiceOpen(false)
    onOpenChange(false)
  } catch (error) {
    logger.warn("Publish-to-repo overwrite failed.", {
      contentId: item.synapseContentId,
      contentType: item.type,
      editorId: item.editorId,
      error,
    })
    setQuickPublishError(
      error instanceof Error ? error.message : "读取本地内容失败。",
    )
  } finally {
    setIsOverwriteBusy(false)
  }
}, [disabledReason, item, onOpenChange])
```

3e. 新增 `handlePublishAsNewFromChoice`：

```ts
const handlePublishAsNewFromChoice = useCallback(async () => {
  setIsPublishChoiceOpen(false)
  await publishAsNew()
}, [publishAsNew])
```

3f. 在 `if (!item) return null` 之后的 `JSX` 区里，与已有的 `<AlertDialog>`（trash 确认、fallbackReason）并排，新增"发布到仓库"选择弹窗。把它放在已有 fallbackReason `AlertDialog` 之后：

```tsx
<AlertDialog
  open={isPublishChoiceOpen}
  onOpenChange={(nextOpen) => {
    if (!isOverwriteBusy && !isQuickPublishBusy) setIsPublishChoiceOpen(nextOpen)
  }}
>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>发布到仓库</AlertDialogTitle>
      <AlertDialogDescription>
        把本地内容推回仓库。覆盖会替换该 {item.type === "skill" ? "Skill" : "Rule"} 在仓库的现有内容，仓库会保留历史版本，可回退。
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel disabled={isOverwriteBusy || isQuickPublishBusy}>取消</AlertDialogCancel>
      <Button
        type="button"
        variant="outline"
        disabled={isOverwriteBusy || isQuickPublishBusy}
        onClick={(event) => {
          event.preventDefault()
          void handlePublishAsNewFromChoice()
        }}
      >
        发布为新内容
      </Button>
      <AlertDialogAction
        disabled={isOverwriteBusy || isQuickPublishBusy}
        onClick={(event) => {
          event.preventDefault()
          void handlePublishOverwrite()
        }}
      >
        {isOverwriteBusy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
        覆盖现有内容
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

3g. 在 `<DropdownMenuContent>` 里，紧跟"重新安装" `DropdownMenuItem` 后插入：

```tsx
{canPublishToRepo ? (
  <DropdownMenuItem
    disabled={isOverwriteBusy || isQuickPublishBusy || disabledReason !== null}
    onSelect={() => {
      logger.info("Publish-to-repo choice opened.", {
        contentId: item.synapseContentId,
        contentType: item.type,
        editorId: item.editorId,
        scope: item.scope,
      })
      setIsPublishChoiceOpen(true)
    }}
  >
    发布到仓库
  </DropdownMenuItem>
) : null}
```

最终菜单顺序：查看仓库内容 → 重新安装 → **发布到仓库** → 移到废纸篓 → 复制到其它编辑器。

3h. 关闭 dialog 的 effect（处理 `open` 变 false 的 useEffect）末尾加上：

```ts
setIsPublishChoiceOpen(false)
setIsOverwriteBusy(false)
```

- [ ] **Step 4：跑测试确认 GREEN**

```bash
pnpm --filter @synapse/desktop run test src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
```

预期：所有 it（含原有的 + 4 个新 it）PASS。

- [ ] **Step 5：跑 typecheck + lint**

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run lint
```

预期：通过。

- [ ] **Step 6：commit**

```bash
git add desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx \
        desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
git commit -m "feat(editor-scan): add publish-to-repo action with overwrite/new choice"
```

---

## Task 5：整体回归

**Files:** 无修改，仅运行命令。

- [ ] **Step 1：跑全部测试**

```bash
pnpm --filter @synapse/desktop run test
```

预期：全 PASS。

- [ ] **Step 2：跑 typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

预期：通过。

- [ ] **Step 3：跑 lint**

```bash
pnpm --filter @synapse/desktop run lint
```

预期：通过。

- [ ] **Step 4：跑硬约束检查**

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

预期：通过（本次改动只动 renderer，不会触碰 runtime 硬约束）。

- [ ] **Step 5：把 spec + plan 一起提到分支头**

```bash
git add docs/superpowers/specs/2026-05-10-editor-scan-publish-to-repo-design.md \
        docs/superpowers/plans/2026-05-10-editor-scan-publish-to-repo.md
git commit -m "docs: spec + plan for editor-scan publish-to-repo"
```

> 如果 spec 已经在 brainstorming 阶段提交过，跳过这一步。

- [ ] **Step 6：手动验证清单（交付前由用户跑）**

不在自动化范围内，留给用户在桌面端跑：

1. 在 IDE 扫描页打开一个由 Synapse 安装的 Skill 详情 → 操作菜单出现"发布到仓库"。
2. 点击 → 弹窗显示"覆盖现有内容 / 发布为新内容 / 取消"。
3. 选"覆盖现有内容" → 跳进该 Skill 的详情页编辑态，body 是本地版本，附件是本地目录里的文件，title/category/icon 是仓库现值。点保存 → 写库成功，扫描列表行为不变。
4. 选"发布为新内容" → 进入新建对话框，行为与外部条目"导入到仓库"一致。
5. 同样路径在 Rule 上验证一遍（Rule 没有附件，仅 body 覆写）。
6. 把仓库内容删了之后再走覆盖路径 → 命中"关联内容不可用，作为新内容导入"降级。
7. 外部条目（非 Synapse 安装）的菜单**没有**"发布到仓库"，主操作仍为"导入到仓库"。

---

## 实施顺序与回退策略

- 推荐顺序：Task 1 → Task 2 → Task 3 → Task 4 → Task 5。Task 2 与 Task 3 在 typecheck 上有耦合（`<config.DetailDialog overwritePrefill={...} />`），如果不便分离 commit 可以合并为一个 commit，但测试仍分两个文件保留可读性。
- 回退：每个 commit 独立可回退。Task 4 出问题不影响 Task 1–3 的能力，只是 UI 入口暂时缺失。

## Self-Review

- **Spec coverage**：菜单形态（Task 4）、选择弹窗（Task 4）、覆盖路径（Task 1+2+3+4）、新建路径（Task 4 复用）、降级（Task 4 - readDetail 检查 + setFallbackReason）、Skill 附件完全镜像（Task 4 prefill files 来自 draft.files）、日志（Task 4）、不动主进程（确认）—— 全部覆盖。
- **Placeholder scan**：每步都有具体代码或具体命令，无 TBD/TODO/泛化提示。
- **Type consistency**：`overwritePrefill` 形态（`{ requestId, prefill }`）在 Task 2、3 一致；`requestOpenContentEditOverwrite` 命名在 Task 1 定义、Task 4 调用一致；`SkillCreateFilePayloadDraft` 类型在 Task 1 引入、Task 4 使用一致。
