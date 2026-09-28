# Portal Headless 正式连接器

Synapse 的 **Portal Headless**（`portal-headless`）连接正式环境；**Portal Headless Test**（`portal-headless-test`）继续连接测试环境。两者沿用相同的授权回调校验、远端身份与企业验证、加密凭据保存、账号/环境隔离、断开及重连机制，详见 [测试连接器契约](portal-headless-test.md)。

| 项目 | 正式环境值 |
|---|---|
| 连接器 ID | `portal-headless` |
| 环境 | `prod` |
| API | `https://biz-api.wodecorp.cn` |
| 网页 | `https://portal.wodecorp.cn/#/` |
| 授权入口 | `https://portal.wodecorp.cn/#/connect/synapse` |
| 回调 | `synapse://portal-headless/callback` |
| 默认语言 | `zh-CN` |

正式网页首页由用户提供为 `https://portal.wodecorp.cn/#/dashboard/home`；授权入口按相同 hash 路由结构推定。正式站尚未部署授权页，因此当前只完成 Synapse 侧接线，不能宣称真实授权联调通过。Web 侧需按 [测试环境授权页契约](portal-headless-test-web-prompt.md) 实现相同参数和回调形态，但将 origin、API、`environment`、回调和展示名称改为上表正式环境值，并严格拒绝测试环境请求。

扩展凭证工具接受 `environment: "prod"`，取得正式连接器凭据和绑定 `prod` 的短期 SY 授权；不传环境仍按既有测试环境处理。扩展后端依据授权中的环境使用对应固定 API，客户端不能提交任意业务 API 地址。正式环境未进行真实 Portal 授权与业务调用验收。
