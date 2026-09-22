# Portal Headless Test 交付报告

## 已完成与使用方法

SY 侧已实现 Portal Headless Test 测试连接器、私有协议回调、一次性 state 校验、真实用户/企业只读验证、加密凭据保存、账号/环境隔离、取消/断开/重新连接与网络失败重试。

登录 Synapse → 打开“连接器” → 打开 Portal Headless Test 开关 → 浏览器进入 Portal 授权确认页 → 确认账号与企业 → SY 验证通过后显示“已连接”。连接中/验证中可关闭开关取消；后续可重新连接。网络验证失败可点“重试验证”。

**上述浏览器授权环节依赖 Portal Web 新页面上线，目前未完成真实端到端联调。** 当前登录首页不能自动回传凭据；SY 没有模拟成功入口。测试连接器会永久保留，正式 Portal Headless 尚未注册。

## 保存字段与 SDK 映射

- `ownerUserId` 来自 SY 可信登录态；`connectorId/environmentId`、API/网页/授权入口及语言来自客户端可信定义。
- token 来自用户确认后的 Portal 回调，真实验证后保存到既有加密凭据 namespace 的 `accessToken`；与 owner、环境、连接器、tenantId、portalUserId 成对绑定。
- 普通配置只存凭据引用、上述归属和真实接口确认的账号/企业白名单摘要、连接/最近验证时间。
- 不保存头像、token 到期时间、refresh token、原始用户响应、password2、salt、权限目录或 OSS 配置。
- 内部凭据提供接口为 `core.connectors.getSessionInput(connectorId)`；返回可信 `baseUrl`、`userId=ownerUserId`、`credential={token,tenantId}`、`language`。未来由可信执行层分别传给 `createPortalServer` 与 `forSession`；不暴露给 Renderer、MCP、HTTP 或模型。

字段来源、SDK 代码形状和存储恢复语义详见 [连接器契约](portal-headless-test.md)。断开只清理 SY 本地绑定，不声称吊销 Portal token。

## Portal 仍需完成

新增测试授权确认页，接收并保留 state/callback/environment/language，登录后恢复授权请求，由用户确认真实账号与企业，再按精确成功/取消/失败契约回调。SY 不提供 OAuth/code 兑换或版本握手接口。

直接复制 [Web 实施提示词](portal-headless-test-web-prompt.md) 的代码块执行该任务。本次没有修改 Web 或 SDK 仓库，没有新增业务能力或 AI 工具目录。

## 验证结果

- 自动化：18 个测试文件、233 项测试通过。外部 Portal 响应、浏览器打开、账号状态及 OS 安全存储接口均采用受控替身；既有加密存储后端测试覆盖文件读写与加密不可用错误。这不是生产凭据实测。
- 覆盖正常连接、取消、过期/重放/不匹配 state、非法字段、凭据失效、身份/企业不匹配、分页/异常响应/网络失败/超时/重定向、断开后迟到回调、验证/写入中的断开、账号与环境隔离、重启验证、孤立凭据清理、存储失败、日志脱敏、私有协议和 preload/EventBus、Figma/MCP 表面回归。
- `pnpm --filter @synapse/desktop run typecheck` 通过。
- `check:ipc-codegen`、`check:hard-constraints`、`check:ui-tracking-coverage` 通过；`git diff --check` 通过。
- 真实环境实测：本次没有使用真实 Portal 凭据，没有启动应用、浏览器或开发服务器。
- 待完成：Web 授权页实现/部署，以及真实浏览器协议交接、账号/企业验证、OS 加密存储联调。正式环境配置及入口以后单独交付。

## 本次文件清单

- `RELEASE_NOTES_PENDING.md`
- `desktop/app-capabilities/connectors/main/__tests__/portal-session-driver.test.ts`
- `desktop/app-capabilities/connectors/main/__tests__/portal-verifier.test.ts`
- `desktop/app-capabilities/connectors/main/__tests__/service.test.ts`
- `desktop/app-capabilities/connectors/main/definitions.ts`
- `desktop/app-capabilities/connectors/main/ipc.ts`
- `desktop/app-capabilities/connectors/main/mcp-streamable-http-driver.ts`
- `desktop/app-capabilities/connectors/main/portal-errors.ts`
- `desktop/app-capabilities/connectors/main/portal-session-driver.ts`
- `desktop/app-capabilities/connectors/main/portal-verifier.ts`
- `desktop/app-capabilities/connectors/main/service-types.ts`
- `desktop/app-capabilities/connectors/main/service.ts`
- `desktop/app-capabilities/connectors/main/types.ts`
- `desktop/app-capabilities/connectors/renderer/__tests__/connectors-module.test.tsx`
- `desktop/app-capabilities/connectors/renderer/hooks/use-connectors.ts`
- `desktop/app-capabilities/connectors/renderer/index.tsx`
- `desktop/app-capabilities/connectors/shared/__tests__/portal-contract.test.ts`
- `desktop/app-capabilities/connectors/shared/manifest.ts`
- `desktop/app-capabilities/connectors/shared/portal-contract.ts`
- `desktop/app-capabilities/connectors/shared/schema.ts`
- `desktop/app-capabilities/manifest-registry.ts`
- `desktop/app-capabilities/manifest.ts`
- `desktop/app-capabilities/synapse-skill/skill-package/app/index.md`
- `desktop/electron/__tests__/preload.test.ts`
- `desktop/electron/bootstrap/__tests__/account-external-opener.test.ts`
- `desktop/electron/bootstrap/__tests__/portal-protocol.test.ts`
- `desktop/electron/bootstrap/__tests__/registry.test.ts`
- `desktop/electron/bootstrap/account-external-opener.ts`
- `desktop/electron/bootstrap/app-deep-link.ts`
- `desktop/electron/bootstrap/app-ready.ts`
- `desktop/electron/bootstrap/connector-protocol-handlers.ts`
- `desktop/electron/bootstrap/descriptors.ts`
- `desktop/electron/bootstrap/protocol-router.ts`
- `desktop/electron/generated/ipc-channels.generated.ts`
- `desktop/electron/main.ts`
- `desktop/electron/preload.ts`
- `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`
- `desktop/electron/runtime/data-repo/schemas/connectors.ts`
- `desktop/electron/runtime/network/__tests__/outbound-http.test.ts`
- `desktop/electron/runtime/network/outbound-http.ts`
- `desktop/src/types/bridge.ts`
- `docs/adr/0033-limit-unsigned-app-deep-links-to-declared-actions.md`
- `docs/agents/capability-registry.md`
- `docs/agents/module-boundaries.md`
- `docs/agents/workflow-and-capabilities.md`
- `docs/integrations/portal-headless-test-delivery.md`
- `docs/integrations/portal-headless-test-web-prompt.md`
- `docs/integrations/portal-headless-test.md`
- `docs/superpowers/specs/2026-09-03-builtin-mcp-skill-connectors-design.md`
