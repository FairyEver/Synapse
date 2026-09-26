# SAP-收款账号

## 能力定义

- 菜单归属：门户 → 系统设置 → 销售设置 → SAP-收款账号
- 页面路径：`/dashboard/sale/order/ccb-account/list`
- 页面权限：`/dashboard/sale/frame/order/ccb-account`
- 新建按钮权限：`order:ccbAccount:edit`
- 编辑、删除行按钮权限：Portal 源码实际检查 `order:tradeStoreroom:edit`；这是页面现状，SDK 不擅自改成 `order:ccbAccount:edit`
- CRM 请求实例：`app/portal/utils/http/crm.js`，调用 SDK 时走 `httpBaseUrls.crm`
- 组织树实例：`app/portal/utils/http/platform.js`，调用 SDK 时走 `httpBaseUrls.platform`
- `module-type`：`60`
- 页面动作：组织树、分页查询、新建、编辑、单条删除
- 页面没有筛选、排序、详情 GET、批量删除或导入导出入口；不暴露后端不可达的其它 CCB 接口

对应 SDK 能力：

| capability | 作用 | 写入 |
| --- | --- | --- |
| `sale-ccb-account-list` | 查询 SAP 收款账号 | 否 |
| `sale-ccb-account-organization-tree` | 查询新建/编辑使用的销售组织树 | 否 |
| `sale-ccb-account-prepare-create` / `sale-ccb-account-create` | 准备并新建 | 后者是 |
| `sale-ccb-account-prepare-update` / `sale-ccb-account-update` | 准备并编辑 | 后者是 |
| `sale-ccb-account-prepare-remove` / `sale-ccb-account-remove` | 准备并删除单条记录 | 后者是 |

## 参数契约

### 列表

`sale-ccb-account-list` 只接受分页参数。Portal 的 `customLoad` 丢弃公共列表状态中的其它字段，只发送：

| 参数 | 页面默认值 | 请求字段 | 说明 |
| --- | --- | --- | --- |
| `pageNo` | `1` | `pageNo` | 从 1 开始 |
| `pageSize` | `20` | `pageSize` | `styleV2` 公共列表默认值；SDK 接受 10/20/50/100 |

请求是：

```text
GET /vue/order/ccbAccount/list
Content-Type: application/x-www-form-urlencoded
```

CRM 返回 `{ list, count }`；SDK 返回 `{ list, total }`。后端在非管理员会话下按当前用户 `tenantId` 写入查询条件，SDK 不接收或伪造 tenantId。

列表字段：

| 字段 | 页面消费含义 |
| --- | --- |
| `id` | 收款账号记录主键，删除时使用 |
| `office.id` / `office.name` | 公司销售组织标识和展示名称；编辑时 `office.id` 回填 `officeId` |
| `itemKind` | CRM Controller 已把存储值转成逗号分隔的字典标签，只用于展示 |
| `branchCode` | 分行号 |
| `merchantCode` | 商户号 |
| `ccbpayAccount` | 银行收款账号 |
| `counterCode` | 柜台号 |
| `receiptAccountName` | 收款银行账户名称 |
| `receiptAccountNo` | 收款银行卡号 |
| `bankName` | 收款银行名称 |
| `branchName` | 支行名称 |
| `instCode` | 总行联行号 |
| `branchInstCode` | 开户行联行号 |
| `publicKey` | 密钥 |
| `createDate` / `updateDate` | 创建/更新时间原值 |
| `remarks` | 后端备注原值；当前页面表单没有备注输入项 |

### 组织树

表单挂载时 Portal platform 实例请求：

```text
GET /admin-api/sales/organization/tree?salesTypeMax=1
```

SDK 的 `sale-ccb-account-organization-tree` 固定发送字符串参数 `salesTypeMax: '1'`，返回销售组织树。树选择器的 `value`、`key` 都是节点 `salesId`，展示字段是 `name`；选择后页面把同一节点的 `salesId` 和 `name` 写入 `form.officeId`、`form.office`。`officeId` 不能用公司名称代替。

### 新建和编辑表单

`ModalFormContent.vue` 的页面表单字段如下：

| 字段 | 页面规则 | 请求形态 |
| --- | --- | --- |
| `id` | 新建默认为 `''`；编辑保留当前行 ID | 原样保留在 save 数据中 |
| `companyId` | 页面内部旧字段，默认 `''` | 原样保留 |
| `office` | 组织选择后为 `{ id: salesId, name }` 快照 | 原样保留 |
| `officeId` | 必填 | 组织树节点 `salesId` |
| `itemKindCode` | `item_kind` 字典多选，必填且至少一项 | 不直接提交，转换成 `itemKind` |
| `publicKey` | 可空 | 字符串 |
| `branchCode` | 可空 | 字符串 |
| `merchantCode` | 可空 | 字符串 |
| `ccbpayAccount` | 必填 | 字符串 |
| `counterCode` | 可空 | 字符串 |
| `receiptAccountName` | 必填 | 字符串 |
| `receiptAccountNo` | 必填 | 字符串 |
| `bankName` | 必填 | 字符串 |
| `branchName` | 必填 | 字符串 |
| `instCode` | 可空 | 字符串 |
| `branchInstCode` | 可空 | 字符串 |

页面没有长度、格式或数字范围校验；SDK 不新增这些业务限制。商品类型候选来自全局平台字典 `item_kind`，需要候选时调用 `base-dict-get`，使用 `entries[].value`，不要把列表的 `itemKind` 标签直接提交。

页面 `processFormData` 的转换是固定规则：

1. 读取 `itemKindCode`，缺省按空数组；执行 `JSON.stringify(itemKindCode)`。
2. 把结果中的所有双引号替换为单引号，生成 `itemKind`。
3. 从表单中删除 `updateDate`、`createDate`、`itemKindCode`。
4. 保留其它表单字段（包括 `id`、`companyId`、`office`、`officeId` 和空字符串字段）。

最终新建/编辑都发送完整表单到同一个接口：

```text
POST /vue/order/ccbAccount/save
Content-Type: application/x-www-form-urlencoded
```

SDK 的 `prepareCreate` / `prepareUpdate` 执行上述转换且不发请求；用户取消时丢弃 `draft`。用户确认后把同一 `draft` 交给 `create` / `update`。保存成功回执是文案，SDK 对外返回 `undefined`，必须重新查询核对，不能从文案猜测新 ID。

### 删除

页面确认后发送：

```text
DELETE /vue/order/ccbAccount/{id}
Content-Type: application/x-www-form-urlencoded
```

页面只支持单条删除。SDK 的 `prepareRemove` 不发请求，用户取消时丢弃 ID；确认后调用 `remove`。CRM 后端执行逻辑删除，完成或超时后必须重新分页查询确认目标 ID 消失。

## 逐字段基准

基准来源：

- Portal：`app/portal/menus/sale.js:202-203`、`app/portal/views/dashboard/sale/order/ccb-account/list.vue`、`ModalFormContent.vue`
- CRM 后端：`CcbAccountVueController`、`CcbAccount`、`CrmCcbAccountService`、`CcbAccountDao.xml`
- 平台后端：`SalesOrganizationController`、`SalesOrganizationPageReqVO`、`SalesOrganizationRespVO`
- SDK：`src/capabilities/sale-ccb-account.ts`、`test/sale-ccb-account.test.ts`

已核对请求映射：

| 页面动作 | 方法 | 路径 | 实例 | 请求体/参数 | SDK结果 |
| --- | --- | --- | --- | --- | --- |
| 查询 | GET | `/vue/order/ccbAccount/list` | crm | `{ pageNo, pageSize }`，表单编码头 | `{ list, total }` |
| 组织树 | GET | `/admin-api/sales/organization/tree` | platform | `{ salesTypeMax: '1' }` | 组织树数组 |
| 新建 | POST | `/vue/order/ccbAccount/save` | crm | 完整草稿，含转换后的 `itemKind`，表单编码头 | `undefined` |
| 编辑 | POST | `/vue/order/ccbAccount/save` | crm | 完整草稿，含当前行 `id`，表单编码头 | `undefined` |
| 删除 | DELETE | `/vue/order/ccbAccount/{id}` | crm | 无业务体，表单编码头 | `undefined` |
| 编辑页加载 | 无详情请求 | 当前列表行传给弹窗 | — | `processRowData` 回填 `officeId` 和 `itemKindCode` | 本地表单 |

权限核对：页面菜单权限是 `/dashboard/sale/frame/order/ccb-account`；新建按钮检查 `order:ccbAccount:edit`；编辑/删除按钮源码检查的是 `order:tradeStoreroom:edit`。SDK 只声明页面权限和这些说明，不自行替换或绕过权限。

以下内容是源码和离线测试证据，不冒充真实环境验证：当前尚未在测试环境执行本页组织树、列表、新建、编辑、删除和写入后的列表回查闭环。

## 操作步骤

### 查询和编辑

1. 调用 `sale-ccb-account-organization-tree`，从当前会话可见树选择 `salesId`。
2. 调用 `sale-ccb-account-list`，按 `total` 分页并保存目标行完整字段。
3. 编辑时使用目标行 `office.id`、`office.name`，并用 `base-dict-get({ dictType: 'item_kind' })` 将 `itemKind` 标签匹配回 `itemKindCode` 值数组。
4. 将完整表单交给 `sale-ccb-account-prepare-update`；用户取消时丢弃 `draft`。
5. 用户明确确认后调用 `sale-ccb-account-update`，成功或超时按同一 `id` 回查并逐字段核对。

### 新建

1. 读取组织树和 `item_kind` 字典，准备包含页面全部字段的表单；必填字段不能省略。
2. 调用 `sale-ccb-account-prepare-create`，检查生成的 `draft.itemKind` 与 Portal 单引号 JSON 规则一致。
3. 用户取消时不发送 save；明确确认后将同一 `draft` 交给 `sale-ccb-account-create`。
4. 成功或超时后按公司、商品类型、商户号和账号等关键字段分页查询；匹配不唯一时不能猜测哪条是本次创建。

### 删除

1. 从当前列表选择目标 `id`，调用 `sale-ccb-account-prepare-remove`。
2. 用户取消时丢弃准备结果；明确确认后调用 `sale-ccb-account-remove`。
3. 重新分页查询并确认目标 ID 不再出现；超时先核实，不盲目重试。
