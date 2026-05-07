# 数据库侧边栏重设计

## 概述

重构数据库模块左侧侧边栏：统一顶部布局为标准 ModuleSidebarHeader 样式，新增 ghost 工具栏，引入单层文件夹系统对表进行可视化分组。

## 目标

1. 顶部布局与 rules/skills/prompts 侧边栏统一（搜索框 + 新建表按钮）
2. 附加操作下沉到无边框工具栏（导入表、新建文件夹、显示模式切换）
3. 支持单层文件夹对表进行分组，文件夹与表是纯展示关系，不影响表本身

## 数据模型

### 系统表 `_table_folders`

| 列 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 自增主键 |
| name | TEXT NOT NULL UNIQUE | 文件夹名称 |
| sort_order | INTEGER DEFAULT 0 | 排序权重（越小越靠前） |
| created_at | TIMESTAMP | 创建时间 |

### 系统表 `_table_folder_members`

| 列 | 类型 | 说明 |
|---|---|---|
| folder_id | INTEGER FK → _table_folders.id | 所属文件夹 |
| table_name | TEXT NOT NULL UNIQUE | 用户表名（UNIQUE 保证单归属） |
| sort_order | INTEGER DEFAULT 0 | 表在文件夹内的排序权重 |

复合主键 `(folder_id, table_name)`。`table_name` 上的 UNIQUE 约束确保一张表只能属于一个文件夹。

### 显示模式持久化

存储在 electron-store config 中：`database.sidebar.displayMode`，取值 `"title+desc" | "title" | "desc"`。

## 侧边栏布局

```
┌──────────────────────────────────┐
│ [搜索框....................] [+]  │  ← ModuleSidebarHeader
│ ⬇  📁  Aa                       │  ← DatabaseSidebarToolbar
├──────────────────────────────────┤
│ ▾ 📂 工作日志                    │  ← 文件夹区域
│    work_entry_index         12   │
│    work_entry_brief         12   │
│                                  │
│ plan_item                    8   │  ← 未归类表区域
│ skill_registry               3   │
│ user_preferences             1   │
└──────────────────────────────────┘
```

## 组件结构

- `DatabaseSidebar` — 顶层容器，管理搜索状态、显示模式、文件夹数据
- `DatabaseSidebarToolbar` — 工具栏行（导入表、新建文件夹、显示模式切换）
- `DatabaseTableFolder` — 单个文件夹，基于 Collapsible，含 hover 操作按钮 + 右键菜单
- 表项复用 `ModuleSidebarItem`，根据 displayMode 控制显示内容

### 工具栏按钮

- 导入表：`Button variant="ghost" size="icon"`，图标 `FileInput`，`size-3.5`
- 新建文件夹：`Button variant="ghost" size="icon"`，图标 `FolderPlus`，`size-3.5`
- 显示模式：`Button variant="ghost" size="icon"`，图标随状态变化（`AlignLeft` / `Type` / `Text`），tooltip 提示当前模式

### 文件夹组件

- 基于 `Collapsible` + `CollapsibleTrigger` + `CollapsibleContent`
- 折叠图标：展开时 `FolderOpen`，折叠时 `Folder`
- hover 时右侧显示删除图标（`X`，`size-3`，`text-muted-foreground`）
- 右键菜单：重命名、删除

## 交互设计

### 拖拽

- 表项 `draggable`，文件夹和根区域为 drop target
- 拖拽时表项半透明，目标文件夹 `bg-accent` 高亮
- 从文件夹拖到根区域 = 移出文件夹
- 从根区域拖到文件夹 = 归入文件夹
- 从文件夹 A 拖到文件夹 B = 转移归属
- 同区域内拖拽 = 调整排序

### 右键菜单

表项右键：
- 移动到文件夹 → 子菜单列出所有文件夹 + "移出文件夹"

文件夹右键：
- 重命名
- 删除文件夹

列表空白处右键：
- 新建文件夹

### 新建文件夹

点击工具栏按钮 → 列表顶部出现 inline 输入框 → 回车确认 / Escape 取消。不弹 Dialog。

### 搜索行为

搜索时忽略文件夹结构，所有匹配的表平铺展示。搜索清空后恢复文件夹视图。

### 显示模式切换

三态循环：标题+介绍 → 仅标题 → 仅介绍 → 循环。点击按钮切换，tooltip 显示当前模式名称。

## 边界情况

### 外部变更同步

- 表被 MCP/CLI 删除：加载侧边栏时自动清理 `_table_folder_members` 中的孤儿记录
- 表被 MCP/CLI 新建：新表出现在根级别
- 表被重命名：在 rename 的 IPC handler 中同步更新 `_table_folder_members.table_name`

### 文件夹名冲突

创建和重命名时校验，不允许同名文件夹，inline 输入框实时提示。

### 空文件夹

允许存在。展开时不显示额外提示。

### 删除确认

- 空文件夹：直接删除
- 非空文件夹：弹确认，文案"删除文件夹「{name}」？文件夹内的 {n} 张表不会被删除。"

### 显示模式回退

"仅介绍"模式下，无 description 的表回退显示表名。

## 技术要点

- 系统表以 `_` 前缀命名，MCP 自动屏蔽，用户不可见
- 文件夹折叠状态为组件 local state，不持久化，默认全部展开
- 拖拽使用原生 HTML5 Drag and Drop API
- 清理逻辑在侧边栏数据加载时执行（service 层），不需要实时监听
