# Agent 对话顶栏重设计

**日期：** 2026-05-11  
**状态：** 待实现  
**范围：** `desktop/src/modules/agent/index.tsx` 顶栏区域

---

## 1. 背景与问题

当前顶栏所有元素视觉权重相同，缺乏主次层级：

```
Agent  [claudecode]  [anthropic]  [claude-opus]  [权限1]  [复制]  [⌘命令]
```

- "Agent" 标题无信息量，不反映当前会话上下文
- Provider + Model 两个 Badge 常驻，视觉噪音高但使用频率低
- 权限紧急提示与普通 Badge 样式相同，无法凸显优先级
- 复制 / 命令常驻文字按钮占位较宽，但属低频操作

---

## 2. 目标设计

### 2.1 整体布局

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [cc]  会话名称（截断）       claude-opus · anthropic  [⚠ 权限 1]  [□]  [⌘] │
└─────────────────────────────────────────────────────────────────────────┘
  ← 左区：身份 + 会话上下文 →     ← 右区：模型信息 · 状态 · 操作 →
```

### 2.2 左区

| 元素 | 组件 | 逻辑 |
|---|---|---|
| Agent 类型 Badge | `Badge variant="secondary"` | `agentCliLabel(selectedSession?.agentType)` 非空时显示；scheduled 时在 Badge 内附 `Clock` 图标 |
| 会话名称 | `text-sm font-medium truncate` | `sessionLabel(selectedSession)` 有 session 时；无 session 时 fallback 为 `"Agent"` |

### 2.3 右区（从左到右）

| 元素 | 组件 | 条件 | 说明 |
|---|---|---|---|
| 模型信息 | `text-xs text-muted-foreground` 纯文本 | `chat.providers?.activeModel` 存在时 | 格式：`{activeModel} · {activeProvider.id}`；若无 provider 则仅显示 model |
| 权限按钮 | `Button variant="outline" size="sm"` + `ShieldAlert` 图标 | `pendingPermissions.length > 0` 时出现，否则不渲染 | 文本：`权限 {count}`；图标在文字前；本次迭代无 onClick（纯状态指示器，后续可扩展为滚动到权限请求） |
| 复制 | `Button variant="ghost" size="icon"` + `Copy` 图标 + `Tooltip` | 始终可见 | tooltip 文本：`"复制对话"`；disabled 逻辑与现在相同 |
| 命令 | `Button variant="ghost" size="icon"` + `Command` 图标 + `Tooltip` | 始终可见 | tooltip 文本：`"命令"`；触发现有 `paletteOpen` popover |

### 2.4 空态与边界

```
无 session 选中：
  Agent                                                       [□]  [⌘]
  （无 Badge，无模型信息，复制 disabled）

有 session，无 pending 权限：
  [cc]  会话名称               claude-opus · anthropic        [□]  [⌘]

有 session，有 pending 权限：
  [cc]  会话名称               claude-opus · anthropic  [⚠ 1]  [□]  [⌘]

scheduled session：
  [cc 🕐]  会话名称            ...
  （Clock 图标保留在 Badge 内，现行逻辑不变）

无 activeModel：
  [cc]  会话名称                                              [□]  [⌘]
  （右侧模型文本区完全不渲染）
```

---

## 3. 变更对照

| 元素 | 现状 | 新设计 |
|---|---|---|
| 模块标题 | `"Agent"` 静态文本（始终显示） | 无 session 时 fallback `"Agent"`，有 session 时显示会话名 |
| Agent 类型 | `Badge variant="outline"` | `Badge variant="secondary"`（视觉降级，辅助角色） |
| Provider | `Badge variant="secondary"` 常驻 | 合并入静音纯文本，无边框 |
| Model | `Badge variant="outline"` 常驻 | 与 provider 合并为一行静音文本 |
| 权限提示 | `Badge variant="outline"` 同级 | `Button variant="outline"` + `ShieldAlert` 图标，条件渲染 |
| 复制按钮 | `Button variant="outline" size="sm"` + 文字 | `Button variant="ghost" size="icon"` + Tooltip |
| 命令按钮 | `Button variant="outline" size="sm"` + 文字 | `Button variant="ghost" size="icon"` + Tooltip |

---

## 4. 组件依赖

- 现有：`Badge`, `Button`, `Popover` / `Command` 系列（命令面板）
- 新增：`Tooltip`, `TooltipProvider`, `TooltipTrigger`, `TooltipContent`（来自 `@/components/ui/tooltip`，文件已存在）
- 新增图标：`ShieldAlert`（来自 lucide-react，已作为依赖存在）
- 复用函数：`sessionLabel()`、`agentCliLabel()`（已在 `utils.ts` 导出）

---

## 5. 实现范围

- **文件：** `desktop/src/modules/agent/index.tsx`，顶栏 JSX 区块（约 L227–L287）
- **不改动：** 命令面板逻辑、`handleCopyTranscript`、任何 hook / service 层
- **已确认：** `Tooltip` 组件已存在于 `desktop/src/components/ui/tooltip.tsx`；`ShieldAlert` 图标来自 lucide-react（已是项目依赖）

---

## 6. 成功标准

1. 有 session 时，顶栏主标题显示会话名称
2. Model + Provider 信息降级为无边框静音文本
3. `pendingPermissions.length === 0` 时，权限按钮完全不渲染
4. `pendingPermissions.length > 0` 时，权限按钮使用 `Button` + `ShieldAlert` 显示
5. 复制 / 命令改为 ghost icon 按钮，Tooltip 可见
6. 无 session 时保持 "Agent" fallback，界面不崩溃

## 7. 实时上下文占用补充（2026-08-25）

模型信息与待回答/权限状态之间增加当前主线程上下文指示器。完整宽度显示 token、窗口、百分比和短进度条；窄宽度只保留“上下文 + 百分比 + 进度条”。无可靠窗口时只显示已用 token，无快照时不渲染。该指标由 SDK 实时事件驱动，自动压缩后允许下降；详细口径见 `2026-08-25-agent-context-usage-header-design.md`。
