# Task Run Navigate Agent Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手动点击"运行"定时任务后，自动跳转到 Agent 页并选中新创建的 agent session。

**Architecture:** 在 `navigation.ts` 新增一个 `requestWatchNextAgentSession` 导航意图事件，task-scheduler 在手动触发 agent 任务时发出该意图，agent module 的 `useChatEvents` 订阅并在下一个匹配的 `conversationUpdated` 到达时调用 `requestOpenAgentSession` 完成跳转。纯 renderer 侧修改，不改 IPC/后端。

**Tech Stack:** TypeScript · React (`useRef`, `useEffect`) · CustomEvent (浏览器原生 API)

**Spec:** `docs/superpowers/specs/2026-05-11-task-run-navigate-agent-design.md`

---

## File Map

| 状态 | 文件 | 变更说明 |
|------|------|---------|
| 修改 | `desktop/src/app-shell/navigation.ts` | 新增常量、类型、`requestWatchNextAgentSession`、`subscribeWatchNextAgentSession` |
| 新增 | `desktop/src/app-shell/__tests__/navigation-watch-session.test.ts` | source-reading 测试：验证新函数被导出 |
| 修改 | `desktop/src/modules/task-scheduler/index.tsx` | `onRun` 回调中发出意图 |
| 修改 | `desktop/src/modules/agent/hooks/use-chat-events.ts` | 订阅意图事件，在 `conversationUpdated` 时触发跳转 |

---

## Task 1: navigation.ts — 新增 watch-next-agent-session 事件

**Files:**
- Modify: `desktop/src/app-shell/navigation.ts`
- Create: `desktop/src/app-shell/__tests__/navigation-watch-session.test.ts`

- [ ] **Step 1: 写失败测试**

  新建 `desktop/src/app-shell/__tests__/navigation-watch-session.test.ts`：

  ```ts
  import { readFile } from "node:fs/promises"
  import { describe, expect, it } from "vitest"

  describe("navigation watch-next-agent-session", () => {
    it("exports requestWatchNextAgentSession", async () => {
      const source = await readFile(
        new URL("../navigation.ts", import.meta.url),
        "utf8",
      )
      expect(source).toContain("function requestWatchNextAgentSession")
      expect(source).toContain("requestWatchNextAgentSession,")
    })

    it("exports subscribeWatchNextAgentSession", async () => {
      const source = await readFile(
        new URL("../navigation.ts", import.meta.url),
        "utf8",
      )
      expect(source).toContain("function subscribeWatchNextAgentSession")
      expect(source).toContain("subscribeWatchNextAgentSession,")
    })

    it("declares WatchNextAgentSessionPayload with projectId", async () => {
      const source = await readFile(
        new URL("../navigation.ts", import.meta.url),
        "utf8",
      )
      expect(source).toContain("WatchNextAgentSessionPayload")
      expect(source).toContain("projectId: string")
    })
  })
  ```

- [ ] **Step 2: 运行测试，确认失败**

  ```bash
  pnpm --filter @synapse/desktop run test -- --run src/app-shell/__tests__/navigation-watch-session.test.ts
  ```

  预期输出包含 `FAIL` 和 `AssertionError`。

- [ ] **Step 3: 在 navigation.ts 添加实现**

  在 `desktop/src/app-shell/navigation.ts` 里，紧跟 `OPEN_AGENT_SESSION_EVENT` 常量后插入新常量：

  ```ts
  const WATCH_NEXT_AGENT_SESSION_EVENT = "synapse:watch-next-agent-session"
  ```

  在 `OpenAgentSessionPayload` 类型后插入新类型：

  ```ts
  type WatchNextAgentSessionPayload = {
    projectId: string
  }
  ```

  在 `subscribeOpenAgentSession` 函数后插入两个新函数：

  ```ts
  function requestWatchNextAgentSession(payload: WatchNextAgentSessionPayload): void {
    window.dispatchEvent(new CustomEvent(WATCH_NEXT_AGENT_SESSION_EVENT, { detail: payload }))
  }

  function subscribeWatchNextAgentSession(
    listener: (payload: WatchNextAgentSessionPayload) => void,
  ): () => void {
    const handleEvent = (event: Event) => {
      listener((event as CustomEvent<WatchNextAgentSessionPayload>).detail)
    }

    window.addEventListener(WATCH_NEXT_AGENT_SESSION_EVENT, handleEvent)

    return () => {
      window.removeEventListener(WATCH_NEXT_AGENT_SESSION_EVENT, handleEvent)
    }
  }
  ```

  在 `export { ... }` 块里补充两个新导出：

  ```ts
  export {
    publishActiveAppTab,
    readCurrentAppTab,
    requestOpenAgentSession,
    requestOpenSettingsAbout,
    requestOpenSettingsStorage,
    requestOpenSettingsTab,
    requestWatchNextAgentSession,
    subscribeActiveAppTab,
    subscribeOpenAgentSession,
    subscribeOpenSettingsAbout,
    subscribeOpenSettingsStorage,
    subscribeOpenSettingsTab,
    subscribeWatchNextAgentSession,
  }

  export type { OpenAgentSessionPayload, WatchNextAgentSessionPayload }
  ```

- [ ] **Step 4: 运行测试，确认通过**

  ```bash
  pnpm --filter @synapse/desktop run test -- --run src/app-shell/__tests__/navigation-watch-session.test.ts
  ```

  预期：所有 3 个测试 PASS。

- [ ] **Step 5: TypeScript 编译检查**

  ```bash
  pnpm --filter @synapse/desktop run typecheck
  ```

  预期：无新增错误。

- [ ] **Step 6: Commit**

  ```bash
  git add desktop/src/app-shell/navigation.ts desktop/src/app-shell/__tests__/navigation-watch-session.test.ts
  git commit -m "feat: add requestWatchNextAgentSession navigation intent event"
  ```

---

## Task 2: task-scheduler — onRun 发出导航意图

**Files:**
- Modify: `desktop/src/modules/task-scheduler/index.tsx`

> **背景知识：** `ScheduledTask.action` 的类型是 `ScheduledTaskActionRef = { type: string; config: Record<string, unknown> }`。当 `action.type === "builtin.agent"` 时，`action.config` 保证有 `projectId: string` 字段（来自 `AgentActionConfig` schema）。

- [ ] **Step 1: 在 index.tsx 顶部添加 import**

  在 `desktop/src/modules/task-scheduler/index.tsx` 找到现有的 navigation 相关 import（如有），否则在文件 import 区末尾添加：

  ```ts
  import { requestWatchNextAgentSession } from "@/app-shell/navigation"
  ```

- [ ] **Step 2: 修改 onRun 回调**

  找到当前的 `onRun` 回调（约 256-261 行）：

  ```ts
  onRun={(task) => {
    runTask(task.id).catch((err) => {
      logger.error("Failed to run task.", { error: err, taskId: task.id })
    })
    notify({ message: "任务已触发", tone: "success" })
  }}
  ```

  替换为：

  ```ts
  onRun={(task) => {
    if (task.action.type === "builtin.agent") {
      const projectId = task.action.config["projectId"]
      if (typeof projectId === "string" && projectId) {
        requestWatchNextAgentSession({ projectId })
      }
    }
    runTask(task.id).catch((err) => {
      logger.error("Failed to run task.", { error: err, taskId: task.id })
    })
    notify({ message: "任务已触发", tone: "success" })
  }}
  ```

- [ ] **Step 3: TypeScript 编译检查**

  ```bash
  pnpm --filter @synapse/desktop run typecheck
  ```

  预期：无新增错误。

- [ ] **Step 4: Commit**

  ```bash
  git add desktop/src/modules/task-scheduler/index.tsx
  git commit -m "feat: fire watch-next-agent-session intent on manual agent task run"
  ```

---

## Task 3: use-chat-events — 订阅意图并跳转

**Files:**
- Modify: `desktop/src/modules/agent/hooks/use-chat-events.ts`

> **背景知识：** `useChatEvents` 是自定义 hook，可以在内部使用 `useRef`。`conversationUpdated` 事件已在该 hook 的 `useEffect` 里被处理（约 104-161 行）。`requestOpenAgentSession` 已在 `navigation.ts` 存在并被其他地方使用。

- [ ] **Step 1: 添加 import**

  在 `desktop/src/modules/agent/hooks/use-chat-events.ts` 的 import 区找到：

  ```ts
  import { useEffect } from "react"
  ```

  替换为：

  ```ts
  import { useEffect, useRef } from "react"
  ```

  在文件 import 区末尾（`import type { ChatAction, ChatState }` 等行附近）添加：

  ```ts
  import {
    requestOpenAgentSession,
    subscribeWatchNextAgentSession,
  } from "@/app-shell/navigation"
  ```

- [ ] **Step 2: 在 useChatEvents 函数体内添加 pendingWatchRef 和订阅 useEffect**

  在 `useChatEvents` 函数内，紧接解构语句（`const { projectIdsRef, ... } = refs`）之后，`useEffect` 之前，插入：

  ```ts
  const pendingWatchRef = useRef<{ projectId: string; expiresAt: number } | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribeWatchNextAgentSession(({ projectId }) => {
      if (timer !== null) clearTimeout(timer)
      pendingWatchRef.current = { projectId, expiresAt: Date.now() + 5000 }
      timer = setTimeout(() => {
        pendingWatchRef.current = null
        timer = null
      }, 5000)
    })
    return () => {
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
      pendingWatchRef.current = null
    }
  }, [])
  ```

- [ ] **Step 3: 在 conversationUpdated 分支添加跳转逻辑**

  在 `domainEvent.type === "conversationUpdated"` 分支里，找到 `void refreshConversationSnapshot(domainEvent.payload)` 这一行（约 132 行），在其正后方插入：

  ```ts
  const watch = pendingWatchRef.current
  if (
    watch !== null
    && domainEvent.payload.projectId === watch.projectId
    && Date.now() < watch.expiresAt
  ) {
    pendingWatchRef.current = null
    requestOpenAgentSession({
      projectId: domainEvent.payload.projectId,
      conversationId: domainEvent.payload.conversationId,
    })
  }
  ```

  插入后该区域应如下所示：

  ```ts
  void refreshConversationSnapshot(domainEvent.payload)
  const watch = pendingWatchRef.current
  if (
    watch !== null
    && domainEvent.payload.projectId === watch.projectId
    && Date.now() < watch.expiresAt
  ) {
    pendingWatchRef.current = null
    requestOpenAgentSession({
      projectId: domainEvent.payload.projectId,
      conversationId: domainEvent.payload.conversationId,
    })
  }
  if (selectedUpdate || autoFollow) {
  ```

- [ ] **Step 4: TypeScript 编译检查**

  ```bash
  pnpm --filter @synapse/desktop run typecheck
  ```

  预期：无新增错误。

- [ ] **Step 5: 运行全量测试，确认无回归**

  ```bash
  pnpm --filter @synapse/desktop run test -- --run
  ```

  预期：所有现有测试 PASS，无新增 FAIL。

- [ ] **Step 6: Commit**

  ```bash
  git add desktop/src/modules/agent/hooks/use-chat-events.ts
  git commit -m "feat: auto-navigate to agent session on manual task run"
  ```

---

## 验收标准

手动测试步骤（实现完成后，由用户在应用中验证）：

1. 打开任意一个 `builtin.agent` 类型的定时任务
2. 点击任务卡片上的"运行"按钮
3. 预期：
   - 成功提示 "任务已触发" 出现
   - 应用自动切换到 Agent 页
   - 新 session 被选中并显示正在执行的内容
4. 验证非 agent 任务（HTTP / 脚本类型）点击"运行"后行为不变（只显示成功提示，不跳转）
