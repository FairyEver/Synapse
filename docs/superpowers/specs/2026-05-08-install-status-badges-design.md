# 列表卡片安装状态展示

日期：2026-05-08

## 概述

在 skill/rule 列表卡片底部展示全局安装状态，显示已安装到哪些编辑器，并提供快捷卸载操作。

## 需求

- 卡片底部新增一行，展示已全局安装的编辑器图标
- 仅检测全局安装（global scope），不检测项目级安装
- 不处理 `needs_update` 逻辑，只区分已安装/未安装
- 点击编辑器图标弹出 popover，提供卸载操作
- 未安装到任何编辑器时不显示该行
- 适用于 skill 和 rule 两种内容类型

## 架构

### 主进程：InstallStatusService

文件：`desktop/electron/services/install-status-service.ts`

职责：
- 维护 `Map<contentId, EditorId[]>` 内存缓存
- 启动时扫描所有已注册编辑器的全局安装目录，建立初始缓存
- 安装/卸载操作完成后更新缓存并推送变更事件
- 暴露 `getAll()` 供渲染进程初始化拉取

扫描逻辑：
- 遍历每个编辑器 adapter 的全局目录
- 复用现有 adapter 的路径解析逻辑匹配 contentId
- 只扫描 global scope 目录

IPC channels：
- `synapse:install-status:get-all` — 渲染进程拉取全量，返回 `Record<contentId, EditorId[]>`
- `synapse:install-status:changed` — 主进程推送变更，payload: `{ contentId: string, editors: EditorId[] }`
- `synapse:install-status:uninstall` — 渲染进程请求卸载，参数: `{ contentId: string, editorId: EditorId }`

### 渲染进程：状态管理

文件：`desktop/src/modules/content/contexts/install-status-context.tsx`

Context + hook：
- `InstallStatusProvider` 挂载在 content 模块顶层
- 挂载时调用 `window.synapse.installStatus.getAll()` 拉取全量
- 监听 `synapse:install-status:changed` 事件实时更新本地 state
- 暴露 `useInstallStatus(contentId: string): EditorId[]` hook

Preload bridge 新增：
- `window.synapse.installStatus.getAll()` → IPC invoke
- `window.synapse.installStatus.uninstall(contentId, editorId)` → IPC invoke
- `window.synapse.installStatus.onChange(callback)` → IPC on event

### 卡片 UI

修改文件：`desktop/src/modules/content/components/content-list-card.tsx`（或其子组件）

渲染规则：
- 调用 `useInstallStatus(contentId)` 获取已安装编辑器列表
- 列表为空 → 不渲染底部状态行，卡片高度不变
- 列表非空 → 卡片底部新增一行（border-top 分隔），展示编辑器图标组

编辑器图标：
- 20x20px 圆角方块，编辑器品牌色背景 + 白色缩写文字
- 每个编辑器有固定缩写：CC (Claude Code), Cu (Cursor), Cx (Codex) 等
- 图标可点击

Popover 菜单（点击图标触发）：
- 显示编辑器全名 + "global" scope 标识
- 分隔线
- "卸载" 按钮（红色文字）
- 点击卸载 → 调用 `window.synapse.installStatus.uninstall(contentId, editorId)`
- 卸载成功后图标自动消失（由 Context 状态驱动）

### 现有安装流程集成

安装完成后触发缓存更新：
- 现有 `installToEditor()` handler 执行成功后，调用 `InstallStatusService.refresh(contentId)`
- Service 更新缓存并推送 `changed` 事件
- 渲染进程自动响应，新图标出现

## 不做的事

- 不检测项目级安装
- 不处理 `needs_update` 状态
- 不在卡片上提供"重新安装"操作（用原有安装按钮）
- 不修改详情弹窗中已有的 `EditorInstallStatusPanel`

## 组件复用

- Popover 使用 shadcn `Popover` 组件
- 图标组为新组件 `EditorInstallBadges`，skill 和 rule 卡片共享
