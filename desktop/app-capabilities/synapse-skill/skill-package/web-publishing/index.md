# 网页制作、数据存储与发布

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or an exact `app_*` name, then call `invoke` with `toolName` set to that exact name and `arguments` matching its returned `inputSchema`. Never guess tool names or arguments.

适用于「做个网站，用户填写后保存数据，给别人用」「做一个有逻辑、有表单、有图片的网页并发布」等需求。用户不必先说出云表或云盘名称。使用当前 Synapse Skill 的 `search` / `invoke` 发现并调用工具；搜索结果只供发现，不扩大用户授权。

## 先判断需要什么

- 纯展示网页、已有静态站点，或明确仅使用 localStorage / 本地保存：按 [Drive HTML Sharing Route](../drive/index.md#html-sharing-route) 发布，不建云表；本地浏览器保存不代表跨设备共享。
- 访客提交并由服务端保存的表单：先按 [云表发布流程](../cloud-tables/public-apps.md)检查环境、建表及最小权限，再由 Drive 发布网页。不能用桌面 Database / Data Store 代替公开网站的数据后端。
- 只写表单组件、校验函数、示例代码：按原项目开发，不因此创建云表、开放匿名权限、上传或分享。明确不需要后端时不建云表；若同时要求发布，仍按静态网页路线执行。保留已有后端和用户指定的平台。
- 先核对谁可填写、谁可看记录，以及用户是否要求身份识别。公开收集默认仅开放匿名 create，不能为方便而开放名单或修改、删除权限。

网页 JavaScript 可以处理显示、筛选、交互和费用预估，但它可被绕过。云表字段当前支持类型、必填、默认值和选项校验，不提供任意服务端代码、公式、字段数值范围、库存事务或支付核验。人数下限、每人一次、名额、金额、订单等必须先核对服务端能否强制执行，不能将客户端校验或幂等键当成这些业务约束。开放表单也不自动识别登录的 SY 用户；不能承诺登录后查看本人记录。

区分“展示图片”和“访客上传图片”：静态图片可随站点发布；云表没有附件字段，作者的 Drive 图床工具也不是匿名访客上传接口。若用户要求访客上传，先核对独立上传能力，不能用保存 URL 字段冒充文件上传完成。

## 图片与发布顺序

1. 先检查本次网页的文件和依赖，包含 HTML、CSS、脚本及引用图片。不要上传无关邻居文件。
2. **仅当用户明确要求图片上图床、公开素材或图片直链时**，按 [HTML Image Hosting](../drive/index.md#html-image-hosting) 先上传各张图片，拿齐返回链接，再改写网页及依赖文件中的对应引用。未明确要求时保留相对资源，不自动创建公开素材。
3. 改写后重新检查最终产物。独立单文件 HTML → `app_drive_file_upload` + `app_drive_share_create`；多文件、多页或仍依赖本地 CSS / JS / 图片等资源 → `app_drive_folder_upload` + `app_drive_site_create`。图床图片变为远程链接后，若已无任何本地依赖，单文件可走文件分享。明确要求发布整个目录时沿用 Drive 的整目录规则。
4. 更新已有链接时先解析，复用原文件分享或站点。站点更新需要更新源文件后 `app_drive_site_republish`，不能只覆盖云盘文件就声称线上更新。

## 验收与交付

- 检查发布页、图片、样式及脚本可加载；实际操作表单与联动逻辑，覆盖空值、错误状态和窄屏。图床路线核对每个替换 URL 可达且旧本地图片引用已消除。
- 云表页面按云表指南做无 Cookie、无授权头提交、幂等重试及表主 MCP 读回；验证匿名名单和未开放的读、修改、删除拒绝。对业务约束做绕过前端的请求验证，不符合时明确尚未支持。
- `local_only` 仅本机验收，不能当公网交付；公网交付需要独立网络匿名验证。保存 tableId（如有）、Drive itemId / sourceFolderItemId、share URL / siteId、图片 assetId 与 URL 对照，方便恢复和更新。
- 只向当前用户返回链接；未要求指定渠道或收件人时，不替用户发送给其他人。只报告实际验证完成的范围。
