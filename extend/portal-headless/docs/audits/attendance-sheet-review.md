# 考勤表新增能力独立复核

2026-09-22；只读复核 `attendance-sheet.ts`、`contracts-attendance-sheet.ts`、对应测试，以及前端 `d3cf56bdc7` / 后端 `dcb3f360194`。没有调用真实环境，没有修改被审代码。

## P1：无班组表被新增 info 前置查询阻断，无法删除清理

- SDK `src/capabilities/attendance-sheet.ts:77` 的 `assertEditable` 无条件先调用 `info/{id}`；archive/remove 分别在 :119/:127 调用它，statistics 在 :131 也先调用 info。
- 页面新建/编辑的 organizationId 可清空（`attendance-sheet/[mode]/[id].vue:16` 的 `allow-clear`，form 初值 null）；SDK `buildSheetPayload` 同样允许 null。
- Java `HrAttendanceSheetServiceImpl.getInfo` 的 :703 无空判断执行 `hrOrganizationService.selectById(entity.getOrganizationId()).getName()`。合法无班组记录的 organizationId=null，会在此失败。不是 SDK 空对象映射问题，而是前置请求本身失败。
- 浏览器 archive/delete 直接用列表行 ID 发写请求，预览依赖 bridge 的 isArchived/year/month，不先调用 info，因此这三个动作不受该详情接口缺陷约束。SDK 新加的 info 前置使可操作范围变窄，尤其新建无班组表后无法执行 SDK 撤销清理。

建议：归档/删除/统计的状态应从列表支持的真实数据取得并验证目标行，不依赖这个详情接口；保留归档保护，不简单删除保护。真实详情编辑入口仍可能遇到后端既有 bug，需如实说明，不能承诺缺陷已经修复。增加无班组行、info 失败但列表可见的独立夹具，确保 remove/archive/statistics 不调用 info，并核实真实环境。

证据是静态确定的空值路径；本次未在真实后端创建该条件，不能称为线上复现。

## P2：当前部门为空的实现与 AI 输出契约不一致

- `attendance-sheet.ts:95` 对 getUserDepartment 返回值调用 `record()`，收到 null 即抛“考勤接口未返回对象”。
- AI 契约 `contracts-attendance-sheet.ts:30` 明确承诺 `{ id:null, fullPath:null }` 分支（id=null 表示没有部门），调用者无法按契约得到此结果。
- Java `HrOrganizationServiceImpl.getUserDepartment:5564` 在用户无组织、无组织关系、无标准化单元等多处明确 `return null`；前端 `watch(state)` 只在有 id 时回填表单。

建议：将后端 null 归一为契约承诺的空部门结构，或把契约与错误行为统一；当前协议已有清晰空状态，优先保持它。补 null 测试，不以成功 DTO 夹具覆盖该分支。

## 已声明但阻塞“整页 100%”的遗漏

预览页面 `attendance-sheet/detail/[id]/item.vue` 默认打开 type=1“考勤簿”；当前只实现 type=2“统计薄”。缺 `getArchiveAttendanceInfo` / `getUnArchiveAttendanceInfo`、每人上下午逐日展示、出勤/休假标记、入离职日期边界；归档时还有“打印此表格”“合并为双面打印”。AI consume 已说明缺考勤簿和打印，因此这是如实声明的功能缺口，不是隐藏 bug；仍不能把本次补齐描述为完整页面交付。

## 本次验证及盲区

- 独立运行 `pnpm exec vitest run test/attendance-sheet.test.ts`：12 例通过。
- 现有夹具全部 info 成功且 organizationId 非空；没有测到 P1。department 只测成功对象，没测到 P2。
- 未修改实现、未执行变异反证、未运行浏览器/真实写入；无需为只读复核建立额外测试文件。

## 主代理修复复核

已修复两项：归档/删除/统计按页面使用刷新后列表的isArchived，不再调用info；编辑isArchived在防重登记前校验。department对后端null返回{id:null,fullPath:null}。新增回归明确让info抛出模拟NPE仍可执行列表动作，且验证无部门契约；15项通过。
