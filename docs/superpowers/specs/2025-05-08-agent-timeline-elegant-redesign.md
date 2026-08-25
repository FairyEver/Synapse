# Agent Timeline 优雅化重设计

## 目标

改进 Agent 对话界面右侧消息列表的视觉气质，从"山寨感"提升到商用产品水准。参考 ChatGPT 的对话体验，同时妥善处理 Synapse Agent 特有的工具调用、Thinking 过程等技术内容。

## 现状问题

1. **视觉不平衡**：用户消息是灰色圆角气泡，AI 消息却是白底无框，缺乏对称性
2. **身份标识缺失**：没有头像或清晰的 sender 标识
3. **信息层次松散**：消息、工具调用、思考过程之间的层级关系不清晰
4. **细节粗糙**：Thinking 按钮纯英文、工具事件折叠展开样式简陋

## 设计方案：分层双栏布局

### 核心原则

- **对话内容**（用户提问、AI 回复）使用 ChatGPT 式气泡营造对话感
- **执行过程**（工具调用、思考过程）作为 AI 消息的"附属脚注"结构化展示
- 保持技术细节可访问，但默认不干扰对话阅读流

### 消息区域设计

#### 用户消息

```
┌─────────────────────────────────────────────────────────────┐
│                                                    ┌──────┐   │
│                                            用户头像 │  User│   │
│                                                    └──────┘   │
│                                         ┌──────────────────┐  │
│                                         │ 用户消息内容      │  │
│                                         │ 多行文本展示      │  │
│                                         └──────────────────┘  │
│                                               12:34          │
└─────────────────────────────────────────────────────────────┘
```

- **位置**：右对齐
- **气泡**：`bg-muted` 灰色背景，`rounded-2xl` 圆角，`max-w-[72%]` 最大宽度
- **头像**：右上角显示用户头像（默认使用 Lucide `User` 图标）
- **时间戳**：气泡下方右对齐，`text-xs text-muted-foreground`

#### AI 消息

```
┌─────────────────────────────────────────────────────────────┐
│  ┌──────┐                                                   │
│  │ Icon │  Agent Name                                12:34  │
│  └──────┘                                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                                                      │   │
│  │  AI 回复内容，使用标准文本样式                        │   │
│  │                                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ▶ 思考了 2.3 秒 ▼                                          │
│  ─────────────────────────────────────────────────────────  │
│  ▶ Bash: npm install (Done) ▼                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- **位置**：左对齐
- **头部**：Agent 图标 + Agent 名称（如"Claude"、"GPT-4"）+ 时间戳
- **气泡**：白色/透明背景，`max-w-[76ch]`，左边距与头部对齐
- **附属区域**：气泡下方的可折叠区域，容纳 Thinking 和 Tool Calls

### 工具/思考区域设计

#### Thinking（思考过程）

- **收起状态**：单行按钮显示"思考了 X 秒"或"Thinking"，右侧有展开箭头
- **展开状态**：显示思考内容，使用等宽字体，`text-muted-foreground` 颜色
- **视觉区分**：左侧有细微的竖线装饰 `border-l-2 border-muted`

#### Tool Calls（工具调用）

- **收起状态**：显示工具名称 + 状态标签（Running/Done/Failed），右侧有展开箭头
- **展开状态**：
  - 输入参数：代码块样式展示
  - 输出结果：代码块样式展示，支持复制
  - 退出码：小字显示在底部
- **状态颜色**：Running = 蓝色，Done = 灰色，Failed = 红色
- **视觉区分**：与 Thinking 类似的左侧竖线装饰

#### 多个工具调用

当一次回复包含多个工具调用时：
- 默认全部收起，只显示数量概览"使用了 3 个工具"
- 或按时间顺序排列，已完成的显示为绿色勾选，正在运行的显示为转圈动画

### 组件架构调整

#### 文件变更计划

```
desktop/src/modules/agent/components/
├── agent-timeline.tsx           # 修改：调整容器间距
├── agent-timeline-item.tsx      # 修改：新增头部区域渲染
├── agent-message-event.tsx      # 重写：双栏气泡布局
├── agent-message-bubble.tsx     # 新增：可复用的消息气泡组件
├── agent-message-header.tsx     # 新增：头像 + 名称 + 时间戳
├── agent-thinking-event.tsx     # 修改：改进折叠样式
├── agent-tool-event.tsx         # 修改：改进折叠样式和状态展示
└── agent-annotation.tsx         # 新增：气泡下方的附属区域容器
```

#### 数据结构

```typescript
// AgentMessageEvent 组件 Props 扩展
interface AgentMessageEventProps {
  item: SynapseAgentMessageTimelineItem
  profile: SynapseAgentDisplayProfile  // 新增：用于显示 Agent 信息
  onOpenReference: (reference: string) => void
}

// 新增：消息头部 Props
interface AgentMessageHeaderProps {
  role: "user" | "assistant"
  agentName?: string
  agentIcon?: React.ReactNode
  timestamp?: Date
}
```

### 视觉细节规范

#### 间距系统

- **消息间距**：`gap-6`（24px）相邻消息之间
- **气泡内边距**：`p-4`（四边 16px）
- **头部与气泡间距**：`gap-2`（8px）
- **气泡与附属区域间距**：`gap-1`（4px）
- **附属项间距**：`gap-1`（4px）

#### 颜色使用

严格使用 shadcn token：

- 用户气泡：`bg-muted text-foreground`
- AI 气泡：透明背景，`text-foreground`
- 时间戳：`text-muted-foreground`
- 思考内容：`text-muted-foreground`
- 工具成功：`text-muted-foreground`
- 工具失败：`text-destructive`
- 工具运行中：`text-primary`

#### 字体规范

- 消息正文：`text-sm leading-7`
- 代码/工具内容：`text-sm font-mono leading-6`
- 时间戳：`text-xs`
- Agent 名称：`text-sm font-medium`

#### 圆角规范

- 用户气泡：`rounded-2xl`
- AI 气泡：无边框，无圆角（靠左对齐形成自然边界）
- 折叠按钮：`rounded-md`

### 交互设计

#### 消息操作

- **复制**：悬停消息时显示复制按钮（右上角）
- **引用点击**：保持现有行为，引用链接使用 `variant="link"` 按钮样式

#### 折叠展开

- **默认状态**：
  - Thinking：根据 `profile.thinkingDefaultCollapsed` 决定
  - Tool Calls：根据 `profile.toolDefaultCollapsed` 决定
- **动画**：使用 shadcn `Collapsible` 组件的默认动画
- **记忆状态**：不记忆展开状态，每次重新加载按默认规则

#### 滚动行为

- 保持现有自动滚动到底部逻辑
- 新增：滚动到某条消息时，该消息可以有 subtle 的高亮反馈

### 边界情况处理

#### 超长消息

- 用户消息：最大宽度 72%，超出自动换行
- AI 消息：最大宽度 76ch，超出自动换行
- 代码块：水平滚动，最大高度 300px，超出显示滚动条

#### 连续消息

- 同一发送者的连续消息：保持独立气泡，不合并（与 ChatGPT 一致）
- 时间间隔超过 5 分钟：显示时间分割线

#### 空消息

- Thinking 内容为空：显示"思考中..."占位
- Tool 无输出：显示"无输出"占位

### 无障碍考虑

- 消息使用 `<article>` 标签，带 `aria-label` 标识发送者
- 折叠按钮使用 `<button>`，有明确的 `aria-expanded` 状态
- 时间戳使用 `<time>` 标签
- 颜色不是唯一信息载体（状态同时有文字和颜色）

## 实现优先级

1. **P0 - 核心布局**：`agent-message-event.tsx` 重写为双栏布局，添加头部区域
2. **P1 - 组件提取**：创建 `agent-message-bubble.tsx` 和 `agent-message-header.tsx`
3. **P1 - 工具改进**：更新 `agent-tool-event.tsx` 的视觉样式
4. **P2 - 思考改进**：更新 `agent-thinking-event.tsx` 的视觉样式
5. **P2 - 附属区域**：创建 `agent-annotation.tsx` 统一附属区域样式
6. **P3 - 细节优化**：时间分割线、悬停复制按钮、动画微调

## 验收标准

- [ ] 用户消息和 AI 消息视觉上对称且易于区分
- [ ] 每条消息都有清晰的发送者标识（头像/名称）
- [ ] 工具调用和 Thinking 默认不干扰对话阅读
- [ ] 展开工具调用后信息完整且易读
- [ ] 整体视觉风格与 Synapse 其他模块保持一致
- [ ] 响应式布局在常见屏幕尺寸下表现良好
