# Skill 详情面板：新增「使用说明」字段

## 概述

为 Skill 新增 `usage` 字段（纯文本），用于向安装者展示使用方法。该字段仅在 Synapse UI 中显示，不会安装到编辑器。同时调整详情模态框的布局结构。

## 数据层

- 在 `SynapseContentSnapshotRecord` 类型中新增可选字段 `usage?: string`
- 存储层（Git snapshot）中对应新增该字段
- 编辑/创建时可留空

## 详情模态框 - 查看态

### 头部区域

- 第一行：标题（不变）
- 第二行：显示 `usage`（使用说明），替代原来显示 description 的位置
- 空值处理：`usage` 为空时，显示灰色占位文字"暂无使用说明"

### 正文滚动区（三段式）

1. **Description 区块**
   - 浅灰背景（`bg-muted` 或等效 token）
   - 左上角小标签文字 "description"（英文，`text-muted-foreground`，11px/12px）
   - 下方显示 description 正文内容
   - 圆角容器，与下方内容有间距

2. **Markdown 正文**
   - 保持现有的 MarkdownViewer 渲染
   - 白色背景，与现有样式一致

3. **附件列表**
   - 保持现有的附件展示逻辑不变

## 编辑表单

### 字段顺序

标题 → name → 分类 → **使用说明（新）** → 简介(description) → 正文(content) → 附件 → 外观

### 使用说明字段

- 输入类型：纯文本 Textarea（2-3 行高度）
- 字段标签："使用说明"
- Helper text："显示在详情头部，不会安装到编辑器"
- 可选字段，不做必填校验

### 简介(description) 字段

- 保持现有实现不变
- Helper text 保持现有："安装到编辑器时，这段简介会作为 skill 描述一并写入。"

## 涉及文件

- `desktop/src/types/content.ts` — 类型定义新增 `usage`
- `desktop/src/modules/content/components/content-item-meta.tsx` — 头部改为显示 usage
- `desktop/src/modules/skills/components/skill-version-view.tsx` — 正文区新增 description 区块
- `desktop/src/modules/skills/components/skill-create-dialog.tsx` — 编辑表单新增字段
- `desktop/electron/` 相关 service — 确保 usage 字段在读写 snapshot 时被正确处理

## 边界情况

- `usage` 为空：头部显示"暂无使用说明"灰色占位
- `description` 为空：正文区 description 区块不显示（隐藏整个区块）
- 旧数据兼容：已有 skill 没有 `usage` 字段，等同于空值，走空值逻辑
