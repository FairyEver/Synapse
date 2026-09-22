# Portal Headless Test 连接器

## 交付边界与使用

Synapse 连接器中的 **Portal Headless Test** 永久用于测试环境。打开开关后进入连接中，浏览器打开 Portal 授权确认页；用户确认后，SY 校验 state、远端身份和企业成员关系，安全保存成功才显示已连接。可以关闭开关断开、重新连接；网络验证失败可以重试验证。未登录 SY 时要求先登录 SY。

2026-09-22 已在本机开发环境验证：SY 登录回调成功，用户完成 Portal 授权后连接器显示已连接，AI 通过扩展查询到真实会议室数据。生产与其它平台尚未验收；下方保留授权页接入契约。 不提供手填 token、浏览器数据库读取、Cookie 抓取或模拟成功入口。

未来正式连接器名称为 **Portal Headless**、ID 为 `portal-headless`；本次不注册它、不猜测生产地址，也不会将测试连接器改名覆盖。两个连接器分别绑定环境，长期共存。

## 固定环境与 Web 契约

| 项目 | 本次值 |
|---|---|
| 连接器 ID | `portal-headless-test` |
| 环境 | `test` |
| API | `https://biz-api-test.wodecorp.cn` |
| 网页 | `https://webtest01.wodecorp.cn/portal.html#/` |
| 待新增授权页 | `https://webtest01.wodecorp.cn/portal.html#/connect/synapse` |
| 回调 | `synapse://portal-headless-test/callback` |
| 默认语言 | `zh-CN` |

上述配置在客户端可信定义中分别保存，回调不能覆盖。网页地址不是 API 地址。授权请求参数放在 hash 路由 query：`state`（32 字节随机数的 43 字符 base64url）、`callback`（固定回调）、`environment=test`、`language=zh-CN`。不会携带 SY 用户 ID、SY 会话凭据或 Portal token。

回调 query 必须精确符合以下一种形态。所有值均为字符串，编码一次，整条编码后 URL 最多 65536 字符；重复、未知、缺失字段、错误路由、userinfo、端口、fragment、原始控制字符均拒绝。

| 结果 | 参数 |
|---|---|
| 成功 | `status=success`、`state`、`token`、`tenantId`、`portalUserId` |
| 取消 | `status=cancelled`、`state` |
| 失败 | `status=error`、`state`、`errorCode` |

- `token`：用户登录产生的 Portal 会话 token，非空、最多 16384 字符、不得包含 CR/LF。不是私人令牌/API Key/内部 token。
- `tenantId`、`portalUserId`：非空 ID 字符串，各最多 128 字符；不得有 CR/LF；不得通过 JavaScript Number 做有损转换。使用 `tenantId`，不接受 `tenant` 别名。
- `errorCode`：只允许 `login_failed`、`tenant_unavailable`、`authorization_failed`、`request_expired`。取消和失败不得携带凭据或自由文本。
- 不回传显示姓名、企业名称、头像、权限、原始用户资料或到期时间。SY 自行获取真实摘要，核对回传的 `portalUserId`，核对企业列表中的 `tenantId`。
- Web 登录前用当前标签页 sessionStorage 保留授权请求，登录后恢复确认页；最多 5 分钟。已登录仍必须确认真实账号与企业，更换企业后重新取得匹配身份与会话。
- 浏览器交接 token 只在用户确认时发生。Web 不得记录、展示或持久化回调 URL；协议被拦截时提供再次触发按钮。用户关闭浏览器但没有取消回调时，SY 只能等待超时或由用户关闭开关，不能推断授权已取消。
- 这不是 OAuth/code 兑换或 SDK 版本握手协议。上述授权页面是本次要求 Web 新增的功能。

## 身份、验证与存储

`ownerUserId` 来自主进程 AccountService 已认证且 active 的 `profile.user.id`；`portalUserId` 是另一个身份体系。state 只在内存保存 5 分钟，绑定当前 owner、连接器、环境和尝试对象。回调在任何异步验证前消费 state。取消、重新连接、断开、账号切换和进程重启使旧尝试失效。

主进程窄适配器经 PermissionGuard/AuditSink 和集中 HTTP 客户端读取：

1. `GET /admin-api/sys/user/info`：验证 token 和回调 Portal 用户 ID。
2. `GET /admin-api/hr/system-tenant/getUserTenantsByPage?pageNo=N&pageSize=200`：验证企业成员关系，最多 100 页。

请求带 `token`、`tenant-id`、`Accept-Language`，不带 SY token、Cookie、module-type。固定可信 API、不跟随重定向；单请求 15 秒、总验证 30 秒、单响应最多 2 MiB。SDK 当前包络规则为 `ret === 'SUCCESS'`。401/10001 为凭据失效，1002015001 为企业不可用；403 单独报告，无响应、超时或 5xx 不判定为登录失效。

| 字段 | 来源 | 保存位置 |
|---|---|---|
| ownerUserId、connectorId、environmentId | SY 登录态与可信定义 | 普通绑定摘要与加密凭据绑定元数据 |
| baseUrl、portalWebUrl、authorizationUrl、language | 客户端可信定义 | 随客户端发布，不接受回调覆盖 |
| credentialRef | SY 随机 UUID | 普通绑定摘要 |
| token | Portal 成功回调，远端验证通过 | `app.connectors.credentials` 的加密 `accessToken` 字段 |
| tenantId、portalUserId | 回调与远端身份／企业列表核对 | 加密凭据绑定元数据与普通摘要 |
| displayName | 用户接口 realName，缺失时 username | 普通摘要；都缺失则省略 |
| tenantName | 匹配企业条目的 name | 普通摘要；缺失则省略 |
| connectedAt、lastValidatedAt | SY 成功提交／重新验证时钟 | 普通摘要 |

普通摘要存入既有 `app.connectors.state` 的独立 collection 记录，键为 owner/environment/connector 元组的 SHA-256，避免与 Figma singleton 写入竞争。两个 namespace 均采用兼容的可选字段扩展，旧 Figma 状态无需迁移。

不存头像、token 到期时间、refresh token、完整用户资料、password2、salt、部门/权限列表或 OSS 配置。未验证凭据仅暂留主进程内存供网络失败重试；账号切换/断开/重启清除。已验证凭据使用现有 OS safeStorage 加密后端；加密不可用及 Linux basic_text 后端均拒绝。

恢复连接先后台验证，不阻塞启动，验证前不给执行层使用；网络失败保留已保存凭据以便重试。切换 SY 账号不会展示、使用其他账号绑定；返回原账号会重新验证。断开先使正在进行的尝试失效，持久化禁用标记，再删除凭据与摘要；删除失败明确报错，禁用记录用于下次清理。启动清理本 owner/environment/connector 下的孤立凭据。

所有凭据访问、网络和浏览器打开经过权限与无正文审计。回调走已有声明式协议路由的私有主进程 handler，不注册公开 capability/MCP/HTTP/Workflow/Automation。Renderer 仅收到白名单状态摘要，变更通过 EventBus 的 `connector/item.changed` 发送。禁止 token 进入日志、错误、埋点、普通配置或 Agent 快照。唯一专用交付面是扩展凭证 MCP 响应，允许用户自己的 AI 临时使用，不得复述或保存到文档。

## SDK 扩展接线

内部 `core.connectors.getSessionInput(connectorId)` 在主进程检查当前账号、连接代次、验证状态和凭据绑定后返回：

```ts
{
  baseUrl,       // 可信环境定义
  userId,        // ownerUserId，不是 portalUserId
  language,      // zh-CN
  connectionGeneration, // 本次连接尝试代次，用于异步交付前复核
  credential: { token, tenantId }
}
```

独立扩展的凭证 dispatcher 复用该内部入口，经过权限和审计，再向后端换取短期 SY 扩展授权；返回前复核账号与 connectionGeneration。AI 携带两类凭证直连 SY 后端，后端按请求创建 SDK 会话，显式验证 `user-basic`、`tenant-context` 并在 finally 清理。SDK 仅安装在服务端，连接器不注册 Agent contribution。详见 [扩展直连契约](portal-headless-extension.md)。

使用凭据时仍需处理远端失效，不能将最近一次验证当作永久有效。断开删除本机凭据并阻止后续交付，不承诺吊销 Portal token 或即时撤销已交付的五分钟 SY 授权。

## 验收口径

自动化使用合成凭据、受控 HTTP 响应与存储故障注入，覆盖 state、真实适配器请求契约、身份/企业匹配、账号/环境隔离、迟到结果、失败清理、重启验证、UI 状态和脱敏。它们证明 SY 实现行为，不证明 Portal 授权页已经存在。

2026-09-22 本机 macOS 开发版 GUI 联调已覆盖 SY 登录回调、用户完成授权后的 Portal 连接与扩展会议室查询。Portal 授权确认由用户手工完成，不宣称已自动化覆盖该确认页或所有授权失败分支；未验证生产环境及 Windows/Linux。不得将 SDK 仓库已有实测记录算作本次连接器实测。

Web 实施任务可直接复制 [Portal Web 提示词](portal-headless-test-web-prompt.md)。
