# 发送通知

在 Console「设置 > API 秘钥」创建密钥并勾选「发送通知」（`notification.send`）。密钥只显示一次，可在原页面撤销。

接口提供三种请求形状，写入同一个账号的通知队列，语义完全一致；选哪一种只取决于调用环境能否设置请求头和请求体。

| 形状 | 请求 | 密钥位置 |
|---|---|---|
| 整体式 | `POST /api/open/v1/notifications` | 请求体 `key` 字段 |
| 表单式 | `POST /api/open/v1/notifications/{key}` | URL 路径段 |
| 路径式 | `GET /api/open/v1/notifications/{key}/{title}/{body}` | URL 路径段 |

密钥随请求携带，三种形状都不接受 `Authorization` 头。

## 整体式

```bash
curl --request POST '{{APP_PUBLIC_URL}}/api/open/v1/notifications' \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: deploy-20260924-001' \
  --data '{"key":"syn_sk_...","title":"部署完成","body":"生产环境已更新","group":"部署","level":"active","url":"https://example.com/releases"}'
```

## 表单式

```bash
curl --request POST '{{APP_PUBLIC_URL}}/api/open/v1/notifications/syn_sk_...' \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'title=部署完成' \
  --data-urlencode 'body=生产环境已更新' \
  --data-urlencode 'group=部署'
```

这个路径也接受 `application/json` 请求体，字段与整体式除去 `key` 后相同。

## 路径式

```bash
curl --request GET '{{APP_PUBLIC_URL}}/api/open/v1/notifications/syn_sk_.../%E9%83%A8%E7%BD%B2%E5%AE%8C%E6%88%90?group=部署&level=active'
```

标题和正文是 URL 路径段，必须 URL 编码；`group`、`url` 和 `level` 只能通过 query 传。这条形状不需要请求头，也不需要请求体。

这条形状只接受 `GET`。链接预览、爬虫和邮件安全网关常用 `HEAD` 探测地址，`HEAD` 会返回 `405`，不发出通知。

`GET` 会写入数据，且整条 URL 等同密钥：任何真正抓取该 URL 的链接预览、爬虫或浏览器预取都会发出通知。按密钥保管它，不要写进公开仓库、聊天或截图。

## 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `key` | 整体式必填 | 请求体里的 API 密钥；表单式和路径式从 URL 路径段读取 |
| `title` | 是 | 1–64 字符 |
| `body` | 是 | 1–512 字符 |
| `group` | 否 | 1–64 字符 |
| `url` | 否 | 最长 2048 字符，仅 HTTPS |
| `level` | 否 | `active`（默认）、`passive` 或 `timeSensitive` |

请求体里出现未列出的字段会返回 `400`，不会被忽略。`level` 只认这三个值。

`active` 在桌面和 iPhone 提醒；`passive` 只进入消息中心；`timeSensitive` 在 iPhone 使用系统时效性提醒，在桌面按普通提醒。实际弹出方式还取决于设备的系统通知设置。

## 响应与重试

三种形状成功都返回 `201`：

```json
{
  "id": "消息 ID",
  "createdAt": "2026-09-24T08:00:00.000Z"
}
```

网络超时后重试时，可带上同一个 `Idempotency-Key` 请求头。同一密钥和去重键只创建一条消息，并返回原消息 ID。去重键为 8–120 位字母、数字、下划线或连字符；不同业务事件使用不同去重键。

| HTTP 状态 | 常见原因 |
|---|---|
| `400` | 字段超长、`url` 不是 HTTPS、出现未列出的字段，或去重键无效 |
| `401` | API 密钥无效或缺失 |
| `403` | 密钥缺少 `notification.send` 权限 |
| `405` | 用 `HEAD` 等非 `GET` 方法访问路径式地址 |
| `429` | 超过每分钟 60 次的请求限制 |

三种形状共用一个额度：每分钟最多接受 60 次请求。消息先入库再投递，推送失败不影响历史查看。历史保留 90 天，账号设备间同步已读与删除状态。标题和正文以明文存于 Synapse 服务端，并可能显示在系统通知预览中；访问日志不记录密钥和消息内容。
