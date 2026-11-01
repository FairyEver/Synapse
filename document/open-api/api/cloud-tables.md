# 云端数据表

在 Console 的“云端数据表”中创建有类型的表，或通过 API 与独立 Skill 管理。数据在云端，不依赖桌面在线。

## 接入与权限

基础路径：`{{APP_PUBLIC_URL}}/api/open/v1/tables`。完整请求和响应以 [OpenAPI 3.1]({{APP_PUBLIC_URL}}/api/open/openapi.json) 为准。

私有调用使用 `Authorization: Bearer <API密钥>`。在“设置 > API 密钥”选择操作权限，再通过“表资源”授权指定表。默认不包含任何表；“自己的全部表”包含以后创建的表，不包含他人的协作表。协作者需要表主授权，并使用自己的密钥。

| scope | 能力 |
| --- | --- |
| `tables.manage` | 管理结构、权限及回收站；API建表另需“自己的全部表” |
| `tables.records.read` | 查询记录 |
| `tables.records.create` | 新增记录 |
| `tables.records.update` | 修改记录 |
| `tables.records.delete` | 删除记录 |

scope、资源范围和当前表授权共同决定权限，撤权后排队请求也会重新校验。新表默认私有，可分别开放匿名查询、新增、修改、删除，或为指定SY用户配置全部／本人记录。匿名记录没有SY创建者，后续登录不会自动认领。

开放接口忽略Cookie，不接受普通登录Token。无密钥时为匿名；无效密钥返回401，不降级。公开网页使用 `credentials: 'omit'`，不要把个人密钥写进网页。第一版不支持分享网页使用访问者SY登录身份访问私有数据。

```sh
# 地址是应用根地址，不包含/api；密钥只保存在私有环境。
curl --fail-with-body "$SY_API_BASE_URL/api/open/v1/tables/TABLE_ID/schema" \
  -H "Authorization: Bearer $SY_API_KEY"

curl --fail-with-body "$SY_API_BASE_URL/api/open/v1/tables/TABLE_ID/records/query" \
  -H "Authorization: Bearer $SY_API_KEY" -H 'Content-Type: application/json' \
  -d '{"limit":50,"filters":[],"sort":[]}'
```

匿名收集示例（须先开放匿名新增）：

```js
await fetch('https://YOUR_SY_ORIGIN/api/open/v1/tables/TABLE_ID/records', {
  method: 'POST', credentials: 'omit',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
  body: JSON.stringify({ values: { name: '示例' } }),
})
```

## 表结构

`POST /tables` 建表：

```json
{"name":"报名","fields":[{"key":"name","name":"姓名","type":"text","required":true},{"key":"status","name":"状态","type":"singleSelect","defaultValue":"new","options":[{"key":"new","name":"新提交"}]}]}
```

类型为 `text/integer/number/boolean/date/datetime/singleSelect/multiSelect/url/json`。整数为安全整数，小数必须有限；日期为 `YYYY-MM-DD`，时间为UTC ISO格式。JSON、多选不支持深层查询或排序。

字段key以小写字母开头，只含小写字母、数字和下划线，最长64字符；选项key也稳定。显示名可改。每表含待清理归档字段最多100个，定义合计最多1MiB，单字段定义最多64KiB，活动字段默认值合计最多64KiB。表列表仅返回轻量摘要，结构通过详情或schema读取。非空字段不能改类型或移除选项；已有记录时先加可选字段、补齐后再设必填。恢复归档必填字段也检查已有记录，缺值时先恢复为可选字段再补齐。默认值仅作用于新增记录。

`PATCH /tables/{id}` 传当前 `schemaVersion` 作为 `version`，可更新 `name` 或提交完整活动 `fields` 列表。省略字段进入归档，30天内重新提交原key恢复；其后分块清理。结构不兼容返回409，不静默转换数据。

## 数据与分页

| 方法 | 相对 `/api/open/v1` 路径 | 用途 |
| --- | --- | --- |
| GET / POST | `/tables` | 列表／创建，匿名无目录权限 |
| GET / PATCH / DELETE | `/tables/{id}` | 查看／修改／删除表 |
| GET | `/tables/{id}/schema` | 读取字段结构 |
| PATCH | `/tables/{id}/permissions` | 设置匿名和协作者权限 |
| POST | `/tables/{id}/records/query` | 筛选、排序和分页 |
| POST | `/tables/{id}/records` | 新增记录 |
| GET / PATCH / DELETE | `/tables/{id}/records/{recordId}` | 读取／修改／删除记录 |
| POST | `/tables/{id}/records/batch` | 原子批量操作 |
| GET | `/tables/trash` | 表回收站 |
| POST | `/tables/{id}/restore` | 恢复表，关闭匿名权限 |
| GET | `/tables/{id}/records/trash` | 记录回收站 |
| POST | `/tables/{id}/records/{recordId}/restore` | 恢复记录 |
| GET | `/tables/{id}/logs` | 表主查看操作记录 |

查询体为 `{ filters, sort, cursor, limit }`。filters最多20项，AND组合；每项 `{ field, op, value }`，操作符 `eq/ne/in/gt/gte/lt/lte/contains`。值须匹配类型，in最多100值，contains仅文本/链接。sort最多3项 `{ field, direction: 'asc' | 'desc' }`。系统字段使用 `$id/$createdAt/$updatedAt/$creatorUserId`，默认创建时间升序，始终加入ID稳定排序，空值最后。

默认50条、最大100条，还受响应字节预算约束。使用返回的nextCursor继续直到null；条件、身份或结构改变后重头开始。分页不是快照，并发修改排序字段可能改变后续结果。不默认统计全表总数。

新增为 `{ "values": { "name": "A" } }`；修改为 `{ "version": 1, "values": { "name": "B" } }`；删除为 `{ "version": 1 }`。省略更新字段不变，null清空可选字段。ID、创建者、时间和版本由服务端控制；写响应仅ID/新版本，不泄漏无读取权限的数据。

批次为 `{ "operations": [{ "action": "create", "values": {} }, { "action": "update", "id": "...", "version": 1, "values": {} }, { "action": "delete", "id": "...", "version": 1 }] }`。最多100条，全成全败；不同批次无事务。请求最大1MiB，记录最大64KiB；JSON请求最多32层、50000节点。连续分页游标支持最大合法排序值，不因首分页记录被删除而失效。

建表及记录写入支持8至120字符的 `Idempotency-Key`（字母、数字、下划线、连字符），保留24小时。重试保持相同键和请求；同键不同请求409。重放检查当前权限。过期后可能重新执行，幂等键不是业务唯一值约束。

## 协作者与恢复

权限修改使用完整配置：

```json
{"version":1,"anonymous":{"read":false,"create":true,"update":false,"delete":false},"members":[{"userId":"SY_USER_ID","permissions":{"read":"own","create":"all","update":"own","delete":"none"}}]}
```

读、改、删使用none/own/all，新增none/all。表主始终可以管理，但其密钥仍受scope和资源限制。`POST /tables/{id}/collaborators/resolve` 接收准确SY用户名 `{ "handle": "用户名" }`，仅表主使用，不提供用户枚举。

删除表或记录后立即停止普通访问，30天内仅表主恢复。恢复须符合当前结构，整表恢复关闭匿名权限；没有逐次修改历史。到期分块清理，不保证在截止时刻立即完成物理删除。

## 性能与诊断

无账号容量、表数、记录数、总字节额度或低固定RPM。请求仍受并发、等待、批次和执行成本保护；同表所属账号的匿名、多个密钥和协作者共用公平预算。繁忙503并返回Retry-After，请退避重试，勿放大并发。409先重读并解决冲突。通过错误requestId及X-Request-Id排查。

操作日志保留30天，仅保存固定诊断信息，不含记录正文或凭据。JSON导出保留类型，CSV导出处理公式注入。Console单次导出有16MiB浏览器内存保护，大数据使用API分批导出。

## Skill

下载 <a href="/document/skills/synapse-cloud-tables/SKILL.md" download>SKILL.md</a> 和 <a href="/document/skills/synapse-cloud-tables/references/http.md" download>HTTP参考</a>，在AI工具的技能目录中保留 `synapse-cloud-tables/SKILL.md`、`references/http.md` 的相对位置，配置私有环境变量 `SY_API_BASE_URL`、`SY_API_KEY`。无需MCP或桌面在线。
