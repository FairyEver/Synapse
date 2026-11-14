# 内网穿透退役记录

日期：2026-11-14。仓库：`/Users/liyang/Documents/code/github/Synapse`，变更分支：`main`。

用户要求彻底删除内网穿透的客户端、服务端与云端资源，并按完整发布流程发布。此决定替代 2026-11-11 的上线设计与部署要求。旧的启用、续期和回滚操作说明已从当前文档树删除；历史记录只能用于审计，不能据此重新启用服务。

## 产品与代码范围

- 删除 `tunnel` System App、主进程服务、设备授权、本机回环代理、控制与数据连接、启动恢复、界面、IPC、事件和系统 Skill。
- 删除六项 `app.tunnel.mapping.*` capability / MCP 索引；不保留别名或兼容 API。System App 从 23 降至 22，全局 capability / MCP 索引从 372 / 368 降至 366 / 362。默认 Dock 仍为 9 项，旧穿透固定项通过已有有效 App ID 校验移除。
- 删除 Shared 协议、Node 流实现及 ESM / CommonJS 导出；删除服务端映射、凭据、幂等回执、HTTP ingress、控制/数据 WSS、配置、容器与开发端口和专用部署脚本。
- 删除云端运行资源，包括正式与试验 DNS、入口区块、证书及续期材料、定时任务、专用 CAM 授权与密钥；只处理本功能拥有的资源，保留共享入口和其他站点。
- iOS `devicectl` 的设备连接 tunnel 状态，以及 SDK 文档中的 SSH tunnel 等无关内容不属于本功能。

## 数据与安全边界

已执行的 `server/prisma/migrations/20261111100000_user_tunnels/migration.sql` 保留原样。Prisma 的迁移历史需要原始校验和；删除或改写旧文件会破坏已部署数据库的迁移一致性，也不能从已备份或已应用的事实中抹掉历史。业务表由新增退役迁移删除，部署前仍需备份和恢复预演。

退役迁移为 `server/prisma/migrations/20261114130000_remove_user_tunnels/migration.sql`，在单一事务中依次删除 `UserTunnelOperation`、`TunnelDeviceCredential`、`UserTunnel`，不使用 `CASCADE` 或 `IF EXISTS`。未知外键或不一致的库结构应阻止迁移。部署沿用既有风险迁移显式放行、在线备份/恢复预演、停止旧服务和最终备份验证；仅回滚应用镜像不能恢复已删除的业务数据，数据恢复必须使用迁移前的已验证备份。原迁移 SHA-256 为 `e8058470b29f8d01c276463c227850860db965e6d6ff59f001542049dded9c8f`。

平台网页会话的精确 `APP_PUBLIC_URL` Origin 校验、生产 `__Host-` host-only Cookie、登录/退出保护、Bearer 认证语义与多 Cookie 字段解析仍是通用安全边界，不能随内网穿透一起撤销。共享 Caddy 的其他站点、其他业务证书和 DNS 授权不得受影响。备份或历史证据中已经存在的旧配置不作为活动服务，也不能由当前发布自动恢复。

## 服务器与腾讯云资源核对清单

以下位置先由原站内信与上线记录定位，再通过本次生产现场与已登录腾讯云账号逐项核对；状态列为实际结果。

| 范围 | 历史定位 | 本次状态 |
| --- | --- | --- |
| 正式 DNS | `*.tunnel.d2.pub`，DNSPod 记录 `2448370038` | 已在已登录腾讯云主账号删除，DNSPod 成功回执 |
| 试验 DNS | `*.tunnel-test.d2.pub` | 已删除；以 tunnel 搜索剩余 0 条，权威 DNS 两个命名空间均无 A 记录 |
| 共享边缘入口 | `/www/wwwroot/shared-caddy-edge/Caddyfile` 中正式 `SYNAPSE TUNNEL` 与试验区块 | 两块均精确移除，其他站点字节保留；validate、reload 成功，运行配置无 tunnel |
| 正式与试验证书 | `bootstrap-certs/tunnel`、`bootstrap-certs/tunnel-test-20261111`、BT ACME 订单 | 两个证书目录、试验原始证书目录及三项专属 ACME 订单已删除；共享 ACME 账号和其他证书保留 |
| 续期凭据与包装器 | `/root/.config/synapse-tunnel/`、`/usr/local/sbin/synapse-tunnel-certificate` | 密钥撤销后已删除凭据文件、空目录及包装器 |
| systemd | `synapse-tunnel-certificate`、`synapse-tunnel-certificate-check` 的 service / timer | 停用后删除四个 unit 和两个 Persistent stamp，列出 0 个 timer、0 个加载 unit |
| 专用 CAM 账号 | `synapse-tunnel-dns-renew` 及其访问密钥、域级策略 | 访问密钥先禁用再删除，账号已删除；用户列表仅余主账号。SynapseTunnelDnsRenew 策略已删除，自定义策略列表剩余 0 项 |
| 服务端运行配置 | 旧 `TUNNEL_*` 环境项、专用监听与数据表 | 本机生产环境文件与远端 .env 各移除两项配置；新容器无对应环境项和 3002 监听，三张表已删除 |

现场边缘配置 SHA-256 为 `0ec701efa0b8fc329f84afb01a002f331e8eddb23f63828313fe06052084a23a`，本次变更前的纯 Caddy 配置保存在远端 `/root/synapse-retirement-20261114/Caddyfile.before`。旧功能专属的边缘备份和试验备份已删除，避免旧证书与完整 ACME 配置继续留在共享配置挂载中。此备份仅用于排查配置差异，不能直接恢复整个共享入口或重新启用已退役域名。

边缘清理后，正式平台 `/healthz`、`/console/`、`/desktop/update` 均为 200；`console.brick.cool`、专利静态站、`wdbc.sys.d2.pub`、`game.d2.pub` 为 200，`api.bricklab.d2.pub/` 为 404、`bricklab.d2.pub/` 为 403，均无网关 5xx。未将原有业务根路径的 403/404 记为健康 200。

迁移前只读取服务器 `120.53.17.64`、Postgres 容器 `server-postgres-1`、数据库 `synapse` 的三张专用表汇总：`UserTunnel` 按 `id IS NOT NULL` 计数为 4，`deletedAt IS NULL` 为 0；`UserTunnelOperation` 按 `requestId IS NOT NULL` 为 4；`TunnelDeviceCredential` 按 `userId IS NOT NULL` 为 1。未读取或打印设备凭据。迁移后对这三个精确表名调用 `to_regclass` 均为 NULL；`_prisma_migrations` 按退役迁移名与 `finished_at IS NOT NULL`、LIMIT 1 查询，完成时间为 `2026-11-14T05:24:07.822514Z`。

## 验证与发布状态

源码、自动化验证、云端清理、生产迁移、桌面发布、TestFlight 上传与全站版本通知均已完成；各层证据如下，不将上传成功视为 Apple 处理完成，也不将测试夹具视为真实用户桌面验收。

Shared 验证已执行：先观察旧包入口可加载、旧 App 数量和旧 Dock 固定项三项预期失败，删除实现后 `pnpm --filter @synapse/shared run test` 全部 27 个文件、332 项通过，`pnpm --filter @synapse/shared run typecheck` 退出 0。新断言覆盖 ESM / CommonJS 拒绝两个旧 subpath、根入口不再导出穿透协议，以及历史 Dock 固定项的移除与禁止重新固定。未以这些结果宣称已验证生产资源或完整发布。

服务端专项 16 个文件、178 项测试通过，覆盖退役入口、环境、数据库范围和 Cookie/Origin/Bearer 安全；开发启动环境脚本 7 项通过。Prisma generate/validate、服务端 typecheck 与 build:api 成功。风险扫描识别且默认拒绝三项 DROP，只有显式授权开关才放行。

桌面相关 16 个文件、345 项测试逐组通过，完整 typecheck、IPC codegen 与 hard-constraints 通过。维护 Worker 精确删除本机旧凭据文件，按预算分批删除绑定，清空后移除表及 metadata；未知旧 App ID 已由现有配置规范化清除。ASAR 新增四类旧产物拒绝回归，覆盖 packed/unpacked，不放宽其他打包检查。独立只读代码审查未发现阻塞问题。

本机 desktop 完整 build 成功，精确删除旧编译输出后构建未签名 macOS arm64 候选，完整 ASAR、Worker、PTY、Electron 44.9.3 运行时与原生代码指纹校验通过（48,357 packed / 1,592 unpacked）。首次 PTY smoke 在工具提前让出会话时失败；同候选直接 PTY、相同 spawnSync 探针及完整 checker 随后均通过，未稳定复现该次失败，未据此修改终端实现或弱化断言。默认扫描旧 release 目录另遇历史 v1.0.80 的失效 SingletonCookie 链接，因此本次定向检查新候选，不删除历史验收产物。

本机构建、CI 与 Release 结果、CDN/生产冒烟、部署和 iOS 日志位于 `/Users/liyang/Documents/code/github/Synapse/.superpowers/retire-tunnel-20261114/`，暂无在线分享链接；在线 CI、Release 和归档说明链接见下文。首次 Apple 自检返回协议未签署或到期的 403，打开账号页面后复查已恢复正常，实际上传也成功。

## 正式发布与生产结果

- 功能提交 `a66287761`、版本提交 `6e6da8d947db10339847537d3122cd57accdf640` 与说明归档提交 `d9261a263` 均推送至 `FairyEver/Synapse` 的 `main`；未创建分支或 worktree。
- [CI 43557475979](https://github.com/FairyEver/Synapse/actions/runs/43557475979) 六组成功：macOS 主套件 11,827 项通过、32 跳过，独立真实文件系统契约 80 项、停服契约 22 项通过；三平台运行时、Windows 综合测试及安装包、macOS 类型/构建/架构约束均通过。
- [Release 43558954814](https://github.com/FairyEver/Synapse/actions/runs/43558954814) 四项任务成功。[v1.0.113](https://github.com/FairyEver/SynapseAppRelease/releases/tag/v1.0.113) 正文包含产品说明及全部六条 CDN 链接，说明归档至 [v1.0.113.md](../releases/v1.0.113.md)，待发布说明已清空为标准模板。三个安装文件与三个更新元数据均为 HTTP 200，元数据版本均为 1.0.113；DMG 325,486,815 字节、ZIP 314,682,972 字节、Windows EXE 282,858,748 字节。
- `pnpm mobile:release` 退出 0，iOS `1.0.113 (119)` 正式签名导出并成功上传；Delivery UUID 为 `bd80ccdc-2a18-4047-9fde-27c56657a9e2`。上传器先记录缺失续传状态文件的提示，最终明确返回 `UPLOAD SUCCEEDED with no errors`。未等待 Apple 后续处理，也未声称已安装到手机。
- `ALLOW_RISKY_MIGRATIONS=1 bash deploy.sh` 退出 0，19 步成功、858 秒。风险扫描现场确认仅本次三项 DROP 待执行；在线备份恢复至 `synapse_preflight_20261114_131024` 后退役迁移预演成功，最终备份另恢复至 `synapse_final_verify_20261114_131024` 验证成功，再执行生产迁移并切换。新容器为 `synapse-server:deploy-20261114_131024`，healthy；仅监听平台 3000/3001，无 3002，环境无 TUNNEL 项，`APNS_USE_SANDBOX=false` 保持不变。
- 部署后 `/healthz`、`/readyz`、`/console/`、`/admin/`、`/document/`、`/desktop/update` 均 200；旧 `/api/tunnels`、`/api/tunnels/control`、`/api/tunnels/data` 均 404。正式与试验随机子域的 DNS 查询均不再解析。
- TestFlight 与后端命令均成功后，按 `release:v1.0.113` 稳定请求向发送时的 40 个活跃账号发送一封版本站内信，信件 ID `cmwfyox5l008zpd2s4tudyu01`。服务端确认入库及收件副本数量，不代表所有设备均已显示通知。
- 本次未安装或重启真实用户桌面应用。升级后，现有配置校验会删除旧 Dock 项，后台维护 Worker 会清除旧本机绑定和加密设备凭据；其真实文件/SQLite 夹具已验证。未升级的旧客户端也无法使用已下线的云端接口与域名。外部编辑器中由用户自行安装的旧 Skill 副本不作为本次扫描删除对象。

生产恢复点均位于远端 `/www/wwwroot/synapse/`：`backups/env/synapse-env-before-sync-20261114_131024.env`、`backups/globals/synapse-globals-before-deploy-20261114_131024.sql`、`backups/synapse-online-before-deploy-20261114_131024.sql`、`backups/synapse-final-before-switch-20261114_131024.sql` 与 `backups/pdf-renderer-rollback-20261114_131024.state`。回滚镜像 `synapse-server:rollback-20261114_131024` 与对应 PDF 回滚镜像保留。恢复已删除的数据必须使用已验证的迁移前备份，不能只回滚旧镜像；不得恢复已撤销的 DNS/CAM 资源或复用已撤销密钥。

## 历史资料

以下链接固定在退役前的源码提交 `05c3cd0b2f5de12c2350fd398858ecb128fbef3f`，仅供追溯已发生的上线与验收事实：

- [原部署与证书续期记录](https://github.com/FairyEver/Synapse/blob/05c3cd0b2f5de12c2350fd398858ecb128fbef3f/docs/agent-guides/tunnel-deployment.md)
- [原生产、跨端与发布验收](https://github.com/FairyEver/Synapse/blob/05c3cd0b2f5de12c2350fd398858ecb128fbef3f/docs/agent-guides/tunnel-acceptance.md)
- [原设计](https://github.com/FairyEver/Synapse/blob/05c3cd0b2f5de12c2350fd398858ecb128fbef3f/docs/superpowers/specs/2026-11-11-tunnel-app-design.md)
- [原实施计划](https://github.com/FairyEver/Synapse/blob/05c3cd0b2f5de12c2350fd398858ecb128fbef3f/docs/superpowers/plans/2026-11-11-tunnel-app.md)
- [已发布的 v1.0.112 更新说明](../releases/v1.0.112.md)

原本地证据路径 `/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-11-tunnel-app/` 本次未找到文件；原服务器试验记录目录已随专属资源删除。历史资料通过上述 Git 固定链接追溯，不编造旧测试日志的在线分享链接。
