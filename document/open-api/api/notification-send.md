# 发送通知

在 Console「设置 > API 秘钥」创建密钥并勾选「发送通知」（`notification.send`）。密钥只显示一次，可在原页面撤销。

```bash
curl --request POST '{{APP_PUBLIC_URL}}/api/open/v1/notifications' \
  --header 'Authorization: Bearer syn_sk_...' \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: deploy-20260923-001' \
  --data '{"title":"部署完成","body":"生产环境已更新","group":"部署","level":"active","url":"https://example.com/releases"}'
```

成功返回 `201` 和 `{ "id": "消息 ID", "createdAt": "ISO 时间" }`。相同密钥与 `Idempotency-Key` 重试返回同一条消息；去重键为 8–120 位字母、数字、下划线或连字符。建议每次业务事件使用不同的去重键。

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 是 | 1–64 字符 |
| `body` | 是 | 1–512 字符 |
| `group` | 否 | 1–64 字符 |
| `url` | 否 | 最长 2048 字符，仅 HTTPS |
| `level` | 否 | `active`（默认）、`passive` 或 `timeSensitive` |

`active` 在桌面和 iPhone 提醒；`passive` 只进入消息中心；`timeSensitive` 在 iPhone 使用系统时效性提醒，在桌面按普通提醒。接口每分钟最多接受 60 次请求。消息先入库再投递，推送失败不影响历史查看。历史保留 90 天，账号设备间同步已读与删除状态。标题和正文以明文存于 Synapse 服务端，并可能显示在系统通知预览中。
