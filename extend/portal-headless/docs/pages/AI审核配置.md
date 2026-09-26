# AI审核配置（`/dashboard/flow/ai-review-config/list`）

审批管理域「流程治理」四页里的第二页。四件套的其它三件分别在：
能力定义与参数契约 → `src/capabilities/flow-manage.ts`；逐字段基准 → `baseline/flow-management.browser.json`；
回归测试 → `test/flow-management.test.ts`。

这一页是这四页里**空值处理最激进的一页**：所有空值**整个丢掉**，
连恒为空串的 `order` / `orderField` 都不放过 —— 不填筛选时 URL 上**只剩分页**。

## 页面标识

| 项 | 值 |
| --- | --- |
| 菜单路径 | `/dashboard/flow/ai-review-config/list`（菜单标题「AI审核配置」，域 `flow`） |
| 权限码 | `/dashboard/flow/ai-review-config`（比菜单路径少 `/list`） |
| 路由文件 | `app/portal/views/dashboard/hr/flow/ai-review-config/list.vue` |
| 接口封装 | `app/portal/views/dashboard/hr/flow/ai-review-config/api.js` |
| 清单行 | `page-catalog.json` 的 `4eb18f`，`kind` = 列表页(自定义 customLoad)，`write` = false |
| 菜单来源 | `app/portal/menus/hr.js:259` |
| module-type | **没有** —— 匹配不到任何规则；基准里浏览器**同样不发这个头** |
| http 实例 | **全局默认的 `platform.js`**（`api.js:1` 显式 import） |
| 形态 | 只读列表页（`useListPageModule` + `customLoad`） |
| 写操作 | 新建 / 编辑 / 删除，均已登记 prepare/submit/cancel 能力 |

## 逐字段基准

基准文件：`baseline/flow-management.browser.json` 第 8 条（打开页面时自动查询）。

```text
GET https://biz-api-test.wodecorp.cn/admin-api/bpm/ai-review-config/page
    ?pageNo=1&pageSize=20&_t=<ts>
```

请求头（**没有 `module-type`**）：`tenant-id` / `token` / `Accept-Language: zh-CN` /
`Accept: application/json, text/plain, */*`。

**注意这条 URL 上有什么、没什么** —— 它只有分页，`order=` 与 `orderField=` **一个都不在**。
这不是"页面没发"，是**发出去之后被滤掉了**，见下。

## 空值全丢：`removeEmptyParams` 逐字复刻

`customLoad` 是 `getAiReviewConfigPage(normalizeSearchParams(params))`，而

```js
// api.js:101-113
function removeEmptyParams(data) {
  return Object.fromEntries(
    Object.entries(data || {}).filter(([, value]) => {
      if (value === '' || value === null || value === undefined) return false
      if (Array.isArray(value) && value.length === 0) return false
      return true
    })
  )
}
```

滤掉 `''` / `null` / `undefined` / **空数组**。而列表模块拼出来的 `params` 里：

| 键 | 初值 | 结果 |
| --- | --- | --- |
| `order` / `orderField` | `''`（页面没有这两个控件） | **被滤掉** |
| `processDefinitionKey` | `undefined`（页面 `form` 里就写的 `undefined`） | 被滤掉 |
| `taskDefinitionKey` | `''` | 被滤掉 |
| `enabled` | `undefined` | 被滤掉 |
| `createTime` | `[]` | 被滤掉 |
| `pageNo` / `pageSize` | `1` / `20` | **留下** |

⇒ 无筛选时 URL 就是 `?pageNo=1&pageSize=20&_t=`。

**两处最容易写坏的地方**：

1. **`false` 必须留下。** `enabled=false` 是"只看停用的"这个**有效筛选值**；
   顺手写成 `if (!value) continue` 会把 `false` 也滤掉，语义就从"只看停用"变成"不过滤"。
   页面源码写的是 `value === '' || value === null || value === undefined`（三个精确比较），
   SDK 逐字照抄；测试有一条专门钉 `enabled=false` 会进 URL。
2. **`order` / `orderField` 也一起没了。** 这与同文件的**流程模型**页正相反
   （那一页空值照发，URL 上 `order=&key=` 都在）。两页只差一个 `customLoad`。

## 参数契约

| 参数 | kind | 必填 | 说明 |
| --- | --- | --- | --- |
| `processDefinitionKey` | text | 否 | 流程定义 Key。页面是下拉（候选走 `/bpm/process-definition/list` 的全量，**SDK 不拉那张表**） |
| `taskDefinitionKey` | text | 否 | 任务节点 Key。页面是文本输入框 |
| `enabled` | boolean | 否 | 页面取值是**布尔** `true` / `false`。**`false` 是有效筛选值、会照发**；"不传"才是"不过滤" |
| `createTimeStart` / `createTimeEnd` | date | 否 | 必须**成对**给；`YYYY-MM-DD HH:mm:ss`；**原样两端**（不 +1 天、也不归到当日边界） |
| `pageNo` / `pageSize` | number | 否 | 默认 1 / 20 |
| `order` / `orderField` | — | — | **恒为空串、且恒被滤掉**，所以不开放 |

请求参数的顺序（有值时才出现，顺序不变）：
`order, orderField, processDefinitionKey, taskDefinitionKey, enabled, createTime[0], createTime[1], pageNo, pageSize, _t`。
测试里有一条**把两个相邻键对调**的用例在比有序对，所以键序也是被锁住的。

时间区间的语义是 **原样取两端**：页面是
`<a-range-picker value-format="YYYY-MM-DD HH:mm:ss" show-time>`，两个值原样进 qs，
没有任何改写。要含结束日一整天请自己给 `23:59:59`（`buildAiReviewConfigTimeRange()` 只做格式校验）。

## 页面列与返回结构

列表列：流程定义Key / 任务节点Key / AI Skill / AI 模型 / 状态 / 备注 / 创建时间 / 操作。

- **「AI Skill」那一列显示的是名称、返回的是 id。** 页面挂载时拉
  `/sys/tip-template/list` 建了一张**本地** `id → name` 映射（`tipTemplateNameMap`），
  渲染时 `getSkillName(record.skillId)`。SDK **不拉那张表**（见下），
  所以能力返回的就是 `skillId` 原始 id —— 这是**有意的取舍**，别把它当缺失。
- 「状态」用 `normalizeEnabledLabel()`：真值 →「启用」、假值 →「停用」。
- 「AI 模型」列显示 `record.modelConfigName`（页面直接显示、不做映射）。

## 长选项参数（D6 / H35）：页面挂载时那几条全量拉，SDK **一条都不照抄**

基准第 9、10 条就是它们：

| 页面发的（基准） | 用途 | SDK |
| --- | --- | --- |
| `GET /bpm/process-definition/list?suspensionState=1` | 左侧「流程定义Key」下拉 | 不提供 |
| `GET /sys/tip-template/list` | AI Skill 的 id → 名称映射 | 不提供 |
| `GET /manager/aiModelConfig/getAvailableList`（编辑表单里，基准未抓到） | AI 模型候选 | 不提供 |

它们都不是**筛选参数本身**（只是把 id 换成名字），所以 SDK 的取舍是：
**宁可在返回里给 id，也不为了好看去拉全表**。

⚠️ 顺带记一条：`flow-task-create-definitions`（发起流程页的能力）拿到的是**当前用户可发起的**
流程定义，而这一页要的是**全部启用中的**定义 —— 两者严格说不是一回事，所以那一份**不能**替代这里。

## 操作步骤

```text
1. 进入「AI审核配置」（/dashboard/flow/ai-review-config/list）
2. （可选）选流程定义Key、填任务节点Key、选状态（启用/停用）
3. （可选）选创建时间区间
4. 查询
5. 行上「编辑 / 删除」——都是写，本能力不覆盖
```

## 真实验证

- **基准来自真实环境**：2026-09-21 由 `bsk` 抓于 `https://webtest01.wodecorp.cn/portal.html#/`
  （`baseline/flow-management.browser.json` 第 8 条）。
- **契约与基准逐字段一致**：`test/flow-management.test.ts` 比有序的 `[key, value]`，
  并把整条 URL 断言成 `[['pageNo','1'],['pageSize','20'],['_t','<ts>']]`；
  另有「`enabled=false` 要照发」「空串一律丢」「有值时的顺序」「区间原样两端」「单边 reject」各一条。
- **没做**：SDK 对真实后端的**冒烟**（本波不跑浏览器、也没有这一页的 smoke 脚本）。

## 动作覆盖边界

- **写操作三条已接入**：`POST /bpm/ai-review-config/create`、`PUT …/update`、
  `DELETE …/delete?id=`；准备阶段保留 `modelConfigId: null`，删除沿用 query 参数。
  这些动作会改变流程节点的 AI 审核规则，真实环境验证必须使用安全夹具并按
  `prepare → submit → verify → cancel/cleanup` 记录，不能把离线合同测试当作线上写证据。
- **三条候选入口**（流程定义 / 审核模板 / AI 模型）**刻意不做**，理由见上。
- **`normalizeSubmitData`**（提交路径上对 `modelConfigId === null` 的显式保留，
  `api.js:83-89`）只读出来记在这里，本波不涉及提交。
- **列表行的字段只在源码里核对过**，**没有拿真实响应体逐字段核过**（基准只抓了请求，没抓响应）：
  `processDefinitionKey` / `taskDefinitionKey` / `skillId` / `modelConfigName` / `enabled` /
  `remark` / `createTime`。
- **`enabled` 在后端的真实类型**（布尔还是 0/1）没有验证过 —— 只从页面的
  `ENABLED_OPTIONS`（`{ value: true } / { value: false }`）读出是布尔。

<!-- ai-contract-business:start -->
## SDK AI 说明契约（2026-09-22）

本节由当前 SDK 描述结果整理；说明权威来源为 `src/catalog/contracts-business.ts`。调用 `catalog.describe(id)`（或 `id-llm`）可得到参数来源、返回字段/状态、数据消费与后续映射；`catalog.describePage(页面路径)` 用于选择页面功能。以下更新以本节为准；前文历史请求/实测记录仍保留其记录日期。

### `flow-manage-ai-review-config-list`

查询流程节点的 AI 审核配置、绑定技能和启用状态；不执行审核或修改配置。

- 执行：`sdk.flowManage.listAiReviewConfigs`；通过 `capabilities.invoke('flow-manage-ai-review-config-list', args)` 调用时按 `params` 填参。性质：read。
- 参数：`processDefinitionKey` 可选 (string)；`taskDefinitionKey` 可选 (string)；`enabled` 可选 (boolean)；`createTimeStart` 可选 (string)；`createTimeEnd` 可选 (string)；`pageNo` 可选 (number)；`pageSize` 可选 (number)。完整来源、枚举、条件必填与默认值由 SDK 同次返回。
- 返回：`{ list: object[], total: number }`。list=[] 为当前页无记录；total=0 表示该筛选无结果。保留筛选条件检查页码，不将空结果解释成权限判定。
- 字段：`list`、`total`、`list[].id`、`list[].processDefinitionKey`、`list[].taskDefinitionKey`、`list[].skillId`、`list[].modelConfigName`、`list[].enabled`、`list[].remark`、`list[].createTime`。嵌套字段、可空性及业务含义见同次返回的 `returns.fields`。
- 消费：按流程 Key+节点 Key 区分配置；enabled=false 是有效筛选，省略才不过滤。skillId 不能当模型 ID。 筛选已有配置时，先按流程名称用模型列表取 key，再只填 processDefinitionKey 读取该流程配置的 taskDefinitionKey；若无配置即交付空结果，不需要猜一个尚无配置的节点。此能力只读，不承担新增节点配置。
- 完成条件：按用户要求交付本次筛选范围的结果；需要完整清单时继续翻页至覆盖 total，不能把当前页当全集。
- 失败/不确定：权限或会话错误要交由用户恢复权限/登录后再读；不要通过换租户、换页面上下文绕过。业务校验失败按原错误修正参数，网络失败的只读查询可重试。


验证：`test/ai-contract-business.test.ts` 直接检查 SDK 描述输出及业务夹具；本批未重放真实写操作。逐能力状态、证据与反证见 [补齐清单](../ai-contract-business-evidence.md)。
<!-- ai-contract-business:end -->
