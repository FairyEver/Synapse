# Portal Headless 扩展直连

## 产品边界

Skill 引导用户自己的 AI 从本机 MCP 获取凭证，AI 使用自己的 HTTP 执行工具直连 `/api/extend/portal-headless/*`，SY 后端收到凭证后调用 SDK。Portal Headless 与未来扩展平行，不是 System App，没有 Dock、独立应用页、Workflow、Automation 或业务转发 MCP。

本机 action 为 `extend.portal-headless.credential.get`，MCP 索引名为 `extend_portal_headless_credential_get`；它注册到 `extend.capabilities` ExtensionPoint 和 `extend` domain。公开 tools/list 仍只有 search/invoke，IPC 保持 app 命名边界。该凭证 action 拒绝非 MCP 来源。

## 双重认证

1. 本机读取当前已验证 `portal-headless-test` 的凭证，检查 `secret.read` 权限。
2. 经 `network.connect` 权限与 AccountService 的现有认证客户端请求 `/api/extend/portal-headless/access`；该路由使用 UserAuthGuard。
3. 服务端签发五分钟、issuer `synapse.extend`、audience `portal-headless`、scope `read` 的 SY 扩展 JWT。签名密钥从现有用户 JWT 密钥经固定领域分隔 HMAC 派生，不能用于普通 SY 登录接口；不新增密钥环境变量。
4. 本机再次比对当前用户及连接尝试代次，然后向调用方 AI 返回短期 SY 授权、Portal token、tenantId、语言和固定扩展 API 基址。SY refresh token 不出本机。
5. AI 以 Authorization Bearer 传 SY 扩展授权，以 X-Portal-Token / X-Portal-Tenant-Id 传 Portal 凭证。后端验证签名、用途、过期、SY 账号状态和密码修改时间，再通过 SDK 验证 Portal 用户与企业。

仅专用凭证响应允许含 token；审计只记录权限、操作、目的地和结果。HTTP 日志脱敏 token/Authorization，不记录 body。后端捕获并归一化 SDK 异常，不输出原始错误配置；SDK 自带诊断日志接入 SY Logger，只记录固定事件标识，不转发上游文本或元数据。所有扩展响应 no-store。业务端点每 IP 每分钟限 30 次，每 owner 最多 4 个在途请求、每进程最多 16 个。

本机断开删除本机凭据，阻止之后取凭证，不承诺吊销 AI 已取得的 Portal token。已发 SY 授权在五分钟内仍可能有效；被禁用或修改密码的 SY 账号立即不能继续使用。不要把这个机制描述为即时远程撤销。

## SDK 如何进入后端

SDK 源码仍在独立仓库维护，SY 不复制一套业务源码。当前固定源码提交 `0dae0247f34ee503d6086c58a5f6243f3665fb3d`，从该提交导出干净快照构建，不包含另一工作区正在开发的改动。

- `server/vendor/portal-headless-0.0.1-synapse.0dae0247.tgz` 是交付产物。
- `server/vendor/portal-headless.manifest.json` 记录版本、来源提交和 SHA-256；pnpm lock 另记录归档 integrity。
- 归档只包含构建后的 JS/类型、包元数据和必要生成资源；不包含 smoke、baseline、用户凭据或开发 node_modules。
- 必带 `generated/page-catalog.json` 与 `generated/module-type-rules.json`，缺失不能静默发布。
- `server/package.json` 通过 `file:vendor/...tgz` 固定依赖，依赖实际安装到 node_modules，不是跨仓库软链接。
- Nest 后端为 CommonJS/NodeNext，通过保留的动态 `import("portal-headless")` 加载 ESM。SDK 不进入 Electron 安装包。
- Docker deps 阶段先复制 vendor 再 frozen install；build 阶段运行 `check:portal-sdk` 后构建；正式阶段沿用现有 node_modules 复制路径。部署脚本现有 `/server/***` 白名单包含归档。

升级时从 SDK 的干净提交执行冻结依赖安装与构建，按此包的 `exports/files` 元数据生成新版本 tarball；更新归档、manifest、server 依赖与 lockfile，并运行 `pnpm --filter @synapse/server check:portal-sdk`、后端测试/typecheck/build 和 Docker 构建。不得指向开发者 `/Users/...` 或从生产服务器拉浮动分支。发布包来源应通过独立 SHA 与 Node 版本记录复核。具体打包步骤与当前上游测试限制见 `server/vendor/README.md`。

## 运行范围与限制

仅测试 API `https://biz-api-test.wodecorp.cn`；不允许客户端覆盖环境、URL、header 集合或 SDK 方法路径。每个请求使用隔离 SDK 会话并在 finally 清理，身份与企业验证显式要求 `user-basic`、`tenant-context`。SDK 请求工厂设置 10 秒单请求、30 秒总时限、禁止重定向、2 MiB 响应上限。页面权限查询失败或返回格式异常时失败关闭，不回退到全量目录。

首期只读 allowlist：`meeting-room-usage`、`perf-year-agreement-list`、`base-dict-get`（仅 protocol_status）。执行时同时复核 SDK 的 write=false、ai.effect=read、invoke 绑定，参数用同一份 schema 校验并通过 describe 返回。其它能力即使已在 SDK 中也不能执行；扩大范围需要对应契约验证与 allowlist 更新。

目录、describe 与 read 统一调用 SDK `baseData.checkPermissions`，数据来自 `/admin-api/sys/menu/permissionsNotBySystem`，与 Portal 网页的 `fetchPermissions` / `permissionFilter` 一致。只批量检查 allowlist 所关联页面的 `permission`，精确匹配；不得把导航树 `/sys/menu/nav?project=2`、分组入口、路径前缀或猜测的别名当成页面授权。SDK 的 `capability-only` 页面（流程表单、基础字典）继续按既有规则保留，仍受 allowlist、只读校验与 Portal 业务鉴权约束。过滤定义时同步过滤绑定页面，避免重建目录把已剔除能力补成 capability-only；不把用户完整权限列表返回 AI 或写入日志。每次 HTTP 请求均独立查询，不跨用户或企业缓存。

核对依据：Portal `app/portal/utils/system.js` 中的 `fetchPermissions`、`permissionFilter`，`app/portal/menus/hr.js` 中个人年度页面的 permission；固定 SDK `base-dept-dict-permission.ts` 已封装相同权限接口。旧导航树返回 `/dashboard/agreement`，并不代表新页面 `/dashboard/year-agreement/main` 无权限。该类兼容问题通过统一权限数据源修复，不逐个添加路径别名。`catalogRevision` 在 SDK 提交号后加 `:page-permissions-v1` 标识接入层过滤规则变更。

年度协议列表无 year 参数，按真实 year 字段与分页筛选。当前固定 SDK 没有个人年度详情，不可用列表或年度时间配置冒充任务/指标正文。`context.configuredReadCapabilities` 仅表示服务端配置范围；目录按当前用户与企业的页面权限收敛，不是最终数据权限。服务端已配置但页面权限不包含时返回 `CAPABILITY_NOT_VISIBLE`，不得误判为部署缺失或没有业务数据；Portal 业务响应决定实际访问结果。

完整请求、响应与错误契约见系统 Skill 的 `extend/portal-headless/api-reference.md`。2026-09-22 已在用户启动的本机开发环境通过 Computer Use 验证 SY 登录回调、用户完成 Portal 授权后的连接状态、AI 取凭证与直连后端会议室查询。首次年度查询被旧导航树过滤；该问题的修复与复测记录见 `portal-headless-gui-acceptance.md`。生产部署、其它账号与跨平台授权仍未验收。本地合成测试不能代替真实验收。

## HTTP 调用与失败终止

系统 Skill 随包交付 `extend/portal-headless/scripts/client.mjs`（Node 22+，标准库，无额外依赖）。AI 从 MCP 取凭证后通过 stdin 传给脚本，脚本直连固定扩展地址，不新增 MCP 业务转发。支持目录与个人年度列表的有界分页：typed null、游标单调、总数和完成标记、重复记录、最多 20 页（可配置上限 100）。单请求含响应体读取 35 秒、整次执行 120 秒，重定向拒绝；不会调整 Agent 的 Bash 默认或最大超时。

SY 401 仅输出一次 MCP 刷新指令（退出码 10）；调用方刷新后带 `authRetry:1` 重试，失败立即结束。Portal 401 要求重连，400 等错误不重试。错误无原始上游文本或凭证，参数校验通过全局异常过滤器返回 schema 已知字段的 path/code/固定 message，不回显输入值或未知字段名。脚本不创建凭证文件、不调用 shell、不把凭证放进进程参数。

专项脚本验证：`node --test desktop/tests/portal-headless-client.test.mjs`，已接入 CI。真实网络路径使用本机临时 HTTP 测试服务与虚构凭证；不以合成测试声称已覆盖用户真实 Portal 数据。
