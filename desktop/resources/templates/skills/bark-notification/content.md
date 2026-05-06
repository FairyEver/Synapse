---
name: bark-notification
description: 使用 Bark 发送手机推送通知。Use when the user asks to send a Bark notification, phone push, iPhone push, or says "给我手机发消息", "给手机发信息", "bark通知我", "手机通知我", "发到我手机", or asks to notify them with a title and message.
---

当用户要求发送 Bark 通知、手机消息或手机推送时，按以下步骤执行：

1. 你的 BARK_ID 是：`${{ BARK_ID }}`。
2. 如果上面的 BARK_ID 为空或看起来不像一个有效的标识符（例如仍包含 `${{` 和 `}}` 的模板语法），不要发送请求，直接回复用户：需要在 Synapse 中设置 BARK_ID 变量后才能发送 Bark 通知。
3. 从用户消息中提取通知标题和通知内容。
4. 如果用户没有明确提供标题或内容，但当前对话上下文足够判断通知事项，可以自行生成：
   - 标题：不超过 20 个字。
   - 内容：一句话说明结果或需要用户注意的事。
5. 如果上下文不足以判断通知标题或内容，先询问用户要发送什么。
6. 对标题和内容进行 URL 编码。
7. 请求地址格式为：`https://api.day.app/${{ BARK_ID }}/{通知标题}/{通知内容}`。
8. 发送请求后，简要告诉用户发送结果。

示例：
用户说：“手机通知我，标题是构建完成，内容是 Synapse 打包成功。”
应发送：
标题：构建完成
内容：Synapse 打包成功

用户说：“打包完成后手机通知我。”
如果上下文显示打包已经完成，可以发送：
标题：打包完成
内容：Synapse 打包已完成。

URL 示例：

```text
https://api.day.app/${{ BARK_ID }}/构建完成/Synapse 打包成功
https://api.day.app/${{ BARK_ID }}/打包完成/Synapse 打包已完成。
```

实际请求前必须对标题和内容进行 URL 编码，例如：

```text
https://api.day.app/${{ BARK_ID }}/%E6%9E%84%E5%BB%BA%E5%AE%8C%E6%88%90/Synapse%20%E6%89%93%E5%8C%85%E6%88%90%E5%8A%9F
```

不要在回复中展示完整的 `BARK_ID`。
