# Portal Link 正式连接器

Synapse 的 **Portal Link**（`portal-headless`）连接正式环境；**Portal Link Test**（`portal-headless-test`）继续连接测试环境。两者沿用相同的授权回调校验、远端身份与企业验证、加密凭据保存、账号/环境隔离、断开及重连机制，详见 [测试连接器契约](portal-headless-test.md)。

显示名称与 Portal Web 授权页统一使用 Portal Link / Portal Link Test。内部连接器 ID、回调地址和凭据存储键保持兼容；改名不迁移凭据，也不要求用户重新授权。

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

正式凭据通过 `app_connectors_portal_link_credential_get` 读取，测试凭据通过 `app_connectors_portal_link_test_credential_get` 读取，均接受空对象。两者只读取本机，不换取 SY 后台授权、不调用业务 SDK；账号或连接变化时拒绝旧结果。旧业务扩展已经移除，不提供兼容业务 API。正式授权联调仍需独立验收。
