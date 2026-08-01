# Server And Dashboard Boundary

Synapse 服务端产品界面仍由一个工作区和一套部署产物提供：

- `server/`：NestJS API、Prisma、认证、审计、备份、日志和业务服务。
- `dashboard/`：Vite、TanStack Router、React 和 shadcn/ui 前端。

## 应用边界

- `/console/**` 是普通用户 SPA，只包含普通用户登录、个人 Skills、云盘、Webhook、个人设备和设置。
- `/admin/**` 是平台管理 SPA，只包含系统、用户、设备、Skill 仓库、全局 Webhook 历史、审计、问题反馈、备份、全局云盘和日志。
- 两个 SPA 共用构建、主题和无身份耦合的 UI/底层工具，但不得共享导航、认证状态或业务路由。
- `/` 继续进入 `/console/`；公共页面、桌面授权和公开分享不得迁入 `/admin`。

## 认证边界

- 普通用户 Web 会话使用 `synapse_user_session` HttpOnly 不透明 Cookie，并复用 `UserSession`；桌面 Bearer Access Token、Refresh Token 和 PKCE 流程保持独立兼容。
- 平台管理会话使用 `synapse_admin_session` HttpOnly 不透明 Cookie，只发送到 `/api/admin`，固定 8 小时，无刷新和滑动续期。
- 管理员身份不对应账号，只由服务端 `ADMIN_ACCESS_SECRET` 解锁；不得恢复 `AdminUser`、管理员 JWT 或运行时 `admin | user` 角色切换。
- `/api/console/**` 与兼容别名 `/api/dashboard/**` 只接受普通用户会话；`/api/admin/**` 只接受管理会话。
- 前端不得读取、持久化或记录任何会话令牌和管理密钥。

## 前端实现纪律

- 普通用户文件路由位于 `dashboard/src/routes/`；管理应用使用独立的 `dashboard/src/admin-routes.tsx` 路由树和 `admin-main.tsx` 入口。
- API 调用集中在 `dashboard/src/lib/api.ts`，并按用户/管理员会话分别处理 401。
- 管理 401 只回到 `/admin/access`，保留白名单内的站内目标；不得自动重放失败请求。
- 页面使用现有 shadcn/ui、共享组件、主题 token 和克制的 Tailwind 布局，不新增并行组件系统或自定义颜色。

权威设计与决策见：

- `docs/superpowers/specs/2026-07-31-separate-admin-access-domain-design.md`
- `docs/adr/0212-authenticate-platform-administration-with-an-environment-secret.md`
