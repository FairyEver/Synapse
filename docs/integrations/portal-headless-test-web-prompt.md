# Portal Web 实施提示词

复制以下代码块到 Portal Web 项目的任务中。SY 已实现本契约的接收和验证端；Web 授权页仍需新增。

```text
请在 Portal Web 项目中实现 Synapse 测试连接器的授权确认页，只修改 Web，不修改 Synapse 或 portal-headless SDK，不扩展业务能力。

先阅读本仓库规则，核对现有路由、登录流程、会话 token、用户资料、企业列表及切换企业机制。现有普通登录页不是授权回传页，已有 URL 接收 token 的入口也不能替代本需求。

新增测试环境页面：
https://webtest01.wodecorp.cn/portal.html#/connect/synapse

页面接收 hash 路由 query：
- state：必填，SY 生成的 43 字符 base64url 随机字符串，字符集 A-Z、a-z、0-9、_、-。
- callback：必填，只允许精确值 synapse://portal-headless-test/callback。
- environment：必填，只允许 test。
- language：可选，默认 zh-CN。

这是待新增页面契约，不要假设已有 OAuth、一次性 code 兑换、版本握手接口。
不得接受参数覆盖 API 地址。测试 API 固定来自 Web 的可信环境配置：
https://biz-api-test.wodecorp.cn
正式站不得受理测试授权请求；本次不实现正式连接器。未来正式连接器叫 Portal Headless；当前 Portal Headless Test 将永久保留，不能以后改名覆盖或复用其凭据。

未登录时，通过当前项目登录机制登录，并在当前标签页的 sessionStorage 中暂存本次授权请求和接收时间，不保存 token 副本。登录完成后恢复授权页，不能直接返回首页丢失请求。授权请求最多保留 5 分钟；过期必须提示回到 SY 重新连接，SY 是有效期与 state 的最终裁决方。

已登录也必须展示确认页，明确显示“Portal Headless Test”、真实当前账号和企业，由用户主动确认。
企业必须来自该用户真实可访问企业列表，不能默认 tenantId=1。
若用户更换账号或企业，必须完成现有登录／企业切换流程，重新读取身份并确认 token 与 tenantId 匹配，不能只改显示名称。
不得把私人令牌、API Key 或内部系统 token 当作登录会话 token。

成功时使用 URL/URLSearchParams 构造回调（下面分行仅为展示，实际是一条 URL）：
synapse://portal-headless-test/callback
  ?status=success
  &state=<原值>
  &token=<当前Portal会话token>
  &tenantId=<确认企业ID>
  &portalUserId=<该企业上下文的真实用户ID>

以上参数都是字符串：
- tenantId、portalUserId 使用非空 ID 字符串，不做有损数字转换，不含 CR/LF。
- token 不得包含 CR/LF，非空且最长 16384 字符。
- tenantId、portalUserId 最长各 128 字符。
- 使用 tenantId 字段，不使用 tenant 别名。
- 编码后的整条回调 URL 不得超过 65536 字符。
- 回调不得包含 userinfo、端口、fragment、原始空格/控制字符或未知参数。
- 不回传姓名、企业名称、头像、完整用户资料或到期时间，SY 自行从测试 API 验证并提取展示字段。

用户取消：
synapse://portal-headless-test/callback?status=cancelled&state=<原值>

授权失败：
synapse://portal-headless-test/callback?status=error&state=<原值>&errorCode=<稳定错误码>
errorCode 只允许 login_failed、tenant_unavailable、authorization_failed、request_expired。
失败或取消不得携带 token、tenantId、portalUserId 或任意错误正文。
参数重复、未知参数、非法 state 或非法 callback 必须本地拒绝，不向不可信地址跳转。

用户确认前不生成带 token 的回调 URL；生成后立即交给浏览器打开外部协议，清理待授权请求，禁止记录或持久化完整回调 URL。
若浏览器拦截外部协议，只提供“返回 Synapse”按钮供用户再次触发，不显示、复制或打印凭据链接。
Web 只能表示授权信息已交接；是否已连接由 SY 完成远端身份和企业验证后决定。SY 会拒绝重复回调和已取消/过期请求；再次连接需回 SY 发起新请求。

禁止 token、完整回调 URL、原始用户资料进入 console、埋点、错误上报或持久化调试记录。检查授权页经过的路由、全局错误上报和导航埋点，不能只保证页面本身不打印。
不得抓 Cookie、读取浏览器数据库或让 AI 提取 token。
不新增业务页面、权限目录、SDK 业务调用、刷新 token 或吊销承诺。

SY 使用 GET /admin-api/sys/user/info 验证用户，使用 GET /admin-api/hr/system-tenant/getUserTenantsByPage 验证所选企业归属。两者均带 token、tenant-id 和 Accept-Language；回调的 portalUserId 必须与确认企业上下文中的用户身份一致。不要把 SY 的 ownerUserId 与 Portal 用户 ID 混用，Web 不需要接收 ownerUserId。

测试覆盖未登录恢复、已登录确认、企业切换、取消、失败、请求过期、非法/重复参数、跨环境、外部协议被拦截，以及日志脱敏。
最终列出修改文件，并区分自动化测试与和真实 Synapse 客户端完成的联调；未实测不得声称端到端完成。
```
