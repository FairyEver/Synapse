# Dashboard V2 HeroUI 实施计划

用户于 2026-10-31 批准。在当前 main、当前目录开发，不创建分支/worktree，不 push、不部署。完整需求以本次对话批准的方案为准。

## Global Constraints

- HeroUI React/Styles 3.2.7，固定浅色；不含 shadcn、旧封装或旧 Dashboard 源码引用。
- 普通用户和管理员的全部有效功能迁入 V2，但两套云盘菜单及所有云盘管理页不迁移。后端不删。
- 独立 `/drive/items/:id`、`/share/:id` 及子项、编辑、评论、通知、下载和零脚本 reader 降级保留。
- 保留 API、认证、权限及会话隔离；只复用仓库现有依赖，不升级。旧 dashboard 保持运行。
- 阅读器正文、排版、滚动节点、ref、坐标系和 DOM 标记保留；外围替换须验评论几何及 Portal。

## Task 1: 基线、迁移清单与公共层

建立功能清单，补 V2 依赖、路由构建、请求层和独立 session。实现 HeroUI 布局、列表、确认、状态等业务组合，禁止旧 primitive API adapter。先验证路由与退役路径测试失败，再实现。

## Task 2: 独立阅读器

迁入独立 Drive 和 share 功能，移除 console surface 和返回云盘动作，替换外围交互。保留编辑器、正文及几何逻辑，迁移测试并做滚动、布局和定位回归。

## Task 4: 管理后台

迁入除云盘外全部管理功能；使用 HeroUI compound 组件及公共列表，保留操作、校验、分页、权限和异常行为。

## Task 5: 用户控制台与辅助入口

迁入用户 Skills、Webhook、设备、设置、认证及桌面更新入口；移除云盘列表，旧详情转独立路由，保留公开 Skills。

## Task 6: 验证、构建接线及交付

显式选择 V2 构建，默认旧版。运行新旧构建、类型、单元及浏览器测试和 UI 边界检查；bsk 本地验收使用隔离数据库。更新规则及发布说明，独立审阅并修复，本地提交且不推送。

## Review Focus

认证隔离、登录回跳、退役 Drive 深链、无旧 UI 引用、Markdown 图片及评论几何、构建默认 V1。
