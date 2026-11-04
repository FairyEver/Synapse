# 云端数据表

为网页、脚本和 AI 提供有类型的数据表。建表、字段配置、权限、记录、回收站和操作记录均提供 REST API，可由 Agent 完成整个管理流程，也可通过 Console 操作；数据保存在云端，不依赖桌面应用在线。

本页包含完整的认证约定、接口列表、请求与响应示例，可使用页面的“复制 Markdown”交给 AI。示例 ID 均为占位值，调用时使用实际响应中的 ID、字段 key 和版本。

## 地址与机器可读契约

| 项目 | 地址 |
|---|---|
| 应用根地址 | `{{APP_PUBLIC_URL}}` |
| 接口基础地址 | `{{APP_PUBLIC_URL}}/api/open/v1` |
| OpenAPI 3.1 JSON | `{{APP_PUBLIC_URL}}/api/open/openapi.json` |

[打开 OpenAPI 契约]({{APP_PUBLIC_URL}}/api/open/openapi.json)，获取当前部署版本的请求、响应和认证 schema。下文 `/tables` 路径都接在 `/api/open/v1` 后，不要省略版本前缀或改用 Console 的登录接口。

## 通过 Synapse 桌面端让 AI 操作

如果正在使用已登录的 Synapse 桌面端，让 AI 按现有 Synapse Skill 的云表指南在 MCP 中查找 `cloud_tables`。MCP 使用当前登录账号及现有表权限，支持建表、字段与权限配置、记录读写、回收站和日志，无需提供 API 密钥。

以下开放 HTTP API 面向独立脚本、外部集成与公开网页。

制作报名、征集等网页时，先调用 `app_cloud_tables_publish_preflight_get`。它通过当前登录身份返回服务地址、可用功能以及本机、需外网验收或配置异常等状态，不会创建表或发布链接。按系统 Synapse Skill 中的中文报名页流程完成建表、云盘发布、匿名验收和原链接更新。只在外部网络实际可访问后交付为公网链接。

## 为独立脚本和外部集成准备密钥与表

1. 用户在 Console 的“设置 > API 密钥”创建个人密钥，选择任务需要的云表操作权限；将密钥交由自己的 Agent、脚本或后端私有运行环境保管。
2. **让 Agent 从零建表**：授予 `tables.manage`，表资源选择“自己的全部表”（`all_owned`）。Agent 可直接调用建表接口并配置字段，无需先到 Console 手工建表。需要读写记录时，另选对应记录 scope。
3. **只操作已有表**：表资源选择“指定表”，勾选自己或已获协作授权的目标表，按任务选择管理或记录 scope。默认没有任何表资源，只有 scope 仍不能访问表。
4. 在私有环境中配置 `SY_API_KEY`。创建表后保留响应中的表 ID；操作已有表时，可通过表列表接口发现已授权的表。新表默认私有。

密钥的创建、资源范围和 scope 的扩大由用户在官方 Console 配置。云表管理接口不会为 Agent 自动签发密钥、扩权或授权其他表。

本页 cURL 示例使用以下环境变量：

```bash
export SY_API_BASE_URL='{{APP_PUBLIC_URL}}'
export SY_TABLE_ID='替换为实际表ID'
export SY_RECORD_ID='替换为实际记录ID'
# SY_API_KEY 由私有运行环境注入，不要把真实密钥写进网页或共享文档。
```

`SY_API_BASE_URL` 是应用根地址，不含 `/api`，不带末尾斜杠。表 ID 和记录 ID 是不透明标识，不能根据表名、内容或示例拼接。

### scope 与表资源

| scope | 允许的操作 |
|---|---|
| `tables.manage` | 表主管理结构、权限、回收站和操作记录；API 建表另需“自己的全部表” |
| `tables.records.read` | 查询及读取记录 |
| `tables.records.create` | 新增记录 |
| `tables.records.update` | 修改记录 |
| `tables.records.delete` | 删除记录 |

表资源范围：

- **指定表**：仅包含明确选择的表，可以是自己的表或已获授权的协作表。Console 的已选列表可移除已删除、撤权或不在当前页的表 ID；不会自动清除其他页的选择。已有协作成员可沿用表开放的匿名操作，但仍需相应 scope。
- **自己的全部表**：包含自己当前及以后创建的表，不包含他人的协作表。

已有密钥不会自动获得云表权限。API 建表必须同时具备 `tables.manage` 和“自己的全部表”；指定表密钥不能建表或自行扩大资源范围。管理 scope 不替代记录的读写 scope。

协作者使用自己的密钥，同时需要表主授予表权限。每次操作检查 **密钥 scope、表资源范围、当前表授权、记录归属**；撤权后排队请求也会重新检查。

### 私有调用与匿名网页

私有调用使用单个 Bearer 密钥：

```http
Authorization: Bearer syn_sk_...
Content-Type: application/json
```

开放接口忽略 Cookie，不接受普通登录 Token，也不从 query、请求体或 `X-API-Key` 读取密钥。没有 `Authorization` 时按匿名处理；提供无效密钥时返回 `401 INVALID_API_KEY`，不会降级成匿名。

公开网页只能执行表主显式开放的匿名操作，使用 `credentials: 'omit'` 且不发送密钥。第一版不支持网页按访问者的 Synapse 登录身份操作私有数据，包括 Synapse 分享网页。私有访问应由 AI、脚本或持有受限密钥的自有后端发起。

### 管理操作的身份边界

| 调用方 | 身份与入口 | 可执行范围 |
|---|---|---|
| 独立脚本、外部 Agent 或外部集成 | 本人的 API 密钥，调用 `/api/open/v1/tables` | 账号现有权限与密钥 scope、表资源范围共同允许的操作 |
| 官方 Console 或 Synapse 桌面 MCP | 当前用户的登录状态，使用独立的账号通路 | 本人作为表主或协作者可执行的操作 |
| 指定协作者的 Agent | 协作者本人的 API 密钥 | 获授权表的结构发现和记录操作；持有 `tables.manage` 也不能管理别人的结构、授权或回收站 |
| 分享网页或其他公开网页 | 不发送密钥、Cookie 或登录 Token | 仅限表主显式开放的匿名操作，不能管理表配置 |

**新表归当前操作账号，配置已有表必须是表主。** 修改表名、添加／修改／归档／恢复字段、配置匿名访问、增删协作者、删除／恢复表、管理记录回收站和查看操作记录，都要求表主身份。使用 API 时还需 `tables.manage` 和该表的资源授权。仅有管理 scope 或知道表 ID 不构成表主授权。

密钥与登录状态分别对应上述两种入口，不混用。Agent 不应调用登录接口索取用户密码、从网页提取 Cookie，或把普通登录 Token 当作开放 API 密钥。缺少管理权限时停止相关操作，告知用户需要补充哪项授权。

## 接口列表

路径相对于 `{{APP_PUBLIC_URL}}/api/open/v1`。所有 `POST` 成功返回 `201`；`GET`、`PATCH`、`DELETE` 成功返回 `200`，包括带 JSON 请求体的删除操作。

| operationId | 方法 | 路径 | 权限 |
|---|---|---|---|
| `listCloudTables` | GET | `/tables` | 有云表 scope 的密钥，按资源范围列出自己的表和协作表；匿名不能列目录 |
| `createCloudTable` | POST | `/tables` | `tables.manage` + 自己的全部表 |
| `getCloudTable` | GET | `/tables/{id}` | 至少一项可用的表权限 |
| `getCloudTableSchema` | GET | `/tables/{id}/schema` | 至少一项可用的表权限 |
| `getCloudTableDailySummary` | GET | `/tables/{id}/daily-summary` | 表主已发布的今日汇总可匿名访问 |
| `getCloudTablePublicCount` | GET | `/tables/{id}/public-count` | 表主已启用的记录总数可匿名访问 |
| `updateCloudTable` | PATCH | `/tables/{id}` | 表主 + `tables.manage` |
| `setCloudTablePermissions` | PATCH | `/tables/{id}/permissions` | 表主 + `tables.manage` |
| `resolveCloudTableCollaborator` | POST | `/tables/{id}/collaborators/resolve` | 表主 + `tables.manage` |
| `deleteCloudTable` | DELETE | `/tables/{id}` | 表主 + `tables.manage` |
| `listDeletedCloudTables` | GET | `/tables/trash` | 本人的表回收站，不包含协作表 |
| `restoreCloudTable` | POST | `/tables/{id}/restore` | 表主 + `tables.manage` |
| `queryCloudTableRecords` | POST | `/tables/{id}/records/query` | `tables.records.read` + 表的查询授权 |
| `countCloudTableRecords` | POST | `/tables/{id}/records/count` | 同上，仅统计可读且未删除记录 |
| `existsCloudTableRecords` | POST | `/tables/{id}/records/exists` | 同上，仅检查可读且未删除记录 |
| `getCloudTableRecord` | GET | `/tables/{id}/records/{recordId}` | 同上，且记录在可读范围内 |
| `createCloudTableRecord` | POST | `/tables/{id}/records` | `tables.records.create` + 表的新增授权 |
| `updateCloudTableRecord` | PATCH | `/tables/{id}/records/{recordId}` | `tables.records.update` + 表的修改授权 |
| `deleteCloudTableRecord` | DELETE | `/tables/{id}/records/{recordId}` | `tables.records.delete` + 表的删除授权 |
| `mutateCloudTableRecords` | POST | `/tables/{id}/records/batch` | 批次内每个操作分别检查对应权限 |
| `listDeletedCloudTableRecords` | GET | `/tables/{id}/records/trash` | 表主 + `tables.manage` |
| `restoreCloudTableRecord` | POST | `/tables/{id}/records/{recordId}/restore` | 表主 + `tables.manage` |
| `listCloudTableLogs` | GET | `/tables/{id}/logs` | 表主 + `tables.manage` |

匿名可调用已开放的记录操作及结构发现接口，不需要 scope；不能管理结构、权限、回收站或日志。

## 响应约定

云表成功响应直接返回对象，**没有统一的 `requestId` / `data` 外层封装**。只有列表、查询和批次结果按各自约定使用 `data`：

| 场景 | 成功响应形状 |
|---|---|
| 建表 | `{ "id": "表ID", "schemaVersion": 1 }` |
| 表详情／结构／修改结构 | 表对象；匿名发现结构时返回精简对象，见下文 |
| 表列表／记录查询／回收站／日志 | `{ "data": [...], "nextCursor": "...或null" }` |
| 条件计数 | `{ "count": 123 }` |
| 存在判断 | `{ "exists": true }`，无匹配时为 `false` |
| 新增／修改／删除／恢复记录 | `{ "id": "记录ID", "version": 1 }`，实际版本以响应为准 |
| 批量写入 | `{ "data": [{ "id": "记录ID", "version": 1 }] }`，与输入顺序对应 |
| 设置权限 | `{ "schemaVersion": 2 }` |
| 删除／恢复表 | `{ "id": "表ID", "schemaVersion": 2 }` |
| 查询协作者 | `{ "id": "用户ID", "handle": "用户名" }` |

写入响应不返回记录正文；只有新增权限时不能借写入响应读取数据。不要从建表响应读取 `data.id`，也不要假定记录写入返回 `values`。

成功和错误响应都有 `X-Request-Id`，JSON 响应使用 `Cache-Control: no-store`。错误体单独包含 `requestId` 和 `error`，见文末。

## 表结构与字段

### 创建表

```bash
curl --fail-with-body --request POST "$SY_API_BASE_URL/api/open/v1/tables" \
  --header "Authorization: Bearer $SY_API_KEY" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: registration-table-001' \
  --data '{"name":"报名","fields":[{"key":"name","name":"姓名","type":"text","required":true},{"key":"status","name":"状态","type":"singleSelect","defaultValue":"new","options":[{"key":"new","name":"新提交"},{"key":"done","name":"已处理"}]},{"key":"score","name":"分数","type":"number"}]}'
```

成功返回 `201`：

```json
{ "id": "table_example", "schemaVersion": 1 }
```

将返回的 `id` 设为 `SY_TABLE_ID` 后继续调用。同一幂等键表示同一次建表；创建另一张表需换键。

| 请求字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 去除首尾空白后 1–100 字符 |
| `fields` | array | 否 | 活动字段定义，默认 `[]`，最多 100 个 |

每个字段定义如下：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | 是 | 稳定 API 标识，以小写字母开头，只含小写字母、数字、下划线，最长 64 字符；表内唯一 |
| `name` | string | 是 | 显示名，去除首尾空白后 1–100 字符；改名不改变 key |
| `type` | string | 是 | 下表中的 10 种类型之一 |
| `required` | boolean | 否 | 默认非必填；最终值不能为 `null`，新增时省略且无默认值会报错 |
| `defaultValue` | JSON value | 否 | 须符合字段类型，仅在新增且未提供该字段时使用 |
| `options` | array | 选择类型需要 | 单选／多选选项，1–100 项；每项 `{ "key": "new", "name": "新提交" }` |

选项 key 为 1–64 字符，name 为 1–100 字符，key 在字段内唯一。写记录传选项 key，不传显示名。改显示名不影响已有调用。请求定义不传只读的 `archivedAt`。

| type | JSON 值示例 | 约束 |
|---|---|---|
| `text` | `"张三"` | 字符串 |
| `integer` | `42` | 安全整数，不能传 `"42"` |
| `number` | `87.5` | 有限数值，不能传数字字符串 |
| `boolean` | `true` | 布尔值，不能传 `"true"` 或 `1` |
| `date` | `"2026-11-01"` | 真实有效的 `YYYY-MM-DD` 日期 |
| `datetime` | `"2026-11-01T08:30:00.000Z"` | UTC ISO 时间，使用 `Z`，不能传时区偏移；响应规范化为毫秒格式 |
| `singleSelect` | `"new"` | 已定义选项 key |
| `multiSelect` | `["red", "blue"]` | 已定义选项 key 数组，不重复 |
| `url` | `"https://example.com"` | 完整 HTTP 或 HTTPS URL |
| `json` | `{ "source": "web", "count": 2 }` | 任意合法 JSON 值，也可以是数组、字符串、数值或布尔值 |

可选字段用 `null` 清空。`required` 检查是否缺值，不额外禁止空字符串或空数组。默认值不回填已有记录，修改默认值也不改变已有记录。

### 读取列表与表结构

```bash
curl --fail-with-body "$SY_API_BASE_URL/api/open/v1/tables" \
  --header "Authorization: Bearer $SY_API_KEY"

curl --fail-with-body "$SY_API_BASE_URL/api/open/v1/tables/$SY_TABLE_ID/schema" \
  --header "Authorization: Bearer $SY_API_KEY"
```

列表返回 `{ "data": [表摘要], "nextCursor": null }`。摘要包含 `id`、`ownerId`、`viewerId`、`name`、`schemaVersion`、`createdAt`、`deletedAt`、`permissions`，不包含字段、匿名配置或协作者。

`GET /tables/{id}` 和 `GET /tables/{id}/schema` 对获授权的密钥返回相同的表详情：

```json
{
  "id": "table_example",
  "ownerId": "user_owner",
  "viewerId": "user_owner",
  "name": "报名",
  "schemaVersion": 1,
  "fields": [
    { "key": "name", "name": "姓名", "type": "text", "required": true, "archivedAt": null },
    { "key": "status", "name": "状态", "type": "singleSelect", "defaultValue": "new", "options": [{ "key": "new", "name": "新提交" }, { "key": "done", "name": "已处理" }], "archivedAt": null },
    { "key": "score", "name": "分数", "type": "number", "archivedAt": null }
  ],
  "anonymous": {},
  "members": [],
  "deletedAt": null,
  "createdAt": "2026-11-01T08:00:00.000Z",
  "permissions": { "read": "all", "create": "all", "update": "all", "delete": "all", "manage": "all" }
}
```

`permissions` 是当前调用者可用权限的提示，取值 `none/own/all`；实际执行仍重新鉴权。`viewerId` 是当前用户 ID。仅表主获得 `members` 和归档字段，非表主只见活动字段。

表只要有任意匿名操作，匿名也能发现其活动结构，但只能得到 `{ "id", "schemaVersion", "fields" }`，不能据此读取记录。私有表的匿名结构请求返回 `403`。

列表每页 50 项；有 `nextCursor` 时使用 `GET /tables?cursor=...` 继续，游标须 URL 编码。没有总数。协作表只有在当前表授权与密钥 scope 存在可用操作交集时才列出；所有操作已撤销或 scope 不匹配时不再返回摘要。仅开放匿名访问不构成公开目录。

### 修改表与归档字段

```http
PATCH /api/open/v1/tables/{id}
Authorization: Bearer syn_sk_...
Content-Type: application/json
```

只改表名传 `{ "version": 1, "name": "活动报名" }`；修改字段时提交**完整活动字段列表**：

```json
{
  "version": 1,
  "fields": [
    { "key": "name", "name": "报名人", "type": "text", "required": true },
    { "key": "status", "name": "状态", "type": "singleSelect", "defaultValue": "new", "options": [{ "key": "new", "name": "新提交" }, { "key": "done", "name": "已处理" }] },
    { "key": "score", "name": "分数", "type": "number" }
  ]
}
```

`version` 取最近表详情的 `schemaVersion`，不是记录版本。成功返回 `200` 和完整表对象，`schemaVersion` 增加；旧版本返回 `409 VERSION_CONFLICT`。

- 不传 `fields` 不改变字段；传 `[]` 归档所有活动字段。省略已有 key 会归档该字段，不是只修改列出的字段。
- 归档字段退出普通记录读写，数据保留 30 天。表主可在详情看到 `archivedAt`，保留期内重新提交原 key 与定义可恢复。
- 已有非空数据的字段不能改类型或移除选项，包括仍在回收站中的记录；不会自动转换数据。
- 已有记录时，先加可选字段、补齐值，再设必填。恢复归档必填字段也检查缺值；默认值不替代补齐操作。

## 记录增删改查

### 新增记录

```bash
curl --fail-with-body --request POST "$SY_API_BASE_URL/api/open/v1/tables/$SY_TABLE_ID/records" \
  --header "Authorization: Bearer $SY_API_KEY" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: registration-record-001' \
  --data '{"values":{"name":"张三","score":87.5}}'
```

成功返回 `201`：

```json
{ "id": "record_example", "version": 1 }
```

`values` 必填，key 须为活动字段 key。示例省略 `status`，新增时使用默认值 `new`；未提供的可选字段无默认值时为 `null`。未知字段、归档字段、类型不符均报错。

ID、创建者、时间和版本由服务端生成，不能在请求中伪造。匿名新增的 `creatorUserId` 为 `null`，后续登录不会自动认领。

### 查询记录

查询使用 POST JSON 请求体，成功状态为 `201`：

```bash
curl --fail-with-body --request POST "$SY_API_BASE_URL/api/open/v1/tables/$SY_TABLE_ID/records/query" \
  --header "Authorization: Bearer $SY_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"filters":[{"field":"status","op":"eq","value":"new"},{"field":"score","op":"gte","value":80}],"sort":[{"field":"score","direction":"desc"}],"limit":50}'
```

```json
{
  "data": [{
    "id": "record_example",
    "values": { "name": "张三", "status": "new", "score": 87.5 },
    "creatorUserId": "user_owner",
    "version": 1,
    "createdAt": "2026-11-01T08:01:00.000Z",
    "updatedAt": "2026-11-01T08:01:00.000Z",
    "deletedAt": null
  }],
  "nextCursor": null
}
```

| 请求字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `filters` | array | 否 | 默认 `[]`，最多 20 项；组合方式由 `filterMode` 决定，不支持 SQL／嵌套分组 |
| `filterMode` | string | 否 | 默认 `all`，全部条件满足（AND）；`any` 为任一条件满足（OR）。空条件在两种模式下均不增加业务筛选 |
| `fields` | string[] | 否 | 省略返回全部活动业务字段；`[]` 返回空 `values`。最多 100 个不同的活动业务字段 key，不接受系统字段 key、未知或归档字段 |
| `sort` | array | 否 | 默认 `$createdAt` 升序，最多 3 个不同字段 |
| `limit` | integer | 否 | 默认 50，范围 1–100；响应还受字节预算限制 |
| `cursor` | string | 否 | 上一页的 `nextCursor`，原样传入 |

筛选项是 `{ "field": "score", "op": "gte", "value": 80 }`；排序项是 `{ "field": "score", "direction": "desc" }`，方向仅 `asc/desc`。

| op | 含义 | value 约束 |
|---|---|---|
| `eq` / `ne` | 等于／不等于 | 符合字段类型的标量或 `null`；与 `null` 比较可查空值／非空值 |
| `in` | 属于集合 | 1–100 个同类型值，如 `["new", "done"]` |
| `gt` / `gte` | 大于／大于等于 | 非空标量；布尔和单选不支持范围比较 |
| `lt` / `lte` | 小于／小于等于 | 同上 |
| `contains` | 包含子串 | 仅 `text/url`，大小写敏感，按字面子串匹配，不是正则 |

字段可引用活动 key 或系统字段 `$id/$createdAt/$updatedAt/$creatorUserId`。系统时间筛选须为有效 ISO 时间字符串，带 `Z` 或时区偏移，例如 `2026-11-01T08:00:00+08:00`，服务端按同一 UTC 时刻比较；小数秒最多3位（毫秒），不接受无时区、非法日期或年份0000。业务 `datetime` 字段仍按字段类型约定使用 `Z` 格式。`json`、`multiSelect` 不支持筛选或排序，也不支持 JSON 深层路径。文本排序按数据库固定字符顺序，不是地区语言排序；空值最后，按请求中的字段顺序排序，未指定 `$id` 时追加稳定 ID 排序。

`fields` 只选择 `values` 内返回的业务字段，`id`、`version`、创建者和时间等系统元数据仍返回。筛选和排序可使用未返回的字段。投影在数据库内执行；它不是字段级权限，不能用来限制其他调用方可读取哪些字段。

例如，查找状态为“新提交”或分数至少 80 的记录，只返回姓名和状态，并按分数排序：

```json
{
  "filters": [
    { "field": "status", "op": "eq", "value": "new" },
    { "field": "score", "op": "gte", "value": 80 }
  ],
  "filterMode": "any",
  "fields": ["name", "status"],
  "sort": [{ "field": "score", "direction": "desc" }],
  "limit": 50
}
```

AND／OR 只组合业务条件；表范围、未删除和本人记录权限始终同时生效，不会因 `any` 扩大可读范围。不传新参数时，沿用原有 AND 查询及完整活动字段响应。

`nextCursor` 非 `null` 时，保持表、身份、筛选、组合模式、字段投影与排序不变继续：

```json
{
  "filters": [{ "field": "status", "op": "eq", "value": "new" }, { "field": "score", "op": "gte", "value": 80 }],
  "filterMode": "any",
  "fields": ["name", "status"],
  "sort": [{ "field": "score", "direction": "desc" }],
  "limit": 50,
  "cursor": "替换为上一页的nextCursor"
}
```

不要发送 `cursor: null`，结束时停止请求。页面不足 `limit` 条也可能还有下一页，以 `nextCursor` 为准。游标绑定表、身份、结构版本、筛选、组合模式、字段投影和排序，变化后从首分页重查，否则返回 `400 INVALID_CURSOR`。字段投影列表的顺序也应保持不变；省略 `fields` 与显式传空数组不是同一查询。不要解析或拼接游标。分页不是快照，并发修改排序字段可能改变后续结果；列表不附带总数，需要时单独调用计数接口。

### 条件计数与存在判断

只需要数量或判断是否有匹配记录时，使用以下接口，避免分页下载明细。两者成功状态均为 `201`，使用 `tables.records.read` 及表读取授权；匿名调用必须已开放匿名 read。仅有新增、修改、删除或管理权限不能调用。

| 接口 | operationId | 成功响应 |
|---|---|---|
| `POST /tables/{id}/records/count` | `countCloudTableRecords` | `{ "count": 123 }` |
| `POST /tables/{id}/records/exists` | `existsCloudTableRecords` | `{ "exists": true }` 或 `{ "exists": false }` |

两者的请求只接受以下字段，规则与记录查询一致：

| 请求字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `filters` | array | 否 | 默认 `[]`，最多 20 个条件，支持上文 8 种操作符及相同字段类型范围 |
| `filterMode` | string | 否 | 默认 `all`（AND），可选 `any`（同级 OR）；空条件表示不增加业务筛选 |

不接受 `fields`、`sort`、`limit`、`cursor` 或其他参数，传入会返回 `400 INVALID_REQUEST`。例如统计状态为“新提交”或分数至少80的可读记录：

```bash
curl --fail-with-body --request POST "$SY_API_BASE_URL/api/open/v1/tables/$SY_TABLE_ID/records/count" \
  --header "Authorization: Bearer $SY_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"filters":[{"field":"status","op":"eq","value":"new"},{"field":"score","op":"gte","value":80}],"filterMode":"any"}'
```

检查是否存在已处理记录：

```bash
curl --fail-with-body --request POST "$SY_API_BASE_URL/api/open/v1/tables/$SY_TABLE_ID/records/exists" \
  --header "Authorization: Bearer $SY_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"filters":[{"field":"status","op":"eq","value":"done"}]}'
```

计数返回当前权限内、未删除记录的精确数量，`own` 只统计本人创建记录；无匹配时为 `0`。存在判断使用数据库 EXISTS，找到一条匹配记录即可结束，不读取正文。对空表分别返回 `0` 和 `false`。

计数与另一次列表请求不保证同一快照；存在判断也不能作为并发去重或唯一性保证。两个接口均不写入业务数据、不声明写入幂等键，但仍会记录不含正文的操作元数据。它们共用现有公平队列和 SQL 超时；大范围精确计数可能返回 `503 SERVER_BUSY`，应退避或缩小条件，不返回近似数。计数超过 `9007199254740991` 时返回 `400 COUNT_TOO_LARGE`，不静默舍入。

### 读取单条记录

```bash
curl --fail-with-body "$SY_API_BASE_URL/api/open/v1/tables/$SY_TABLE_ID/records/$SY_RECORD_ID" \
  --header "Authorization: Bearer $SY_API_KEY"
```

成功返回 `200` 和一个完整记录对象，字段与查询 `data` 中的元素相同，没有外层 `data`。不存在、已删除或不在本人范围内返回 `404 NOT_FOUND`。

### 修改记录

```bash
curl --fail-with-body --request PATCH "$SY_API_BASE_URL/api/open/v1/tables/$SY_TABLE_ID/records/$SY_RECORD_ID" \
  --header "Authorization: Bearer $SY_API_KEY" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: registration-update-001' \
  --data '{"version":1,"values":{"status":"done","score":null}}'
```

成功返回 `200` 和 `{ "id": "record_example", "version": 2 }`。

`version` 必填，取该记录最近一次查询的版本。`values` 为局部更新：省略字段保持原值，`null` 清空可选字段，默认值不重新应用。不能改创建者、ID、版本或时间。过期版本返回 `409 VERSION_CONFLICT`，不要自动换成新版本强行覆盖。

### 删除记录

```bash
curl --fail-with-body --request DELETE "$SY_API_BASE_URL/api/open/v1/tables/$SY_TABLE_ID/records/$SY_RECORD_ID" \
  --header "Authorization: Bearer $SY_API_KEY" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: registration-delete-001' \
  --data '{"version":2}'
```

成功返回 `200` 和 `{ "id": "record_example", "version": 3 }`。DELETE **需要 JSON 请求体中的当前记录版本**，不是 query 参数。删除后立即退出普通查询，30 天内仅表主可恢复。

### 批量新增、修改与删除

```http
POST /api/open/v1/tables/{id}/records/batch
Authorization: Bearer syn_sk_...
Content-Type: application/json
Idempotency-Key: registration-batch-001
```

```json
{
  "operations": [
    { "action": "create", "values": { "name": "李四", "score": 91 } },
    { "action": "update", "id": "record_to_update", "version": 4, "values": { "status": "done" } },
    { "action": "delete", "id": "record_to_delete", "version": 2 }
  ]
}
```

成功返回 `201`，结果与输入顺序对应：

```json
{
  "data": [
    { "id": "record_created", "version": 1 },
    { "id": "record_to_update", "version": 5 },
    { "id": "record_to_delete", "version": 3 }
  ]
}
```

`operations` 必填，1–100 项。create 需要 `values`；update 需要 `id/version/values`；delete 需要 `id/version`。每项检查对应权限和记录归属，任一失败则整个批次回滚。

导入使用同一接口，将每项设为 `create`，按条数和字节数分批。批次之间无共同事务；不能假定全量导入一起提交。

## 匿名与协作者授权

只有表主可修改授权，密钥需 `tables.manage`。使用当前 `schemaVersion` 作为 `version`，成功后表版本增加。

### 解析协作者

按准确的 Synapse 用户名查询 ID：

```http
POST /api/open/v1/tables/{id}/collaborators/resolve
Authorization: Bearer syn_sk_...
Content-Type: application/json
```

请求 `{ "handle": "teammate" }`，成功返回 `201` 和 `{ "id": "user_member", "handle": "teammate" }`。handle 为 1–64 字符，不传邮箱，不猜用户 ID。账号不存在或停用返回 `404`；不提供模糊搜索或用户目录。

### 设置完整授权配置

```http
PATCH /api/open/v1/tables/{id}/permissions
Authorization: Bearer syn_sk_...
Content-Type: application/json
```

```json
{
  "version": 1,
  "anonymous": { "read": false, "create": true, "update": false, "delete": false },
  "members": [{
    "userId": "user_member",
    "permissions": { "read": "own", "create": "all", "update": "own", "delete": "none" }
  }]
}
```

成功返回 `200` 和 `{ "schemaVersion": 2 }`。

| 字段 | 说明 |
|---|---|
| `version` | 当前表的 `schemaVersion`，正整数，必填 |
| `anonymous` | 必填，完整替换原配置；`read/create/update/delete` 为布尔值，省略操作关闭 |
| `members` | 必填，完整替换原协作者列表，最多 100 人；省略已有用户即撤权，`[]` 撤销全部协作者 |
| `members[].userId` | 有效用户 ID，不重复，不能包含表主 |
| `members[].permissions` | 查询／修改／删除支持 `none/own/all`，新增仅 `none/all`；省略表示未单独授权 |

`own` 按服务端的 `creatorUserId` 判断，不能操作他人或匿名记录。表主无需加入 members，但其密钥仍受 scope 与资源范围限制。

匿名权限对所有访问者开放。协作者的 `none` 不是针对匿名操作的拒绝名单：未单独获得某项权限时，仍可能使用该项匿名开放权限；显式的 `own` 按本人范围执行。需要限制协作者范围时，不要同时向匿名开放同一操作。

### 匿名网页收集

先由表主显式开放匿名新增，再在网页调用。此例不发送密钥：

```js
const response = await fetch('{{APP_PUBLIC_URL}}/api/open/v1/tables/TABLE_ID/records', {
  method: 'POST',
  credentials: 'omit',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': crypto.randomUUID(),
  },
  body: JSON.stringify({ values: { name: '张三', score: 87.5 } }),
})
const result = await response.json()
if (!response.ok) throw new Error(result.error?.message ?? `HTTP ${response.status}`)
// result.id、result.version；没有 result.values。
```

替换 `TABLE_ID` 为实际 ID。同一次提交因网络失败重试时保留首次幂等键和请求体，不重新生成 UUID。匿名新增不意味着可读、可改或可删，四项操作分别开放。

### 仅公开记录总数

报名页可只展示已报名份数。表主更新权限时保留 `anonymous` 和 `members`，另传 `publicCount: true`。省略保留原设置，`false` 关闭。表主读取表详情时可看到已开启的标志。

`GET /tables/{id}/public-count` 无需登录，仅返回 `{"count":12}`。总数包括未删除的全部记录，接口不接受查询参数。原始记录和通用查询、计数、存在判断仍需记录读取权限。匿名报名不能按人去重，数字表示提交份数。整表恢复时关闭公开计数。若携带 API 密钥，仍需 `tables.records.read` 及表资源授权。

### 公开今日汇总

公开收集页可以展示今日分类榜单，征集表仍可仅开放 `anonymous.create`。表主在 `PATCH /tables/{id}/permissions` 的现有请求中加入 `dailySummary`：

```json
{
  "dateField": "date",
  "selectionField": "menu_item_id",
  "flagField": "group_order",
  "catalogTableId": "公开候选表ID",
  "catalogLabelField": "name",
  "timeZone": "Asia/Shanghai"
}
```

上述字段依次为征集表的日期、存放候选记录 ID 的文本字段、布尔值，以及同表主且开放 `anonymous.read` 的独立候选表及其文本标题字段。仍须提交当前 `version`、`anonymous` 和 `members`。省略 `dailySummary` 保留原配置，传 `null` 关闭。仅表主可在表详情中读取配置。

网页使用 `GET /tables/{id}/daily-summary`，不发送凭据或查询参数。响应示例：

```json
{
  "date": "2026-11-04",
  "data": [{ "label": "番茄牛肉饭", "selections": 4, "flagged": 2 }],
  "other": { "selections": 1, "flagged": 0 },
  "hasMore": false
}
```

结果按选择数、布尔真值数降序，再按标题排序，最多返回 100 个公开标题，包含零票候选。同名候选合并。未关联有效候选的记录合并为 `other`，不返回其自由文本。按配置时区计算当日，排除回收站记录。数字统计提交份数，匿名身份不支持按人去重。原始记录及通用查询、计数和存在判断仍需既有读取权限。菜单撤权、删除或所需字段失效时停止提供汇总。整表恢复时清除汇总配置。若请求携带 API 密钥，仍需 `tables.records.read` 与表资源授权。

## 回收站与操作记录

表、记录删除后立即退出普通访问，保留 30 天；归档字段也保留 30 天。到期后分块清理，不保证截止时刻立即物理删除。没有逐次修改历史。

### 删除与恢复表

```http
DELETE /api/open/v1/tables/{id}
Authorization: Bearer syn_sk_...
Content-Type: application/json
```

请求 `{ "version": 2 }`，version 是当前 `schemaVersion`。成功返回 `200` 和 `{ "id": "table_example", "schemaVersion": 3 }`。

用 `GET /tables/trash` 查找本人可恢复的表，返回 `{ "data": [表摘要], "nextCursor": null }`。恢复指定表：

```http
POST /api/open/v1/tables/{id}/restore
Authorization: Bearer syn_sk_...
```

无需请求体或版本。成功返回 `201` 和 `{ "id": "table_example", "schemaVersion": 4 }`。只允许恢复已删除表；活动表返回 `409 NOT_DELETED`，不会修改权限或结构版本。整表恢复后匿名权限全部关闭，重新开放需表主明确设置；协作者配置保留。

### 查询与恢复已删除记录

```http
GET /api/open/v1/tables/{id}/records/trash
Authorization: Bearer syn_sk_...
```

返回 `{ "data": [记录对象], "nextCursor": null }`，`deletedAt` 是删除时间。恢复使用：

```http
POST /api/open/v1/tables/{id}/records/{recordId}/restore
Authorization: Bearer syn_sk_...
```

无需请求体。成功返回 `201` 和 `{ "id": "record_example", "version": 4 }`，实际版本由服务端递增。恢复按当前结构校验，不兼容返回 `409 INCOMPATIBLE_SCHEMA`；并发恢复或其他变化导致版本冲突时返回 `409 VERSION_CONFLICT`，不重复增加版本。已经恢复或不在回收站的记录返回 `404 NOT_FOUND`。表已删除时先恢复表，再访问记录回收站。

### 操作记录

```http
GET /api/open/v1/tables/{id}/logs
Authorization: Bearer syn_sk_...
```

成功返回 `200`：

```json
{
  "data": [{
    "id": "log_example",
    "ownerId": "user_owner",
    "tableId": "table_example",
    "actorId": "user_owner",
    "apiKeyId": "key_example",
    "requestId": "req_example",
    "operation": "records.create",
    "status": 200,
    "durationMs": 12,
    "createdAt": "2026-11-01T08:01:00.000Z"
  }],
  "nextCursor": null
}
```

日志保留 30 天，只含固定诊断字段，不含数据正文、密钥内容或 Cookie。`status` 为业务处理状态，成功记为 `200`，不区分接口的 HTTP `200/201`。匿名操作的 `actorId/apiKeyId` 为 `null`。

表回收站、记录回收站、日志每页 50 项，下一页用 `?cursor=...` 传回经 URL 编码的游标；各接口游标不能互换，没有总数。

## 版本、重试与幂等

| 概念 | 来源与用途 |
|---|---|
| 表 `schemaVersion` | 从表详情取得；改名、字段、授权、删除表时作为请求体的 `version` |
| 记录 `version` | 从记录查询／读取／写入响应取得；修改、删除该记录时作为请求体的 `version` |
| `Idempotency-Key` | 为一次业务写入生成，网络结果不明确时重试同一请求 |

建表、记录新增／修改／删除及批量写入支持可选的 `Idempotency-Key`，格式为 8–120 位字母、数字、下划线或连字符，保留 24 小时。结构变更、授权和恢复不提供这项幂等保证。

- 同一表、调用身份、操作和幂等键下，请求相同则返回原确认，不重复写入。建表按调用身份和建表操作隔离。
- 同键不同请求返回 `409 IDEMPOTENCY_CONFLICT`。匿名调用共享匿名身份，应使用随机 UUID，避免不同访问者重用键。
- 网络超时不代表失败，先按原键和原请求重试，不生成新键再次创建。重放仍检查当前权限，不能绕过撤权。
- 24 小时后相同键可能重新执行，不是长期业务唯一约束，也不代替版本检查。
- `409 VERSION_CONFLICT` 时重读并解决冲突，不盲目覆盖；修改请求内容属于新操作，使用新幂等键。
- `503` 时遵守 `Retry-After` 并退避，保留原写入键；`401/403` 时处理凭据或授权，不自动改为匿名。

## 请求边界与导入导出

| 项目 | 边界 |
|---|---|
| 单次请求 | 最多 1 MiB |
| 单条记录 | JSON 编码后最多 64 KiB |
| 字段数量 | 每表最多 100 个，包含仍在保留期的归档字段 |
| 字段定义 | 单字段最多 64 KiB，含归档定义合计最多 1 MiB，活动默认值合计最多 64 KiB |
| JSON 复杂度 | 请求最多 32 层、50000 节点 |
| 字符串兼容 | 字符串和对象 key 不允许空字符 `\u0000` 或未配对的 Unicode 代理码点；返回 `400 INVALID_VALUE`，正常中文及 emoji 可用 |
| 查询 | 最多 20 筛选、3 排序；默认 50、最多 100 条，记录查询数据约 1 MiB 响应预算 |
| 查询投影 | 最多 100 个不同的活动业务字段 key；`[]` 只返回系统元数据及空 `values` |
| 计数／存在判断 | 最多 20 筛选，不分页、不排序；沿用读取权限、公平队列和 SQL 超时 |
| 写入批次 | 1–100 个操作，并受请求字节限制 |

不设置账号表数、记录数、总字节容量额度或低固定调用频率。使用专用连接池、按表所属账号分配公平并发和队列预算；多个密钥、协作者和匿名访问者共用表主预算，繁忙时返回 `503 SERVER_BUSY`。不要通过增加密钥或并发绕过保护。

Console 按读取权限导出 JSON／CSV，CSV 处理公式注入，单次导出有 16 MiB 浏览器内存保护。API 没有专门的导入／导出路径，大数据通过查询分页导出、批量写入分批导入。第一版没有附件、公式、关联表、SQL、实时订阅或完整修改历史。

## 错误码

```json
{
  "requestId": "req_example",
  "error": { "code": "VERSION_CONFLICT", "message": "记录已变化，请重新读取。" }
}
```

| HTTP | code | 处理方式 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 检查 JSON、字段集合、必填参数和版本，不发未列出的字段 |
| 400 | `INVALID_FIELDS`、`INVALID_VALUE`、`UNKNOWN_FIELD` | 重新读结构，按类型和字段 key 构造请求 |
| 400 | `INVALID_QUERY`、`INVALID_CURSOR` | 检查筛选／排序／活动投影字段；条件、组合模式、投影、身份或结构改变后从首分页重查 |
| 400 | `COUNT_TOO_LARGE` | 精确数量超出安全整数范围，缩小筛选范围 |
| 400 | `INVALID_DAILY_SUMMARY` | 检查时区、字段类型及同表主公开候选表 |
| 400 | `INVALID_MEMBERS` | 检查用户是否有效、重复或包含表主 |
| 400 | `INVALID_IDEMPOTENCY_KEY` | 使用 8–120 位合法幂等键 |
| 400 | `JSON_TOO_COMPLEX`、`SCHEMA_TOO_LARGE` | 降低 JSON 复杂度或定义体积 |
| 401 | `INVALID_API_KEY` | 检查密钥、撤销状态及账号，不降级匿名 |
| 403 | `INSUFFICIENT_SCOPE` | 检查 scope 和密钥表资源，建表还需自己的全部表 |
| 403 | `FORBIDDEN` | 检查表授权、本人范围或是否由表主执行管理操作 |
| 403 | `DAILY_SUMMARY_UNAVAILABLE` | 今日汇总未发布或依赖配置已失效 |
| 403 | `PUBLIC_COUNT_UNAVAILABLE` | 表主尚未开启公开计数，或已关闭 |
| 404 | `NOT_FOUND` | 不存在、已删除、过期或不在可见范围；停止猜测 ID |
| 409 | `VERSION_CONFLICT` | 读最新版本并解决冲突 |
| 409 | `NOT_DELETED` | 表当前未删除，无需恢复；权限和版本保持不变 |
| 409 | `IDEMPOTENCY_CONFLICT` | 同键已有不同请求，核对原操作，不盲目重试不同内容 |
| 409 | `INCOMPATIBLE_SCHEMA`、`FIELD_EXPIRED` | 结构／恢复不兼容或过期，由表主处理 |
| 413 | `REQUEST_TOO_LARGE`、`RECORD_TOO_LARGE` | 缩小请求或单行，拆批不能解决单行超限 |
| 503 | `SERVER_BUSY` | 遵守 `Retry-After`，退避重试，不扩大并发 |
| 500 | `INTERNAL_ERROR` | 保留 `X-Request-Id` 排查；写入结果不明确时按原幂等键重试 |

## 交给 AI、Agent 或现有 Skill 调用

在桌面端已登录且 MCP 可用时，Agent 可以按 Synapse Skill 直接操作云表。本节说明独立脚本或 Agent 如何调用开放 HTTP API。OpenAPI 提供机器可读的当前接口契约。复制本页时另行提供任务目标、已有表的 ID（如有）和私有环境变量名，无需把真实密钥粘贴进对话。

### 从零建表到管理数据

| 顺序 | Agent 操作 | 必须遵守的约定 |
|---|---|---|
| 1 | 读取 OpenAPI，确认用户交办的任务和密钥授权 | 使用自己的 `SY_API_KEY`；缺失凭据时请用户配置，不查找网页登录凭据 |
| 2 | `POST /tables`，提交表名与字段定义 | 需 `tables.manage` + `all_owned`，表归密钥所属用户，默认私有；保存返回的 `id`、`schemaVersion` |
| 3 | `GET /tables/{id}/schema`，了解字段与当前权限 | 依据实际 key、类型、选项 key 调用；不能从显示名猜字段 |
| 4 | 按任务 `PATCH /tables/{id}`，修改表名或字段 | 使用最新 `schemaVersion` 作为 `version`；字段须提交完整活动列表，去掉只读 `archivedAt`。省略已有字段会归档，不能误当局部字段更新 |
| 5 | 需要协作时，先解析用户名，再 `PATCH /tables/{id}/permissions` | 仅表主；完整保留任务未要求移除的协作者和匿名配置。只有用户授权开放或调整权限时执行，不为解决403自动开放匿名 |
| 6 | 新增、查询、修改、删除或分批导入记录 | 需相应记录 scope；`tables.manage` 不自带记录读写权限。修改与删除使用记录 `version`；查询可用 `fields` 减少返回字段、`filterMode: any` 表达同级 OR |
| 7 | 按读取权限分页导出，或由表主读取操作记录 | 导出使用查询接口，按 `nextCursor` 继续；日志是诊断元数据，不是完整修改历史 |
| 8 | 按用户要求删除、恢复表／记录或恢复字段 | 表主执行恢复；30天内恢复并检查当前结构，恢复整表后匿名权限关闭 |

操作已有表时跳过建表步骤，先通过 `GET /tables` 发现已授权的表，再读取结构。Agent 不需要用户先在 Console 完成建表、字段配置或授权设置；用户只需先提供足够且明确授权的密钥。协作者管理自己的表与操作他人的协作表属于不同权限范围。

只需要匹配数量时调用 `/records/count`，只判断是否存在时调用 `/records/exists`；不要下载全部记录后自行计数，也不要把存在判断当作防止重复新增的保证。需要明细时才分页查询，并仅选择任务需要的业务字段。

调用示例任务：

```text
请按照这份 API 文档，在我的账号下创建“客户跟进”表，包含姓名、联系电话、
跟进状态和备注字段，再导入我提供的数据。保持私有，不添加协作者或开放匿名。
API 地址从 SY_API_BASE_URL 获取，密钥从私有环境变量 SY_API_KEY 获取。
先确认接口契约与字段定义，保存表 ID；遇到缺少权限或版本冲突时明确报告。
```

### 重试与权限处理

Agent 或现有 Skill 调用时还需遵守：

1. 先读当前部署的 OpenAPI；操作已有表前读 `/tables/{id}/schema`，不凭显示名猜 key、类型或选项值。
2. 调用 `/api/open/v1/tables` 下的开放接口，不借浏览器登录态。私有操作使用 `SY_API_KEY`；网页只做已开放的匿名操作。
3. 区分直接对象、分页 `data`、批量 `data`；写入不返回正文。不要混用表的 `schemaVersion` 与记录 `version`。
4. 分页直到 `nextCursor` 为 `null`；导入同时按 100 条和 1 MiB 拆批，每批使用独立且重试稳定的幂等键。
5. 修改、删除、开放匿名或新增协作者须符合用户授权。缺权限时请表主配置，不擅自公开表、扩大密钥范围或把密钥写进 HTML。
