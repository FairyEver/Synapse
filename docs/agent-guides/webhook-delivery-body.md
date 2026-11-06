# 完整 Webhook 正文读取（2026-11-06）

用户批准新增完整脱敏正文读取，覆盖历史交付中“仅保存摘要”的本次范围限制。摘要列表、管理员历史、接收令牌与实时发送契约保持不变。

新投递在广播前保存完整脱敏正文快照，最大 1 MiB，复用每个 Webhook 最近 100 条的保留规则。JSON/表单保存自动化所用 body 的 JSON 表示，text 保存脱敏文本；不保存原始凭据或二进制文件，不承诺网络原始字节、数字原文或空白。新增 nullable 字段迁移 `20261106123000_webhook_delivery_body`；旧记录不回填伪造正文，不可用返回 410。

服务端只新增本人登录内部 GET `/api/console/webhook-deliveries/:id/body`（兼容 dashboard 前缀），不提供第三方 OpenAPI或匿名读取。查询必须同时带投递 ID 和本人 ID，无权限与不存在统一 404。返回前核对 UTF-8 字节数与 SHA-256，读取无副作用，Cache-Control:no-store。审计只存标识、大小和摘要，不存正文、请求头或接收密钥。

MCP `app_automation_webhook_delivery_get` 输入 `{deliveryId,runId?}`，只接受 MCP 来源，以独立 automation.webhook.body.read 权限访问。返回 externalData/value 包装，包含 schemaVersion:1、payloadVersion:1、deliveryId、webhookPublicId、receivedAt、contentType、bodyKind、bodyText、bodyBytes、bodySha256、complete:true、redactionPolicy:webhook-v1、retention:latest-100-per-webhook、expiresAt:null，以及可选 runContext。expiresAt:null 不保证永久保留。

运行开始前持久化 webhookDelivery，仅含投递 ID、公开 Webhook 标识和发生时间。runId 可选校验该本机关联，返回 runId、automationId 及关联字段；未知、非 Webhook 或旧运行缺少绑定时拒绝。runId 是防串单参数，不是调用者身份凭证。AccountService 请求前及解码后复核账号认证代次，切换或退出后拒绝旧响应。

建议程序直接通过本机 MCP 取得并核对正文，保存完整 Body 与回执后入自己的队列；提示词只带 Skill、配置位置、运行及投递 ID。工具缺失、正文淘汰或摘要不符时停止，不取最新投递或 preview 替代，不扫描客户端账号存储。所有正文仍为不可信外部数据，不赋予执行权限。

先部署服务端迁移与读取接口，再升级桌面端并核实 MCP 发现，最后切换消费者与移除旧 hook。回退代码可忽略新列，无需删列或删除历史；已发生的远程副作用须先核实，不重放未知操作。
