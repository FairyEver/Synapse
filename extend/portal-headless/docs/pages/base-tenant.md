# base-tenant：AI 使用契约

2026-09-22 范围：2 个已注册且接入执行层的基础能力。基础上下文不是 Portal 菜单页面，不计入页面覆盖数。

权威定义：`src/catalog/contracts-base.ts`。SDK 通过 `catalog.describe(id).ai` 返回以下业务契约，`returns.fields` 和 `params[].contract` 同源；执行入口由 `describe(id).invoke` 返回。通用调用为 `sdk.capabilities.invoke(id, args)`。以下内容从同一契约生成，避免另一套手写参数/返回说明。

证据：对应能力实现、`test/base-tenant.test.ts` 的历史真机形状夹具；历史只读/OSS验收详见 `docs/base/`。本轮为离线语义验证，没有重放真实写入。

## base-tenant-list

列出当前用户所属企业、企业状态及已开通系统。

- 场景：选择企业上下文或核对企业归属；不会切换当前 SDK 的租户。
- 性质：read
- 边界：内部每页 200、最多 5 页（1000 家），再按 keyword/limit 本地筛选；truncated 时 matched 只覆盖已拉取部分。；返回白名单已排除身份证、证件图和联系人手机号；系统码不等同权限。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| keyword | 按企业名/简称/编码忽略大小写过滤，可省略；来源：用户给出的企业名称或编码片段 | 按原始输入 |
| limit | 最多返回条数；本地裁剪，不是服务端分页。超过上限截断到上限。；来源：调用方按展示预算填写 | 正整数，上限 100；无效值回退默认值，非正数归为1，小数取整；默认 20 |

### 返回与消费

`{ tenants: TenantSummary[], total, matched, pages, truncated }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| tenants[].id | string | 企业数字 ID 的字符串形式，供详情查询或创建新租户会话 |
| tenants[].name | string，可null | 企业名 |
| tenants[].shortName | string，可null | 简称 |
| tenants[].code | string，可null | 企业编码 |
| tenants[].contactName | string，可null | 联系人显示名，可能实际是企业名称 |
| tenants[].createDate | string，可null | 创建时间，原 createTime 的字符串形式，不自行假定时区 |
| tenants[].status | number，可null | 租户状态；不同于用户 status；0=开启，1=关闭 |
| tenants[].systems[] | number | 开通系统码；1人/2财/3物/4产/5供/6销；其它码原样显示，不能猜标签 |
| tenants[].tenantAdmin | boolean | 当前用户是否该企业管理员 |
| total | number | 后端报告的全部企业数 |
| matched | number | 已拉取企业中符合 keyword 的数量 |
| pages | number | 内部实际读取页数，最多5 |
| truncated | boolean | true 表示返回集合不完整；不能把当前结果当全集 |

空结果：tenants=[] 表示已拉取范围无匹配；truncated=true 时不能断言全账号无匹配。

- 展示企业名、编码和管理员身份供用户选择；改变企业需要接入方创建独立会话，不能只改查询 id。

### 操作步骤与验证

- optional：需要企业套餐/到期/账号数信息 → base-tenant-get；选择企业后传原始数字 ID 字符串。；字段映射 {"id":"tenants[].id"}

完成判据：企业候选及截断情况已交付，或取得用户确认的租户 ID。

错误：BaseTenantShapeError 表示返回形状/缺 id，不能作空列表。；会话权限错误先核对账号和当前租户；不要因为列表包含企业就假定可以读写其所有资源。

防重：只读/本地能力，无写入防重要求。

## base-tenant-get

查询指定企业的开通系统、套餐、到期时间和账号数。

- 场景：已取得企业 ID 后核对配置；列表用于取得候选，详情不切换会话。
- 性质：read
- 边界：详情每次请求不缓存；null 到期时间不能解释成已过期或永久有效。；除1人/2财/3物/4产/5供/6销外，系统码没有本契约已验证的标签表。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| id | 企业主键，不是企业名或企业编码；来源：base-tenant-list.tenants[].id | 非空数字或数字字符串 |

### 返回与消费

`TenantDetail 白名单对象`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| id | string | 企业 ID |
| name | string，可null | 企业名称 |
| status | number，可null | 企业启停状态；0=开启，1=关闭 |
| website | string，可null | 企业网站 |
| packageId | number，可null | 套餐 ID；不推断套餐权益 |
| expireDate | string，可null | 到期时间；SDK 原样转字符串，未核实格式与时区，不据此自动判过期 |
| accountCount | number，可null | 账号数量/额度原值；null 表示未提供 |
| createDate | string，可null | 创建时间原字符串 |
| systems[] | number | 开通系统码，1人/2财/3物/4产/5供/6销；其它码原样保留 |

空结果：不存在或无 id 的详情会抛 BaseTenantShapeError，不返回 null。

- 按已提供字段展示；到期时间含义需要后端有效期口径，不在客户端猜测权限失效。

### 操作步骤与验证

- optional：查询已满足用户目的 → 交付结果；交付企业配置；需要切换租户由接入方建立独立用户租户会话。

完成判据：指定企业配置已交付。

错误：id 为空被拒绝；企业名不是主键，先重查候选。；后端拒绝时报告错误，不能据此替换当前租户或扩大范围。

防重：只读/本地能力，无写入防重要求。
