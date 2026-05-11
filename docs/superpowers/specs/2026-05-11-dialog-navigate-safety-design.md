# Dialog Navigate Safety Design

**日期**：2026-05-11  
**问题来源**：[ui-freeze-diagnosis-20260511.md](../../../desktop/docs/ui-freeze-diagnosis-20260511.md)（也见桌面）  
**状态**：待实现

---

## 一、背景

### 根因

Radix UI `DismissableLayer` 使用**模块级共享变量** `originalBodyPointerEvents` 记录恢复值。若在上一个 Dialog 的关闭动画期间（150ms）就打开下一个 Dialog，新 Dialog 会把 `"none"` 捕获为恢复值，导致它关闭后 `body.pointer-events` 永久锁定为 `"none"`，页面冻结。

### 现有补丁（三处创可贴）

| 补丁 | 文件 | 现状 |
|------|------|------|
| P1 `handleSubmit` async | `create-content-module.tsx` | 正确修复，不涉及本次 |
| P2 `setTimeout(action, 300)` | `scan-item-detail-dialog.tsx` × 3处 | magic number 重复，无注释 |
| P3 `body.pointerEvents = ""` | `create-content-module.tsx` | 散落在 useEffect，无文档 |

### 系统性缺口

`App.tsx` 的 `subscribeContentOpenRequest` 事件处理器目前**没有任何 body 防御**：将来任何新增的"从其他模块导航到内容模块"路径，若调用方忘记用安全工具，都面临同样风险。

---

## 二、设计目标

1. 把 magic number 收拢到**一处命名常量**，动画时长变了只改一个地方
2. 把 3 处重复的 `setTimeout` 模式变成**一个可复用的调用点**
3. 在 App 级别的内容导航入口加**统一防御**，覆盖未来路径
4. 把 Patch 3 的 DOM 操作变成**有文档的命名函数**，不再是惊喜

---

## 三、三层防御模型

```
调用方（ScanItemDetailDialog 等）
  └─ closeDialogThenNavigate(onClose, action)   ← 层 1：导航侧
      └─ requestOpenContent*()
          └─ App.tsx subscribeContentOpenRequest  ← 层 2：App 入口侧
              └─ ensureBodyInteractable()
              └─ setActiveTab + setPendingRequest
                  └─ createContentModule useEffect  ← 层 3：Dialog 打开前
                      └─ ensureBodyInteractable()
                          └─ setIsCreateDialogOpen(true)
```

每层独立有效，合在一起做到：无论请求来自哪个路径，打开新 Dialog 前 body 一定处于干净状态。

---

## 四、新文件：`desktop/src/app-shell/dialog-navigate.ts`

### 职责

集中所有与"关闭 Dialog 后安全导航"相关的工具，是 Radix `originalBodyPointerEvents` 问题的统一应对点。

### 导出

#### 常量 `DIALOG_CLOSE_SETTLE_MS`

```ts
/**
 * Minimum delay (ms) after calling onClose() before dispatching cross-tab navigation.
 *
 * Radix DismissableLayer animates dialog close over ~150ms (tw-animate-css default).
 * After animation ends, DismissableLayer cleanup restores body.pointerEvents.
 * 300ms = 150ms animation + 150ms settle buffer for React cleanup scheduling.
 *
 * If the animation duration ever changes (e.g., via --tw-duration CSS variable),
 * update this constant to remain > animation duration.
 */
export const DIALOG_CLOSE_SETTLE_MS = 300
```

#### 函数 `ensureBodyInteractable()`

```ts
/**
 * Defensively clears body.pointerEvents if it has been left in a non-empty state.
 *
 * Radix DismissableLayer stores originalBodyPointerEvents in a module-level
 * shared variable. If a new Dialog opens while a previous Dialog's close animation
 * is still running, the new instance captures "none" as the restore value,
 * permanently freezing pointer events after it closes.
 *
 * Call this before opening any Dialog that may follow another Dialog's close
 * to break the pollution chain.
 */
export function ensureBodyInteractable(): void {
  if (document.body.style.pointerEvents) {
    document.body.style.pointerEvents = ""
  }
}
```

#### 函数 `closeDialogThenNavigate(onClose, action)`

```ts
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

## 五、修改：`scan-item-detail-dialog.tsx`

### 变化

导入 `closeDialogThenNavigate`，替换 3 处重复的 `onOpenChange(false)` + `setTimeout(action, 300)` 模式。

#### `publishAsNew`（第 1 处）

```ts
// Before:
onOpenChange(false)
setTimeout(() => {
  if (draft.itemType === "rule") {
    requestOpenContentCreate({ ... })
  } else {
    requestOpenContentCreate({ ... })
  }
}, 300)

// After:
closeDialogThenNavigate(
  () => onOpenChange(false),
  () => {
    if (draft.itemType === "rule") {
      requestOpenContentCreate({ ... })
    } else {
      requestOpenContentCreate({ ... })
    }
  },
)
```

#### `handlePrimaryAction`（第 2 处）

```ts
// Before:
onOpenChange(false)
setTimeout(() => {
  requestOpenContentDetail({ ... })
}, 300)

// After:
closeDialogThenNavigate(
  () => onOpenChange(false),
  () => requestOpenContentDetail({ ... }),
)
```

#### `handlePublishOverwrite`（第 3 处）

```ts
// Before:
setIsPublishChoiceOpen(false)
onOpenChange(false)
setTimeout(() => { // delay allows dialog close animations (150ms) to complete before tab switch
  if (draft.itemType === "rule") { ... } else { ... }
  logger.info(...)
}, 300)

// After:
setIsPublishChoiceOpen(false)
closeDialogThenNavigate(
  () => onOpenChange(false),
  () => {
    if (draft.itemType === "rule") { ... } else { ... }
    logger.info(...)
  },
)
```

---

## 六、修改：`create-content-module.tsx`

### 变化

导入 `ensureBodyInteractable`，替换内联 body 重置，并在原地添加说明注释。

```ts
// Before (Patch 3 - 无文档的 DOM 操作):
if (document.body.style.pointerEvents) {
  document.body.style.pointerEvents = ""
}
setIsCreateDialogOpen(true)

// After:
// Guard against Radix DismissableLayer originalBodyPointerEvents pollution.
// See desktop/src/app-shell/dialog-navigate.ts for context.
ensureBodyInteractable()
setIsCreateDialogOpen(true)
```

---

## 七、修改：`App.tsx`

### 变化

在 `subscribeContentOpenRequest` 事件处理器中加 Layer 2 防御。

```ts
// Before:
useEffect(() => {
  return subscribeContentOpenRequest((request) => {
    setActiveTab(request.contentType, "shortcut")
    setPendingContentOpenRequest(request)
  })
}, [setActiveTab])

// After:
useEffect(() => {
  return subscribeContentOpenRequest((request) => {
    ensureBodyInteractable() // Layer 2: guard against upstream dialog cleanup races
    setActiveTab(request.contentType, "shortcut")
    setPendingContentOpenRequest(request)
  })
}, [setActiveTab])
```

---

## 八、文件变更一览

| 文件 | 类型 | 变化 |
|------|------|------|
| `desktop/src/app-shell/dialog-navigate.ts` | **新建** | 工具常量 + 2 个函数 |
| `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx` | 修改 | 3 处 setTimeout 替换为 `closeDialogThenNavigate` |
| `desktop/src/modules/content/create-content-module.tsx` | 修改 | 内联 body 重置替换为 `ensureBodyInteractable()` |
| `desktop/src/App.tsx` | 修改 | `subscribeContentOpenRequest` 处理器加 `ensureBodyInteractable()` |

---

## 九、不做什么（排除项）

- **不使用 `animationend` 替换 setTimeout**：需要 ref 管理，`prefers-reduced-motion` 下无事件，多层嵌套动画干扰；300ms settle 对已知动画（150ms）提供 2× 缓冲，足够安全
- **不修改 Radix 上游**：模块级 `originalBodyPointerEvents` 是 Radix 内部实现，通过三层防御在应用层隔离该问题
- **不扩大重构范围**：只动 4 个文件，`P1` 修复（async handleSubmit）不需要变动

---

## 十、未来使用规范

在 Synapse 中，凡是需要"关闭 Dialog A 后在其他 Tab 打开 Dialog B"，必须：

1. 使用 `closeDialogThenNavigate(onClose, action)` 而非裸 setTimeout
2. 在目标 Dialog 打开前调用 `ensureBodyInteractable()`
3. App 级的内容导航入口（如 `subscribeContentOpenRequest`）统一调用 `ensureBodyInteractable()`

新增类似跨 Tab Dialog 切换场景时，这套基础设施已开箱即用。
