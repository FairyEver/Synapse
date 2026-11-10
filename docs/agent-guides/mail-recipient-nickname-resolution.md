# 邮件自动化批量昵称解析

TeamRobot 的 `synapse_internal_mail` 和 `external_mail` 钩子可以共用 `app_mail_internal_recipient_resolve`。每批最多 50 个昵称，一次调用返回逐项结果。批量入口替代原需求提出的逐个调用 `app_mail_internal_recipient_list` 并传 `matchMode` 的方案，减少 MCP 往返，并把唯一性判断交给 Synapse。

## MCP 调用

通过 Synapse 桌面 MCP 的 `search` 精确发现 `app_mail_internal_recipient_resolve`，然后用 `invoke` 调用。TeamRobot 现有 `Synapse.invoke` 已封装这两步。

```python
result = synapse.invoke("app_mail_internal_recipient_resolve", {
    "nicknames": ["测试成员甲", "测试成员乙", "测试成员丙"],
})
```

`nicknames` 是 1–50 个字符串，每项最多 100 个 UTF-16 代码单元。Synapse 去掉首尾空白并拒绝空白或无效 Unicode 输入。昵称匹配区分大小写和字符，不做 Unicode 归一化。结果与输入等长、顺序一致，`nickname` 是去掉首尾空白后的输入，重复输入也各有一个结果。以下为虚构响应。

```json
{
  "items": [
    {"nickname": "测试成员甲", "status": "matched", "userId": "example-user-id", "contactEmail": "recipient@example.com"},
    {"nickname": "测试成员乙", "status": "not_found"},
    {"nickname": "测试成员丙", "status": "ambiguous"}
  ]
}
```

| 状态 | 含义和调用方处理 |
| --- | --- |
| `matched` | 唯一可见的活跃账号。站内信用 `userId`。外部邮件须验证 `contactEmail`，`null` 或无效地址都使该动作失败。 |
| `not_found` | 当前登录账号的共同团队中没有可见的活跃精确匹配。报告该昵称。 |
| `ambiguous` | 有两个或更多可见的同名活跃用户。站内信要求配置明确的用户 ID，外部邮件要求明确的邮箱地址。 |

同一用户属于多个共同团队时只算一次。联系邮箱来自用户资料，允许为空，重名判断不考虑邮箱有无。工具缺失、未登录、HTTP 查询失败和响应不符合契约都应作为调用失败处理。新版桌面连接旧服务端时，独立路由缺失，Synapse 会返回工具错误 `recipient_resolve_unavailable`。现有 TeamRobot 客户端可能将其包装为 `synapse_operation_failed_app_mail_internal_recipient_resolve`，仍需与逐项的 `not_found` 区分。需要读取该具体原因时，从 MCP 工具错误保留相应信息即可。

## TeamRobot 接入

1. 更新 `scripts/lifecycle_hooks.py` 的两个邮件配置校验。站内信保留 `{type, value}` 对象写法并接受纯字符串昵称。外部邮件把含 `@` 的值按现有邮箱规则校验，其余非空字符串按昵称处理。
2. 在 `scripts/hook_executors.py` 共用一个昵称解析函数。按首次出现顺序收集并去重昵称，超过 50 个时分批。仅有显式 ID 或地址时跳过解析调用。保留现有 `loginEmail` 对象只匹配当前登录账号的语义。
3. 对照每批输入校验响应数量、顺序和状态。汇总全部结果后，任一查询失败、未找到、重名或缺少有效外部地址，记录失败项和原因，并在站内信预览或外部邮件草稿创建之前终止整个动作。不要从 handle、登录邮箱、历史邮件或公司域名猜测昵称的目标。
4. 站内信按最终用户 ID 去重，再调用 `app_mail_internal_send_preview` 和 `app_mail_internal_message_send`。外部邮件按最终地址去重，接回 `app_mail_draft_create`、`app_mail_send_preview`、`app_mail_message_send`。一封站内信的所有参与人仍须共享同一个团队，由预览和发送检查。
5. 新动作按当前 Synapse 登录身份解析。同一次发送沿用已解析的地址和原请求标识，未知结果沿用已有处理。收件人解析失败仅影响通知动作。更新钩子 README，并覆盖混填、去重、旧配置、批次上限和任一项失败均不创建预览或草稿的测试。

生产接入需要带该工具的 Synapse 桌面版本和支持 `POST /api/mail-internal/recipients/resolve` 的服务端。TeamRobot 使用本机 MCP，无需直接调用 HTTP 路由。
