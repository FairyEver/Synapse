# Portal Headless 扩展直连

## 产品边界

Skill 引导用户自己的 AI 从本机 MCP 获取凭证，AI 使用自己的 HTTP 执行工具直连 `/api/extend/portal-headless/*`，SY 后端收到凭证后调用 SDK。Portal Headless 与未来扩展平行，不是 System App，没有 Dock、独立应用页、Workflow、Automation 或业务转发 MCP。

本机 action 为 `extend.portal-headless.credential.get`，MCP 索引名为 `extend_portal_headless_credential_get`；它注册到 `extend.capabilities` ExtensionPoint 和 `extend` domain。公开 tools/list 仍只有 search/invoke，IPC 保持 app 命名边界。该凭证 action 拒绝非 MCP 来源。

## 双重认证

1. 本机按 `environment` 读取当前已验证的 `portal-headless-test`（`test`）或 `portal-headless`（`prod`）凭证，检查 `secret.read` 权限；省略参数沿用 `test`。
2. 经 `network.connect` 权限与 AccountService 的现有认证客户端请求 `/api/extend/portal-headless/access`；该路由使用 UserAuthGuard。
3. 服务端签发五分钟、issuer `synapse.extend`、audience `portal-headless`、scope `read`、包含 `environment` 的 SY 扩展 JWT。签名密钥从现有用户 JWT 密钥经固定领域分隔 HMAC 派生，不能用于普通 SY 登录接口；不新增密钥环境变量。
4. 本机再次比对当前用户及连接尝试代次，然后向调用方 AI 返回短期 SY 授权、Portal token、tenantId、语言和固定扩展 API 基址。SY refresh token 不出本机。
5. AI 以 Authorization Bearer 传 SY 扩展授权，以 X-Portal-Token / X-Portal-Tenant-Id 传 Portal 凭证。后端验证签名、用途、过期、SY 账号状态和密码修改时间，再通过 SDK 验证 Portal 用户与企业。

仅专用凭证响应允许含 token；审计只记录权限、操作、目的地和结果。HTTP 日志脱敏 token/Authorization，不记录 body。后端捕获并归一化 SDK 异常，不输出原始错误配置；SDK 自带诊断日志接入 SY Logger，只记录固定事件标识，不转发上游文本或元数据。所有扩展响应 no-store。业务端点每 IP 每分钟限 30 次，每 owner 最多 4 个在途请求、每进程最多 16 个。

本机断开删除本机凭据，阻止之后取凭证，不承诺吊销 AI 已取得的 Portal token。已发 SY 授权在五分钟内仍可能有效；被禁用或修改密码的 SY 账号立即不能继续使用。不要把这个机制描述为即时远程撤销。

## SDK 如何进入后端

SDK 源码就在本仓库内，是 `extend/portal-headless` 下的 workspace 子包 `@synapse/portal-headless`。2026-09-26 由独立仓库整体迁入，不再有跨仓库交付产物。

- `server/package.json` 通过 `workspace:*` 依赖该包，解析为指向 `extend/portal-headless` 的符号链接。
- 包入口是 `dist/index.js`（`exports` 只声明 `import` 条件），由 `pnpm --filter @synapse/portal-headless run build` 产出。
- 必带 `generated/page-catalog.json` 与 `generated/module-type-rules.json`：这两个是**运行时按 `import.meta.url` 读取**的资源，不内联进 dist；缺失时目录查询会失败。
- Nest 后端为 CommonJS/NodeNext，通过保留的动态 `import("@synapse/portal-headless")` 加载 ESM。SDK 不进入 Electron 安装包。
- Docker deps 阶段复制包 `package.json` 后 frozen install；build 阶段先构建 SDK，再运行 `check:portal-sdk` 与 server 构建；正式阶段显式复制 `extend/portal-headless` 的 `dist`、那两个运行时生成资源与依赖链接——workspace 依赖是符号链接，不像归档那样实体落盘，不复制该目录则链接在生产镜像中断开。部署脚本白名单含 `/extend/***`。

迁入前用的是 `file:vendor/*.tgz` 归档：从独立仓库的干净提交导出、构建、`npm pack`，再由 `server/vendor/portal-headless.manifest.json` 记录版本、来源提交与 SHA-256，归档只含构建后的 JS/类型与必要生成资源。那套机制要保证的「线上运行的 SDK 精确来自某个已知提交」依然成立，现在由 monorepo 的原子提交承担——SDK 变更与其 SY 侧适配变更落在同一次提交里，比归档更直接。

`check:portal-sdk` 相应从供应链校验收窄为构建产物校验：不再比对归档 SHA-256 与来源提交，保留包可加载、运行时资源在位、三个只读契约（`meeting-room-usage` / `perf-year-agreement-list` / `base-dict-get` 必须是非写、`ai.effect` 为 `read`、且存在 `invoke` 绑定）三项。

改完 SDK 仍需真实测试账号联调：`check:portal-sdk` 只验证构建产物与只读契约，不发业务请求，**合成测试不能代替真实授权验收**。原冻结提交 `0dae0247f34ee503d6086c58a5f6243f3665fb3d` 的上游全量测试记录为 2387 通过、19 失败、51 跳过，19 项失败都在 `test/sample-device.test.ts`（缺该提交未跟踪的 `tools/sample/endpoints.json`）——这不代表上游全量测试通过，该状态随源码一并带入，属本包已知情况。

## 运行范围与限制

测试 API 固定为 `https://biz-api-test.wodecorp.cn`，正式 API 固定为 `https://biz-api.wodecorp.cn`；后端从已验证的短期授权中读取环境，不允许业务请求覆盖环境、URL、header 集合或 SDK 方法路径。两个环境分别复用 SDK 会话仓库；会话按已验证的 SY owner、Portal 凭据、企业和语言隔离，身份与企业基础数据显式要求 `user-basic`、`tenant-context`。SDK 请求工厂设置 10 秒单请求、30 秒总时限、禁止重定向、2 MiB 响应上限。正式环境真实授权与业务调用尚未验收。

两个环境的扩展都发布固定版本 SDK 的完整能力发现目录，不按 Portal 页面权限收窄目录。`describe` 只接受目录中的精确 capability/method 引用并返回 SDK 契约与顶层参数 schema；`/invoke` 和兼容 `/read` 只调用 SDK 已登记的 `capabilities.invoke` 绑定，不接受客户端指定 URL、header 或任意方法路径。读写能力均须通过 PH 服务端权限闸门，已审阅页面链、动作链和可信上下文全部满足才发送目标请求；Portal 后端继续执行自身鉴权。

全量目录是能力发现面，不表示当前账号具备每项业务权限；执行使用当前用户与企业绑定的 Portal 凭据，从用户会话读取权限与可信业务上下文执行 PH 策略，再调用目标业务接口。能力探查不得触发写操作；写入必须来自用户明确请求，并遵守 SDK 描述中的 prepare、候选值、`requestId`、幂等、完成条件和失败处理。同一用户会话复用 SDK 内部缓存，不跨身份、企业、语言或环境共享；权限判断结果不缓存。

`context.capabilityAccess` 返回 `mode=all` 及固定 SDK 的总数、读能力数和写能力数；这些计数只表示可发现能力，不代表策略或账号授权通过。具体清单通过分页目录读取。`catalogRevision` 在 SDK 提交号后加 `:full-test-v1` 或 `:full-prod-v1`，分别标识环境与全量目录规则。

年度协议列表无 year 参数，按真实 year 字段与分页筛选。当前固定 SDK 没有个人年度详情，不可用列表或年度时间配置冒充任务/指标正文。目录不存在某项能力表示固定 SDK 未发布它；目录中存在但执行返回 `PORTAL_FORBIDDEN` 表示当前 Portal 身份或企业被业务接口拒绝。

完整请求、响应与错误契约见系统 Skill 的 `extend/portal-headless/api-reference.md`。2026-09-22 已在用户启动的本机开发环境通过 Computer Use 验证 SY 登录回调、用户完成 Portal 授权后的连接状态、AI 取凭证与直连后端会议室查询。首次年度查询被旧导航树过滤；该问题的修复与复测记录见 `portal-headless-gui-acceptance.md`。生产部署、其它账号与跨平台授权仍未验收。本地合成测试不能代替真实验收。

## HTTP 调用与失败终止

系统 Skill 随包交付 `extend/portal-headless/scripts/client.mjs`（Node 22+，标准库，无额外依赖）。AI 从 MCP 取凭证后通过 stdin 传给脚本，脚本直连固定扩展地址，不新增 MCP 业务转发。支持目录与个人年度列表的有界分页：typed null、游标单调、总数和完成标记、重复记录、最多 20 页（可配置上限 100）。单请求含响应体读取 35 秒、整次执行 120 秒，重定向拒绝；不会调整 Agent 的 Bash 默认或最大超时。

SY 401 仅输出一次 MCP 刷新指令（退出码 10）；调用方刷新后带 `authRetry:1` 重试，失败立即结束。Portal 401 要求重连，400 等错误不重试。错误无原始上游文本或凭证，参数校验通过全局异常过滤器返回 schema 已知字段的 path/code/固定 message，不回显输入值或未知字段名。脚本不创建凭证文件、不调用 shell、不把凭证放进进程参数。

专项脚本验证：`node --test desktop/tests/portal-headless-client.test.mjs`，已接入 CI。真实网络路径使用本机临时 HTTP 测试服务与虚构凭证；不以合成测试声称已覆盖用户真实 Portal 数据。

## 权限审阅与拒绝恢复

权限生产策略采用 `ph-permission-policy/v2`。扫描器盘点源码事实，AI 逐条审阅，SDK 与 CLI 共用结构编译器。完整覆盖允许 `accepted` 与 `blocked` 并存；仅 accepted 产生可执行策略。任何 needs-review、悬空引用、证据或源码不一致均不能编译。操作说明见 `extend/portal-headless/tools/permissions/README.md`。

SDK build 独立固定 Portal 与 SDK 源码 revision；执行前检查 schema、覆盖、registry 与内容 hash。策略缺失、损坏、过期、无 accepted 条目、权限/上下文不可取得或不满足，均返回结构化 `403 PH_PERMISSION_DENIED`，包括 capabilityId、policyRevision、failedRule。目标业务接口零请求，禁止重试或通过参数覆盖权限。审计仅保留这些固定字段，不记录 token 或业务参数。

权限码通过 SDK 会话的 `permission-list` 按需加载；企业开通系统通过 `tenant-system` 按需加载。已加载数据在会话有效期内复用，并发首次加载由 SDK single-flight 合并。租户来自验证后的会话。每次调用仍校验策略版本并重新计算页面链、动作链与业务条件，不缓存 allow/deny 结论。店铺、业务状态与配置需先接入经审阅的可信服务端 resolver；没有来源时编译阻断。不能把调用方提交的上下文当成授权事实。

收到 PH_PERMISSION_DENIED 后停止调用，由维护者核对 Portal Web 调用链、补齐证据与审阅、重新编译和构建部署。普通用户只能修正真实账号权限或业务条件，不能更换入口绕过。PORTAL_FORBIDDEN 仍表示目标业务接口自身拒绝。当前仓库没有真实 accepted 策略；普通/管理员双账号与高风险写操作验收仍待完成，合成测试不能代替该验收。

## 权限缓存与 Portal Web 对齐

本次源码核对基于 Portal `test/portal/main` 的 `a3e0adc7fc`，不代表已验证线上部署。Portal Web 的 `app/portal/utils/system.js` 中，`fetchPermissions(force=false)` 在权限 store 已 ready 且未 force 时直接返回；`permissionCheck` 用 store 中的权限码判断。`fetchTenantSystem` 复用同一企业已加载的系统数据。退出重置 stores；重新登录更新 refreshMark 并触发 dashboard 重载；销售店铺切换更换 token 后调用 `fetchSaleAllState(true)`，强制刷新权限。PH 复用 SDK 已有会话缓存实现这一模式，不复制 Web 开发环境的权限绕过开关。

适配层不再生成随机 userId 或在每次 HTTP 请求结束时清空 SDK 仓库。每个环境沿用 SDK 默认的 64 会话 LRU 上限、30 分钟绝对有效期和 30 分钟空闲有效期；两种过期条件先到者生效。凭据轮换重建同一身份的会话；不同企业、语言和 owner 使用独立会话。可信宿主可通过 `sessions.invalidateCapability(key, 'permission-list')` 或 `sessions.invalidate(key)` 显式刷新。缓存仅在服务端进程内存中保存，服务关闭时清空，不落盘，不返回给 AI。

账号权限变化后，在显式失效、重新连接导致凭据变化或会话过期后读取新权限；不承诺下一次调用立即看到管理员修改。有效的空权限列表也会缓存并持续拒绝；请求失败或权限载荷不合法时失败关闭，不发送目标请求，不保留可放行的降级结果。业务接口返回凭据失效时清除对应会话，旧请求失败不能清除已轮换凭据的新会话。每次 HTTP 调用保留独立取消信号与 30 秒等待期限，业务请求不会继承上一请求的已取消信号。共享基础数据加载使用原有 10 秒请求超时和服务关闭信号，不受首个等待者超时影响；超时调用停止等待，共享数据返回后也不能发送该调用的目标请求。
