# Agent 顶栏重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重设计 Agent 对话模块顶栏，会话名称升级为主标题，模型信息降级为静音文本，权限提示升级为 Button + 图标，复制/命令改为 ghost icon 按钮。

**Architecture:** 仅修改 `desktop/src/modules/agent/index.tsx` 顶栏 JSX 区块及其 import 行。不涉及任何 hook、service、或其他组件文件。所有变更均在现有 shadcn/Radix 组件体系内完成。

**Tech Stack:** React, TypeScript, shadcn/ui (Radix), lucide-react, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-05-11-agent-header-redesign.md`

---

### Task 1: 更新 import 语句

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx:1-36`

- [ ] **Step 1: 更新 lucide-react import，加入 `ShieldAlert`**

将文件第 2 行从：
```tsx
import { Clock, Command as CommandIcon, Copy } from "lucide-react"
```
改为：
```tsx
import { Clock, Command as CommandIcon, Copy, ShieldAlert } from "lucide-react"
```

- [ ] **Step 2: 添加 Tooltip 组件 import**

在第 10 行 `import { Button } from "@/components/ui/button"` 之后插入：
```tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
```

- [ ] **Step 3: 将 `sessionLabel` 加入 utils import**

将文件中：
```tsx
import {
  agentCliLabel,
  formatAgentTranscript,
} from "./utils"
```
改为：
```tsx
import {
  agentCliLabel,
  formatAgentTranscript,
  sessionLabel,
} from "./utils"
```

- [ ] **Step 4: TypeScript 编译检查**

```bash
pnpm --filter @synapse/desktop run typecheck
```

预期：无新增错误（此时 `sessionLabel` / `ShieldAlert` / Tooltip 导入正确，但尚未在 JSX 中使用，可能有 unused import 警告，属正常中间态）

---

### Task 2: 重写顶栏 JSX

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx:227-287`

- [ ] **Step 1: 定位并替换顶栏 JSX 块**

找到以下现有代码块（约 L227–L287）：

```tsx
<div className="flex items-center justify-between gap-2 px-0 py-0">
  <div className="flex min-w-0 items-center gap-2">
    <h2 className="truncate text-sm font-medium">Agent</h2>
    {selectedCliLabel ? (
      <Badge variant="outline" className="flex items-center gap-1">
        {selectedCliLabel}
        {selectedSession?.platform === "scheduled" && (
          <Clock className="size-3 text-muted-foreground" />
        )}
      </Badge>
    ) : null}
  </div>
  <div className="flex shrink-0 items-center gap-2">
    {activeProvider ? (
      <Badge variant="secondary">{activeProvider.id}</Badge>
    ) : null}
    {chat.providers?.activeModel ? (
      <Badge variant="outline">{chat.providers.activeModel}</Badge>
    ) : null}
    {chat.pendingPermissions.length > 0 ? (
      <Badge variant="outline">权限 {chat.pendingPermissions.length}</Badge>
    ) : null}
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!chat.activeProjectId || chat.timeline.length === 0}
      onClick={() => void handleCopyTranscript()}
    >
      <Copy data-icon="inline-start" />
      复制
    </Button>
    <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <CommandIcon data-icon="inline-start" />
          命令
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-0">
        <Command>
          <CommandInput placeholder="搜索命令" />
          <CommandList>
            <CommandEmpty>无命令</CommandEmpty>
            <CommandGroup>
              {(selectedAgentDefinition?.commands ?? []).map((command) => (
                <CommandItem
                  key={command.name}
                  value={`/${command.name}`}
                  onSelect={() => handleCommandSelect(command.name)}
                >
                  <span className="truncate">/{command.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  </div>
</div>
```

替换为：

```tsx
<TooltipProvider>
  <div className="flex items-center justify-between gap-2 px-0 py-0">
    {/* 左区：agent 类型 badge + 会话名称 */}
    <div className="flex min-w-0 items-center gap-2">
      {selectedCliLabel ? (
        <Badge variant="secondary" className="flex shrink-0 items-center gap-1">
          {selectedCliLabel}
          {selectedSession?.platform === "scheduled" && (
            <Clock className="size-3 text-muted-foreground" />
          )}
        </Badge>
      ) : null}
      <h2 className="truncate text-sm font-medium">
        {selectedSession ? sessionLabel(selectedSession) : "Agent"}
      </h2>
    </div>

    {/* 右区：模型信息 · 权限 · 复制 · 命令 */}
    <div className="flex shrink-0 items-center gap-2">
      {chat.providers?.activeModel ? (
        <span className="text-xs text-muted-foreground">
          {chat.providers.activeModel}
          {activeProvider ? ` · ${activeProvider.id}` : ""}
        </span>
      ) : null}

      {chat.pendingPermissions.length > 0 ? (
        <Button type="button" variant="outline" size="sm">
          <ShieldAlert data-icon="inline-start" />
          权限 {chat.pendingPermissions.length}
        </Button>
      ) : null}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={!chat.activeProjectId || chat.timeline.length === 0}
            onClick={() => void handleCopyTranscript()}
          >
            <Copy />
          </Button>
        </TooltipTrigger>
        <TooltipContent>复制对话</TooltipContent>
      </Tooltip>

      <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="icon">
                <CommandIcon />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>命令</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-40 p-0">
          <Command>
            <CommandInput placeholder="搜索命令" />
            <CommandList>
              <CommandEmpty>无命令</CommandEmpty>
              <CommandGroup>
                {(selectedAgentDefinition?.commands ?? []).map((command) => (
                  <CommandItem
                    key={command.name}
                    value={`/${command.name}`}
                    onSelect={() => handleCommandSelect(command.name)}
                  >
                    <span className="truncate">/{command.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  </div>
</TooltipProvider>
```

- [ ] **Step 2: TypeScript 编译检查**

```bash
pnpm --filter @synapse/desktop run typecheck
```

预期：无错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/agent/index.tsx
git commit -m "feat(agent): 重设计顶栏 — 会话名升主标题，模型降级静音文本，权限/复制/命令改 icon 按钮"
```

---

## 验收清单

实现完成后对照 spec 逐条确认：

- [ ] 有 session 时，左区主标题显示 `sessionLabel(selectedSession)` 的值
- [ ] 无 session 时，左区显示 "Agent" 作为 fallback
- [ ] agent 类型 badge 使用 `variant="secondary"`，scheduled 时 Badge 内有 Clock 图标
- [ ] model + provider 显示为 `text-xs text-muted-foreground` 纯文本，格式 `{model} · {provider}`
- [ ] `pendingPermissions.length === 0` 时，权限按钮不渲染
- [ ] `pendingPermissions.length > 0` 时，权限按钮使用 `Button variant="outline"` + `ShieldAlert` 图标
- [ ] 复制按钮为 `variant="ghost" size="icon"`，hover 显示 Tooltip "复制对话"
- [ ] 命令按钮为 `variant="ghost" size="icon"`，hover 显示 Tooltip "命令"，点击打开命令面板
