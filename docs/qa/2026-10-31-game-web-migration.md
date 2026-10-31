# 游戏中心 Web 迁移验收

2026-10-31。仓库 `/Users/liyang/Documents/code/github/Synapse`，始终在 `main`。已有游戏 UI 改动先单独提交为 `27c6efc12`；迁移提交为 `371f6a8e0`；本次迁移不 push、不发布桌面、不上传 TestFlight、不发送发布通知。

## 已实现与验证

- 游戏 UI、76 项原有素材/样式完整迁入独立 Web 入口；Console 普通用户侧栏的原生链接实际以 `target=_blank`、`rel=noopener noreferrer` 打开新标签页，原 Console 标签保留。独立 `/game/` 页面不含 Console 侧栏。
- `/game/poker/1234` 未登录时进入 Console 登录，实际登录后返回原路径；不存在房间提供错误及返回入口。大厅、房间、记录、档案采用 URL 状态，支持刷新和浏览器历史。
- Cookie 身份不一致实际返回 409；大小写 `/api/game/INVOKE` 的 AI 操作实际返回 403。跨标签退出后游戏页转至带 `/game/` 回跳的登录页；切至第二个隔离账号后档案/统计为空，无前一账号数据。
- 浏览器真实创建陪练房 973708、真人入座、添加机器人、开局；宽屏与 570×840 窄屏实际呈现，局部主题、牌面、金额操作与管理弹层正常。音效资源保留，未做主观听音或所有设备浏览器兼容认证。
- 真实本机 stdio MCP 使用原 `GameHallService`、dispatcher、PermissionGuard 和 search/invoke 路由，经真实测试账号 Bearer 调用同一 API。网页申请 AI 后，本机找到同一座位并认领，控制版本 3；wait 返回 your_turn，成功 check、actionSeq 2。网页本人接管后版本 4，MCP wait 返回 control_released。没有托管模型或持续 AI 循环。
- 初次牌局在长时间验证中按规则超时离桌，不能当作完整人工打完一手。随后重新入座并完成上述交接；测试房最终由隔离 API 解散，返回 closed:true，不兑换点数。
- 桌面 System App、启动台、Dock 和 24 项游戏 UI IPC/preload 移除；26 项 MCP 保留。历史深链经权限检查/审计打开 Web。新候选 asar 中未发现 game-hall Renderer、游戏 UI IPC 或 Web UI 文件，仍有后台 cloud service。

## 自动化与构建

- 原桌面游戏 UI 基线：26 文件 / 155 项通过，desktop typecheck、hard constraints 通过。
- Web 最终全量：141 文件 / 1122 项通过（含重复入口挂载、跨标签会话通知降级回归）；游戏专项 30 文件 / 176 项通过。Web typecheck/build 通过。
- Desktop 全量最终：1131 文件通过、2 文件跳过；11609 项通过、2 项跳过。启动台图标数量减少后，动画原点的固定期望同步为 (16px,12px)。新增的开发脚本测试随后迁入其既有 Node 测试目录，13 项开发脚本测试通过。
- Server 默认全量：184 文件通过、24 文件跳过；2232 项通过、137 项跳过。独立数据库游戏专项：42 文件 / 271 项通过。API 构建通过。
- Server 完整 typecheck 仍受未修改的 `server/src/notifications/notification.service.spec.ts:274` 的既有 TS2493（空元组索引）影响，未将其声明为通过。生产构建不包含该测试文件。
- desktop typecheck、hard constraints 和 IPC codegen 已执行；最终以对应日志记录为准。
- 新 macOS arm64 候选包：`desktop/release/game-web-20261031/mac-arm64/Synapse.app`，仅 ad-hoc 验证包，没有发布/公证。完整 packaged-asar 验证通过：Electron 44.9.3，JSON Repair、PDF/DOCX 提取、HTML Worker、node-pty 及原生运行时/网络探针均通过；50627 packed / 1652 unpacked。asar 另行检查游戏 UI/IPC 文件为 0。
- 独立审查发现 Cookie invoke 大小写绕行及会话请求无界挂起，均有 RED→GREEN 回归并修复。浏览器发现 Vite 双执行入口引起重复 React 根，补真实 DOM 状态保持回归并修复。

## 环境与证据

浏览器写入只发生在本机 `localhost:5433/synapse_game_web_20261031_e2e`；独立单测库为 `synapse_game_web_unit_20261031_e2e`。测试 API 19710、Web 19700 已随本任务根命令会话中断退出；既有业务 API 19701 和 Docker 依赖未停用，两个隔离测试库保留供复现。使用根 `pnpm dev:server`，显式测试库覆盖业务 `.env.local`；Docker Hub 拉取超时后，使用有测试覆盖的 `SYNAPSE_SERVER_REUSE_INFRA=1` 复用现有依赖镜像。普通开发默认不变。没有向业务测试库写数据。

首次全量 DB 测试与运行中的测试 API 共用了隔离库，后台任务造成部分失败；拆为独立单测库并串行后，剩余失败为旧回滚用例假设房名 null。该用例改为核对原房名，保留回滚断言；另修复五个 describe.skip 夹具仍以 undefined URL 构造 Prisma 的问题。修复后以以上最终结果为准。

本地证据（均尚无在线链接）：

- 宽屏：`/tmp/synapse-game-web-table.png`
- 窄屏：`/tmp/synapse-game-web-narrow-final.png`
- 浏览器记录：`/tmp/synapse-game-web-acceptance-20261031.json`（1111 请求，覆盖仅被捕获标签，33 条 console 因容量未保留；不能当作所有新标签页的完整网络记录）
- Web：`/tmp/synapse-game-dashboard-final-tests.log`、`/tmp/synapse-game-web-after-review-tests.log`、`/tmp/synapse-game-web-final-build.log`
- Desktop：`/tmp/synapse-game-desktop-final-tests.log`、`/tmp/synapse-game-desktop-final-tsc.log`、`/tmp/synapse-game-package-final-check.log`
- Server：`/tmp/synapse-game-server-final-tests.log`、`/tmp/synapse-game-db-final-tests.log`、`/tmp/synapse-game-server-final-build.log`

## 部署预检与恢复边界

生产部署前只读核对生产已应用 92 个历史迁移，本地 100 个目录；其中生产历史 `20260609010000_content_store` 已不在当前目录，当前待应用为 9 份既有游戏迁移（20261030083000 至 20261030141000），没有无关待执行迁移。本次没有新增迁移。

生产 `public` schema 的 `Game%` 表数量为 0。风险扫描标记 31 项：新游戏表的唯一索引、带默认值的必填列及归档函数体中的 DELETE。已阅读对应 SQL，后者是函数定义，不在 DDL 应用时执行；归档有 90 天、锁及不可变完整副本检查。本机空库迁移与游戏专项均通过。这些已逐项审查的扫描项按既有 ALLOW_RISKY_MIGRATIONS=1 显式放行，执行既有在线备份、恢复预演、最终备份及镜像回滚流程，不删游戏表或回滚数据保护约束。

已安装的旧桌面仍包含原界面，需后续正式客户端更新才移除；本任务只部署 Web 并提交桌面退出代码。Windows、真实 macOS 跨版本升级及生产账号真实出牌未验收。


## 已部署与上线验收

2026-10-31 执行 `ALLOW_RISKY_MIGRATIONS=1 bash deploy.sh`，退出码 0，耗时 557 秒；部署本机 main 的迁移提交 `371f6a8e0`，没有 push。19 个阶段完成，PDF 渲染器预检、生产在线备份恢复与迁移预演、最终备份恢复验证通过。生产应用以上 9 份既有迁移成功，没有新增迁移文件或执行无关迁移。健康检查前两次处于启动窗口（000/502），第三次所有检查通过，并非最终健康失败。

部署目标 `root@120.53.17.64:/www/wwwroot/synapse`，线上入口 [游戏中心](https://synapse.d2.pub/game/)。新 API 容器于 08:59:54 UTC 启动，PDF 容器于 08:59:48 UTC 启动，二者实际 inspect 为 healthy，镜像分别为 `synapse-server:deploy-20261031_165051`、`synapse-pdf-renderer:deploy-20261031_165051`。

- `/game/`、`/game/poker`、`/game/poker/1234`、`/game/poker/records`、`/game/poker/agents` 均 HTTP 200，HTML SHA256 一致为 `e30e2073b512be3338af37a48ac0943e7dd491e0c6deb396cc67c068910ee000`，使用独立 `game-4ioImiZr.js` 和 `game-BHsjLiRW.css`；`/game` 跳转至 `/game/`。
- HTML 引用的脚本/样式及已输出音效、Geist 字体合计 46 个资源均 HTTP 200，类型与内容有效；未以 HTML 回退冒充资源成功。原音效中小文件按原构建策略内联。
- 无 Cookie 的 `/api/game/hall/overview`、`/api/game/poker/lobby`、`/api/game/poker/rooms/1234/state` 均 HTTP 401。
- bsk 在原浏览器上下文中只读读取 `/api/console/session`、`/api/console/me` 均为 JSON / HTTP 200；读取游戏深链 HTML 为 200 且独立入口。未退出或切换生产账号，未创建生产测试房间、出牌或兑换点数。完整游戏界面的交互和真人/MCP 交接验收发生在上文隔离环境；不能据此宣称生产账号已实际出牌。
- 首次生产 HTTP 冒烟误用了不存在的旧假定路径 `/api/game/overview`，返回 404；对照 Controller 后改用上文真实路径，最终全部通过。这是验收脚本路径错误，未修改生产代码来适配。
- bsk 构建等待期间的 eosl 会话已结束，确认 session list 为空后新建 ijni 完成最终只读验收，正常 stop/export/stop；无活跃任务浏览器会话。最终捕获 71 请求，无丢弃；4 条错误中含广告拦截扩展自身 IO/资源错误，其中同一扩展注入错误也标在网站上下文，不能声称浏览器控制台零错误。

部署与恢复定位：以下文件均在该远端服务器，不是本机文件，也没有在线分享链接。

- 环境备份：`/www/wwwroot/synapse/backups/env/synapse-env-before-sync-20261031_165051.env`
- Postgres globals：`/www/wwwroot/synapse/backups/globals/synapse-globals-before-deploy-20261031_165051.sql`
- 在线备份：`/www/wwwroot/synapse/backups/synapse-online-before-deploy-20261031_165051.sql`（233MB）
- 最终备份：`/www/wwwroot/synapse/backups/synapse-final-before-switch-20261031_165051.sql`（233MB）；临时库 `synapse_final_verify_20261031_165051` 恢复验证通过并由脚本清理。
- 回滚镜像：`synapse-server:rollback-20261031_165051`、`synapse-pdf-renderer:rollback-20261031_165051`；PDF 状态文件 `/www/wwwroot/synapse/backups/pdf-renderer-rollback-20261031_165051.state`。
- Drive 使用 COS，按既有脚本跳过本地数据备份。未实际触发回滚；代码镜像回滚不应自动删除新增游戏数据，只有必要时才按既有受控恢复流程使用备份。

本地部署日志 `/tmp/synapse-game-web-deploy.log`、HTTP 证据 `/tmp/synapse-game-production-smoke.json`、浏览器证据 `/tmp/synapse-game-production-browser-smoke.json`，均尚无在线分享链接；捕获可能含账号个人信息，不公开上传。没有桌面 Release、TestFlight 或群发通知；游戏内容未写入待发布说明。
