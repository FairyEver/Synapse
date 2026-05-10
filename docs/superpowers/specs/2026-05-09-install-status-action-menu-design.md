# 安装状态面板操作下拉菜单

日期：2026-05-09

## 概述

将详情弹窗安装状态面板中每行的行内按钮替换为 DropdownMenu，统一操作入口，并为 `installed` 状态新增"重新安装"操作。

## 问题

当前 `EditorInstallStatusPanel` 中：
- `not_installed` 和 `needs_update` 显示行内"安装/更新"按钮
- `installed` 状态无任何操作入口，用户无法重新安装
- 操作以裸按钮形式散落在行内，扩展性差

## 设计

### 操作菜单映射

每行右侧的行内 Button 替换为 `DropdownMenu`，菜单项根据 status 动态决定：

| 状态 | 菜单项 | 说明 |
|---|---|---|
| `not_installed` | 安装 | 首次写入 |
| `needs_update` | 更新 | 覆盖旧版本 |
| `installed` | 重新安装 | 覆盖写入当前版本 |
| `conflict` | （无菜单） | 仅展示路径和状态 |
| `external_same_name` | （无菜单） | 仅展示路径和状态 |
| `unsupported` | （无菜单） | 不渲染触发器 |
| `unavailable` | （无菜单） | 不渲染触发器 |

所有写入类操作统一调用现有 `onOpenInstallTarget(entry)` 回调，不需要新增回调或 IPC。

### 触发器

- `MoreHorizontal`（lucide `Ellipsis`）图标的 ghost 小按钮
- actions 为空时不渲染触发器
- 菜单对齐方式：`align="end"`

### Dialog 关闭行为

当前行内按钮被 `DialogClose asChild` 包裹，点击后关闭安装状态 Dialog。

改为 DropdownMenu 后：
- 不再使用 `DialogClose` 包裹
- 点击菜单项 → 调用 `onOpenInstallTarget(entry)` → 触发安装弹窗
- 安装状态 Dialog 保持打开，用户安装完成后可直接点"刷新"查看更新后的状态
- 这是更好的体验：用户不需要重新打开安装状态 Dialog

### 路径链接

路径链接保持内联展示，不收进下拉菜单。

## 涉及文件

仅 `desktop/src/modules/content/components/editor-install-status-panel.tsx`：

1. 新增 import：`DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuTrigger` from `@/components/ui/dropdown-menu`，`MoreHorizontal` from `lucide-react`
2. 移除 import：`DialogClose`（不再使用）
3. 新增辅助函数 `getRowActions(status)` 返回菜单项数组
4. 修改 `canWriteStatus` 为新逻辑（或直接移除，由 `getRowActions` 取代）
5. 修改 `renderInstallStatusTargetList` 中按钮区域的渲染：行内 Button → DropdownMenu

## 不涉及

- 卡片 badge 的交互不变（仍然是点击 → 删除确认）
- 主进程安装逻辑不变
- `onOpenInstallTarget` 回调签名不变
- 其他文件不需要修改
