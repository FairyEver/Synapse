# Dialog Navigate Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 3 处硬编码 setTimeout(300) + Patch 3 的内联 body 重置统一收拢到 `dialog-navigate.ts` 工具模块，并在 App.tsx 内容导航入口加第二层防御，彻底消除 Radix `originalBodyPointerEvents` 竞态的补丁散乱问题。

**Architecture:** 新建 `desktop/src/app-shell/dialog-navigate.ts`，导出 `DIALOG_CLOSE_SETTLE_MS` 常量、`ensureBodyInteractable()` 和 `closeDialogThenNavigate(onClose, action)`；`scan-item-detail-dialog.tsx` 3 处调用点改用 `closeDialogThenNavigate`；`create-content-module.tsx` 内联 DOM 重置改用 `ensureBodyInteractable`；`App.tsx` 事件处理器加 `ensureBodyInteractable` 兜底。

**Tech Stack:** TypeScript, React, Vitest (node environment)

**Spec:** `docs/superpowers/specs/2026-05-11-dialog-navigate-safety-design.md`

---

## File Map

| 文件 | 类型 | 职责 |
|------|------|------|
| `desktop/src/app-shell/dialog-navigate.ts` | **新建** | 常量 + 2 个工具函数 |
| `desktop/src/app-shell/__tests__/dialog-navigate.test.ts` | **新建** | 单元测试（纯行为） |
| `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx` | 修改 | 替换 3 处 setTimeout 模式 |
| `desktop/src/modules/content/create-content-module.tsx` | 修改 | Patch 3 内联重置 → ensureBodyInteractable |
| `desktop/src/App.tsx` | 修改 | subscribeContentOpenRequest 处理器加防御 |

---

## Task 1: 创建 `dialog-navigate.ts` + 单元测试（TDD）

**Files:**
- Create: `desktop/src/app-shell/dialog-navigate.ts`
- Create: `desktop/src/app-shell/__tests__/dialog-navigate.test.ts`

---

- [ ] **Step 1.1: 写失败测试**

创建 `desktop/src/app-shell/__tests__/dialog-navigate.test.ts`，内容如下：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DIALOG_CLOSE_SETTLE_MS, closeDialogThenNavigate, ensureBodyInteractable } from "../dialog-navigate"

const mockBodyStyle: { pointerEvents: string } = { pointerEvents: "" }

beforeEach(() => {
  vi.useFakeTimers()
  mockBodyStyle.pointerEvents = ""
  // @ts-expect-error - mocking document in node test environment
  globalThis.document = { body: { style: mockBodyStyle } }
})

afterEach(() => {
  vi.useRealTimers()
})

describe("DIALOG_CLOSE_SETTLE_MS", () => {
  it("is greater than 150ms to outlast the tw-animate-css default close animation", () => {
    expect(DIALOG_CLOSE_SETTLE_MS).toBeGreaterThan(150)
  })
})

describe("ensureBodyInteractable", () => {
  it("clears body.pointerEvents when it is non-empty", () => {
    mockBodyStyle.pointerEvents = "none"
    ensureBodyInteractable()
    expect(mockBodyStyle.pointerEvents).toBe("")
  })

  it("does not modify body.pointerEvents when it is already empty", () => {
    mockBodyStyle.pointerEvents = ""
    ensureBodyInteractable()
    expect(mockBodyStyle.pointerEvents).toBe("")
  })
})

describe("closeDialogThenNavigate", () => {
  it("calls onClose immediately", () => {
    const onClose = vi.fn()
    const action = vi.fn()
    closeDialogThenNavigate(onClose, action)
    expect(onClose).toHaveBeenCalledOnce()
    expect(action).not.toHaveBeenCalled()
  })

  it("does not call action before DIALOG_CLOSE_SETTLE_MS elapses", () => {
    const action = vi.fn()
    closeDialogThenNavigate(vi.fn(), action)
    vi.advanceTimersByTime(DIALOG_CLOSE_SETTLE_MS - 1)
    expect(action).not.toHaveBeenCalled()
  })

  it("calls action after DIALOG_CLOSE_SETTLE_MS elapses", () => {
    const action = vi.fn()
    closeDialogThenNavigate(vi.fn(), action)
    vi.advanceTimersByTime(DIALOG_CLOSE_SETTLE_MS)
    expect(action).toHaveBeenCalledOnce()
  })

  it("resets body.pointerEvents to empty before calling action", () => {
    mockBodyStyle.pointerEvents = "none"
    let pointerEventsAtCallTime = "not-checked"
    const action = vi.fn(() => {
      pointerEventsAtCallTime = mockBodyStyle.pointerEvents
    })
    closeDialogThenNavigate(vi.fn(), action)
    vi.advanceTimersByTime(DIALOG_CLOSE_SETTLE_MS)
    expect(pointerEventsAtCallTime).toBe("")
  })
})
```

---

- [ ] **Step 1.2: 运行测试，确认失败**

```bash
pnpm --filter @synapse/desktop test -- --reporter=verbose src/app-shell/__tests__/dialog-navigate.test.ts
```

期望输出：`FAIL` — `Cannot find module '../dialog-navigate'`

---

- [ ] **Step 1.3: 创建 `dialog-navigate.ts` 实现**

创建 `desktop/src/app-shell/dialog-navigate.ts`，内容如下：

```ts
/**
 * Minimum delay (ms) after calling onClose() before dispatching cross-tab navigation.
 *
 * Radix DismissableLayer animates dialog close over ~150ms (tw-animate-css default,
 * controlled by --tw-duration CSS variable). After animation ends, DismissableLayer
 * cleanup restores body.pointerEvents. 300ms = 150ms animation + 150ms settle buffer
 * for React cleanup scheduling.
 *
 * If the animation duration ever changes (e.g., via --tw-duration CSS variable),
 * update this constant to remain > animation duration.
 */
export const DIALOG_CLOSE_SETTLE_MS = 300

/**
 * Defensively clears body.pointerEvents if it has been left in a non-empty state.
 *
 * Radix DismissableLayer stores originalBodyPointerEvents in a module-level shared
 * variable. If a new Dialog opens while a previous Dialog's close animation is still
 * running, the new instance captures "none" as the restore value, permanently freezing
 * pointer events after it closes.
 *
 * Call this before opening any Dialog that may follow another Dialog's close.
 */
export function ensureBodyInteractable(): void {
  if (document.body.style.pointerEvents) {
    document.body.style.pointerEvents = ""
  }
}

/**
 * Closes a Radix Dialog and safely dispatches a navigation action after
 * the close animation and DismissableLayer cleanup have settled.
 *
 * Use this instead of:
 *   onClose()
 *   setTimeout(() => navigate(...), 300)
 *
 * The body.pointerEvents guard fires just before the action to break any
 * residual Radix DismissableLayer pollution.
 */
export function closeDialogThenNavigate(
  onClose: () => void,
  action: () => void,
): void {
  onClose()
  setTimeout(() => {
    ensureBodyInteractable()
    action()
  }, DIALOG_CLOSE_SETTLE_MS)
}
```

---

- [ ] **Step 1.4: 运行测试，确认全部通过**

```bash
pnpm --filter @synapse/desktop test -- --reporter=verbose src/app-shell/__tests__/dialog-navigate.test.ts
```

期望输出：所有 6 个测试 `PASS`

---

- [ ] **Step 1.5: 提交**

```bash
git add desktop/src/app-shell/dialog-navigate.ts desktop/src/app-shell/__tests__/dialog-navigate.test.ts
git commit -m "feat(app-shell): add dialog-navigate safety utilities

- DIALOG_CLOSE_SETTLE_MS: single named constant for the 300ms settle period
- ensureBodyInteractable(): documented guard against Radix DismissableLayer
  originalBodyPointerEvents module-level variable pollution
- closeDialogThenNavigate(): safe close-then-navigate abstraction

Addresses the UI freeze root cause documented in:
ui-freeze-diagnosis-20260511.md"
```

---

## Task 2: 重构 `scan-item-detail-dialog.tsx`（3 处调用点）

**Files:**
- Modify: `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`

---

- [ ] **Step 2.1: 在文件顶部添加 import**

在 `@/app-shell/content-navigation` 的 import 块之后，添加新 import：

```ts
import { closeDialogThenNavigate } from "@/app-shell/dialog-navigate"
```

具体位置：当前第 6–10 行是：

```ts
import {
  createContentOpenRequestId,
  requestOpenContentCreate,
  requestOpenContentDetail,
  requestOpenContentEditOverwrite,
} from "@/app-shell/content-navigation"
```

在这个 import 块后加一行：

```ts
import { closeDialogThenNavigate } from "@/app-shell/dialog-navigate"
```

---

- [ ] **Step 2.2: 替换 `publishAsNew` 的 setTimeout（第 1 处）**

找到 `publishAsNew` 函数末尾（约第 214–238 行），替换：

```ts
      onOpenChange(false)

      setTimeout(() => {
        if (draft.itemType === "rule") {
          const result = buildRuleQuickPublishPayload(draft)
          requestOpenContentCreate({
            kind: "create",
            requestId: createContentOpenRequestId(),
            contentType: "rule",
            initialValue: result.payload,
            notices: result.notices,
            sourceLabel,
          })
        } else {
          const result = buildSkillQuickPublishPayload(draft)
          requestOpenContentCreate({
            kind: "create",
            requestId: createContentOpenRequestId(),
            contentType: "skill",
            initialValue: result.payload,
            notices: result.notices,
            sourceLabel,
          })
        }
      }, 300)
```

替换为：

```ts
      closeDialogThenNavigate(
        () => onOpenChange(false),
        () => {
          if (draft.itemType === "rule") {
            const result = buildRuleQuickPublishPayload(draft)
            requestOpenContentCreate({
              kind: "create",
              requestId: createContentOpenRequestId(),
              contentType: "rule",
              initialValue: result.payload,
              notices: result.notices,
              sourceLabel,
            })
          } else {
            const result = buildSkillQuickPublishPayload(draft)
            requestOpenContentCreate({
              kind: "create",
              requestId: createContentOpenRequestId(),
              contentType: "skill",
              initialValue: result.payload,
              notices: result.notices,
              sourceLabel,
            })
          }
        },
      )
```

---

- [ ] **Step 2.3: 替换 `handlePrimaryAction` 的 setTimeout（第 2 处）**

找到 `handlePrimaryAction` 函数中的（约第 263–274 行），替换：

```ts
      const { type: contentType, synapseContentId } = item
      onOpenChange(false)

      setTimeout(() => {
        requestOpenContentDetail({
          kind: "detail",
          requestId: createContentOpenRequestId(),
          contentType,
          contentId: synapseContentId,
        })
      }, 300)
```

替换为：

```ts
      const { type: contentType, synapseContentId } = item
      closeDialogThenNavigate(
        () => onOpenChange(false),
        () => requestOpenContentDetail({
          kind: "detail",
          requestId: createContentOpenRequestId(),
          contentType,
          contentId: synapseContentId,
        }),
      )
```

---

- [ ] **Step 2.4: 替换 `handlePublishOverwrite` 的 setTimeout（第 3 处）**

找到 `handlePublishOverwrite` 函数中的（约第 373–411 行），替换：

```ts
      setIsPublishChoiceOpen(false)
      onOpenChange(false)

      setTimeout(() => { // delay allows dialog close animations (150ms) to complete before tab switch
        if (draft.itemType === "rule") {
          requestOpenContentEditOverwrite({
            kind: "edit-overwrite",
            requestId,
            contentType: "rule",
            contentId: item.synapseContentId!,
            prefill: { contentType: "rule", content: draft.content },
            sourceLabel,
          })
        } else {
          requestOpenContentEditOverwrite({
            kind: "edit-overwrite",
            requestId,
            contentType: "skill",
            contentId: item.synapseContentId!,
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
      }, 300)
```

替换为：

```ts
      setIsPublishChoiceOpen(false)
      closeDialogThenNavigate(
        () => onOpenChange(false),
        () => {
          if (draft.itemType === "rule") {
            requestOpenContentEditOverwrite({
              kind: "edit-overwrite",
              requestId,
              contentType: "rule",
              contentId: item.synapseContentId!,
              prefill: { contentType: "rule", content: draft.content },
              sourceLabel,
            })
          } else {
            requestOpenContentEditOverwrite({
              kind: "edit-overwrite",
              requestId,
              contentType: "skill",
              contentId: item.synapseContentId!,
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
        },
      )
```

---

- [ ] **Step 2.5: 运行全量测试，确认无回归**

```bash
pnpm --filter @synapse/desktop test -- --reporter=verbose
```

期望输出：所有测试 `PASS`，无新增失败。

---

- [ ] **Step 2.6: 提交**

```bash
git add desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx
git commit -m "refactor(editor-scan): replace 3x setTimeout(300) with closeDialogThenNavigate

All three cross-tab navigation callsites in ScanItemDetailDialog now
use the centralized closeDialogThenNavigate() utility:
- publishAsNew → requestOpenContentCreate
- handlePrimaryAction → requestOpenContentDetail
- handlePublishOverwrite → requestOpenContentEditOverwrite

Magic number 300 is no longer repeated; body guard is part of the utility."
```

---

## Task 3: 重构 `create-content-module.tsx` + `App.tsx`

**Files:**
- Modify: `desktop/src/modules/content/create-content-module.tsx`
- Modify: `desktop/src/App.tsx`

---

- [ ] **Step 3.1: 在 `create-content-module.tsx` 中替换 Patch 3**

在文件顶部 import 区添加（在 `@/app-shell/logging` import 附近）：

```ts
import { ensureBodyInteractable } from "@/app-shell/dialog-navigate"
```

然后找到 useEffect 中的 Patch 3（约第 105–108 行）：

```ts
      if (document.body.style.pointerEvents) {
        document.body.style.pointerEvents = ""
      }
      setIsCreateDialogOpen(true)
```

替换为：

```ts
      // Guard against Radix DismissableLayer originalBodyPointerEvents pollution.
      // See desktop/src/app-shell/dialog-navigate.ts for context.
      ensureBodyInteractable()
      setIsCreateDialogOpen(true)
```

---

- [ ] **Step 3.2: 在 `App.tsx` 中添加 Layer 2 防御**

在文件顶部 import 区添加（在 `@/app-shell/content-navigation` import 附近）：

```ts
import { ensureBodyInteractable } from "@/app-shell/dialog-navigate"
```

然后找到 `subscribeContentOpenRequest` 处理器（约第 267–272 行）：

```ts
  useEffect(() => {
    return subscribeContentOpenRequest((request) => {
      setActiveTab(request.contentType, "shortcut")
      setPendingContentOpenRequest(request)
    })
  }, [setActiveTab])
```

替换为：

```ts
  useEffect(() => {
    return subscribeContentOpenRequest((request) => {
      ensureBodyInteractable()
      setActiveTab(request.contentType, "shortcut")
      setPendingContentOpenRequest(request)
    })
  }, [setActiveTab])
```

---

- [ ] **Step 3.3: 运行全量测试，确认无回归**

```bash
pnpm --filter @synapse/desktop test -- --reporter=verbose
```

期望输出：所有测试 `PASS`，无新增失败。

---

- [ ] **Step 3.4: TypeScript 类型检查**

```bash
pnpm --filter @synapse/desktop typecheck
```

期望输出：无类型错误。

---

- [ ] **Step 3.5: 提交**

```bash
git add desktop/src/modules/content/create-content-module.tsx desktop/src/App.tsx
git commit -m "refactor(content): replace inline Patch 3 with ensureBodyInteractable

create-content-module.tsx: undocumented DOM mutation replaced with named
utility + comment explaining the Radix DismissableLayer root cause.

App.tsx: add Layer 2 body guard in subscribeContentOpenRequest handler,
protecting all future cross-tab content navigation paths."
```

---

## 验证清单（实现完成后）

完成所有 Task 后，确认以下全部成立：

- [ ] `dialog-navigate.ts` 中是唯一包含 `300` 这个数字的地方（与 Dialog 动画关闭相关）
- [ ] `scan-item-detail-dialog.tsx` 中不再有裸 `setTimeout(() => {...}, 300)` 模式
- [ ] `create-content-module.tsx` 中不再有裸 `document.body.style.pointerEvents = ""` 赋值
- [ ] `pnpm --filter @synapse/desktop test` 全部通过
- [ ] `pnpm --filter @synapse/desktop typecheck` 无错误
