# Agent Timeline 优雅化重设计实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 Agent 对话消息列表，实现 ChatGPT 风格的双栏气泡布局，提升视觉精致度

**Architecture:** 用户消息右对齐灰色气泡，AI 消息左对齐带头部（头像+名称+时间戳）；工具调用和 Thinking 作为 AI 消息下方的可折叠附属区域

**Tech Stack:** React 19 + TypeScript + Tailwind CSS + shadcn/ui (radix-nova preset)

---

## 文件结构

| 文件路径 | 操作 | 说明 |
|---------|------|------|
| `desktop/src/modules/agent/components/agent-message-header.tsx` | 创建 | 消息头部：头像 + 发送者名称 + 时间戳 |
| `desktop/src/modules/agent/components/agent-message-bubble.tsx` | 创建 | 可复用的消息气泡组件 |
| `desktop/src/modules/agent/components/agent-annotation.tsx` | 创建 | 气泡下方附属区域容器 |
| `desktop/src/modules/agent/components/agent-message-event.tsx` | 重写 | 双栏布局，整合头部、气泡、附属区域 |
| `desktop/src/modules/agent/components/agent-thinking-event.tsx` | 修改 | 改进折叠按钮样式，增加左侧装饰线 |
| `desktop/src/modules/agent/components/agent-tool-event.tsx` | 修改 | 改进折叠按钮和展开内容样式 |
| `desktop/src/modules/agent/components/agent-timeline-item.tsx` | 修改 | 传递 profile 给 message event |
| `desktop/src/modules/agent/components/agent-timeline.tsx` | 修改 | 调整消息间距 |

---

### Task 1: 创建 AgentMessageHeader 组件

**Files:**
- Create: `desktop/src/modules/agent/components/agent-message-header.tsx`
- Test: `desktop/src/modules/agent/components/__tests__/agent-message-header.test.tsx`

**组件设计：**
- 用户消息：右侧显示用户头像 + "You" + 时间戳
- AI 消息：左侧显示 Agent 图标 + Agent 名称 + 时间戳
- 使用 Lucide 图标：用户用 `User`，Agent 用 `Bot` 或根据 agentType 映射

- [ ] **Step 1: 编写组件代码**

```tsx
import { Bot, User } from "lucide-react"
import { cn } from "@/lib/utils"

interface AgentMessageHeaderProps {
  readonly role: "user" | "assistant"
  readonly agentName?: string
  readonly timestamp?: string
  readonly className?: string
}

function AgentMessageHeader({
  role,
  agentName,
  timestamp,
  className,
}: AgentMessageHeaderProps) {
  const isUser = role === "user"
  const displayName = isUser ? "You" : (agentName ?? "Agent")
  const Icon = isUser ? User : Bot

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        isUser ? "flex-row-reverse justify-start" : "flex-row justify-start",
        className,
      )}
    >
      <div className="flex size-6 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <span className="text-sm font-medium">{displayName}</span>
      {timestamp ? (
        <time className="text-xs text-muted-foreground">
          {formatTimestamp(timestamp)}
        </time>
      ) : null}
    </div>
  )
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

export { AgentMessageHeader, formatTimestamp }
export type { AgentMessageHeaderProps }
```

- [ ] **Step 2: 编写测试**

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AgentMessageHeader, formatTimestamp } from "../agent-message-header"

describe("AgentMessageHeader", () => {
  it("renders user header with correct layout", () => {
    render(<AgentMessageHeader role="user" timestamp="2025-05-08T12:34:56Z" />)
    expect(screen.getByText("You")).toBeInTheDocument()
    expect(screen.getByText("12:34")).toBeInTheDocument()
  })

  it("renders assistant header with agent name", () => {
    render(
      <AgentMessageHeader
        role="assistant"
        agentName="Claude"
        timestamp="2025-05-08T12:34:56Z"
      />,
    )
    expect(screen.getByText("Claude")).toBeInTheDocument()
  })

  it("renders default agent name when not provided", () => {
    render(<AgentMessageHeader role="assistant" />)
    expect(screen.getByText("Agent")).toBeInTheDocument()
  })
})

describe("formatTimestamp", () => {
  it("formats ISO timestamp to HH:MM", () => {
    expect(formatTimestamp("2025-05-08T12:34:56Z")).toBe("12:34")
  })
})
```

- [ ] **Step 3: 运行测试验证**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
pnpm test src/modules/agent/components/__tests__/agent-message-header.test.tsx
```

Expected: 3 tests PASS

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/agent/components/agent-message-header.tsx
git add desktop/src/modules/agent/components/__tests__/agent-message-header.test.tsx
git commit -m "feat(agent): add AgentMessageHeader component for message sender display"
```

---

### Task 2: 创建 AgentMessageBubble 组件

**Files:**
- Create: `desktop/src/modules/agent/components/agent-message-bubble.tsx`

**组件设计：**
- 用户消息：右对齐，`bg-muted rounded-2xl`，最大宽度 72%
- AI 消息：左对齐，透明背景无边框，最大宽度 76ch

- [ ] **Step 1: 编写组件代码**

```tsx
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface AgentMessageBubbleProps {
  readonly role: "user" | "assistant"
  readonly children: ReactNode
  readonly className?: string
}

function AgentMessageBubble({
  role,
  children,
  className,
}: AgentMessageBubbleProps) {
  const isUser = role === "user"

  return (
    <div
      className={cn(
        "min-w-0 whitespace-pre-wrap break-words text-sm leading-7",
        isUser
          ? "max-w-[72%] rounded-2xl bg-muted px-5 py-3 text-foreground"
          : "max-w-[76ch] px-1 py-2 text-foreground",
        className,
      )}
    >
      {children}
    </div>
  )
}

export { AgentMessageBubble }
export type { AgentMessageBubbleProps }
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/agent/components/agent-message-bubble.tsx
git commit -m "feat(agent): add AgentMessageBubble component for consistent message styling"
```

---

### Task 3: 创建 AgentAnnotation 组件

**Files:**
- Create: `desktop/src/modules/agent/components/agent-annotation.tsx`

**组件设计：**
- 作为 AI 消息气泡下方的附属区域容器
- 左侧带竖线装饰 `border-l-2 border-muted`
- 用于包裹 Thinking 和 Tool Calls

- [ ] **Step 1: 编写组件代码**

```tsx
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface AgentAnnotationProps {
  readonly children: ReactNode
  readonly className?: string
}

function AgentAnnotation({ children, className }: AgentAnnotationProps) {
  return (
    <div
      className={cn(
        "ml-1 border-l-2 border-muted pl-3",
        className,
      )}
    >
      {children}
    </div>
  )
}

export { AgentAnnotation }
export type { AgentAnnotationProps }
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/agent/components/agent-annotation.tsx
git commit -m "feat(agent): add AgentAnnotation component for message attachments"
```

---

### Task 4: 重写 AgentMessageEvent 组件

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-message-event.tsx`
- Test: `desktop/src/modules/agent/components/__tests__/agent-message-row.test.tsx` (已有，需要更新)

**变更要点：**
- 添加 `profile` prop 用于获取 Agent 名称
- 整合 Header + Bubble 布局
- 保持现有的本地引用链接处理逻辑

- [ ] **Step 1: 更新组件代码**

```tsx
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentMessageTimelineItem,
} from "@/types/agent"
import { AgentMessageHeader } from "./agent-message-header"
import { AgentMessageBubble } from "./agent-message-bubble"

type MessageSegment =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "reference"; readonly value: string }

const LOCAL_REFERENCE_PATTERN = /(\[[^\]]+\]\((?:file:\/\/|\.{1,2}\/\/|\/|[\w.-]+\/)[^)]+\)|(?:file:\/\/|\.{1,2}\/\/|\/|[\w.-]+\/)[^\s`),]+(?::\d+(?::\d+)?)?)/g

interface AgentMessageEventProps {
  readonly item: SynapseAgentMessageTimelineItem
  readonly profile: SynapseAgentDisplayProfile
  readonly onOpenReference: (reference: string) => void
}

function AgentMessageEvent({
  item,
  profile,
  onOpenReference,
}: AgentMessageEventProps) {
  const outgoing = item.role === "user"
  const segments = splitLocalReferences(item.content)

  return (
    <article
      className={cn("flex min-w-0 flex-col", outgoing ? "items-end" : "items-start")}
      aria-label={outgoing ? "User message" : "Agent message"}
    >
      <AgentMessageHeader
        role={outgoing ? "user" : "assistant"}
        agentName={outgoing ? undefined : profile.agentLabel}
        timestamp={item.timestamp}
      />
      <AgentMessageBubble role={outgoing ? "user" : "assistant"}>
        {segments.map((segment, index) =>
          segment.kind === "text" ? (
            <span key={`${item.id}:text:${String(index)}`}>{segment.value}</span>
          ) : (
            <Button
              key={`${item.id}:ref:${String(index)}`}
              type="button"
              variant="link"
              size="sm"
              className={cn(
                "h-auto min-w-0 max-w-full whitespace-normal break-all px-1 py-0 text-left align-baseline",
                outgoing ? "text-inherit hover:text-inherit" : null,
              )}
              onClick={() => onOpenReference(segment.value)}
            >
              {segment.value}
            </Button>
          ),
        )}
      </AgentMessageBubble>
    </article>
  )
}

function splitLocalReferences(content: string): readonly MessageSegment[] {
  const segments: MessageSegment[] = []
  let lastIndex = 0
  for (const match of content.matchAll(LOCAL_REFERENCE_PATTERN)) {
    const value = match[0]
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ kind: "text", value: content.slice(lastIndex, index) })
    }
    segments.push({ kind: "reference", value })
    lastIndex = index + value.length
  }
  if (lastIndex < content.length) {
    segments.push({ kind: "text", value: content.slice(lastIndex) })
  }
  return segments.length > 0 ? segments : [{ kind: "text", value: content }]
}

export { AgentMessageEvent, splitLocalReferences }
export type { AgentMessageEventProps }
```

- [ ] **Step 2: 检查并更新现有测试**

测试文件已存在：`agent-message-row.test.tsx`，运行测试查看是否需要更新：

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
pnpm test src/modules/agent/components/__tests__/agent-message-row.test.tsx
```

如果测试失败，需要更新测试以传入新的 `profile` prop：

```tsx
const mockProfile = {
  agentLabel: "Claude",
  thinkingDefaultCollapsed: true,
  toolDefaultCollapsed: "auto" as const,
  toolPreviewLines: 6,
  toolPreviewChars: 1200,
  statusLabels: {
    pending: "Pending",
    running: "Running",
    success: "Done",
    error: "Failed",
    denied: "Denied",
  },
}

// 在 render 时传入 profile
render(<AgentMessageEvent item={mockItem} profile={mockProfile} onOpenReference={mockOnOpenReference} />)
```

- [ ] **Step 3: 运行测试验证**

```bash
pnpm test src/modules/agent/components/__tests__/agent-message-row.test.tsx
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/agent/components/agent-message-event.tsx
git add desktop/src/modules/agent/components/__tests__/agent-message-row.test.tsx
git commit -m "feat(agent): rewrite AgentMessageEvent with header and bubble layout"
```

---

### Task 5: 修改 AgentTimelineItem 传递 profile

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-timeline-item.tsx`

**变更要点：**
- 在 `kind: "message"`  case 中传递 `profile` prop

- [ ] **Step 1: 修改代码**

```tsx
import { AlertCircle } from "lucide-react"
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPendingPermission,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { AgentMessageEvent } from "./agent-message-event"
import { AgentPermissionCard } from "./agent-permission-card"
import { AgentThinkingEvent } from "./agent-thinking-event"
import { AgentToolEvent } from "./agent-tool-event"

interface AgentTimelineItemProps {
  readonly item: SynapseAgentTimelineItem
  readonly profile: SynapseAgentDisplayProfile
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly onOpenReference: (reference: string) => void
  readonly onRespondPermission: (requestId: string, behavior: "allow" | "deny") => void
}

function AgentTimelineItem({
  item,
  profile,
  pendingPermissions,
  onOpenReference,
  onRespondPermission,
}: AgentTimelineItemProps) {
  switch (item.kind) {
    case "message":
      return (
        <AgentMessageEvent
          item={item}
          profile={profile}
          onOpenReference={onOpenReference}
        />
      )
    case "thinking":
      return <AgentThinkingEvent item={item} profile={profile} />
    case "toolCall":
    case "toolResult":
      return <AgentToolEvent item={item} profile={profile} />
    case "permissionRequest": {
      const isPending = pendingPermissions.some((p) => p.requestId === item.requestId)
      return (
        <AgentPermissionCard
          item={item}
          pending={isPending}
          onRespond={onRespondPermission}
        />
      )
    }
    case "error":
      return (
        <Alert variant="destructive">
          <AlertCircle data-icon="inline-start" />
          <AlertDescription>{item.message}</AlertDescription>
        </Alert>
      )
    case "result":
      return null
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}

export { AgentTimelineItem }
export type { AgentTimelineItemProps }
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/agent/components/agent-timeline-item.tsx
git commit -m "feat(agent): pass profile prop to AgentMessageEvent"
```

---

### Task 6: 改进 AgentThinkingEvent 样式

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-thinking-event.tsx`

**变更要点：**
- 改进折叠按钮样式，更紧凑
- 添加中文文案"思考过程"
- 左侧对齐到 Annotation 区域

- [ ] **Step 1: 修改代码**

```tsx
import { ChevronDown, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentThinkingTimelineItem,
} from "@/types/agent"
import { AgentAnnotation } from "./agent-annotation"

interface AgentThinkingEventProps {
  readonly item: SynapseAgentThinkingTimelineItem
  readonly profile: SynapseAgentDisplayProfile
}

function AgentThinkingEvent({
  item,
  profile,
}: AgentThinkingEventProps) {
  return (
    <AgentAnnotation>
      <Collapsible defaultOpen={!profile.thinkingDefaultCollapsed}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="group/agent-event-trigger h-7 justify-start gap-1.5 px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
          >
            <Sparkles className="size-3.5" />
            <span>思考过程</span>
            <ChevronDown
              data-icon="inline-end"
              className="size-3.5 transition-transform group-data-[state=closed]/agent-event-trigger:-rotate-90"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="whitespace-pre-wrap break-words pb-2 pt-1 text-sm leading-6 text-muted-foreground">
            {item.content}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </AgentAnnotation>
  )
}

export { AgentThinkingEvent }
export type { AgentThinkingEventProps }
```

- [ ] **Step 2: 检查并更新测试**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
pnpm test src/modules/agent/components/__tests__/agent-thinking-event.test.tsx 2>/dev/null || echo "No existing test"
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/agent/components/agent-thinking-event.tsx
git commit -m "feat(agent): improve AgentThinkingEvent styling with Chinese label"
```

---

### Task 7: 改进 AgentToolEvent 样式

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-tool-event.tsx`

**变更要点：**
- 改进折叠按钮样式
- 使用 AgentAnnotation 包裹
- 改进状态标签视觉
- 复制按钮移到更合理位置

- [ ] **Step 1: 修改代码**

```tsx
import { ChevronDown, Clipboard, Terminal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPermissionRequestTimelineItem,
  SynapseAgentToolCallTimelineItem,
  SynapseAgentToolResultTimelineItem,
} from "@/types/agent"
import { AgentAnnotation } from "./agent-annotation"

type AgentToolEventItem =
  | SynapseAgentToolCallTimelineItem
  | SynapseAgentToolResultTimelineItem
  | SynapseAgentPermissionRequestTimelineItem

interface AgentToolEventProps {
  readonly item: AgentToolEventItem
  readonly profile: SynapseAgentDisplayProfile
}

function AgentToolEvent({
  item,
  profile,
}: AgentToolEventProps) {
  const rule = profile.tools?.[item.toolName]
  const label = rule?.label ?? profile.aliases?.[item.toolName] ?? item.toolName
  const body = toolBody(item)
  const failed = item.kind === "toolResult" && item.success === false
  const permission = item.kind === "permissionRequest"
  const defaultOpen = permission || failed || shouldDefaultOpen(
    body,
    rule?.defaultCollapsed ?? profile.toolDefaultCollapsed,
  )
  const status = item.kind === "toolCall" ? null : statusLabel(item, profile)
  const statusVariant = failed ? "destructive" : "secondary"

  return (
    <AgentAnnotation>
      <Collapsible defaultOpen={defaultOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="group/agent-event-trigger h-7 w-full justify-start gap-1.5 px-0 py-0 text-xs"
          >
            <Terminal className="size-3.5 text-muted-foreground" />
            <span className="truncate text-muted-foreground">{label}</span>
            {status ? (
              <Badge variant={statusVariant} className="ml-1 h-5 shrink-0 px-1.5 text-[10px]">
                {status}
              </Badge>
            ) : null}
            <ChevronDown
              data-icon="inline-end"
              className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]/agent-event-trigger:-rotate-90"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-2 pb-2 pt-1">
            {body ? (
              <div className="relative">
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-xs leading-5 font-mono">
                  {previewText(body, rule?.previewChars ?? profile.toolPreviewChars)}
                </pre>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 size-6 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                  onClick={() => void navigator.clipboard.writeText(body)}
                >
                  <Clipboard className="size-3" />
                </Button>
              </div>
            ) : null}
            {item.kind === "toolResult" && typeof item.exitCode === "number" ? (
              <span className="text-xs text-muted-foreground">exit {item.exitCode}</span>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </AgentAnnotation>
  )
}

function toolBody(item: AgentToolEventItem): string {
  if (item.kind === "toolResult") return item.content ?? ""
  return item.toolInput ?? formatRawInput(item.toolInputRaw)
}

function formatRawInput(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(value, null, 2) : ""
}

function statusLabel(item: AgentToolEventItem, profile: SynapseAgentDisplayProfile): string {
  if (item.kind === "permissionRequest") return profile.statusLabels.pending
  if (item.kind === "toolCall") return profile.statusLabels.running
  if (item.success === false) return profile.statusLabels.error
  return profile.statusLabels.success
}

function shouldDefaultOpen(body: string, mode: "expanded" | "collapsed" | "auto"): boolean {
  if (mode === "expanded") return true
  if (mode === "collapsed") return false
  return body.trim().length > 0 && body.length <= 400
}

function previewText(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit).trimEnd()}\n...`
}

export { AgentToolEvent }
export type { AgentToolEventProps }
```

- [ ] **Step 2: 运行测试验证**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
pnpm test src/modules/agent/components/__tests__/agent-tool-event.test.tsx
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/agent/components/agent-tool-event.tsx
git commit -m "feat(agent): improve AgentToolEvent styling with annotation wrapper"
```

---

### Task 8: 调整 AgentTimeline 消息间距

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-timeline.tsx`

**变更要点：**
- 增加消息之间的间距 `gap-6`
- 调整内边距

- [ ] **Step 1: 修改代码**

```tsx
import type { RefObject } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPendingPermission,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { AgentRunStatus } from "./agent-run-status"
import { AgentTimelineItem } from "./agent-timeline-item"

interface AgentTimelineProps {
  readonly items: readonly SynapseAgentTimelineItem[]
  readonly profile: SynapseAgentDisplayProfile
  readonly sending: boolean
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly onOpenReference: (reference: string) => void
  readonly onRespondPermission: (requestId: string, behavior: "allow" | "deny") => void
  readonly bottomRef: RefObject<HTMLDivElement | null>
}

function AgentTimeline({
  items,
  profile,
  sending,
  pendingPermissions,
  onOpenReference,
  onRespondPermission,
  bottomRef,
}: AgentTimelineProps) {
  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1">
      <div className="mx-auto flex min-w-0 max-w-4xl flex-col gap-6 px-4 pb-24 pt-4">
        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">暂无消息</p>
        ) : (
          items.map((item) => (
            <AgentTimelineItem
              key={item.id}
              item={item}
              profile={profile}
              pendingPermissions={pendingPermissions}
              onOpenReference={onOpenReference}
              onRespondPermission={onRespondPermission}
            />
          ))
        )}
        {sending ? <AgentRunStatus label={`${profile.agentLabel} 正在处理`} /> : null}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </ScrollArea>
  )
}

export { AgentTimeline }
export type { AgentTimelineProps }
```

- [ ] **Step 2: 运行测试验证**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
pnpm test src/modules/agent/components/__tests__/agent-timeline.test.tsx
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/agent/components/agent-timeline.tsx
git commit -m "feat(agent): adjust AgentTimeline spacing for new message layout"
```

---

## 验证步骤

所有任务完成后，进行以下验证：

- [ ] **TypeScript 编译检查**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
pnpm typecheck
```

Expected: No errors

- [ ] **完整测试套件**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
pnpm test src/modules/agent/
```

Expected: All tests PASS

- [ ] **视觉验证**

```bash
pnpm dev
```

打开桌面应用，检查：
1. 用户消息右对齐，有灰色气泡和头像
2. AI 消息左对齐，有 Agent 头像和名称
3. 时间戳显示正确
4. Thinking 可折叠，样式正确
5. Tool Calls 可折叠，有状态标签
6. 整体间距舒适，无视觉冲突

---

## Spec 覆盖检查

| Spec 要求 | 实现任务 | 状态 |
|----------|---------|------|
| 用户消息右对齐灰色气泡 | Task 2, Task 4 | ✅ |
| AI 消息左对齐带头部 | Task 1, Task 4 | ✅ |
| 头像/名称/时间戳 | Task 1, Task 4 | ✅ |
| Thinking 作为附属区域 | Task 3, Task 6 | ✅ |
| Tool Calls 作为附属区域 | Task 3, Task 7 | ✅ |
| 左侧竖线装饰 | Task 3 | ✅ |
| 中文文案 | Task 6 | ✅ |
| 状态标签视觉 | Task 7 | ✅ |
| 消息间距调整 | Task 8 | ✅ |

---

## 计划自评

**Placeholder 扫描：**
- ✅ 无 "TBD"/"TODO"
- ✅ 所有步骤包含具体代码
- ✅ 所有测试包含具体断言

**类型一致性：**
- ✅ `AgentMessageEventProps` 使用 `SynapseAgentDisplayProfile`
- ✅ 时间戳使用 `string` 类型（与类型定义一致）
- ✅ 组件命名统一使用 `Agent` 前缀

**Spec 对齐：**
- ✅ 间距值与 spec 一致（`gap-6`, `px-5 py-3`）
- ✅ 颜色 token 与 spec 一致
- ✅ 气泡圆角与 spec 一致
