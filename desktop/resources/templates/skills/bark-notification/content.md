---
name: bark-notification
description: 使用 Bark 发送手机推送通知。Use when the user asks to send a Bark notification, phone push, iPhone push, or says "给我手机发消息", "给手机发信息", "bark通知我", "手机通知我", "发到我手机", or asks to notify them with a title and message.
---

当用户要求发送 Bark 通知、手机消息或手机推送时，按以下步骤执行：

1. 使用 `BARK_ID` 占位值：`${{ BARK_ID }}`。
2. 如果 `BARK_ID` 为空、未设置，或仍然是占位符 `${{ BARK_ID }}`，不要发送请求，直接回复用户：需要设置 BARK_ID 后才能发送 Bark 通知。
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

不要在回复中展示完整的 `BARK_ID`。
