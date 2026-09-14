# 侧栏分组拖拽排序设计

## 背景

终端 System App 左侧的分组，以及 Agent（对话）侧栏按项目划分的分组，此前都只能按创建/配置顺序展示，用户无法调整。本设计覆盖两侧栏的分组拖拽排序与顺序记忆。

## 交互

- 拖拽面是分组标题行（文件夹图标 + 名称 + 行内空白）。指针移动超过 6px 才进入拖拽，轻点仍然展开/折叠；拖拽激活后 `@dnd-kit` 会拦截随后的 click，因此不需要额外的折叠守卫。
- 分组「⋯」菜单提供「上移 / 下移」（首尾项禁用），覆盖键盘与不便拖拽的场景。
- 不启用 KeyboardSensor（否则会与折叠触发器的 Space/Enter 冲突），不使用 DragOverlay。
- 固定项：终端合成的「会话」（未归组）行固定在末尾且不参与排序；Agent 侧栏的「本地对话」固定首位、「已归档」固定末位。

## 排序组件

复用仓库已有依赖 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`（Settings 的 Dock 排序已在用同一套），不新增依赖：

- `desktop/src/components/module-sidebar-sortable.tsx` 提供 `ModuleSidebarSortableList`（DndContext + SortableContext + PointerSensor 距离约束，回调新顺序）与 `ModuleSidebarSortableGroup`（`useSortable` 包装 `ModuleSidebarGroup`，transform/transition 为动态内联值）。
- `ModuleSidebarGroup` 增加可选 `triggerProps`，把排序属性透传到折叠触发器；不传该属性的调用方行为不变。

## 终端分组顺序

- 新增 UI 私有 invocation `app.terminal.group.reorder`（方法 `reorderGroups`）：请求 `{ groupIds }` 必须是当前全部分组 id 的一次完整排列，缺 id、重复 id、未知 id 或空数组一律报错且不改动任何数据；响应是按新顺序返回的分组摘要列表。
- 服务端只在顺序确实变化时按 index 重写 `sortOrder`，更新 `updatedAt` 并递增 `groupRevision`，发出 `group.reordered` 领域事件后落盘；顺序未变时不写盘、不发事件。
- 渲染层先做乐观更新，调用失败时提示「调整分组顺序失败」并重新拉取列表回滚；重排请求进行中禁用拖拽与上移/下移。
- 该能力属于 UI 私有 IPC，不注册 MCP capability / tool / Workflow Node / Deep Link；`createGroup` 的 `sortOrder: groups.size` 追加语义不变，新分组仍排在末尾。

## Agent 项目分组顺序

- 全局配置新增 `global.agentProjectOrder`，只用于侧栏展示顺序：`orderAgentProjects` 先按该偏好排列，再把未记录的项目按 `config.global.projects` 顺序追加；`normalizeAgentProjectOrder` 负责去重、丢弃非法值与已不存在的项目 id。
- 不重排 `config.global.projects` 本身，因为多处把 `projects[0]` 当作默认项目，重排会改变 Workflow、Prompt、Automation 等模块的默认项目与下拉顺序。
- 渲染层使用乐观顺序，落库失败时回滚并通知；「本地对话」与「已归档」不参与排序。

## 非目标

- 不做跨分组的会话/命令移动，不做分组内命令排序。
- 不为分组排序新增 MCP capability、tool、Workflow Node 或 Deep Link。
- 不引入 DragOverlay、拖拽手柄或新的视觉层级。
