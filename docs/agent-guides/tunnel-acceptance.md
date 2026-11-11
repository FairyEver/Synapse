# 内网穿透交付验收记录

日期：2026-11-11。实现仓库 `/Users/liyang/Documents/code/github/Synapse`，发生修改时分支为 `main`。本轮只做本地提交，无 push、远端CI、发版、产品生产部署或生产数据库迁移。

## 已实现

独立「内网穿透」应用、只填本机端口申请、多条长期固定HTTPS子域名、逐条启停/修改/删除、默认当前电脑及其他电脑只读、启动后台恢复。六项IPC与六项MCP共用管理入口；运行摘要不暴露设备密钥和传输票据。云端映射、操作回执及密钥哈希表已提供新增迁移。

原生控制/逐请求数据WSS与Live分离。只连本机回环HTTP；网站、API、二进制、WS、SSE流式转发；设备/账号/revision和本机授权一致才运行。DNS和证书为命名空间一次配置，不随每条申请新增DNS记录。

## 执行层次与结果

| 层次 | 实际执行 | 结果 |
| --- | --- | --- |
| Shared | 协议/ESM+CJS入口/背压与分帧/系统App目录，25项 | 通过 |
| Server | Tunnel管理、HTTP/WS/SSE代理、真实双端传输、认证Origin、配置、Live及Webhook回归，200项 | 通过 |
| Desktop | 应用service/账号隔离/持久化/MCP/IPC/端口与菜单组件/注册/顶栏/DataRepository schema，85项 | 通过 |
| 开发环境 | `node --test scripts/__tests__/run-server-with-env.test.mjs`，7项 | 通过 |
| 静态与构建 | shared build、server tsc、desktop完整typecheck与build、IPC codegen一致、hard-constraints、Node/Bash脚本语法 | 通过 |
| 本地macOS arm64候选 | 未签名`electron-builder --dir --publish never`，加载包内协议、schema、ws/transport及已有Worker | 构建及完整ASAR checker通过（带PTY的测试会话） |
| 真实桌面界面/浏览器 | 未启动实际应用和浏览器 | 未验证菜单视觉、窄窗口、键盘与真实网站/HMR；DOM菜单测试不代替视觉验收 |
| Windows | 当前没有执行Windows测试 | 未验证 |
| PostgreSQL | 仅生成Prisma client和validate，未连接隔离或生产库 | 迁移/约束真实数据库预演未执行 |
| 产品生产部署 | 正式`*.tunnel.d2.pub`、自动续期、实际用户访问 | 未部署/未验证，不能宣称生产就绪 |

首次无PTY工具会话在Terminal的PTY smoke失败；同一候选、同一完整checker改在带PTY会话执行后通过。未修改Terminal、签名或放宽断言。未签名候选通过资源/运行时检查，不等于正式签名与发布验收。

## 真实跨端夹具覆盖

集成测试使用正式 `TunnelTransport`、`TunnelGateway`、`TunnelBroker`、`TunnelIngress` 与 Node HTTP/WebSocket，认证及映射存储用隔离内存夹具，未伪装为真实账号数据库测试。只创建测试进程拥有的随机端口。

- 两个本机端口、三个刚申请的域名同时路由；3MiB二进制POST/下载、慢消费、原始编码路径与查询串。
- 停止/重启后URL不变、修改端口保留URL、停止503、删除410。
- WS子协议、早到帧与二进制；SSE首事件在响应结束前到达，访问者取消后释放流。
- IPv6-only回环：只在IPv4连接尚未提交字节前回退；POST写入后连接断开，本机调用次数保持1。
- 活跃SSE期间退出后控制/数据socket、pending ticket、lease、桌面flow及probe均归零。
- 旧账号晚到响应和停止后的鉴权不能新建连接；伪造端口在本机connect前拒绝；100条记录中坏一条保留其余99条。

## 测试发现与修复

全局写预算耗尽时改为等待drain；数据WSS增加独立心跳，二进制握手后拒绝文本，异常关闭释放名额；正常1000/1005关闭保留排空。终态410回执不再永久阻挡后续新申请。本机落盘失败后仍以原requestId恢复原域名。域名配置拒绝覆盖平台hostname。首屏尚未返回时申请成功仍显示链接，旧刷新不会抹掉新结果。

首次重启夹具曾把尚未关闭的旧控制连接状态当成新连接已恢复；现先观察offline，再等待新控制端running。没有通过重放请求、扩大超时或减弱业务断言规避失败。

## 基础设施试验与待办

此前已获授权在正式服务器验证 **测试命名空间**：`*.tunnel-test.d2.pub` wildcard A、系统信任的LE wildcard证书，以及两个静态探针和配置后新随机子域均返回200。这些仅为静态基础设施探针，不是本次产品端口代理。

- 证书到期：2027-02-09T08:12:41Z。尚无自动续期授权配置。
- 远端证据：`/www/wwwroot/shared-caddy-edge/backups/tunnel-test-20261111/verification.json`；原Caddy配置与试验资源位于该备份/证书目录。
- 测试DNS、证书和tagged静态区块暂时保留，未擅自删除。
- DNSPod长期API ID/Token尚缺；已只读核对BT `DNSPodDns(ID, Token)` provider，网页登录不代替续期凭据。

下一步生产操作按[部署指南](tunnel-deployment.md)：取得长期DNS01授权，专用隔离库迁移预演、正式DNS/TLS与至少一次真实续期验证、审阅候选Caddy区块后显式apply、独立域分流，核对原站health/Live/Webhook。部署和启动实际应用需要对应授权，不自动执行整版deploy或发版。

回滚保留云端映射及退役label，只回退本次tagged入口/证书版本并关闭功能；不要drop新表、复用地址或改动平台其他站点。

## 证据定位

本地测试日志和未签名候选位于 `/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-11-tunnel-app/`，暂无在线分享链接。重点日志：`final-server-suite.log`、`final-desktop-suite.log`、`task-9-shared-regression.log`、`task-9-shutdown.log`、`task-9-asar.log` / `task-9-asar-tty.log` / `final-asar.log`。代码和配套测试已按任务本地提交；最终提交与独立审查结果见Git及本次交付回复。

## 独立审查与修复

按完整实现范围进行一次独立只读审查。六项Critical/Important均有失败回归后修复：关闭后拒绝命名空间且Origin保护保持、网页会话登录/登出来源校验、证书强制reload、停止/删除/改端口期间晚到bindings快照不得重新准入、重开申请弹窗复用main持久化回执、重复Cookie字段按分号合并并过滤平台Cookie。额外核对Caddy官方配置语义，将负flush改为1ms以保留访客取消传播。

非阻塞小项暂缓：列表没有独立“浏览器打开”操作，目前通过复制URL打开。真实UI/Windows/数据库/生产与签名验收仍未执行；父域JavaScript Cookie注入的完整影响尚未验证，是生产启用前的安全门禁，未擅自改平台Cookie格式或宣称已解决。
