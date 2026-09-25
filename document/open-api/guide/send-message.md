# 使用 API 发送消息

## 创建 API 密钥

1. 登录 [Synapse Console]({{APP_PUBLIC_URL}}/console/)，打开「设置 > API 秘钥」。
2. 创建密钥，勾选「发送通知」（`notification.send`）。
3. 保存完整密钥。密钥只显示一次；之后可在同一页面撤销。

密钥属于创建它的账号。通过该密钥发送的消息进入这个账号的消息中心，并发送到该账号已注册的设备。

## 发送第一条消息

密钥随请求携带，不需要 `Authorization` 头。把下面的密钥替换成刚创建的密钥：

```bash
curl --request POST '{{APP_PUBLIC_URL}}/api/open/v1/notifications' \
  --header 'Content-Type: application/json' \
  --data '{"key":"syn_sk_...","title":"部署完成","body":"生产环境已更新"}'
```

成功时返回 `201 Created`：

```json
{
  "id": "消息 ID",
  "createdAt": "2026-09-24T08:00:00.000Z"
}
```

消息会出现在 Synapse 桌面端的「消息」面板和 iPhone 的「消息」Tab。服务端先保存消息，再尝试向在线设备投递；设备未收到推送时，仍可在消息中心查看。已读和删除状态会在同一账号的设备间同步，历史保留 90 天。

## 选择请求形状

三种形状写入同一个账号的通知队列，语义一致。按调用环境能否设置请求头和请求体来选：

| 形状 | 请求 | 何时使用 |
|---|---|---|
| 整体式 | `POST /api/open/v1/notifications`，密钥在请求体 `key` | 通用，一次 JSON 提交 |
| 表单式 | `POST /api/open/v1/notifications/{key}`，消息在请求体 | 只能提交表单编码的环境 |
| 路径式 | `GET /api/open/v1/notifications/{key}/{title}/{body}` | 书签、快捷指令、webhook：不接受请求头和请求体 |

路径式只需要一条 URL：

```bash
curl --request GET '{{APP_PUBLIC_URL}}/api/open/v1/notifications/syn_sk_.../%E9%83%A8%E7%BD%B2%E5%AE%8C%E6%88%90?level=active'
```

标题和正文是 URL 路径段，必须 URL 编码。这条形状只接受 `GET`：`HEAD` 等探测性请求返回 `405`，不会发出通知。`GET` 会写入数据，且整条 URL 等同密钥：任何真正抓取它的链接预览、爬虫或浏览器预取都会发出通知。按密钥保管它。

## 设置分组、链接和提醒级别

三种形状支持同样的消息字段，整体式把 `key` 和消息放在一起：

```bash
curl --request POST '{{APP_PUBLIC_URL}}/api/open/v1/notifications' \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: deploy-20260924-001' \
  --data '{"key":"syn_sk_...","title":"部署完成","body":"生产环境已更新","group":"部署","url":"https://example.com/releases","level":"timeSensitive"}'
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 是 | 标题，1–64 字符 |
| `body` | 是 | 正文，1–512 字符 |
| `group` | 否 | 分组，1–64 字符 |
| `url` | 否 | 点击消息详情后可打开的 HTTPS 链接，最多 2048 字符 |
| `level` | 否 | `active`、`passive` 或 `timeSensitive`；默认 `active` |

| `level` | 投递方式 |
|---|---|
| `active` | 桌面显示系统通知，iPhone 显示普通推送 |
| `passive` | 仅保存到消息中心，不弹出提醒 |
| `timeSensitive` | 桌面按普通通知提醒，iPhone 使用系统时效性提醒 |

实际弹出方式还取决于设备的系统通知设置。

## 重试与错误

网络超时后重试时，可在请求头中使用同一个 `Idempotency-Key`。同一密钥和去重键只创建一条消息，并返回原消息 ID。去重键须为 8–120 位字母、数字、下划线或连字符；不同业务事件使用不同去重键。

| HTTP 状态 | 常见原因 |
|---|---|
| `400` | 字段超长、`url` 不是 HTTPS、请求体出现未列出的字段，或去重键无效 |
| `401` | API 密钥无效或缺失 |
| `403` | 密钥缺少 `notification.send` 权限 |
| `405` | 用 `HEAD` 探测路径式地址（其它非 `GET` 方法返回 `404`） |
| `429` | 超过每分钟 60 次的请求限制 |

三种形状共用一个请求额度。

API 密钥仅用于服务端、CLI 或自动化客户端。不要将其写入浏览器代码、公开仓库或日志。消息标题与正文以明文保存在 Synapse 服务端，也可能出现在锁屏预览中。

## 不需要密钥的场景

在 Claude Code、Codex 等编辑器里让 AI 通知你时，不需要创建 API 密钥。这类客户端通过 Synapse MCP 调用 `app_system_notifier_notification_trigger`，消息走桌面端已登录的账号发送，进入同一个消息中心并推送到同一批设备。用户在 System Notifier 里可以分别关闭本机通知与账号同步。

API 密钥适用于没有桌面端登录态的调用方：服务端任务、CI、其它机器上的脚本和第三方集成。

了解更多：[发送通知 API 参考](/open-api/api/notification-send)、[OpenAPI 3.1 契约]({{APP_PUBLIC_URL}}/api/open/openapi.json)。
