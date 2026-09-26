# 页面清单与已实现能力校对（2026-09-22）

## 来源与范围

- Portal：`CodeReview_Projects_Js`，固定分支 `test/portal/main`，拉取后 `82651c98c5`。
- 后端：`CodeReview_Mall_Platform_Java`，固定分支 `test/test`，拉取后 `998ce8223fa`。
- SDK 起点：`4e9745d`。本次检查包括已有未提交的 AI 能力；这些在途源码不纳入本次提交。
- 校对方式：重新扫描源码、比较清单差集、核对能力与执行绑定、回归既有浏览器基准、运行测试。
  **未重新访问线上，也未执行真实写操作。** 注册覆盖不等于页面所有功能完成。

## 当前结果

| 指标 | 校对后 |
| --- | ---: |
| 页面清单 | 983（945 个路径页 + 38 个 iframe） |
| 已实现菜单页（当前工作区） | 74 |
| 能力 / 执行绑定（当前工作区） | 305 / 305 |
| 写能力（当前工作区） | 94 |
| 未覆盖菜单项（当前工作区） | 909 |
| 清单外的基础能力 / 流程入口路径 | 29 |
| 声明式列表静态裁决 | 240：122 自动、114 需补充、4 失败 |
| HTTP 实例 / 页面实例规则 | 17 / 37 |

独立提交副本只含原有已入库业务能力与本次修正：212 个能力（52 个写）、58 个菜单页。
工作区另外 93 个 AI 能力覆盖 16 页；其代码、基准、文档仍保持在途。
两份产物分别重建，避免把在途能力的文档和别名混入本次提交。

305 个能力 ID 无重复，执行绑定一一对应，所有 `sdkPath` 都能解析到实际门面函数。
74 个菜单路径都存在于新清单，没有发现因本次菜单移除而失联的已实现页面。
29 个清单外路径属于基础数据与流程入口，不能按“删除的菜单页”处理。

## 已修正的问题

1. **扫描器漏掉多行菜单字段**：改为按对象读取，恢复 8 项标题/权限，包括待办事项、个人用量、技术配置等。
   父对象不读取子对象字段，继续排除注释。回归：`test/page-catalog-generator.test.ts`。
2. **5 个伪 iframe**：4 条 import 与销售菜单的包装函数曾被计为页面，现已排除。
3. **过期 HTTP 实例**：删除前端已移除且零引用的 `hr` 画像。剩余 37 条页面实例规则与源码重推导一致。
4. **6 条读能力误标为写**：利润、薪资结构、模板内容、模板结构、学习任务配置、任务类型配置。
   已沿前端与后端查询链路复核，修为 `write:false`；不把页面的编辑入口算作查询能力的行为。
5. **统计与验证器过期**：刷新页面/业务域/可见性/批量裁决锚点；范围自检按真实声明式页数读取报告键，
   保留范围拆分回加校验。课程测试精确检查唯一 `type=1`，不再误伤包含 `999` 的时间戳。
6. **文档索引**：补会议室列表四件套，补即时通讯课程的基准链接，更新路线图与换源欠账状态。

## 清单差集

相对起点：975 + 新菜单 15 − 移除菜单 2 − 伪 iframe 5 = 983。

| 变化 | 标题 | 菜单路径 |
| --- | --- | --- |
| 新增 | 金融产品数据库 | `/dashboard/finance/investment/financial-product/list` |
| 新增 | 费用用途管理 | `/dashboard/finance/setting/fee-purpose/list` |
| 新增 | 盘点配置 | `/dashboard/material/assets/stocktaking-config/list` |
| 新增 | 资产盘点 | `/dashboard/material/assets/stocktaking/list` |
| 新增 | 进鸡指数 | `/dashboard/platform/front/inchicken-index-log/list` |
| 新增 | 参数设置 | `/dashboard/platform/front/inchicken-index-params/list` |
| 新增 | 指数说明 | `/dashboard/platform/front/index-note/list` |
| 新增 | 理论维护 | `/dashboard/product/prevention/plan/basic-theory/list` |
| 新增 | 研究目标 | `/dashboard/technology/biology/goal/list` |
| 新增 | 储备问题 | `/dashboard/technology/biology/problem/list` |
| 新增 | 项目管理 | `/dashboard/technology/biology/project/list` |
| 新增 | 项目类型 | `/dashboard/technology/setting/project-type/list` |
| 新增 | 模板基础配置 | `/dashboard/technology/setting/template-base/list` |
| 新增 | 模板中心 | `/dashboard/technology/setting/template/list` |
| 新增 | 类型模板映射 | `/dashboard/technology/setting/type-template-mapping/list` |
| 移除伪条目 | (未命名 iframe) | `app/portal/menus/hr.js` |
| 移除伪条目 | (未命名 iframe) | `app/portal/menus/product/breeders.js` |
| 移除伪条目 | (未命名 iframe) | `app/portal/menus/product/laying-hens.js` |
| 移除伪条目 | (未命名 iframe) | `app/portal/menus/sale.js` |
| 移除伪条目 | (未命名 iframe) | `app/portal/menus/sale.js` |
| 菜单移除 | 常用摘要 | `/dashboard/finance/setting/abstract-manage/list` |
| 菜单移除 |  | `/dashboard/technology/setting/project/list` |

## 仍需区分的边界

- 当前解析不到路由文件的 3 项如下；均没有已注册能力，保留为待核对菜单，不伪称已完成。
  - 各单位资金日报区间表：`/dashboard/finance/investment/daily/interval-report/list`。
  - 平台操作日志：`/dashboard/platform/system/log/platform/list`。
  - 店铺信息：`/dashboard/sale/shop/info/page/shop/details`。
- `zhdj-admin` 返回整个包络、`build-version` 返回裸响应，与 SDK 当前标准包络画像仍有差异。
  已在 `src/context/README.md` 标明；本次未扩大到请求客户端改造。
- 菜单页 `write` 仍是词法启发式：会漏掉 GET 写、也会把 POST 查询视为写，不能作为业务授权依据。
- AI 在途文档 `docs/pages/模型列表.md` 的“只读 9 / 写 8”与实际 10 / 7 不符；本次仅报告，保留其所有者修改。
  这些 AI 文档已声明部分写链路尚未实测，不能从“页面有能力”推断“写链路已验证”。
- 独立干净副本初跑时，抽样装置因缺少被 `.gitignore` 排除的 `tools/sample/endpoints.json` 失败。
  复制当前工作区的历史中间产物后通过；测试可复现性仍依赖这份本地产物。
  本次未修改 `tools/sample` 的独立验证证据，也没有重新抓取它。

## 验证记录

- 当前工作区：70 个文件通过，2525 passed / 31 skipped / 21 todo。
- 独立提交副本：65 个文件通过，2193 passed / 23 skipped（提供上述历史抽样中间产物后）。
- 两份均通过 `pnpm typecheck`、`pnpm run docs`（含 OpenAPI lint）、`node tools/generate/check-batch-scope.mjs`。
- 反证均红且已恢复：逐行扫描漏字段、误收 import/函数、目录丢页、伪 iframe 回流、恢复 hr 实例、
  六个只读能力误标为写、批量拆分错计、课程 type 被覆盖/重复/顺序错误。
- skips/todo 不计为已验证；历史浏览器基准不代表当前部署重新验证。

## 已实现菜单页逐项对照（当前工作区）

每项均确认路径存在、能力注册与执行绑定有效；“写”列只表示定义数量，不表示本轮真实写验证。

| 页面 | 菜单路径 | 能力数 | 其中写能力 |
| --- | --- | ---: | ---: |
| 状态变更 | `/dashboard/agreement-change/main/list` | 1 | 0 |
| 管理分析 | `/dashboard/analysis/department/list` | 2 | 0 |
| 个人分析 | `/dashboard/analysis/person/list` | 1 | 0 |
| 作业管理 | `/dashboard/assignment/assignment/list` | 6 | 4 |
| 考勤档案 | `/dashboard/attendance/attendance-archive-sheet/list` | 2 | 0 |
| 考勤统计 | `/dashboard/attendance/attendance-sheet/list` | 1 | 0 |
| 班次管理 | `/dashboard/attendance/attendance-shift/list` | 5 | 3 |
| 排班管理 | `/dashboard/attendance/attendance-team/list` | 7 | 4 |
| 待办事项 | `/dashboard/backlog/task-examine/list` | 1 | 0 |
| 图库管理 | `/dashboard/base/image/list` | 7 | 5 |
| 组织结构 | `/dashboard/base/management-center/list` | 7 | 4 |
| 学员管理 | `/dashboard/base/student/list` | 2 | 0 |
| 评价设置 | `/dashboard/base/teacher-appraise-setting/list` | 1 | 0 |
| 讲师类型 | `/dashboard/base/teacher-level/list` | 1 | 0 |
| 讲师管理 | `/dashboard/base/teacher/list` | 1 | 0 |
| 组件管理 | `/dashboard/block/main/list` | 1 | 0 |
| 合同模板 | `/dashboard/contract/template/list` | 5 | 3 |
| 即时通讯课程 | `/dashboard/course/im-course/list` | 1 | 0 |
| 图文课程 | `/dashboard/course/text-course/list` | 1 | 0 |
| 视频课程 | `/dashboard/course/video-course/list` | 1 | 0 |
| AI审核配置 | `/dashboard/flow/ai-review-config/list` | 1 | 0 |
| 流程模型 双赢协议 | `/dashboard/flow/old/model/list` | 1 | 0 |
| 流程实例 | `/dashboard/flow/process-instance/manager/list` | 1 | 0 |
| 抄送我的 | `/dashboard/flow/task/copy/list` | 1 | 0 |
| 发起流程 | `/dashboard/flow/task/create/list` | 1 | 0 |
| 已办任务 | `/dashboard/flow/task/done/list` | 1 | 0 |
| 流程任务 | `/dashboard/flow/task/manager/list` | 1 | 0 |
| 待办任务 | `/dashboard/flow/task/todo/list` | 1 | 0 |
| 班级管理 | `/dashboard/grade/grade/list` | 2 | 0 |
| 晨课堂 | `/dashboard/lesson/daily-lesson/list` | 1 | 0 |
| 月课堂 | `/dashboard/lesson/monthly-lesson/list` | 1 | 0 |
| 周课堂 | `/dashboard/lesson/weekly-lesson/list` | 1 | 0 |
| 公式配置 | `/dashboard/manage/formula-definition/list` | 1 | 0 |
| 指标管理 | `/dashboard/manage/indicator/list` | 1 | 0 |
| 五险一金 | `/dashboard/manage/insurance/list` | 1 | 0 |
| 利润管理 | `/dashboard/manage/profit/list` | 1 | 0 |
| 时间节点 | `/dashboard/manage/protocol-configuration/list` | 1 | 0 |
| 考核规则 | `/dashboard/manage/protocol-deduct-rule/list` | 1 | 0 |
| 薪资结构 | `/dashboard/manage/salary-structure/list` | 1 | 0 |
| 标准管理 | `/dashboard/manage/standard/list` | 1 | 0 |
| 学习任务配置 | `/dashboard/manage/study-task-config/list` | 1 | 0 |
| 任务类型配置 | `/dashboard/manage/task-type-config/list` | 1 | 0 |
| 模板内容 | `/dashboard/manage/template-content/list` | 1 | 0 |
| 模板结构 | `/dashboard/manage/template-structure/list` | 1 | 0 |
| 会议室 | `/dashboard/meeting-room/list` | 1 | 0 |
| 个人月度 | `/dashboard/month-agreement/main/list` | 1 | 0 |
| 所辖月度 | `/dashboard/month-agreement/others/list` | 1 | 0 |
| 数据分析 | `/dashboard/platform/intelligence/interaction/dataAnalysis/list` | 1 | 0 |
| 意见反馈 | `/dashboard/platform/intelligence/interaction/feedback/list` | 1 | 0 |
| 热门问题 | `/dashboard/platform/intelligence/interaction/hotTopics/list` | 4 | 3 |
| 模型列表 | `/dashboard/platform/intelligence/interaction/model/list` | 17 | 7 |
| 模型选择 | `/dashboard/platform/intelligence/interaction/modelSelect/list` | 4 | 2 |
| 平台用量 | `/dashboard/platform/intelligence/interaction/platform-usage/list` | 6 | 0 |
| 交互历史 | `/dashboard/platform/intelligence/interaction/questionsAndAnswersDetails/list` | 4 | 2 |
| 敏感词 | `/dashboard/platform/intelligence/interaction/sensitiveWordWhitelist/list` | 5 | 3 |
| 知识空间 | `/dashboard/platform/intelligence/knowledge/document/workspace/list` | 7 | 5 |
| 知识审核 | `/dashboard/platform/intelligence/knowledge/review/list` | 2 | 1 |
| 业务事件绑定技能 | `/dashboard/platform/intelligence/prompt/business-event/list` | 10 | 5 |
| 意图列表 | `/dashboard/platform/intelligence/prompt/intent/list` | 6 | 3 |
| 开放接口 | `/dashboard/platform/intelligence/prompt/interface/list` | 6 | 3 |
| 技能列表 | `/dashboard/platform/intelligence/prompt/prompt/list` | 9 | 2 |
| 工具提示词绑定 | `/dashboard/platform/intelligence/prompt/template/list` | 5 | 3 |
| 提示词类型 | `/dashboard/platform/intelligence/prompt/type/list` | 6 | 3 |
| 工资找齐 | `/dashboard/salary/adjust/list` | 1 | 0 |
| 考核导入 | `/dashboard/salary/examine-result/list` | 1 | 0 |
| 奖励导入 | `/dashboard/salary/main/list` | 1 | 0 |
| 班级统计 | `/dashboard/statistics/grade/list` | 1 | 0 |
| 学习统计 | `/dashboard/statistics/learning/list` | 1 | 0 |
| 班课统计 | `/dashboard/statistics/lesson/list` | 1 | 0 |
| 学员统计 | `/dashboard/statistics/student/list` | 1 | 0 |
| 讲师统计 | `/dashboard/statistics/teacher/list` | 1 | 0 |
| 学习管理 | `/dashboard/study/study/list` | 1 | 0 |
| 个人年度 | `/dashboard/year-agreement/main/list` | 2 | 0 |
| 所辖年度 | `/dashboard/year-agreement/others/list` | 1 | 0 |
