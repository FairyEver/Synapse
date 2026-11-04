# 用一句话做一个云表报名页

示例：「做一个活动报名页，任何人打开都能填，只有我能看名单。」追问示例：「在原链接加一个公开报名人数，别公开名单。」

## 1. 先检查发布环境

用 MCP `search` 搜用户原话，读取实际返回的工具契约。调用 `app_cloud_tables_publish_preflight_get`（参数 `{}`），核对 `accountId`、`publicAppUrl`、`audience` 和 `capabilities`。使用当前 Synapse 桌面登录账号。不要请求 API Key，不从网页获取凭据。

| 返回状态 | 处理 |
|---|---|
| `local_only` | 链接只能用于该环境的预览，不能当公网交付。如果用户只要在当前本机验收，明确标记本机后继续。 |
| `external_verification_required` | 已配置 HTTPS 地址，仍要用独立网络的匿名请求验证实际分享页、schema 和提交。 |
| `unconfigured`、`https_required`、`environment_mismatch` | 先说明当前发布地址的问题。面向外部发布时在建表前停下，等待连接到用户确认的部署。 |
| `CLOUD_TABLE_ACCOUNT_REQUIRED`、`CLOUD_TABLE_PREFLIGHT_UNAVAILABLE` | 引导检查桌面登录和服务版本。工具缺失时检查已安装 Synapse Skill 与桌面版本。 |

只有 `capabilities.anonymousCreate` 可用时继续做公开收集。公开人数还需要 `capabilities.publicCount`。预检不做写入，不判定某个尚未创建的分享地址是否可达。

## 2. 建表，保持名单私有

发现 `app_cloud_tables_table_create`。根据用户需求取最少字段，示例：

```json
{
  "name": "活动报名",
  "fields": [
    { "key": "name", "name": "姓名", "type": "text", "required": true },
    { "key": "note", "name": "备注", "type": "text" }
  ],
  "idempotencyKey": "signup-example-create"
}
```

为每个实际任务生成并保存自己的幂等键。记录返回的 `id`，调用 `app_cloud_tables_table_get` 核对当前账号确为表主，读回字段和 `schemaVersion`。调用 `app_cloud_tables_permissions_update`：

```json
{
  "tableId": "<实际表 ID>",
  "version": 1,
  "anonymous": { "create": true },
  "members": []
}
```

`version` 用刚读到的值。新表默认关闭匿名读取、更新和删除，也不添加协作者。若是在改旧表，先读回并核对现有授权，尤其是与「只有我能看」冲突的现有读权限。遇到版本冲突先重新读取，逐项核对差异。

## 3. 发布和验收

用随 Skill 分发的 [单文件报名页模板](public-signup.html)，复制到本次任务的工作区后修改活动名称和 `synapse-table`。首次发布将 `synapse-public-count` 保持为 `false`。模板从同一个部署读取 schema，用 `credentials: "omit"` 提交记录，并用相同幂等键重试同一份回答。模板支持必填的 `name` 和可选的 `note`。若用户明确要求其他字段，按实际 schema 调整模板。

按 [Drive HTML 分享流程](../drive/index.md#html-sharing-route)，上传唯一命名的 HTML 到用户的云盘，使用 `app_drive_share_create` 返回免密码、只读的文件分享。保存 `tableId`、云盘 `itemId`、`parentId`、文件名和分享 URL。操作中断后从这些回执恢复，先核对已经创建的资源。

匿名验收分三项：

1. 打开分享资源的 HTTP 渲染入口并检查公开 schema。用无 Cookie 和授权头的请求，提交可明确识别的测试姓名，拿到记录 ID。
2. 匿名 `GET /records/{recordId}` 和 `POST /records/query`、`/records/count`、`/records/exists` 都应拒绝。初次发布时 `GET /public-count` 也应拒绝。
3. 用表主 MCP `app_cloud_tables_record_get` 读回本次验收记录，核对其 ID 和姓名。验收获授权时，仅将自己的测试记录移入回收站，复验数值归回验收前。也可先用独立测试表验证写入。

所有路径相对 `/api/open/v1/tables/{tableId}`。独立网络无法访问或未验收时，按实报告。只把链接返回给当前用户，除非用户明确让你发给具体对象。

## 4. 在原链接加公开报名数

先重新运行预检，解析原链接，确认原 `itemId` 和绑定的表。读回表权限。调用原表的 `app_cloud_tables_permissions_update`，保留 `anonymous: { create: true }` 和已有无关配置，另加顶层 `publicCount: true`。该开关只公开无筛选的 `{ count }`，关闭用 `publicCount: false`。原始名单权限独立。

把同一份 HTML 的 `synapse-public-count` 改为 `true`，同目录同名上传覆盖，复用原 `itemId` 和分享 URL。模板会在打开和提交后读取 `GET /public-count`，页面可见时每 15 秒刷新。检查匿名只能看到数字，并重新验证匿名名单、通用查询和计数仍被拒绝。表主仍通过 MCP 查看名单。

公开数字是有效报名记录份数。匿名填表无法凭姓名确认唯一身份。有「每人只能报名一次」或「达到名额就停止」要求时，先核对身份和服务端规则，不能用客户端校验或幂等键承诺这类约束。
