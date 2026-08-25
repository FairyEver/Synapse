# Agent 对话时间线 UI 优化设计

日期: 2026-05-09
范围: `desktop/src/modules/agent/` 消息时间线区域 + 整体体验

## 目标

优化 Agent 对话界面的消息时间线区域，提升信息层次感、可读性和交互便利性。

## 改动清单

### 1. 用户消息气泡

**移除**:
- 气泡上方的 `AgentMessageHeader`（头像圈 + "You" 文字 + 顶部时间）

**新增**:
- 气泡内部末尾追加 `AgentMessageToolbar`（右对齐，时间 + 复制按钮）
- 复制按钮默认 `opacity-0`，hover 气泡时 `opacity-100`

**保留**:
- 气泡样式 `bg-muted rounded-2xl p-4` 靠右对齐，四边统一 16px 内边距
- 文本可拖选

### 2. Agent 消息

#### 2.1 头部

**改为**: Agent 品牌图标 (PNG, `size-5 rounded`) + 时间
**移除**: "Claude Code" 等文字名称、通用 Bot lucide 图标

实现:
- `AgentMessageHeader` 新增 `agentIcon?: string` prop
- assistant 分支用 `<img src={agentIcon}>` 替换 `<Bot>` 图标
- 移除 `displayName` 渲染

#### 2.2 正文

**改为**: Markdown 渲染 (复用 `renderMarkdown` + `MARKDOWN_BODY_CLASSNAME`)
**移除**: 纯文本 `whitespace-pre-wrap` + 手动 `splitLocalReferences` segment 拆分

实现:
- `AgentMessageBubble` assistant 分支用 `dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}`
- 文件引用链接处理策略：在调用 `renderMarkdown` 之前，用现有 `LOCAL_REFERENCE_PATTERN` 正则将裸路径包装为 Markdown 链接 `[path](path)`，这样 markdown-it 会渲染为 `<a>` 标签；然后在容器 `onClickCapture` 事件委托中拦截这些链接的点击，调用 `onOpenReference`
- 复用 `MARKDOWN_BODY_CLASSNAME`（需从 `markdown-viewer.tsx` export）

#### 2.3 底部工具栏

- 复用 `AgentMessageToolbar`
- `content` prop 传原始 Markdown 源文本（复制源码而非 HTML）
- Agent 消息无 `bg-muted` 背景（当前已满足）

### 3. 特殊块视觉修正

#### 3.1 AgentAnnotation 左侧边框

```diff
- "border-l-2 border-muted ml-1 pl-3"
+ "ml-1 pl-3"
```

#### 3.2 Trigger hover 背景

`AgentThinkingEvent` 和 `AgentToolEvent` 的 CollapsibleTrigger Button:
- 追加 `hover:bg-transparent` 覆盖 ghost 默认 hover 效果

#### 3.3 Trigger 宽度统一

- `AgentThinkingEvent` trigger 添加 `w-full`（与 `AgentToolEvent` 一致）

#### 3.4 字号统一

```diff
// AgentToolEvent <pre>
- "text-xs leading-5"
+ "text-sm leading-6"
```

使思考内容和工具输出视觉重量一致（统一 14px / 24px 行高）。

### 4. 全局复制能力

#### 4.1 文本可选

- `AgentTimeline` ScrollArea 内容 div 添加 `select-text`
- 检查并移除父级可能的 `select-none`

#### 4.2 逐条消息复制

- `AgentMessageToolbar` 提供 copy 按钮
- 用户消息复制 `item.content` 纯文本
- Agent 消息复制原始 Markdown 源文本
- 点击反馈: 图标短暂变为 Check (1.5s)

#### 4.3 代码块复制

- Agent Markdown 容器用 `useRef` + `useEffect` 在 `renderedHtml` 变化后扫描 `<pre>` 元素
- 给每个 `<pre>` 注入绝对定位的 copy 按钮 (`insertAdjacentHTML`)
- 容器 `onClick` 事件委托处理 `.code-copy-btn` 点击，复制对应 `<pre>` 文本
- 按钮样式: `absolute right-2 top-2 opacity-0`, `pre:hover` 时显示

## 新增组件

### `AgentMessageToolbar`

```tsx
type AgentMessageToolbarProps = {
  readonly timestamp?: string
  readonly content: string
  readonly className?: string
}
```

- 渲染: 右对齐 flex 行，`<time>` + Copy `<button>`
- 位于 `desktop/src/modules/agent/components/agent-message-toolbar.tsx`

## 影响的现有文件

| 文件 | 改动类型 |
|------|----------|
| `agent-message-header.tsx` | 修改: assistant 分支用 agentIcon img 替换 Bot 图标, 移除 displayName |
| `agent-message-bubble.tsx` | 修改: assistant 分支用 Markdown 渲染 |
| `agent-message-event.tsx` | 修改: user 不渲染 Header, 两者均加 toolbar, 新增 agentIcon prop |
| `agent-annotation.tsx` | 修改: 移除 border-l-2 |
| `agent-thinking-event.tsx` | 修改: hover:bg-transparent, w-full |
| `agent-tool-event.tsx` | 修改: hover:bg-transparent, text-sm leading-6 |
| `agent-timeline.tsx` | 修改: 添加 select-text |
| `agent-timeline-item.tsx` | 修改: 传递 agentIcon prop |
| `index.tsx` | 修改: 将 agentIcon 传入 timeline |
| `markdown-viewer.tsx` | 修改: export MARKDOWN_BODY_CLASSNAME |

## 不变的部分

- Composer 输入框
- 侧边栏会话管理
- 顶部 Header 布局
- `AgentPermissionCard` 权限卡片
- `AgentRunStatus` 运行状态

## 技术约束

- 使用现有 `markdown-it` + `highlight.js` 栈，不引入新依赖
- `MARKDOWN_BODY_CLASSNAME` 从 `markdown-viewer.tsx` export 复用
- 代码块 copy 按钮通过 DOM 操作注入（因为 Markdown HTML 是字符串渲染）
- Agent icon 来自 `agentDefinitions[].icon`（已是 imported PNG URL）
