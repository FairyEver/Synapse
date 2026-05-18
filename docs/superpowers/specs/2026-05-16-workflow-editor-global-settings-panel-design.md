# 工作流编辑器：全局设置面板

> 日期: 2026-05-16
> 状态: 设计完成，待实现

## 背景

工作流编辑器顶栏（`WorkflowToolbar`）承载了名称、描述、默认项目、参数编辑、保存和运行按钮，信息密度高且浪费纵向空间。右侧面板在未选中节点时只显示一行占位文字，利用率低。

## 目标

- 删除顶栏，将全局信息移入右侧面板的"无选中节点"状态
- 保存/运行按钮改为画布内浮动工具条
- 减少界面层级，最大化画布可用面积

## 整体布局

### 现状

```
┌─ toolbar (name / desc / project / [params] [save] [run]) ─────────┐
├─ palette ─┬─ canvas ─────────────────┬─ node-config-panel ────────┤
│           │                          │  (节点配置 / 空提示)       │
└───────────┴──────────────────────────┴────────────────────────────┘
```

### 改后

```
┌─ 窗口拖拽条 (h-8, 纯空白) ───────────────────────────────────────┐
├─ palette ─┬─ canvas ─────────────────┬─ right panel ──────────────┤
│           │   ┌──────────────┐       │  selectedNode ?            │
│           │   │ [save] [run] │       │    → 节点配置              │
│           │   └─ 浮动工具条 ──┘       │    → 全局设置              │
│           │                          │      (name/desc/project/   │
│           │                          │       params)              │
└───────────┴──────────────────────────┴────────────────────────────┘
```

## 浮动工具条

- **新文件**: `desktop/src/modules/workflow/editor/canvas-floating-toolbar.tsx`
- **位置**: 画布区域内部，绝对定位 `top-3 left-1/2 -translate-x-1/2`，z-index 高于画布节点
- **内容**（从左到右）:
  - 保存按钮 — Save 图标 + "保存"，dirty 时右上角小圆点，saving 时 spinner
  - 运行按钮 — Play 图标 + "运行"，有参数时弹 `RunParamsDialog`，无参数直接运行，running 时 spinner
- **样式**: `bg-background/80 backdrop-blur-sm border rounded-lg shadow-sm px-2 py-1.5 gap-1.5`
- **交互**:
  - saving 或 running 时两按钮均 disabled
  - `Cmd+S` 快捷键不变（`editor-app.tsx` 全局监听）
  - `RunParamsDialog` 由浮动工具条内部状态控制

## 全局设置面板

- **位置**: `node-config-panel.tsx` 内部，`selectedNodeId === null` 分支
- **布局**（扁平列表，从上到下）:
  1. 面板标题栏 — "工作流设置"，`border-b px-3 py-2.5`，与节点配置标题栏风格一致
  2. 名称 — Label + Input，绑定 `definition.name`
  3. 描述 — Label + Textarea（多行），绑定 `definition.description`，placeholder "添加描述"
  4. 默认项目 — Label + Select，绑定 `definition.defaultProjectId`，含"无默认项目"选项
  5. 分隔线
  6. 参数定义 — Label "工作流参数" + 参数摘要 + "编辑参数"按钮，点击打开 `ParamsEditorDialog`

## 面板切换机制

自动切换，与现有行为一致:
- 选中节点 → 右侧显示节点配置
- 取消选中（点画布空白 / 按 Esc）→ 右侧显示全局设置
- 无需 Tab 或手动切换

## 窗口拖拽区

删除顶栏后需保留窗口拖拽能力。在窗口最顶部添加一条窄的拖拽条（`h-8`，`-webkit-app-region: drag`），纯空白无内容。

## 改动清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `editor/toolbar.tsx` | 删除 | 整个组件移除 |
| `editor/editor-app.tsx` | 改 | 移除 `WorkflowToolbar`；添加拖拽条；将 `onChange` 传给面板；画布区域内放浮动工具条 |
| `editor/canvas-floating-toolbar.tsx` | 新增 | 浮动工具条：保存 + 运行 + RunParamsDialog |
| `editor/node-config-panel.tsx` | 改 | 空状态替换为全局设置表单；新增 `onChange` prop |

## 不变项

- `canvas.tsx` 无改动
- `ParamsEditorDialog` / `RunParamsDialog` 复用不改
- `WorkflowDefinition` 类型不变
- 保存/运行业务逻辑不变，仅触发入口迁移
- `Cmd+S` 快捷键不变
