# 内网穿透部署

本功能默认关闭。本轮代码未部署、迁移未执行，正式域名和自动续期尚未验收。2026-11-11 的 `*.tunnel-test.d2.pub` 是基础设施试验，不能作为产品已上线的证据。

## 入口与前提

- 正式域为 `*.tunnel.d2.pub`，DNSPod 配一次 wildcard A 到服务器；每条映射不调用 DNS API。
- 当前边缘为 Docker `shared-caddy-edge`（Caddy 2.11.4），80/443 已由它监听。Caddy → 宿主机回环3000 → 应用容器 Nginx3000 → 容器回环3002。不要增加3002宿主机映射。
- wildcard 域所有路径，包括 `/api`、`/console`、Live 和保留路径，都进入 TunnelIngress，未知/多层/不合法 label 为404。管理 API 和控制/数据 WSS 仍只在平台域。
- Nginx 启动时从已验证的 TUNNEL 配置生成 `/etc/nginx/http.d/tunnel.conf`；默认关闭时生成空配置。`.tunnel.d2.pub` 捕获该命名空间全部 host，严格 label 校验在 ingress，不能让无效 label 回退平台站点。
- Caddy 覆盖可信客户端地址头，Nginx 原样转交；3000只能绑定宿主机回环。公网请求不得绕过 Caddy 到达它。
- 单个服务实例持有控制连接、票据和全局预算；不要直接扩容多个 API 实例。需要扩容时另行设计会话路由与全局配额。

## 应用配置与迁移

生产业务环境设置 `TUNNEL_ENABLED=true`、`TUNNEL_PUBLIC_DOMAIN=tunnel.d2.pub`。Compose 固定 ingress 为容器 `127.0.0.1:3002`；开发根命令使用宿主机 `127.0.0.1:19703`。预算由 `.env.example` 的 `TUNNEL_MAX_*` 配置，允许降低，不得超过协议硬上限。默认每账号100映射，映射/账号/全局并发16/64/256，请求体和全局待发预算各64MiB。

迁移 `server/prisma/migrations/20261111100000_user_tunnels/migration.sql` 仅新增三张表及约束。正式操作前先备份 PostgreSQL，在专用隔离库预演，验证唯一 label、账号配额、原子幂等和软删除永久退役。现有入口脚本会 `prisma migrate deploy`，不能未经预演就以部署代替验证。

开启时 Cookie 认证写操作要求 `Origin` 精确等于 `APP_PUBLIC_URL`；Bearer 沿用原规则。部署前核对真实平台 Cookie 客户端，不能只测跨域 CORS。不要放宽为父域匹配。

## 证书与 DNSPod

沿用当前 BT 的 `/www/server/panel/class/acme_v2.py`，不安装 Caddy DNS 插件或新的 ACME 依赖。已只读核对该机 provider 为 `panelDnsapi.DNSPodDns(ID, Token)`，需要 **DNSPod 旧 API 的 ID 和 Token**，不是腾讯云 SecretId/SecretKey，也不是网页登录 Cookie。当前未配置这对长期凭据。

将凭据交由 root 专属的调度环境管理（文件0600、目录0700），提供 `TUNNEL_DNSPOD_ID` / `TUNNEL_DNSPOD_TOKEN`。不要写入仓库、普通 server `.env`、命令参数、调度命令文本或日志。脚本覆盖 provider 的凭据读取，BT 订单只保存 `DNSPodDns` 名称；候选证书写入独立目录，不调用 BT 的站点自动部署。

设置以下非敏感配置：

```sh
export TUNNEL_PUBLIC_DOMAIN=tunnel.d2.pub
export TUNNEL_CERT_ROOT=/www/wwwroot/shared-caddy-edge/tunnel-certs
export TUNNEL_CADDYFILE=/www/wwwroot/shared-caddy-edge/Caddyfile
export TUNNEL_CADDY_CONTAINER=shared-caddy-edge
```

Caddy 只读挂载整个 `TUNNEL_CERT_ROOT` 到 `/certs/tunnel`，保留父目录挂载，不能只挂载当前证书文件。首次安装证书后通过配置脚本加正式区块。活动路径为 `current/fullchain.pem` 和 `current/privkey.pem`，`current` 必须是符号链接。候选与历史版本仅 root 可读。

```sh
bash server/scripts/tunnel-certificate-renew.sh --check
bash server/scripts/tunnel-certificate-renew.sh --renew
```

`--check` 不签发、不安装，校验 wildcard SAN、密钥匹配、有效期和系统可信链，返回到期时间/剩余天数；小于14天失败。`--renew` 仅在不足30天时申请，DNS01成功后候选再次校验至少30天。复制到独立版本目录后原子切换整个证书对，Caddy validate + reload；失败切回旧链接并重载。首次无旧证书时失败移除新链接。失败候选保留待检查，不覆盖旧文件、不输出证书私钥或DNS凭据。

授权配置完成后，为 root 的受保护任务增加每日 `--renew` 和独立每日 `--check` 监测；失败应接入已有运维告警渠道。任务仅通过凭据管理机制加载环境。不要把“存在脚本”当成已经安装了定时任务；本次没有创建生产调度。崩溃遗留的 `.acme-lock` / `.renew-lock` 必须核对进程退出后人工移除，不自动删除并发锁。

## 候选入口与回滚

```sh
node server/scripts/tunnel-edge-config.mjs --check --domain tunnel.d2.pub
```

检查只输出候选区块及当前 Caddyfile SHA256，不写配置。证书必须已挂载且可信。审阅输出后显式传入相同 `--expected-sha256 <摘要>` 与 `--apply`。脚本锁定本任务区块、先备份、验证候选、拒绝配置并发变化，安装后 reload；失败恢复原区块，保留其他区块的并发修改。区块标记是 `# BEGIN SYNAPSE TUNNEL` / `# END SYNAPSE TUNNEL`。重复/缺失一侧标记会拒绝执行。生产配置脚本需要 Docker 执行权限，不从业务 API 调用。

回滚先停止新申请、关闭此功能，再退回本次 tagged 区块/上个证书版本并 validate/reload，保留平台其他站点。已分配域名记录不得删除或复用；不要 drop 表作为日常回滚。现有试验区块和正式区块互相独立，试验资源暂时保留，清理须明确授权。

正式验收覆盖原站health、Live、Webhook，新增域的HTTP/WS/SSE、本机不可达、断线重连、账号切换、慢流取消、至少一次真实 DNS01续期。只有这些完成后才能标记生产就绪。

配置参考：[Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[log_skip](https://caddyserver.com/docs/caddyfile/directives/log_skip)、[Nginx server names](https://nginx.org/en/docs/http/server_names.html)。
