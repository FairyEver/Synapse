# 定时任务导入/导出功能设计

## 概述

为定时任务模块增加导入和导出功能，允许用户将任务配置导出为 JSON 文件，或从 JSON 文件导入任务配置。

## 需求

- 在工具栏"新建任务"按钮右侧增加导入、导出两个独立图标按钮
- 导出：模态框中展示任务列表，支持勾选/全选，导出为 JSON 文件
- 导入：选择 JSON 文件后解析，模态框中展示可导入任务（默认全选），确认后创建
- 导入不做重复性校验，选什么导入什么
- 导入的任务默认未启用

## 文件格式

```json
{
  "version": 1,
  "exportedAt": "2026-05-07T10:30:00.000Z",
  "tasks": [
    {
      "name": "每日备份",
      "description": "可选描述",
      "scope": { "type": "global" },
      "trigger": { "type": "builtin.cron", "config": { "expr": "0 2 * * *" } },
      "action": { "type": "builtin.command", "config": { "command": "backup.sh" } },
      "cwd": "/path/to/dir",
      "missedRunPolicy": "skip"
    }
  ]
}
```

**保留字段：** name, description, scope, trigger, action, cwd, missedRunPolicy

**剥离字段：** id, enabled, schemaVersion, overlapPolicy, createdAt, updatedAt, nextRunAt, lastRunAt, lastStatus, runCount

默认文件名：`synapse-tasks-YYYYMMDD.json`

## UI 设计

### 工具栏布局

从左到右：刷新按钮 | 导入按钮（Upload 图标 + tooltip）| 导出按钮（Download 图标 + tooltip）| 新建任务按钮

图标按钮风格与现有刷新按钮一致。

### 导出模态框

- 标题："导出任务"
- 顶部：全选 checkbox + "已选 N 项"计数
- 列表：每行 checkbox + 任务名称 + 触发方式简述
- 底部：取消按钮 + 导出按钮（未选中任何项时 disabled）
- 点击导出 → 系统保存对话框 → 写入文件 → 关闭模态框

### 导入模态框

- 点击导入按钮 → 系统文件选择对话框（过滤 .json）
- 解析失败：toast "文件格式无效"
- 解析成功后弹出模态框：
  - 标题："导入任务"
  - 顶部：全选 checkbox（默认全选）+ "已选 N 项"计数
  - 列表：每行 checkbox + 任务名称 + 触发方式简述
  - 底部提示："导入的任务默认为未启用状态"
  - 底部：取消按钮 + 导入按钮
- 点击导入 → 逐个创建 → toast "已导入 N 个任务" → 关闭模态框 → 刷新列表

## 技术方案

### 架构选择：纯前端文件读写

后端零改动，完全复用现有 IPC 基础设施。

### 组件拆分

- `task-export-dialog.tsx` — 导出选择模态框
- `task-import-dialog.tsx` — 导入选择模态框

### 导出实现

1. 从当前已加载的任务列表取数据
2. 用户勾选后对选中任务做字段裁剪
3. `window.synapse.dialog.showSaveDialog` 获取保存路径
4. `window.synapse.fs.writeFile` 写入 JSON

### 导入实现

1. `window.synapse.dialog.showOpenDialog` 选择文件
2. `window.synapse.fs.readFile` 读取内容
3. 前端解析 JSON，校验 version 字段和 tasks 数组
4. 展示列表供用户勾选
5. 逐个调用现有 `tasks:create` IPC，强制 `enabled: false`
6. 完成后刷新任务列表

### 错误处理

- JSON 解析失败 → toast "文件格式无效"
- 单个任务创建失败 → 跳过，继续导入其余任务，最终 toast "已导入 N 个任务，M 个失败"
- 文件写入失败 → toast 提示错误信息

### 文件对话框配置

- 导入过滤器：`{ name: 'JSON', extensions: ['json'] }`
- 导出过滤器：`{ name: 'JSON', extensions: ['json'] }`，默认文件名 `synapse-tasks-YYYYMMDD.json`

## Preload Bridge 依赖

需确认以下能力是否已在 preload bridge 中暴露：

- `dialog.showSaveDialog` — 保存文件对话框
- `dialog.showOpenDialog` — 打开文件对话框
- `fs.writeFile` — 写入文件
- `fs.readFile` — 读取文件

若缺失则需新增对应 IPC handler。
