# Server And Dashboard Boundary

Synapse 服务端产品界面仍由一个工作区和一套部署产物提供：

- `server/`：NestJS API、Prisma、认证、审计、备份、日志和业务服务。
- `dashboard/`：Vite、TanStack Router、React 和 shadcn/ui 旧版前端，保留显式选择 V1 的整包回滚能力。
- `dashboard-v2/`：独立 HeroUI v3.2.7 浅色实现，为生产默认版本；未设置或置空 `DASHBOARD_UI` 均选择 V2，不引用旧 UI 源码。功能对应及验证入口见 `dashboard-v2/MIGRATION.md`。

## 应用边界

- `/console/**` 是普通用户 SPA，只包含普通用户登录、个人 Skills、云盘、Webhook、个人设备和设置。
- `/admin/**` 是平台管理 SPA，只包含系统、用户、设备、Skill 仓库、全局 Webhook 历史、审计、问题反馈、备份、全局云盘和日志。
- 两个 SPA 共用构建、主题和无身份耦合的 UI/底层工具，但不得共享导航、认证状态或业务路由。
- `/` 继续进入 `/console/`；公共页面、桌面授权和公开分享不得迁入 `/admin`。

V2 保持上述普通用户/管理身份隔离，但两套导航与路由均移除云盘管理（包括公开素材、文档图片、存储）。独立 `/drive/items/:id`、`/share/:shareId` 及子项、评论通知、编辑和下载保留。旧 `/console/drive/items/:id`、`/console/drive/folders/:id` 以及对应 `/dashboard` 前缀整页跳转 `/drive/items/:id?surface=standalone`，保留其他 query 和 hash；旧全盘列表和管理路由不提供页面。V1 功能保持原样以便回滚。

## 认证边界

- 普通用户 Web 会话使用 `synapse_user_session` HttpOnly 不透明 Cookie，并复用 `UserSession`；桌面 Bearer Access Token、Refresh Token 和 PKCE 流程保持独立兼容。
- 平台管理会话使用 `synapse_admin_session` HttpOnly 不透明 Cookie，只发送到 `/api/admin`，固定 8 小时，无刷新和滑动续期。
- 管理员身份不对应账号，只由服务端 `ADMIN_ACCESS_SECRET` 解锁；不得恢复 `AdminUser`、管理员 JWT 或运行时 `admin | user` 角色切换。
- `/api/console/**` 与兼容别名 `/api/dashboard/**` 只接受普通用户会话；`/api/admin/**` 只接受管理会话。
- 前端不得读取、持久化或记录任何会话令牌和管理密钥。

## 前端实现纪律

- 普通用户文件路由位于 `dashboard/src/routes/`；管理应用使用独立的 `dashboard/src/admin-routes.tsx` 路由树和 `admin-main.tsx` 入口。
- Dashboard 生产构建的最低语法目标为 Chrome 80；公开分享首屏不得依赖更新版本才提供且未经过兼容处理的浏览器 API。高级编辑器可以基于能力检测降级，但不得阻断只读预览。
- 标准公开分享路径在 Dashboard 模块加载前执行能力检测；不满足完整页面 CSS/运行时要求时进入 `/share/:shareId/reader` 或对应子项 reader。Reader 必须由服务端直出、保持零脚本和基础 CSS，不得引入 Dashboard bundle、Tailwind、编辑器或客户端埋点依赖。
- API 调用集中在 `dashboard/src/lib/api.ts`，并按用户/管理员会话分别处理 401。
- 管理 401 只回到 `/admin/access`，保留白名单内的站内目标；不得自动重放失败请求。
- V1 页面沿用现有 shadcn/ui；V2 页面只使用 HeroUI compound 组件和语义 token，不引入或复刻旧组件。专业文档/游戏内容保留专属作用域，不能污染系统 UI。
- 构建选择 `DASHBOARD_UI` 只接受 `v1|v2`，默认 `v2`；显式 `v1` 用于回滚。两套产物使用相同 URL 和容器目录，切换时必须整包构建，不混用资源；`/console/dashboard-ui.json` 标识实际部署的构建选择。入口 HTML 和部署版本标识必须重新校验缓存，带 hash 的静态资源沿用原缓存策略；已缓存的旧入口需刷新一次。构建接线不等于已部署。

权威设计与决策见：

- `docs/superpowers/specs/2026-07-31-separate-admin-access-domain-design.md`
- `docs/adr/0212-authenticate-platform-administration-with-an-environment-secret.md`
