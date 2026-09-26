# 流程表单（「发起流程」下的那一类）——枚举、契约与可复用做法

> 本文件回答一个问题：`pnpm next` **永远选不到**的那批页面（`/simple/hr/form/033` 这类流程表单）
> 该怎么枚举、怎么判断能不能做、以及「做一个新流程表单」能不能变成一套可复用的步骤。
>
> 调查时间 2026-09-20，测试环境（`webtest01.wodecorp.cn` / `biz-api-test.wodecorp.cn`），
> 登录身份是测试账号（租户 1）。**本单全部只读，没有提交过任何流程。**
>
> 文中逐处标注 **【实测】** 与 **【推断】**。带「未覆盖」的小节是明确没查到的部分。

---

## 0. 一句话结论

流程表单**可以被枚举**——一个只读接口 `GET /bpm/process-definition/create-list` 就列出了
「当前用户能发起的全部流程」（实测 82 个）。但它们**不能被批量做**：
每个流程都有自己的**独立业务控制器**（`create` / `get` / `getTemporaryRequiredStartUserSelectTasks`
三个接口，路径前缀各不相同），字段契约**不在接口里、只在前端源码里**。
所以这里能复用的是一个**流程（sop）**，不是一个生成器。

---

## 1. 怎么枚举

### 1.1 「发起流程」页在哪

| 项 | 值 |
| --- | --- |
| 菜单路径 | `/dashboard/flow/task/create/list`（标题「发起流程」，域 `flow`） |
| 路由文件 | `app/portal/views/dashboard/hr/flow/task/create/list/index.vue` |
| 菜单来源 | `app/portal/menus/hr.js:247` |
| `page-catalog.json` | id `5e7066`，`kind` = 其他/自定义页面，`write` = false |
| 组件 | 卡片墙：顶部 `a-segmented`（流程类型）+ 搜索框，「最近使用」chips + 按分类分组的卡片网格 |

### 1.2 拿清单的接口

```text
GET /admin-api/bpm/process-definition/create-list
    ?suspensionState=1
    &processType=<1|2>
    &_t=<ts>
```

来源 `index.vue:218-223`。**两个参数都是必给的**：

- `suspensionState=1` —— 只要启用中的流程（字面量硬编码在页面里）。
- `processType` —— 默认 `1`。取值来自平台字典 `bpm_process_type`
  （`getPlatformDictListByType('bpm_process_type', true)`，`index.vue:121`）。
  字典实测有**两个值**：`1 = 审核`、`2 = 审批`。
  **两个都要拉**——只拉 `processType=1` 会漏掉 57 个流程。

字典本身：`GET /adminmanage-api/system/dict-data/list-all-simple`
（注意是 `adminmanage-api` 前缀，`app/portal/utils/system.js:1309`），
取 `dictType === 'bpm_process_type'` 的行。

### 1.3 返回结构【实测】

`ret: 'SUCCESS'`，`data` 是**分类数组**，不是扁平列表：

```jsonc
{
  "ret": "SUCCESS",
  "data": [
    {
      "code": "human_process",          // 分类码
      "name": "人力",                    // 分类名（页面分组标题）
      "processDefinitionList": [
        {
          "id": "meeting_application:1:55c1c210-...",   // 形如 key:version:uuid，也可能是裸 uuid
          "key": "meeting_application",                 // ← 流程定义 Key，进表单要用它
          "name": "会议室审批",
          "formType": 20,                               // 实测全是 20
          "baseUrl": "portal",                          // 「发起流程」页只认 'portal'
          "formCustomCreatePath": "simple/hr/form/033", // ← 表单路径，**只在 create-list 里有**
          "category": "human_process"
        }
      ]
    }
  ]
}
```

**两个要点：**

1. `formCustomCreatePath` **只有 `create-list` 返回**。`/bpm/process-definition/get` 里这个字段是
   `null`（实测见 §3.4）。要拿到「key → 表单路径」的映射，**必须**打 `create-list`。
2. 页面自己会对每张卡做一次**可用性判定**（`hasError()`，`index.vue:178-185`），
   不满足的卡片渲染成红色并带 tooltip，点进去也是坏的。判据是四条同时成立：

   ```text
   baseUrl === 'portal'
   formType === 20
   formCustomCreatePath 非空
   formCustomCreatePath 以 'simple/' 开头
   ```

   实测这 82 个**全部满足**这四条（没有红色卡片）。

### 1.4 实测拿到的完整清单（82 个）

`processType=1`（审核）25 个 + `processType=2`（审批）57 个。
`formCustomCreatePath` 已省略 `simple/` 前缀（原值都带）。

#### processType=1「审核」

| 分组 | processKey | 名称 | 表单 |
| --- | --- | --- | --- |
| 人力 human_process | `diaodong` | 内部调动流程 | `hr/form/003` |
| | `lizhi` | 离职申请流程 | `hr/form/002` |
| | `qingjia` | 请假申请流程 | `hr/form/005` |
| | `reEmployment` | 再入职流程 | `hr/form/006` |
| | `ruzhi` | 入职流程 | `hr/form/001` |
| | `zhuanzheng` | 试用转正流程 | `hr/form/004` |
| 资产 inventory_process | `energy_usage_record` | 资产能源用量支出 | `material/form/015` |
| | `fixed_asset_disposal` | 固定资产报废处理 | `material/form/013` |
| | `inventory_inbound` | 物料入库 | `material/form/006` |
| | `not_fixed_asset_disposal` | 非固定资产报废处理 | `material/form/014` |
| | `outbound` | 物料出库 | `material/form/007` |
| 生产 production_process | `pre_plan_adjustment_shandong_wode` | 山东沃德预案调整审核 | `product/form/013` |
| | `pre_plan_adjustment_anhui_wode` | 安徽沃德预案调整审核 | `product/form/012` |
| | `pre_plan_adjustment_dulehe` | 独乐河公司预案调整审核 | `product/form/011` |
| | `pre_plan_adjustment_tianjin` | 天津沃德预案调整审核 | `product/form/010` |
| | `pre_plan_adjustment_yunnan` | 云南公司预案调整审核 | `product/form/008` |
| | `chicken_plan_demand_review` | 种鸡饲料计划审核 | `product/form/015` |
| | `pre_plan_adjustment_beijing_breeding` | 北京育种预案调整审核 | `product/form/003` |
| | `pre_plan_adjustment_shandong` | 山东公司预案调整审核 | `product/form/004` |
| | `pre_plan_adjustment_shijiazhuang` | 石家庄公司预案调整审核 | `product/form/005` |
| | `pre_plan_adjustment_xinjiang` | 新疆公司预案调整审核 | `product/form/006` |
| | `feed_review` | 饲料审核 | `product/form/014` |
| | `pre_plan_adjustment_hebei` | 河北公司预案调整审核 | `product/form/009` |
| | `pre_plan_adjustment_hubei` | 湖北公司预案调整审核 | `product/form/007` |
| 销售 sales_process | `visit_record_apply` | 拜访单申请 | `sales/form/004` |

#### processType=2「审批」

| 分组 | processKey | 名称 | 表单 |
| --- | --- | --- | --- |
| 人力 human_process | `temporary_worker_salary_document` | 临时工工资汇总单 | `hr/form/016` |
| | `hr_business_trip_application` | 出差申请流程 | `hr/form/041` |
| | `payroll_expense_request_form` | 薪酬支出申请表 | `finance/form/001` |
| | `hr_business_registration_application` | 企业登记设立/变更/注销申请会签单 | `hr/form/040` |
| | **`hr_product_design_approval`** | **产品设计文档审核** | `hr/form/045` |
| | `contract_template` | 合同模版审批 | `hr/form/007` ← **已做过**（`src/capabilities/contract-template.ts`） |
| | `recruitment_standard_confirmation` | 招聘标准确认表 | `hr/form/024` |
| | `hr_contract_approval` | 合同审批 | `hr/form/034` |
| | **`hr_general_approval`** | **通用审批** | `hr/form/035` |
| | `hr_overtime_application` | 加班审批 | `hr/form/042` |
| | `hr_rest_leave_application` | 调休审批 | `hr/form/043` |
| | **`meeting_application`** | **会议室审批** | `hr/form/033` ← **已做过** |
| | `onboarding_confirmation` | 入职确认单 | `hr/form/020` |
| | `post_staffing_adjustment` | 岗位编制调整单 | `hr/form/021` |
| | `provident_fund_payment` | 公积金缴纳单 | `hr/form/019` |
| | `recruitment_plan` | 招聘计划 | `hr/form/026` |
| | `retire_salary_document` | 退休人员工资汇总单 | `hr/form/015` |
| | `salary_payment_summary` | 工资支出汇总单 | `hr/form/022` |
| | `seal_application` | 用章审批 | `hr/form/032` |
| | `social_security_payment` | 社保缴纳单 | `hr/form/018` |
| | `staff_contract_sign` | 合同签订 | `hr/form/010` |
| | `staff_info_change` | 信息变更单 | `hr/form/025` |
| | `staff_promotion` | 晋级/提拔申请表 | `hr/form/023` |
| | `tenant_apply` | 租户申请 | `hr/form/044` |
| | `unit_staff_salary_expense` | 单元间人员薪资用费用分组表 | `hr/form/014` |
| | **`vehicle_usage_application`** | **用车审批** | `hr/form/031` |
| 财务 finance_process | `financing_profit_expense_request_form` | 利润分配、分红业务支出申请 | `finance/form/017` |
| | `business_entertainment_expense_request_form` | 业务招待费支出申请 | `finance/form/023` |
| | `own_vehicle_transport_expense_request_form` | 车辆费用支出申请单 | `finance/form/016` |
| | `transport_expense_request_form` | 外雇车辆费用支出申请单 | `finance/form/004` |
| | `depreciation_adjustment_request_form` | 折旧调整申请表 | `finance/form/010` |
| | `social_expense_request_form` | 通用性支出申请表 | `finance/form/006` |
| | `energy_expense_request_form` | 能源费支出申请表 | `finance/form/011` |
| | `investment_expenditure_payment_request_form` | 投资支出申请单 | `finance/form/022` |
| | `related_settlement_expense_request_form` | 关联方资金结算支出申请 | `finance/form/019` |
| | `prepayment_expense_request_form` | 预付款项支出申请 | `finance/form/013` |
| | `expenditure_budget_request_form` | 支出预算申请表 | `finance/form/002` |
| | **`internal_transportation_expense_request_form`** | **差旅费支出申请表**（≈报销） | `finance/form/003` |
| | `investment_engineering_expense_request_form` | 工程类支出申请 | `finance/form/020` |
| | `financing_debt_repayment_expense_request_form` | 偿还债务本金及利息支付申请 | `finance/form/015` |
| | `labor_termination_expense_request_form` | 解除劳务关系支出申请 | `finance/form/021` |
| | `meeting_expense_request_form` | 会议费支出申请表 | `finance/form/005` |
| | `employee_loan_expense_request_form` | 员工借款支付申请 | `finance/form/012` |
| | `special_expense_request_form` | 特别费用支付申请 | `finance/form/018` |
| | `welfare_expense_request_form` | 福利费支出申请表 | `finance/form/007` |
| | `finance_grant_application` | 拨款申请 | `finance/form/008` |
| | `tax_expense_request_form` | 税费支出申请表 | `finance/form/014` |
| | `unit_expense_request_form` | 工会支出申请表 | `finance/form/009` |
| 生产 production_process | `chicken_flock_transfer_approval` | 鸡群周转计划审批 | `product/form/001` |
| 销售 sales_process | `claim_apply_chick7d` | 雏鸡7日龄理赔申请 | `sales/form/010` |
| | `claim_apply_tumor` | 肿瘤鸡理赔申请 | `sales/form/009` |
| | `claim_apply_young` | 青年鸡理赔申请 | `sales/form/011` |
| | `customer_credit` | 客户信贷 | `sales/form/001` |
| | `eliminated_chicken_sales_apply` | 老母鸡销售审批申请 | `sales/form/008` |
| | `guide_price_apply` | 指导价申请 | `sales/form/005` |
| | `test_edit_model_name` | QQQ1112（**测试遗留流程，名字是乱的**） | `hr/form/041` |
| | `trade_low_price` | 低价订单审批 | `sales/form/003` |

> ⚠️ **这份清单是「当前登录用户能看到什么」，不是「系统里有什么」。**
> 后端按权限过滤，换个账号数量会变（【推断】，没有第二个账号可验证）。
> `test_edit_model_name` 与 `hr_business_trip_application` 共用 `hr/form/041`，
> 是测试环境的数据脏；不要把它当成正常流程。

---

## 2. 哪些是「大众化、普通用户日常用」的

用户点名了 7 类。**6 类能对上，2 类对不上**（发票完全没有，报销是近似对应）。

| 用户说的 | 能不能对上 | processKey | 表单 | 备注 |
| --- | --- | --- | --- | --- |
| 通用审批 | ✅ 完全对应 | `hr_general_approval` | `hr/form/035` | 名字就叫「通用审批」 |
| 请假 | ✅ 完全对应 | `qingjia` | `hr/form/005` | 「请假申请流程」（注意 key 是拼音） |
| 用车 | ✅ 完全对应 | `vehicle_usage_application` | `hr/form/031` | 「用车审批」 |
| 报销 | ⚠️ **没有叫「报销」的流程** | `internal_transportation_expense_request_form` | `finance/form/003` | 最贴近的是「差旅费支出申请表」，接口路径里就写着 `bpm-spending-apply-travel`。财务分组下 22 个「支出申请」都是同一家族 |
| 发票 | ❌ **不存在** | — | — | 见下 |
| 产品文档审核 | ✅ 对应（名字略不同） | `hr_product_design_approval` | `hr/form/045` | 实际叫「产品设计**文档**审核」 |
| 会议室预定 | ✅ 完全对应，**已做过** | `meeting_application` | `hr/form/033` | |

### 2.1 「发票」为什么对不上【实测】

全库检索 `发票` 只命中两类东西，**都不是流程表单**：

1. `app/portal/views/simple/supply/form/00{1,4,6,8}/*` 里的字段 `invoiceName`（「收货公司发票名称」）
   —— 那是**供应链收货单**上的一个字段，不是流程。
2. `app/portal/views/dashboard/platform/trade/invoice-list{,-market,-platform}/`
   —— 名字里带 invoice，但它是**「发货单」列表**（`app/portal/menus/mall.js:356` 的标题就是「发货单列表」），
   而且挂在 **mall 应用**的菜单（`menus/mall.js` / `menus/mall.v2.js`）下，不在 HR 门户菜单里。

**结论：这套系统里没有一个「发票」流程表单。** 发票是作为「增值税进项税」之类的**字段**
出现在财务支出申请里的（`finance/form/003` 有 `inputTaxAmount` 增值税进项税）。
如果用户要的是「发票相关」的能力，需要重新确认他指的是哪件事。

### 2.2 按「大众化」排出的建议顺序

判据：**普通员工自己就会发起、不依赖财务/生产专业知识、字段少、一年用不止一次。**

第一梯队（真正的日常）：

| 顺序 | processKey | 名称 | 理由 |
| --- | --- | --- | --- |
| 1 | `hr_general_approval` | 通用审批 | 最通用，字段最少（2 个必填 + 附件 + 抄送人） |
| 2 | `qingjia` | 请假 | 人人都会用；但有年假余额/时长计算等**只读联动** |
| 3 | `vehicle_usage_application` | 用车审批 | 字段少；但申请人选择器是**按组织查**的 |
| 4 | `hr_product_design_approval` | 产品设计文档审核 | 与通用审批几乎同构，**可以复用通用审批那套** |

第二梯队（财务类，字段多、有明细行）：

| 顺序 | processKey | 名称 | 理由 |
| --- | --- | --- | --- |
| 5 | `internal_transportation_expense_request_form` | 差旅费支出申请表 | **有 `travelEntryList` 明细行数组**，复杂度明显高一档 |

不建议做的（不是「大众化」）：
- 生产 `pre_plan_adjustment_*`（11 个「预案调整审核」+ 饲料类）—— 强业务知识，且是同一模板的地区变体，
  做了也是重复。
- `test_edit_model_name`（QQQ1112）—— 测试遗留数据。
- 财务分组下另外 21 个「XX费支出申请」—— 与差旅费同构，等差旅费那条线跑通后按方法复制，
  不要一个个当新流程做。

---

## 3. 表单契约从哪来

### 3.1 核心事实：契约**不在接口里，只在前端源码里**【实测】

我试过 `/bpm/process-definition/get?key=<各种>`，5 个流程（含会议室、通用审批、请假、用车、
产品设计文档审核）返回的**是同一个形状**：流程元数据 + `bpmnXml`，**没有任何表单字段信息**：

```jsonc
{
  "id": "hr_general_approval:7:964ff0ae-...",
  "version": 7,
  "name": "通用审批",
  "key": "hr_general_approval",
  "category": "human_process",
  "suspensionState": 1,
  "formType": null,               // ← 全是 null
  "formId": null,
  "formName": null,
  "formConf": null,
  "formFields": null,             // ← 关键：没有字段定义
  "baseUrl": null,                // ← 注意：和 create-list 里的 'portal' 不一样
  "formCustomCreatePath": null,   // ← 关键：只有 create-list 才有
  "bpmnXml": "<xml…>"
}
```

**⇒ 结论：没有「读一个接口就拿到表单 schema」这条路。**
表单字段只能从 `app/portal/views/simple/**/form/NNN/` 的 Vue 源码里读出来，
或者从真实页面逐个控件抽。这是做流程表单**最贵的一步**，也是它不能被生成器覆盖的根本原因。

### 3.2 每个流程有自己的业务控制器（三个接口）

【实测，源码 grep】所有流程表单都是这个三段式，**路径前缀各自不同**：

| 用途 | 形状 | 通用审批的例子 | 会议室（已做） |
| --- | --- | --- | --- |
| 建单 | `POST /<域>/<模块>/create` | `/hr/general-approval/create` | `/hr/meeting-application/create` |
| 详情 | `GET /<域>/<模块>/get?id=<businessKey>` | `/hr/general-approval/get` | （未用） |
| 审批人节点 | `POST /<域>/<模块>/get*RequiredStartUserSelectTasks` | `/hr/general-approval/getTemporaryRequiredStartUserSelectTasks` | `/hr/meeting-application/getRequiredStartUserSelectTasks` |

**⚠️ 审批人节点那个接口的名字有两个变体**，实测都存在：

- `getRequiredStartUserSelectTasks` —— 会议室、请假（`/hr/attendance-user-rel/...`）
- `getTemporaryRequiredStartUserSelectTasks` —— 通用审批、用车、产品设计文档审核

不能靠猜，**必须去源码里看这一个流程用的是哪个**。

### 3.3 五个目标流程的接口与字段【源码实测】

#### a) 通用审批 `hr_general_approval` → `/hr/general-approval/*`

源码：`app/portal/views/simple/hr/form/035/`，字段表在 `common/index.js`。

| 字段 | 页面 label | 必填 | 形态 |
| --- | --- | --- | --- |
| `applicationItem` | 申请事项 | ✅ | 文本 |
| `applicationContent` | 申请内容 | ✅ | 文本域 |
| `copyUserIds` | 抄送人 | 否 | **多选人员**（选项来自 `GET /system/user/simple-list`，**全量、无关键字**）|
| `attachments` | 附件 | 否 | 附件数组 `[{url, name}]` |
| （无 name 字段） | 审批人 | 条件 | 自选审批人，来自 required-tasks 返回的节点 |

提交载荷（`buildGeneralApprovalSubmitData`）：

```js
{ applicationItem, applicationContent, attachments: [{url, name}], copyUserIds: [] }
// 再并入 startUserSelectAssignees: { [taskId]: [userId, ...] }
```

#### b) 请假 `qingjia` → `/hr/attendance-user-rel/*`（**注意模块名不是 leave**）

源码：`app/portal/views/simple/hr/form/005/`。

| 字段 | 页面 label | 必填 | 形态 |
| --- | --- | --- | --- |
| `type` | 请假类型 | ✅ | 下拉（字典 `absentTypeList`）|
| `reason` | 请假事由 | ✅ | 文本域 |
| `startDate` + `startType` | 开始时间 | ✅ | **复合控件**：日期 + 「上午/下午」下拉（`picker-group.vue`）|
| `endDate` + `endType` | 结束时间 | ✅ | 同上 |
| `attachments` | 附件 | 否 | 附件数组（≤10，pdf/jpg/jpeg/png）|

这个流程有**三条只读联动**，都是独立接口，页面会实时调：

- `GET /hr/attendance-user-rel/getYearRest` —— 年假余额；`type === 13`（年假）时若余额 ≤0 直接拦提交
- `GET /hr/attendance-user-rel/getRestDuration` —— 请假时长（自动扣法定节假日）
- `utils.js` 的 `startIsAfterEnd()` —— 结束不能早于开始（**本地校验，前端做的**）

#### c) 用车 `vehicle_usage_application` → `/hr/vehicle-usage-application/*`

源码：`app/portal/views/simple/hr/form/031/`，字段表在 `common/index.js`。

| 字段 | 页面 label | 必填 | 形态 |
| --- | --- | --- | --- |
| `applicantId` | 申请人 | ✅ | **人员选择，但候选来源是组织**：`POST /org/staff/getStaffByOrg` body 是 `orgIdList` |
| `reason` | 用车事由 | ✅ | 文本 |
| `startTime` / `endTime` | 时间段 | ✅ | `a-range-picker`（页面上是一个控件，提交时拆两个字段）|
| `destination` | 用车目的地 | ✅ | 文本 |
| `remark` | 备注 | 否 | 文本 |
| — | 审批人 | 条件 | 同通用审批 |

提交载荷（`buildVehicleUsageSubmitData`）**不是表单字段的直传**，中间有一次映射：

```js
{ staffId, staffName, reason, startTime, endTime, destination, remark }
// staffId/staffName 是从选中的用户对象里取出来的，不是 applicantId 直传
```

#### d) 产品设计文档审核 `hr_product_design_approval` → `/hr/product-design-approval/*`

源码：`app/portal/views/simple/hr/form/045/`。
字段与**通用审批完全同构**（`applicationItem` / `applicationContent` / `copyUserIds` / `attachments`
+ 自选审批人），只是模块路径不同。**这是本批里性价比最高的一个**：
把通用审批那套做出来之后，它基本只是换三个 URL。

#### e) 差旅费支出申请表 `internal_transportation_expense_request_form` → `/finance/bpm-spending-apply-travel/*`

源码：`app/portal/views/simple/finance/form/003/`。

**复杂度明显高一档**，因为它有**明细行数组**，且提交前要做一次结构改写（`onFinish()`）：

| 字段 | 页面 label | 形态 |
| --- | --- | --- |
| `orgId` | 组织选择 | 组织树 |
| `projectExpense` / `financeProjectId` | 是否为项目费用 / 项目名称 | 开关 + 联动选择 |
| `travelerIds` | 出差人 | **多选人员** |
| `reasons` | 出差事由 | 文本 |
| `amount` | 金额总计 | **前端算出来的**（`totalTravelBudgetAmount`），不是用户填 |
| `paymentDate` | 预计付款日期 | 日期 |
| `feeItem` / `feePurpose` | 费用选择 / 费用用途 | 下拉（选项来自 `GET /finance/payment-slip-person/fee-item-options`）|
| `travelEntryList[]` | 明细行 | **数组**，每行含起止时间/出发地/目标地/出行方式/交通费/餐补/住宿补/其他补/增值税进项税/预算单，起止时间是 `startEndDate[0..1]`、地区是三级数组 `[省,市,区]` |
| `remark` / `attachmentList` | 其他说明 / 附件 | |

**没有在源码里找到 `get*RequiredStartUserSelectTasks` 的调用**——这个流程的审批人可能是
后端定好的（【推断】没有实跑验证）。

### 3.4 现有 `meetingApplication.definition(processKey)` 能不能通用？

**接口层面：能通用。DTO 层面：不能。**

`definition()` 打的是 `GET /bpm/process-definition/get?key=<任何 key>`，
**5 个 key 实测都返回 200 `ret:SUCCESS` 且形状一致**。所以：

- ✅ 它能**确认一个流程存在、拿到名字/分类/版本**，任何流程都能调。
- ✅ 它返回的 `bpmnXml` 里含**真实的审批链**——`userTask` 节点带
  `flowable:candidateStrategy` / `flowable:candidateParam`。
  实测：`meeting_application` 的 XML 里**没有 userTask**（发起人 → 结束，与文档一致）；
  而 `hr_general_approval` 有 `name="发起人自选2"`、`vehicle_usage_application` 有 `name="发起人自选"`，
  `candidateStrategy="35"` —— **这两个流程是要求人工选审批人的**。
- ❌ 它**不返回表单字段**（`formFields: null`），所以它**不能**回答「这个流程要填什么」。
- ❌ 它**不返回 `formCustomCreatePath`**（实测为 `null`），所以**不能**靠它找到表单页面。
- ⚠️ 现有 `ProcessDefinition` 类型里声明的 `startUserSelectTasks` 字段，
  在这 5 次实测里**一次都没出现过**（它在响应里不存在）。类型上它是可选字段，所以不会报错，
  但**不要以为它会有值**——要审批人节点，得走 `get*RequiredStartUserSelectTasks`。

### 3.5 现有 DTO 覆盖不到的控件（这决定「做完整」的边界）

`MeetingApplicationDraft` 目前的类型只有 `string` / `number` / `number[]`（通过 assignees）。
拿它去套别的流程，**下面几类控件覆盖不到**：

| 覆盖不到的 | 出现在 | 为什么 DTO 装不下 |
| --- | --- | --- |
| **附件数组** | 通用审批、请假、产品文档、差旅费 | 值是 `[{url, name}]`，需要先上传拿到 `url`（`/file/oss-resource/create`） |
| **复合日期控件**（日期 + 上午/下午） | 请假 `startDate`+`startType` | 页面上一个控件产两个字段，且**两个字段有联动合法性**（`startIsAfterEnd`） |
| **日期区间拆两字段** | 用车 `startTime`/`endTime` | 页面上一个 `a-range-picker`，提交时拆开 |
| **明细行数组**（含嵌套的省市区三级数组） | 差旅费 `travelEntryList` | 需要嵌套 DTO，且提交前有结构改写 |
| **组织树 / 按组织查人** | 用车 `applicantId`、差旅费 `orgId` | 候选来源**不是关键字搜索**，是 `POST /org/staff/getStaffByOrg`（body 是 `orgIdList`） |
| **全量人员多选（抄送人）** | 通用审批、产品文档 `copyUserIds` | 页面直接 `GET /system/user/simple-list` 拉**全量**——**这正是 D6/H35 说的长选项参数**，无头下不能照抄 |
| **金额自动计算** | 差旅费 `amount` | 值由前端算，不接受调用方给 |
| **服务端字典下拉** | 请假 `type`、差旅费 `feeItem` | 选项来自字典/独立接口，不是自由文本 |

**⇒ 「做完整」的边界建议：**
把「**扁平标量 + 一个关键字搜索的人员/实体参数 + 附件**」定为第一档能完整覆盖的范围
（通用审批、产品设计文档审核在这一档）。
复合日期（请假）、组织选人（用车）是第二档，需要给 DTO 加类型。
明细行数组（差旅费）是第三档，**不建议在这一轮做**——它需要的是一个新的 DTO 家族，
不是一个新流程。

---

## 4. 每个流程端到端能做什么

### 4.1 通用动作（与流程无关，所有流程共用）

这些是**流程实例级**的，不是某个表单特有的。全部来自
`app/portal/views/dashboard/hr/flow/**` 与 `common/libs/flow-form/`。

| 动作 | 接口 | 读写 | 推真人待办？ | 来源 |
| --- | --- | --- | --- | --- |
| 列出我能发起的流程 | `GET /bpm/process-definition/create-list` | 只读 | 否 | §1.2 |
| 读流程定义 | `GET /bpm/process-definition/get?key=` | 只读 | 否 | §3.4 |
| 读我的流程实例 | `GET /bpm/process-instance/my-page` | 只读 | 否 | `flow/task/my/list.vue` |
| 读实例详情 | `GET /bpm/process-instance/get?id=` | 只读 | 否 | 多处 |
| **读审批链路** | `GET /bpm/process-instance/getWorkflowPath` | 只读 | 否 | `flow/form/detail/index.vue:425` |
| 读流程变量 | `GET /bpm/process-instance/getProcessVariables` | 只读 | 否 | — |
| 读审批历史（打印） | `GET /bpm/process-instance/detail?id=` | 只读 | 否 | `flow/history/index.vue` |
| **撤销审批**（撤回我办过的） | `PUT /bpm/task/withdraw` body `{id, reason}` | **写** | **会** | `utils/flow/task-withdraw.js:36` |
| **取消流程**（发起人撤回自己的） | `DELETE /bpm/process-instance/cancel-by-start-user` body `{id, reason}` | **写** | **会** | `flow/task/my/list.vue:253` |
| 管理员取消 | `/bpm/process-instance/cancel-by-admin` | **写** | **会** | 管理员面，不建议做 |
| **催办**（短信提醒） | `POST /bpm/process-sms-remind/send` | **写** | **会发给真人短信** | `hxr/flow/sms-remind/api.js` |
| 读催办历史 | `GET /bpm/process-sms-remind/{detail,history}?processInstanceId=` | 只读 | 否 | 同上 |
| **跟进**（给流程加跟进记录） | `POST /bpm/process-follow-up/create` | **写** | 会（通知相关人）| `hxr/flow/follow-up/api.js` |
| 读跟进 | `GET /bpm/process-follow-up/{capability,list}?processInstanceId=` | 只读 | 否 | 同上 |
| **办理**（审批通过/驳回） | `POST /bpm/hr/task/approve` body `{id, reason, type}` | **写** | **会** | `backlog/components/agreement-examine.vue:46` |
| 批量通过 / 批量驳回 | `/bpm/task/batchApprove` `/bpm/task/batchReject` | **写** | **会** | — |

**红线：`withdraw` / `cancel-by-start-user` / `sms-remind` / `follow-up` / `approve` 全是写，
而且都会产生对**真人**可见的后果**（撤掉别人的待办、给真人发短信、给真人推待办）。
本单**一个都没有执行**，只从源码读出接口形状。

### 4.2 撤销审批的线索（接 `docs/pages/待办事项.md` 的「尚未覆盖」）

待办事项那页的文档写着「撤销审批是写，本轮一行都没验」。这次把它的形状查清了：

```text
入口：openTaskWithdrawModal({ taskId, onRefresh })   // app/portal/utils/flow/task-withdraw.js
请求：PUT /bpm/task/withdraw   body { id: taskId, reason: reason?.trim() || '无' }
前置：taskId 来自**已办列表**的 `row.id`（`finished === 2` 且 `canWithdraw === true`)
错误：后端拒绝时 bizCode = '1009005015'（TASK_WITHDRAW_NOT_ALLOWED_CODE），
      页面此时会关弹窗并刷新——说明「状态过期」是正常情况，不是异常
```

对应的「取消流程」是另一个（发起人撤回自己的整条流程）：

```text
DELETE /bpm/process-instance/cancel-by-start-user   body { id, reason }
入口：/dashboard/flow/task/my/list.vue 的「取消流程」按钮，reason 是用户填的
```

**两者不是一回事**：`withdraw` 撤的是「**我办过的一个任务**」，`cancel-by-start-user` 撤的是
「**我发起的一整条流程**」。做能力时不要合并。

### 4.3 每个表单自己的动作

| 流程 | 建单 | 详情 | 审批人节点 | 取消/撤单 |
| --- | --- | --- | --- | --- |
| 会议室（已做） | `POST /hr/meeting-application/create` | —— | `POST …/getRequiredStartUserSelectTasks` | `PUT /hr/meeting-application/cancel-reservation/{id}` |
| 通用审批 | `POST /hr/general-approval/create` | `GET …/get?id=` | `POST …/getTemporaryRequiredStartUserSelectTasks` | 走通用动作 |
| 请假 | `POST /hr/attendance-user-rel/create` | `GET …/get?id=` | `POST …/getRequiredStartUserSelectTasks` | 走通用动作 |
| 用车 | `POST /hr/vehicle-usage-application/create` | `GET …/get?id=` | `POST …/getTemporaryRequiredStartUserSelectTasks` | 走通用动作 |
| 产品文档 | `POST /hr/product-design-approval/create` | `GET …/get?id=` | `POST …/getTemporaryRequiredStartUserSelectTasks` | 走通用动作 |
| 差旅费 | `POST /finance/bpm-spending-apply-travel/create` | `GET …/get?id=` | **源码里没看到** | 走通用动作 |

**只有会议室流程有自己的 `cancel-reservation`**。其余流程的取消一律走
`/bpm/process-instance/cancel-by-start-user`（收到 `bpmBusinessKey`，不是 `id`）。

---

## 5. 可复用的方法

### 5.1 会议室那条线里，哪些是通用的、哪些是那个流程特有的

| 会议室那条线里的东西 | 通用吗 | 说明 |
| --- | --- | --- |
| **`definition(processKey)`**（`/bpm/process-definition/get?key=`） | ✅ **完全通用** | 任何 key 都能调，返回形状一致（§3.4） |
| **`prepare` → `submit` 两步式** | ✅ **通用** | 所有流程都是「先问要哪些审批人节点，再带着 assignees 建单」。**这是整条线里最值钱的一条** |
| **`startUserSelectAssignees` 的形状** `{ [taskId]: [userId] }` | ✅ 通用 | `common/libs/flow-form/index.js:292` 的 `getRequiredStartUserSelectTasks` 对所有表单都一样 |
| **`searchUsers(keyword)` 强制关键字** | ✅ 通用（**必须保留**） | 页面 `simple-page?pageSize=500 × 9` 拉 4500 人的做法在所有表单里都有（通用审批的抄送人也走全量），无头下一律不能照抄 |
| **写能力的 `write: true` 声明 + idempotency 包装** | ✅ 通用 | 组装点那一层与流程无关 |
| **`assertTimeSlot`**（分钟只能 00/30） | ❌ **会议室特有** | 来自会议室表单的 `disabledTime` + 后端 `validateTime`。别的流程没有这条（待办事项那页的 `assertDateTime` 就明确比它松） |
| **`roomUsage`**（会议室占用） | ❌ 特有 | `/hr/meeting-application/meeting-room-usage` |
| **`cancelReservation`** | ❌ 特有 | 只有会议室有这个接口 |
| **`buildMeetingApplicationPayload`** | ❌ 特有 | 每个流程的字段名都不一样 |

**一句话：可复用的一半是「两步提交 + 关键字搜索」，不可复用的一半是「字段名与校验规则」。**

### 5.2 做一个新流程表单的可复用步骤（可直接当派单模板）

```text
【第 0 步 · 枚举与选型】（只读，5 分钟）
  跑 GET /bpm/process-definition/create-list?suspensionState=1&processType=1 和 =2
  在结果里按 key 找到目标流程，抄下三样东西：
     processKey / name / formCustomCreatePath
  产物：一份「key → 表单路径」的映射（本文件 §1.4 已经是了，直接用）

【第 1 步 · 读表单源码，抽字段契约】（只读，这是最贵的一步）
  目录：app/portal/views/simple/<formCustomCreatePath 的目录部分>/
    index.vue                    —— 页面壳、路由 meta、baseData 声明
    page/pc/edit/index.vue       —— **字段与校验在这里**（a-form-item 的 label + name）
    page/pc/detail/index.vue     —— 详情字段
    common/index.js              —— **提交载荷的构造与必填判据在这里**（如果有）
    utils.js / components/       —— 复合控件与本地校验在这里
  要抄下来的四样：
    a) 每个 a-form-item 的 name（= 提交载荷的 key）与 label、必填与否、控件形态
    b) build*SubmitData() —— **注意载荷可能经过一次映射**，不是表单字段直传
       （用车就是 staffId/staffName 而不是 applicantId）
    c) 本地校验函数（如请假 utils.js 的 startIsAfterEnd）
    d) 三个接口路径：create / get / get*RequiredStartUserSelectTasks
       ★ 审批人接口名字有两个变体，**必须在这一步确认是哪个**，不能猜

【第 2 步 · 定「只读联动」要不要做】
  很多表单在填写过程中会调只读接口（请假的年假余额、剩余时长）。
  判据：**它在页面上是「拦住提交」的条件吗？** 是 → 要做；只是展示 → 记进「尚未覆盖」

【第 3 步 · 写能力定义】（照 src/capabilities/meeting-application.ts 的骨架）
  一个流程 4~5 个能力：
    <flow>-definition     只读  pagePath = /dashboard/flow/form/edit
    <flow>-prepare        只读  pagePath = /simple/<表单路径>
    <flow>-submit         写    pagePath = /simple/<表单路径>
    <flow>-detail         只读  （可选）
    <flow>-cancel         写    （只有该流程有自己的 cancel 接口时才建）
  长选项参数必须登记 lookup（照 meeting-application 的 meetingRoomId 那样）

【第 4 步 · 真实验证：prepare → submit → cancel 三段】
  ★ **submit 会推真人待办。做之前必须让用户明确同意，并选一个「可删除」的测试对象。**
  照 docs/pages/会议室预定.md 的「真实验证记录」那一节做：
    提交前占位查询（证明是空的）→ prepare → submit → 提交后占位查询（证明有了）→ cancel → 再查（证明没了）
  没有这条「能独立证实的证据」，不要说验证过

【第 5 步 · 基准 + 反证】
  抓一次浏览器基准（tools/baseline/），与 SDK 请求逐字段比对；
  然后**故意改坏一次确认测试会红**，把反证列进报告

【第 6 步 · 四件套 + 提交】
  src/capabilities/<flow>.ts / docs/pages/<页面名>.md / baseline/<flow>.browser.json / test/<flow>.test.ts
  仓库纪律：只 git add 自己改的文件，禁止 git add -A
```

### 5.3 派单时最容易出事的三处

1. **审批人接口名字猜错**（`getRequired…` vs `getTemporaryRequired…`）—— 猜错会在 submit 时才炸，
   而且报错形态是 404 还是业务错误不一致。**必须在第 1 步从源码里确认。**
2. **提交载荷不是表单字段直传**（用车那次映射）—— 照抄 a-form-item 的 name 会漏掉
   `staffId` / `staffName` 这类由前端补的字段。**必须读 `build*SubmitData()`。**
3. **表单字段的「长选项」来源不是关键字搜索**（用车按组织查、通用审批抄送人拉全量）——
   照抄会重演「一次拉 4500 人」。**每个人员/实体参数都要单独确认候选来源。**

### 5.4 这套方法覆盖不到什么

- **它不能变成生成器。** 字段名、校验、载荷映射、接口路径四个都随流程变，
  且只能从源码读——这和「声明式列表页」那种可以批量生成的形态完全不同。
- **`pnpm next` 永远选不到这些页面**，`docs/plan.json` 的「不在清单里的入口」已经写明了
  它们「不走这份队列」。所以做流程表单**必须单独派单**，不要指望队列会推给你。

---

## 6. 我实测到的 / 我只是推断的 / 我没查到的

### ✅ 实测到（打了真实接口或读了源码原文）

- `GET /bpm/process-definition/create-list` 对 `processType=1`（25 个）与 `processType=2`（57 个）
  各返回 4 个分组、合计 **82 个流程**，含 `key` / `name` / `formCustomCreatePath` / `formType=20` /
  `baseUrl=portal`。§1.4 的清单是这份返回值本身。
- `bpm_process_type` 字典实测只有两个值：`1=审核`、`2=审批`。
- `GET /bpm/process-definition/get?key=` 对 5 个 key（`meeting_application` /
  `hr_general_approval` / `qingjia` / `vehicle_usage_application` / `hr_product_design_approval`）
  全部 200 成功，**返回形状一致且 `formFields` / `formCustomCreatePath` 都是 `null`**。
- 这 5 个响应里的 `bpmnXml` 我都看到了：会议室的 `<process>` 里**没有 userTask**；
  通用审批有 `name="发起人自选2"`、用车有 `name="发起人自选"`，都带 `candidateStrategy="35"`。
- 「发起流程」页的源码位置、它调的接口与两个参数、它的可用性判定四条（§1.1–1.3）。
- 五个目标流程的接口路径与提交载荷构造函数，全部读自源码原文（§3.3）。
- 通用动作的接口路径读自源码原文（§4.1），包括撤销审批的 `PUT /bpm/task/withdraw`
  与其错误码 `1009005015`、取消流程的 `DELETE /bpm/process-instance/cancel-by-start-user`。
- 「发票」在全库检索的结果（§2.1）——命中的两类都不是流程表单。
- `formCustomCreatePath` 只在 `create-list` 里出现，`/bpm/process-definition/get` 里是 `null`。

### ⚠️ 只是推断（没有实跑验证）

- 82 这个数字**是当前登录用户的可见范围**，不是系统总量。换账号会变。
- 请假表单的 `getYearRest` / `getRestDuration` 的**响应结构**没看过（只看了调用点）。
- 差旅费流程**没有**审批人节点接口 —— 这只是「源码里 grep 不到」，
  不代表它真的不需要（也可能是我没找到）。它的 `create` 是否接受 `startUserSelectAssignees`
  未验证。
- 用车表单的 `POST /org/staff/getStaffByOrg` 的 body 形状（`orgIdList`）只从一行调用点读出。
- 上面那些**写接口一个都没执行过**，形状全部来自源码，没有一次真实请求佐证。

### ❌ 没查到（明确没做）

- **没有提交过任何一个流程**（这是本单的红线，也是刻意的）。
  所以 §3.3 的提交载荷没有一条被后端接受过——它们**不是**「已验证的载荷」。
- **没有验证过任何写操作**：`withdraw` / `cancel-by-start-user` / `sms-remind` /
  `follow-up` / `approve` 一行都没跑。
- **没有抓浏览器基准**。本文件里所有请求都来自源码静态阅读，不是网络抓包。
  （会议室那条线有基准；这 5 个流程没有。）
- **没有在真实页面上打开过这 5 个表单**（没有观察过实际渲染出来的控件，
  §3.3 的字段表是从模板源码读的，不排除有条件渲染导致实际少几个字段）。
- **没有枚举每个流程「是否需要人工选审批人」**。只知道会议室不需要、
  通用审批与用车在 BPMN 里**有** `发起人自选` 节点——但**节点存在 ≠ 一定会返回**
  （会议室那条线的文档就写着「页面提示流程可能随填写内容变化」）。
  要确认只能实跑 `get*RequiredStartUserSelectTasks`（**只读**，可以跑，本单没跑）。
- **没有查 `processType` 之外还有没有别的筛选维度**（比如 `category`），
  也没确认 `create-list` 有没有分页上限。
- **没有第二个测试账号**，所以「普通用户看到的清单会不会比这个少」没验证。

---

## 7. 下一步建议

按 §2.2 的顺序，**第一个做 `hr_general_approval`（通用审批）**，理由：

1. 它是这批里**字段最少**的（2 个必填 + 附件 + 抄送人）。
2. 它**有 `getTemporaryRequiredStartUserSelectTasks`、且 BPMN 里有自选审批人节点**——
   正好能补上会议室那条线**从没验证过**的「审批人节点非空时怎么选」那条路径
   （见 `docs/pages/会议室预定.md` 的「尚未覆盖」）。
3. 做完之后 **`hr_product_design_approval`（产品设计文档审核）几乎可以直接复制**——
   字段同构、只换三个 URL。**一单做两个流程**。

**但开工前必须先解决两件事**（都属于要向用户确认的）：

- **提交验证需要真人待办。** 通用审批提交后会推给审批人（BPMN 里明确有自选节点）。
  按仓库纪律，写能力必须有 `prepare → submit → cancel` 的完整记录，
  所以**必须先拿到用户对「用一个测试流程实例做提交验证」的明确同意**，
  并指定一个可以安全取消的测试对象。
  在拿到同意之前，只能做到 `definition` + `prepare` 两个**只读**能力。
- **`hr_general_approval` 的提交载荷需要在真实表单上核对一次**。
  §3.3 的载荷是从 `common/index.js` 静态读出来的，没有实跑过。
