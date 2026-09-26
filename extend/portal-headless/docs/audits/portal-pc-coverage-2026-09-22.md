# 门户 PC 功能覆盖审计（2026-09-22）

## 结论与范围

未达到 100%。本次静态菜单求值获得门户 123 个叶子入口，只有待办事项具备页面能力登记。其余入口不能因生成目录存在就当作执行能力已实现。

前端版本 d3cf56bdc7（父任务已按固定 test/portal/main 更新）；源码根 `/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js`。本报告没有访问浏览器或后端；页面真实可达性、部署版本、权限及写链均未实测。读取已有 dist 的 318 项能力并核对源码注册入口；不是本次重建的独立线上验收。

“门户”选择器使用 SYSTEM_COMMON_VALUE，而不是 SYSTEM_PORTAL_VALUE=7。`app/portal/components/portal/layout/index.vue:303-325` 按顶层 `!menu.system` 筛选。`menus/index.js:110-170` 首页等以及整个系统设置父节点没有 system，因此其下财务/资产/生产/销售/采购/人力/科技设置都在本次门户范围。不能仅按 `domain=common` 或 `menuSource=common.js` 缩小分母。DEV 工具箱只在本地/dev出现，本次 test 范围不计；前端日志在非生产环境存在。菜单被注释的条目排除。

## 全部门户菜单入口

下表“动作线索”从入口源文件静态提取（下节另外核对主入口引入的组件），仅用于定位审查；没有接口的导航/本地转换不应虚构网络动作。无登记表示该页面可见业务链尚未作为 SDK 页面能力交付，基础候选接口不能替代业务写入。详情及弹窗参数仍需在补齐时逐个核实。

| 页面 | 菜单路径 | 已登记能力 / AI说明 | 源文件与动作线索 |
| --- | --- | --- | --- |
| 首页 | `/dashboard/home` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/home/index.vue`；配置、编辑、添加、删除、重置、保存；接口 /admin-api/homePage/get、/admin-api/homePage/save |
| 智能助手 | `/dashboard/chat` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/chat/index.vue`； |
| 个人用量 | `/dashboard/model-usage/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/model-usage/list.vue`； |
| 待办事项 | `/dashboard/backlog/task-examine/list` | backlog-task-examine-list（AI 有） | `app/portal/views/dashboard/hr/backlog/task-examine/list.vue`；详情；接口 /bpm/hr/task/list-by-category-web |
| 进鸡指数 | `/dashboard/market-information/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/market-information/list.vue`； |
| 会计期间 | `/dashboard/finance/setting/accounting-period/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/accounting-period/list.vue`；启用、详情；接口 /admin-api/finance/accounting-period/page、/admin-api/finance/accounting-period/enableOrStop |
| 会计科目 | `/dashboard/finance/setting/ledger-accounts/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/ledger-accounts/list.vue`；重置、导入、导出、下载、启用、添加、详情；接口 /admin-api/finance/ledger-accounts/page、/admin-api/finance/ledger-accounts/enableOrStop、/admin-api/finance/ledger-accounts/import-excel |
| 银行账户 | `/dashboard/finance/setting/receiving-account/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/receiving-account/list.vue`；重置、启用；接口 /admin-api/finance/receiving-account-number/page、/org/corporation/getAllLegalPerson、/admin-api/finance/receiving-account-number/enableOrStop |
| 精度管理 | `/dashboard/finance/setting/accuracy/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/accuracy/list.vue`；重置、启用、编辑、删除；接口 /admin-api/finance/accuracy-manage/page、/admin-api/finance/accuracy-manage/delete、/admin-api/finance/accuracy-manage/enableOrStop |
| 账套管理 | `/dashboard/finance/setting/accounting-manage/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/accounting-manage/list.vue`；导出、启用、详情；接口 /admin-api/finance/accounting-manage/page、/admin-api/finance/accounting-manage/enableOrStop |
| 凭证模板 | `/dashboard/finance/setting/voucher-templates/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/voucher-templates/list.vue`；重置、导出、启用、详情；接口 /admin-api/finance/voucher-template/page、/admin-api/finance/voucher-template/update |
| 费用用途管理 | `/dashboard/finance/setting/fee-purpose/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/fee-purpose/list.vue`；启用、编辑、删除；接口 /admin-api/finance/fee-purpose/delete、/admin-api/finance/fee-purpose/page、/admin-api/finance/fee-purpose/application-type-options、/admin-api/finance/fee-purpose/fee-options、/admin-api/finance/fee-purpose/update-status |
| 期初设置 | `/dashboard/finance/setting/initial-manage/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/initial-manage/list.vue`； |
| 客商基础档案 | `/dashboard/finance/setting/opening-supplier/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/opening-supplier/list.vue`； |
| 类目对照表 | `/dashboard/finance/setting/cat-map/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/cat-map/list.vue`；重置、启用、编辑；接口 /admin-api/finance/thing-category/page、/admin-api/finance/thing-category/discard |
| 类目配置 | `/dashboard/finance/setting/cat-config/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/cat-config/list.vue`；重置、启用、编辑；接口 /admin-api/finance/income-category/page、/admin-api/finance/income-category/update |
| 种畜摊销设置 | `/dashboard/finance/setting/livestock-amortization/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/livestock-amortization/list.vue`；启用；接口 /admin-api/finance/biological-asset-depreciation-config/page、/admin-api/finance/biological-asset-depreciation-config/update-status |
| 费用分配规则 | `/dashboard/finance/setting/allocation-rules/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/allocation-rules/list.vue`；分配、新增、启用、编辑；接口 /admin-api/finance/expense-allocation-rule/page、/admin-api/finance/expense-allocation-rule/updateStatus |
| 销售分配系数 | `/dashboard/finance/setting/sale-allocation-coefficient/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/sale-allocation-coefficient/list.vue`；新增、启用、分配、详情；接口 /admin-api/finance/sales-allocation-coefficient/page、/admin-api/finance/sales-allocation-coefficient/update-status |
| 费用分配指标库 | `/dashboard/finance/setting/allocation-indicator/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/allocation-indicator/list.vue`；重置、启用；接口 /admin-api/finance/indicator-library/page、/admin-api/finance/indicator-library/update |
| 支付计划时间管理 | `/dashboard/finance/setting/date-config/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/date-config/list.vue`；新增、启用；接口 /admin-api/finance/payment-plan-time-management/page、/admin-api/finance/payment-plan-time-management/update-status |
| 月度收入时间配置 | `/dashboard/finance/setting/monthly-income-time-config/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/monthly-income-time-config/list.vue`；保存；接口 /admin-api/finance/monthly-income-budget-edit-config/page、/admin-api/finance/monthly-income-budget-edit-config/get、/admin-api/finance/monthly-income-budget-edit-config/update |
| 存货科目配置 | `/dashboard/finance/setting/inventory-account/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/inventory-account/list.vue`；启用、下载、导入、编辑、保存、复制、新增、清空；接口 /admin-api/finance/inventory-config/page、/admin-api/finance/inventory-config/update、/admin-api/finance/inventory-config/create、/admin-api/finance/inventory-config/update-status、/admin-api/finance/inventory-config/import-excel |
| 成本中心管理 | `/dashboard/finance/setting/cost-center/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/cost-center/list.vue`；重置、新增、启用、编辑；接口 /admin-api/finance/cost-center/page、/admin-api/finance/cost-center/update-status |
| 员工借款额度 | `/dashboard/finance/setting/employee-loan-amount/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/employee-loan-amount/list.vue`；下载、导入；接口 /admin-api/finance/employee-loan-quota/page、/admin-api/finance/employee-loan-quota/import-template、/admin-api/finance/employee-loan-quota/import |
| 项目管理 | `/dashboard/finance/setting/project/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/project/list.vue`；新增、启用、详情、编辑、删除；接口 /admin-api/finance/project/page、/admin-api/finance/project/enable、/admin-api/finance/project/disable、/admin-api/finance/project/delete |
| 关联方结算科目配置 | `/dashboard/finance/setting/related-party-settlement-account/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/related-party-settlement-account/list.vue`；启用、详情；接口 /admin-api/finance/payment-slip-society-related-settlement/subject-config/page、/admin-api/finance/payment-slip-society-related-settlement/subject-config/update |
| 结转单设置 | `/dashboard/finance/setting/settlement-setting/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/settlement-setting/list.vue`；新增、详情、结转、启用；接口 /admin-api/finance/settlement-setting/page、/admin-api/finance/settlement-setting/update-status |
| 年度账结转 | `/dashboard/finance/setting/annual-carryforward/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/finance/setting/annual-carryforward/list.vue`；结转、详情；接口 /admin-api/finance/annual-closing/page、/admin-api/finance/annual-closing/cancel-close |
| 资产编码 | `/dashboard/material/assets/code-setting/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/material/assets/code-setting/list.vue`；删除、配置；接口 /admin-api/inventory/organization-config/page、/admin-api/inventory/organization-config/delete |
| 折旧配置 | `/dashboard/material/assets/setting/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/material/assets/setting/list.vue`；编辑、新增、删除；接口 /admin-api/inventory/asset-category/page、/admin-api/inventory/asset-depreciation-config/page、/admin-api/inventory/asset-depreciation-config/delete |
| 盘点配置 | `/dashboard/material/assets/stocktaking-config/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/material/assets/stocktaking-config/list.vue`；新增、编辑、删除、配置；接口 /admin-api/inventory/asset-stocktaking-config/page、/admin-api/inventory/asset-stocktaking-config/delete、/admin-api/system/user/simple-page |
| 批次配置 | `/dashboard/material/store/batch-setting/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/material/store/batch-setting/list.vue`；重置、启用、删除；接口 /admin-api/inventory/asset-batch-config/page、/admin-api/inventory/asset-batch-config/disable-batch、/admin-api/inventory/asset-batch-config/enable-batch、/admin-api/inventory/asset-batch-config/delete |
| 库存配置 | `/dashboard/material/store/point-setting/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/material/store/point-setting/list.vue`；启用、编辑、新增；接口 /admin-api/inventory/stock-location/page、/admin-api/inventory/stock-location/close、/admin-api/inventory/stock-location/open |
| 库存规则 | `/dashboard/material/store/material-rule/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/material/store/material-rule/list.vue`；编辑、删除；接口 /admin-api/inventory/stock-rule/typeList、/admin-api/inventory/stock-rule/page、/admin-api/inventory/stock-rule/delete |
| 计价配置 | `/dashboard/material/store/valuation/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/material/store/valuation/list.vue`；新增、详情、删除、配置；接口 /admin-api/inventory/stock/typeList、/admin-api/inventory/pricing-method-config/page、/admin-api/inventory/pricing-method-config/delete |
| 审批配置 | `/dashboard/material/approval-configuration/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/material/approval-configuration/list.vue`；新增、添加、配置；接口 /admin-api/inventory/approval-config/list、/admin-api/inventory/approval-config/update |
| 日清日结 | `/dashboard/product/setting/business-manage/day-liquidation/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/business-manage/day-liquidation/list.vue`；；接口 /base/dayLiquidation/list、/config/building/getByFarmId、/base/dayLiquidation/getBatchAndSex |
| 种摊数据重传 | `/dashboard/product/setting/business-manage/data-retransmit/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/business-manage/data-retransmit/list.vue`；同步 |
| 物料主数据 | `/dashboard/product/setting/business-manage/material/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/business-manage/material/list.vue`；编辑、删除、添加；接口 /base/material/page、/base/material/save、/base/material/delete |
| 日龄分割 | `/dashboard/product/setting/business-manage/age-division/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/business-manage/age-division/list.vue`； |
| 配置指标 | `/dashboard/product/setting/business-manage/configure/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/business-manage/configure/list.vue`；编辑、删除；接口 /config/traitIndex |
| 功能开关 | `/dashboard/product/setting/business-manage/function-use/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/business-manage/function-use/list.vue`；启用；接口 /config/functionUse/list、/config/functionUse/openOrClose |
| 鸡群批次状态 | `/dashboard/product/setting/business-manage/batch-status/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/business-manage/batch-status/list.vue`；编辑；接口 /flockStatus/list、/config/building/getByFarmId、/flockStatus/termination、/flockStatus/activate |
| 设置蛋鸡场物料号 | `/dashboard/product/setting/business-manage/setup-material-code/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/business-manage/setup-material-code/list.vue`； |
| 孵化日龄段标准 | `/dashboard/product/setting/standard-manage/egg-standard-age-stage/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/standard-manage/egg-standard-age-stage/list.vue`；删除、添加；接口 /egg/standardAgeStage/page、/egg/standardAgeStage/save |
| 孵化健母率标准 | `/dashboard/product/setting/standard-manage/standard-hatch/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/standard-manage/standard-hatch/list.vue`；删除、添加；接口 /base/standardHatch/page、/egg/standardAgeStage/list、/base/standardHatch/save |
| 种鸡生产指标标准 | `/dashboard/product/setting/standard-manage/chicken-production/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/standard-manage/chicken-production/list.vue`；删除、添加；接口 /base/chickenProduction/page、/base/chickenProduction/save |
| 种鸡标准(BI) | `/dashboard/product/setting/standard-manage/standard-flock-week/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/standard-manage/standard-flock-week/list.vue`；删除、新增、添加；接口 /base/standardFlockWeek/page、/base/standardFlockWeek/save |
| 种鸡标准 | `/dashboard/product/setting/standard-manage/standard-flock/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/standard-manage/standard-flock/list.vue`；删除、添加；接口 /base/standardFlock/page、/base/standardFlock/save |
| 只鸡防疫成本标准 | `/dashboard/product/setting/standard-manage/epidemic-prevention-cost/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/standard-manage/epidemic-prevention-cost/list.vue`；删除、添加；接口 /base/epidemicPreventionCost/page、/base/epidemicPreventionCost/save |
| 年月指标目标标准 | `/dashboard/product/setting/standard-manage/hatch-annual-monthly/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/standard-manage/hatch-annual-monthly/list.vue`；删除、添加；接口 /base/hatchAnnualMonthly/page、/base/hatchAnnualMonthly/save |
| 抗体监测标准 | `/dashboard/product/setting/standard-manage/antibody/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/standard-manage/antibody/list.vue`；删除、添加；接口 /base/antibody/page、/base/antibody/save |
| 肉鸡标准 | `/dashboard/product/setting/standard-manage/standard-broiler/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/standard-manage/standard-broiler/list.vue`；删除、添加；接口 /base/standardBroiler/page、/base/standardBroiler/save |
| 标准设置 | `/dashboard/product/setting/hatch-manage/unit/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/hatch-manage/unit/list.vue`；编辑、删除；接口 /programUnit/getList、/programUnit/add、/programUnit/update、/programUnit/delete |
| 温度设置 | `/dashboard/product/setting/hatch-manage/season/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/hatch-manage/season/list.vue`；编辑、删除；接口 /programNew/baseSetting/temp/getPage、/programNew/baseSetting/temp/create、/programNew/baseSetting/temp/edit、/programNew/baseSetting/temp/delete |
| 温度配置-新 | `/dashboard/product/setting/season/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/season/list.vue`；配置、重置、编辑、删除、详情、保存 |
| 方法设置 | `/dashboard/product/setting/hatch-manage/method/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/hatch-manage/method/list.vue`；编辑、删除；接口 /programUnit/getList、/programNew/methodLib/createTrait、/programNew/methodLib/editTrait、/programNew/methodLib/deleteTrait |
| 标准库 | `/dashboard/product/setting/hatch-manage/lib/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/hatch-manage/lib/list.vue`；编辑、删除；接口 /programNew/baseSetting/temp/getTempInList、/programNew/standardLib/getPage、/programNew/standardLib/importStandardLib、/programNew/standardLib/edit、/programNew/standardLib/delete |
| 指标库-新 | `/dashboard/product/setting/indicator-lib/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/indicator-lib/list.vue`；删除、配置、编辑、复制、保存 |
| 预案品种 | `/dashboard/product/setting/hatch-manage/variety/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/hatch-manage/variety/list.vue`；编辑、删除；接口 /sys/parameter/page、/sys/parameter/save、/sys/parameter/delete |
| 方法库 | `/dashboard/product/setting/hatch-manage/method-lib/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/hatch-manage/method-lib/list.vue`；编辑、删除；接口 /hatchProgram/methodLib、/programNew/methodLib、/programNew/baseSetting/temp/getTempInList |
| 方法库-新 | `/dashboard/product/setting/method-lib/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/method-lib/list.vue`；导入、导出、编辑、删除、配置、新增、保存、详情 |
| 程序库 | `/dashboard/product/prevention/plan/program-library/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/prevention/plan/program-library/list.vue`；保存、导入、导出、删除、下载、新增 |
| 程序库-新 | `/dashboard/product/setting/program-lib/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/program-lib/list.vue`； |
| 预案预览-新 | `/dashboard/product/setting/plan-preview/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/plan-preview/list.vue`；清空 |
| 标准设置 | `/dashboard/product/setting/hatchery-manage/unit/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/hatchery-manage/unit/list.vue`； |
| 方法设置 | `/dashboard/product/setting/hatchery-manage/method/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/hatchery-manage/method/list.vue`； |
| 标准库 | `/dashboard/product/setting/hatchery-manage/lib/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/hatchery-manage/lib/list.vue`； |
| 方法库 | `/dashboard/product/setting/hatchery-manage/method-lib/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/hatchery-manage/method-lib/list.vue`； |
| 企业使用情况 | `/dashboard/product/setting/business-manage/tenant-log/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/business-manage/tenant-log/list.vue`；详情、添加、配置；接口 /use/statistics/companyModuleUseSituation、/use/statistics/companyFunctionUseSituation、/use/statistics/companyUserUseSituation、/sys/office/getTenantCompanyList、/config/leaf/getTree |
| 用户使用分析 | `/dashboard/product/operation/business/user-analysis/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/operation/business/user-analysis/list.vue`；导出、配置；接口 /use/statistics/userLogReport2、/use/statistics/userLogReport2/export |
| 防疫功能使用分析 | `/dashboard/product/operation/veterinarians/usage-analysis/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/operation/veterinarians/usage-analysis/list.vue`；上传；接口 /use/statistics/preventionUseSituation、/config/farm/getOfficeFarmBuildingTreeByTag |
| 高产用户使用分析 | `/dashboard/product/operation/business/usage-chicken/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/operation/business/usage-chicken/list.vue`；配置、添加、提交、同步、上传、启用；接口 /use/statistics/highProductionRecordSituation、/config/farm/getOfficeFarmBuildingTreeByTag |
| 稳产用户使用分析 | `/dashboard/product/operation/business/usage-layer/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/operation/business/usage-layer/list.vue`；配置、添加、提交、同步、上传、启用；接口 /use/statistics/stableProductionRecordSituation、/config/farm/getOfficeFarmBuildingTreeByTag |
| 鸡群范围 | `/dashboard/product/setting/base-setting/user-dict/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/base-setting/user-dict/list.vue`；启用、保存、编辑；接口 /sys/dict/userDictTypeList、/sys/dict/userDictPage、/sys/dict/userDictSave、/sys/dict/deactivate、/sys/dict/enable |
| 药品管理 | `/dashboard/product/setting/base-setting/medicine/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/base-setting/medicine/list.vue`；编辑、删除、添加、保存；接口 /config/medicine/page、/config/medicine/delete、/config/medicine/save |
| 疫苗管理 | `/dashboard/product/setting/base-setting/vaccine/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/base-setting/vaccine/list.vue`；编辑、删除、添加、保存；接口 /config/vaccine/page、/config/vaccine/delete、/config/vaccine/save |
| 物料管理 | `/dashboard/product/setting/base-setting/material/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/setting/base-setting/material/list.vue`；删除、启用、编辑、保存；接口 /base/material/page/external、/base/material/userMaterialSave、/base/material/userMaterialDelete、/base/material/deactivate、/base/material/enable |
| 知会配置 | `/dashboard/product/operation/notice-config/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/product/operation/notice-config/list.vue`；启用、编辑、删除；接口 /config/notification/page、/noticeConfig/delete、/config/notification/getModuleList、/config/notification/enableOrDisable |
| 用户扩展 | `/dashboard/sale/sys/user/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/sys/user/list.vue`；新增、启用、导出、重置、编辑、详情、分配、保存、禁用；接口 /admin-api/sales/user/page、/admin-api/system/dict-data/page、/admin-api/system/hr-role/page、/admin-api/sales/organization/tree、/admin-api/sales/user/update |
| 价格管控 | `/dashboard/sale/setting/price-control/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/setting/price-control/list.vue`；撤回、配置、删除；接口 /sales/third-party-payment/setting、/admin-api/sales/price-control-config/categoryList、/admin-api/sales/price-control-standards/delete、/admin-api/sales/price-control-config/list、/admin-api/priceControlApply/page |
| 低价设置 | `/dashboard/sale/setting/price-control/low-price/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/setting/price-control/low-price/list.vue`；添加、编辑、删除 |
| 理赔配置 | `/dashboard/sale/setting/claim-setting/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/setting/claim-setting/list.vue`；编辑、删除 |
| 老母鸡销售 | `/dashboard/sale/setting/old-chicken-sale/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/setting/old-chicken-sale/list.vue`；删除；接口 /admin-api/sales/eliminated-chicken-sales-apply/page、/admin-api/sales/eliminated-chicken-sales-apply/delete |
| 机构扩展 | `/dashboard/sale/sys/office/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/sys/office/list.vue`；新增、启用、导出、重置、编辑、详情；接口 /admin-api/sales/organization/page、/admin-api/system/dict-data/page、/admin-api/sales/organization/tree、/admin-api/sales/organization/update、/admin-api/sales/organization/batch-disable |
| 工厂管理 | `/dashboard/sale/order/trade-storeroom/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/order/trade-storeroom/list.vue`；同步、编辑、删除、保存；接口 /vue/order/tradeStoreroom/list、/vue/order/tradeStoreroom/getSupplier、/vue/order/tradeStoreroom/save、/vue/order/tradeStoreroom/delete、/vue/order/tradeStoreroom/saveShippingBaseList |
| 推荐设置 | `/dashboard/sale/visit/recommend-setting/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/visit/recommend-setting/list.vue`；删除、添加、保存、配置；接口 /admin-api/sales/recommend-setting/get、/admin-api/sales/recommend-setting/save |
| SAP-收款账号 | `/dashboard/sale/order/ccb-account/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/order/ccb-account/list.vue`；编辑、删除、保存；接口 /vue/order/ccbAccount/list、/vue/order/ccbAccount/save |
| 收款账号 | `/dashboard/sale/order/payment-account/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/order/payment-account/list.vue`；编辑、删除；接口 /admin-api/sales/ccb-account/page、/admin-api/sales/ccb-account/delete |
| 二维码管理 | `/dashboard/sale/custom/qr/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/custom/qr/list.vue`； |
| 任务管理 | `/dashboard/sale/job/schedule-job/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/job/schedule-job/list.vue`；删除、保存；接口 /vue/job/scheduleJob/list、/vue/job/scheduleJob/save、/vue/job/scheduleJob/pause、/vue/job/scheduleJob/resume、/vue/job/scheduleJob/run |
| 任务日志 | `/dashboard/sale/job/schedule-job-log/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/job/schedule-job-log/list.vue`；删除、保存、详情；接口 /vue/job/scheduleJobLog/list、/vue/job/scheduleJobLog/save |
| 配置数据 | `/dashboard/sale/setting/dict/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/setting/dict/list.vue`；配置、重置、编辑、删除；接口 /admin/dict/type/page、/admin/dict/type |
| 设置服务主体 | `/dashboard/sale/setting/service-subject/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/setting/service-subject/list.vue`；编辑、删除；接口 /admin-api/system/hr-role/page、/admin-api/system/hr-role/delete |
| 国家代码管理 | `/dashboard/sale/customer/register-code/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/customer/register-code/list.vue`；导入、删除、上传；接口 /vue/customer/registerCode/list、/vue/customer/registerCode/import |
| 字典配置 | `/dashboard/sale/sys/dict/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/sale/sys/dict/list.vue`；配置、编辑、添加、删除、新增、保存；接口 /vue/sys/dict/getDictTypeList、/vue/sys/dict/list、/vue/sys/dict/save、/vue/sys/dict/getMaxSort |
| 人员配置 | `/dashboard/supply/setting/planner/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/supply/setting/planner/list.vue`；编辑、删除；接口 /org/organization/getRoleOrganizationTree、/admin-api/supply/legal-user-config/page、/admin-api/supply/legal-user-config/delete |
| 系统核算参数 | `/dashboard/setting/system-accounting-parameters/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/hr/setting/system-accounting-parameters/list.vue`；；接口 /salary/parameter/page |
| 项目类型 | `/dashboard/technology/setting/project-type/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/technology/setting/project-type/list.vue`；启用、编辑、删除、新增、保存 |
| 模板中心 | `/dashboard/technology/setting/template/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/technology/setting/template/list.vue`；配置、保存、复制、启用、删除、编辑、提交 |
| 模板基础配置 | `/dashboard/technology/setting/template-base/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/technology/setting/template-base/list.vue`；配置 |
| 类型模板映射 | `/dashboard/technology/setting/type-template-mapping/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/technology/setting/type-template-mapping/list.vue`；启用、编辑、新增、保存 |
| 字典管理 | `/dashboard/setting/dict-platform/all/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/setting/dict-platform/all/list.vue`；重置、编辑、删除；接口 /admin-api/system/dict-type/page、/admin-api/system/dict-type/delete、/admin-api/system/dict-type/update |
| 公共字典 | `/dashboard/setting/dict-platform/common/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/setting/dict-platform/common/list.vue`； |
| 人力字典 | `/dashboard/setting/dict-platform/hr/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/setting/dict-platform/hr/list.vue`； |
| 财务字典 | `/dashboard/setting/dict-platform/finance/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/setting/dict-platform/finance/list.vue`； |
| 资产字典 | `/dashboard/setting/dict-platform/material/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/setting/dict-platform/material/list.vue`； |
| 生产字典 | `/dashboard/setting/dict-platform/product/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/setting/dict-platform/product/list.vue`； |
| 采购字典 | `/dashboard/setting/dict-platform/supply/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/setting/dict-platform/supply/list.vue`； |
| 销售字典 | `/dashboard/setting/dict-platform/sale/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/setting/dict-platform/sale/list.vue`； |
| 分类字典 | `/dashboard/setting/category-dict/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/hr/setting/category-dict/list.vue`；编辑、添加、删除、新增；接口 /admin-api/system/category-dict/tree、/admin-api/system/category-dict/delete、/admin-api/system/category-dict/create、/admin-api/system/category-dict/update |
| 安全验证 | `/dashboard/setting/sensitive-action/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/hr/setting/sensitive-action/list.vue`；保存；接口 /org/sensitive/info、/org/sensitive |
| 菜单管理 | `/dashboard/setting/menu/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/hr/setting/menu/list.vue`；导出、添加、编辑、删除；接口 /admin-api/sys/menu、/admin-api/sys/menu/menuListNotBySystem |
| 用户查询 | `/dashboard/setting/user/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/hr/setting/user/list.vue`；重置、启用、编辑、同步、分配；接口 /sys/user/page、/sys/user、/sys/user/synchronous |
| 角色管理 | `/dashboard/setting/role/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/hr/setting/role/list.vue`；重置、编辑、删除；接口 /admin-api/sys/role/allProjectRoleByPage、/admin-api/sys/role |
| 岗位角色 | `/dashboard/setting/role-post/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/hr/setting/role-post/list.vue`；分配；接口 /org/post/role/page |
| 企业用量 | `/dashboard/setting/enterprise-usage/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/setting/enterprise-usage/list.vue`； |
| 用量分配 | `/dashboard/setting/token-allocation/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/common/setting/token-allocation/list.vue`；分配、保存、导入、清空 |
| 前端日志 | `/dashboard/setting/log/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/hr/setting/log/list.vue`；；接口 /admin-api/sys/menu/menuListNotBySystem |
| 系统开通 | `/dashboard/setting/integration/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/hr/setting/integration/list.vue`；编辑；接口 /admin-api/system/org-module-switch/page |
| 物料管理 | `/dashboard/setting/material/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/hr/setting/material/list.vue`；新增、重置、删除、导出、添加；接口 /admin-api/system/sys-materiel/page、/admin-api/supply/supplier/page、/admin-api/system/sys-materiel/delete、/admin-api/system/sys-materiel/update-use-tenant |
| 供应商管理 | `/dashboard/setting/supplier/list` | 无；缺业务说明与调用绑定 | `app/portal/views/dashboard/hr/setting/supplier/list.vue`；新增、重置、删除、添加；接口 /admin-api/system/sys-supplier/page、/admin-api/system/sys-supplier/delete、/admin-api/system/sys-supplier/export、/admin-api/system/sys-supplier/update-use-tenant |

入口统计：1/123 有至少一项能力；这个比率只表示挂载，不表示动作完成率。

## 已确认的非菜单与主入口缺口

| 入口 | 页面动作 / 证据 | SDK 状态 |
| --- | --- | --- |
| 首页 | `views/dashboard/common/home/index.vue:394-429`；编辑/添加卡片/删除卡片/重排/重置，POST `/admin-api/homePage/save` 保存 config 字符串；卡片内部还可发起各业务 | `base-home-widgets` / `baseShell.listHomeWidgets` 只读白名单卡片，没有完整布局读取与保存；卡片内部功能未逐个验证 |
| 个人用量 | `views/dashboard/common/model-usage/api.js`：额度汇总/分页/每日进度、功能模块候选、模型详情、使用汇总/趋势/模型占比/模块排行/分页/详情/导出、申请创建和申请记录 | 无对应页面能力；不能用平台用量冒充个人额度与申请链 |
| 智能助手 | `views/dashboard/common/chat/index.vue` 及共用聊天组件：会话与消息/技能执行/附件等需逐链追踪 | 无门户聊天页面能力；平台交互历史为后台查询，不等价于用户聊天 |
| 进鸡指数 | `views/dashboard/common/market-information/list.vue` 及引入组件 | 无页面能力 |
| 个人设置 | `views/dashboard/common/me/setting/api.js`：私人令牌列表、scope候选、创建/修改/重生成/删除、开放API分组；`LoginInfoPanel.vue` 登录资料 | 无个人设置能力；会话 token 与私人令牌不可混用 |
| 设置/修改密码 | `views/dashboard/common/change-password/index.vue:115-133`：表单校验后 POST zhdj-app `/user/password.json`，现有密码条件由 setPwd 决定，成功退出 | 无；必须按原页面密码复杂度/旧密码条件处理，不能推定立即撤销所有旧 token |
| 登录设备管理 | `utils/common/login-device/service.js`、`LoginDeviceList.vue`：GET `/device/list.json`、`/device/count.json?clientType=pc`、`/device/kick.json?targetDeviceCode=...`；本机禁移除 | 本次已新增 portal-device-list/count/prepare-remove/remove 模块，主任务接线并验证运行时描述；固定 Java 仓库没有该外部 zhdj-app 实现，尚无线上读写证据 |
| 外壳其它动作 | `components/portal/layout/index.vue:26-82`：租户切换、帮助文档、退出、测试环境复制免密链接、报告问题；全局小慧聊天 | 基础租户读取/候选不等于完整切换登录身份；本次未把复制或浏览器工具编造成 SDK 接口 |

## 目录与描述的真实接线

`src/capabilities/index.ts` 是可调用定义源；`src/capabilities/invoke.ts` 绑定 SDK 方法；`src/index.ts` / `src/server.ts` 创建用户隔离实例；`src/catalog/ai-contracts.ts` 汇集真实返回给 AI 的说明。`src/capabilities/generated/index.ts` 明确批量能力只是可选择接线的集合，本次主 SDK 未引用，不能计入可执行覆盖。现有基础用户/菜单/待办/卡片说明在 `contracts-base.ts`；只提供基础查询不表示上述业务页面完整。

## 补齐次序与证据限制

1. 登录设备管理：列表、PC数量、移除三个明确动作；显式 zhdj-app host 与真实当前设备上下文，拒绝移除本机。外部后端及真实下线未验证必须保留缺口。
2. 个人用量：按共享 API/composables 整组实现，不能只补列表；申请、记录、导出与展示单位必须一起交付。
3. 工作台：完整布局配置读/写及卡片候选，保留原布局未知字段避免覆盖丢失；卡片业务继续逐项比对。
4. common 设置页及其它系统设置页按上表逐页补动作与说明，不以“一个列表能力”宣称100%。

本次报告不提供动作100%分母：未递归验证所有详情/组件/卡片的运行时行为。已确认页面缺口足以否定100%结论；不能把静态线索或未发现接口写成已验证完整。
