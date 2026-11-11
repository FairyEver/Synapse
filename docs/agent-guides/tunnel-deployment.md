# 内网穿透部署

代码默认关闭，生产环境按下述流程启用。2026-11-11 已完成正式 wildcard DNS、可信证书签发和受限续期账号配置；应用部署及端到端验收结果见[验收记录](tunnel-acceptance.md)。`*.tunnel-test.d2.pub` 是独立基础设施试验，不能作为产品已上线的证据。

## 入口与前提

- 正式域为 `*.tunnel.d2.pub`，DNSPod 配一次 wildcard A 到服务器；每条映射不调用 DNS API。
- 当前边缘为 Docker `shared-caddy-edge`（Caddy 2.11.4），80/443 已由它监听。Caddy → 宿主机回环3000 → 应用容器 Nginx3000 → 容器回环3002。不要增加3002宿主机映射。
- wildcard 域所有路径，包括 `/api`、`/console`、Live 和保留路径，都进入 TunnelIngress，未知/多层/不合法 label 为404。管理 API 和控制/数据 WSS 仍只在平台域。
- Nginx 启动时从已验证的 TUNNEL 配置生成 `/etc/nginx/http.d/tunnel.conf`；关闭时仍保留命名空间的503拒绝虚拟主机（未指定时为 `tunnel.d2.pub`），不回落平台。回滚时保留原 `TUNNEL_PUBLIC_DOMAIN`，先移除Caddy区块后才能撤掉该配置。`.tunnel.d2.pub` 捕获该命名空间全部 host，严格 label 校验在 ingress，不能让无效 label 回退平台站点。
- Caddy 覆盖可信客户端地址头，Nginx 原样转交；3000只能绑定宿主机回环。公网请求不得绕过 Caddy 到达它。
- 单个服务实例持有控制连接、票据和全局预算；不要直接扩容多个 API 实例。需要扩容时另行设计会话路由与全局配额。

## 应用配置与迁移

生产业务环境设置 `TUNNEL_ENABLED=true`、`TUNNEL_PUBLIC_DOMAIN=tunnel.d2.pub`。Compose 固定 ingress 为容器 `127.0.0.1:3002`；开发根命令使用宿主机 `127.0.0.1:19703`。预算由 `.env.example` 的 `TUNNEL_MAX_*` 配置，允许降低，不得超过协议硬上限。默认每账号100映射，映射/账号/全局并发16/64/256，请求体和全局待发预算各64MiB。

迁移 `server/prisma/migrations/20261111100000_user_tunnels/migration.sql` 仅新增三张表及约束。正式操作前先备份 PostgreSQL，在专用隔离库预演，验证唯一 label、账号配额、原子幂等和软删除永久退役。现有入口脚本会 `prisma migrate deploy`，不能未经预演就以部署代替验证。

平台 Cookie 认证写操作及网页登录/退出始终要求 `Origin` 精确等于 `APP_PUBLIC_URL`，不随穿透开关关闭；Bearer 沿用原规则。部署前核对真实平台 Cookie 客户端，不能只测跨域 CORS。不要放宽为父域匹配。

## 证书与 DNSPod

沿用当前 BT `/www/server/panel/class/acme_v2.py` 和已安装的腾讯云 Python SDK，不新增Caddy插件。正式环境使用独立CAM账号 `synapse-tunnel-dns-renew`，仅授权 `d2.pub` 的 DescribeRecordList / CreateRecord / DeleteRecord，禁止控制台登录。不是复用业务主密钥，也不需要旧版DNSPod ID/Token。

凭据位于服务器 `/root/.config/synapse-tunnel/renew.env`（0600，父目录0700），变量为 `TUNNEL_DNS_SECRET_ID` / `TUNNEL_DNS_SECRET_KEY` / `TUNNEL_DNS_ZONE`。不写仓库、普通server环境或命令参数。`tunnel-acme.py` 仅把provider名称写入BT订单，严格限定挑战域，只删除本次创建的TXT记录ID。

设置以下非敏感配置：

```sh
export TUNNEL_PUBLIC_DOMAIN=tunnel.d2.pub
export TUNNEL_CERT_ROOT=/www/wwwroot/shared-caddy-edge/bootstrap-certs/tunnel
export TUNNEL_CADDYFILE=/www/wwwroot/shared-caddy-edge/Caddyfile
export TUNNEL_CADDY_CONTAINER=shared-caddy-edge
```

Caddy通过现有 `bootstrap-certs` 父目录只读挂载，证书位于容器 `/bootstrap-certs/tunnel`；保留父目录挂载，不能只挂载当前证书文件。首次安装证书后通过配置脚本加正式区块。活动路径为 `current/fullchain.pem` 和 `current/privkey.pem`，`current` 必须是符号链接。候选与历史版本仅 root 可读。

```sh
bash server/scripts/tunnel-certificate-renew.sh --check
bash server/scripts/tunnel-certificate-renew.sh --renew
# 仅在明确进行真实续期演练时：
bash server/scripts/tunnel-certificate-renew.sh --renew --force
```

`--check` 不签发、不安装，校验 wildcard SAN、密钥匹配、有效期和系统可信链，返回到期时间/剩余天数；小于14天失败。`--renew` 仅在不足30天时申请，DNS01成功后候选再次校验至少30天。复制到独立版本目录后原子切换整个证书对，Caddy validate + 强制reload（`--force`，即使配置文本未变也重新加载手动TLS文件）；失败切回旧链接并重载。首次无旧证书时失败移除新链接。后续获授权的真实验收必须通过TLS握手核对对外证书指纹，磁盘校验不能代替热加载验收。失败候选保留待检查，不覆盖旧文件、不输出证书私钥或DNS凭据。

生产已安装 root 包装器 `/usr/local/sbin/synapse-tunnel-certificate`，仅从上述0600文件加载环境。systemd `synapse-tunnel-certificate.timer` 每日03:17执行 `--renew`，独立 `synapse-tunnel-certificate-check.timer` 每日08:17执行 `--check`，均按服务器 Asia/Shanghai 时区、附加最多20分钟随机延迟并启用 Persistent。两个 service 首次实际执行均返回成功；不足14天的检查失败和续期失败会保留在 systemd failed 状态及 journal，当前没有配置外部推送告警。

运维检查使用 `systemctl list-timers 'synapse-tunnel-certificate*'`、`systemctl status synapse-tunnel-certificate.service synapse-tunnel-certificate-check.service` 和对应 `journalctl -u`。续期 service 限时15分钟，独立检查限时1分钟。崩溃遗留的 `.acme-lock` / `.renew-lock` 必须核对进程退出后人工移除，不自动删除并发锁。

## 候选入口与回滚

```sh
node server/scripts/tunnel-edge-config.mjs --check --domain tunnel.d2.pub
```

检查只输出候选区块及当前 Caddyfile SHA256，不写配置。证书必须已挂载且可信。审阅输出后显式传入相同 `--expected-sha256 <摘要>` 与 `--apply`。脚本锁定本任务区块、先备份、验证候选、拒绝配置并发变化，安装后 reload；失败恢复原区块，保留其他区块的并发修改。区块标记是 `# BEGIN SYNAPSE TUNNEL` / `# END SYNAPSE TUNNEL`。重复/缺失一侧标记会拒绝执行。生产配置脚本需要 Docker 执行权限，不从业务 API 调用。

回滚先停止新申请、关闭此功能，再退回本次 tagged 区块/上个证书版本并 validate/reload，保留平台其他站点。已分配域名记录不得删除或复用；不要 drop 表作为日常回滚。现有试验区块和正式区块互相独立，试验资源暂时保留，清理须明确授权。

正式验收覆盖原站health、Live、Webhook，新增域的HTTP/WS/SSE、本机不可达、断线重连、账号切换、慢流取消、至少一次真实 DNS01续期。只有这些完成后才能标记生产就绪。

Caddy 使用 `flush_interval 1ms` 保留客户端断开时的后端取消；SSE和未知长度响应由Caddy自动即时flush。不使用 `-1`，该模式会取消断开传播。

配置参考：[Caddy CLI reload](https://caddyserver.com/docs/command-line#caddy-reload)、[Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[log_skip](https://caddyserver.com/docs/caddyfile/directives/log_skip)、[Nginx server names](https://nginx.org/en/docs/http/server_names.html)。

生产会话已改为浏览器强制host-only的 `__Host-` Cookie（Secure、HttpOnly、Path=/、无Domain），旧Cookie不作为认证回退，因此已有网页用户需重新登录一次；桌面/iOS Bearer不变。上线仍须用真实浏览器核对公共子域无法植入平台会话，不能仅凭Set-Cookie重写宣称隔离完成。官方依据：[MDN Cookie安全配置](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies)。
