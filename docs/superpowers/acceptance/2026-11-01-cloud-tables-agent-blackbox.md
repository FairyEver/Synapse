# 云表文档驱动的 Agent 模拟验收（2026-11-01）

## 结论与测试边界

在用户预先提供足够权限密钥的前提下，独立HTTP客户端依据线上公开API文档与OpenAPI，完成从零建表、字段和权限配置到记录增删改查、归档/恢复及回收站的完整流程。**63次开放API请求、19项操作成功覆盖；Console请求0次、Cookie请求0次；9次跨表主管理尝试均返回403。** 另一位表主随后回读，表配置、权限与业务记录未被越权请求改变。

这是脚本化HTTP客户端模拟Agent的调用过程，不是另一个LLM自主规划能力评测。客户端不导入后端业务代码、DTO、Prisma或服务实例；操作路径从公开OpenAPI的operationId发现，请求字段根据公开文档及请求schema构造。

本轮未收到生产用户密钥，环境中的 `SY_API_KEY` 也未设置。因此使用临时PostgreSQL16和两个隔离测试账号模拟“用户已提供密钥”，不把结果描述成生产账号完整CRUD实测。没有查询生产凭证或对生产表写入、压测，也没有重新部署。

## 输入与隔离方式

- 仓库 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`。
- 文档来源：[云表API文档](https://synapse.d2.pub/document/open-api/api/cloud-tables)。读取发布页面对应的“复制Markdown”内容，不使用本地源码文档替代；解码页面数据，不执行页面JavaScript。
- 契约地址由上述Markdown发现：[OpenAPI](https://synapse.d2.pub/api/open/openapi.json)。
- 本次Markdown SHA256：`7614499a1506d85b5bf333afb9cc9d86fdd4f8a54bbcb946452460bca873966a`。
- 本次OpenAPI JSON解析后序列化SHA256：`4c36c392d84808d5d625734563fcaba05e872f8e6c0e99dc2fc03c6cccc6c9a2`。
- 客户端为独立Node子进程，只接收测试API地址、Alice本人管理密钥、Alice本人协作表密钥，以及Bob用户名/目标表等任务输入。不继承数据库URL、账号密码、登录Cookie、Bob密钥或其他环境凭证。HTTP写入目标强制为loopback。
- 准备阶段建立Alice/Bob两个账号及密钥，并由Bob通过开放API创建已有表及授予Alice协作权限。这相当于用户预先提供凭据和已有共享表，不属于被测Agent的建表流程；Alice开始时无自己的表。
- Agent执行期间没有数据库直连或Console辅助操作。应用HTTP入口逐请求统计；结束后再由Bob密钥通过只读API观察，不在中途补权限、改字段或修复数据。

## 实际完成的用户流程

1. 从公开文档取得机器契约，发现19项操作；用本人密钥确认自己的表列表为空。
2. 创建默认私有的空表，取得服务端返回的表ID与结构版本。
3. 通过API添加姓名、评分、状态、备注字段，设置必填、默认值与稳定选项key，并重命名表。
4. 通过用户名解析Bob，配置协作者的本人记录范围。后续修改授权时，从schema投影可提交的userId/permissions，去掉只读handle；不误撤已有协作者。
5. 新增记录、以相同幂等键重试且不重复创建，读取单条、组合筛选/排序，修改记录并验证旧版本409。
6. 批量新增/修改，再以每页1条完成游标分页，确认3条数据无重复、默认值正确。
7. 归档备注字段并确认普通读取隐藏；恢复原字段并保留原值，修改显示名称且字段key不变。从请求schema移除只读archivedAt。
8. 只开放匿名新增，匿名提交成功且创建者为null；匿名查询403。保持已有协作者配置，再关闭匿名操作。
9. 删除记录、普通读取404、读取回收站并恢复，原值保留；查看操作日志。
10. 删除整表并验证普通列表隐藏、回收站可见，再恢复整表、检查数据与匿名配置，最后将本次表删除。

Agent共63次API请求：33次200、14次201、12次预期403、3次预期404、1次预期409；错误均为指定负向用例，没有将失败放宽为通过。

## 跨用户权限验证

先验证Alice的 `all_owned` 密钥不能访问Bob表，返回 `403 INSUFFICIENT_SCOPE`。再使用Alice另一把密钥：**包含全部5个云表scopes（含tables.manage），且selected资源明确包含Bob表**；Bob授予Alice读取全部、修改/删除本人记录等权限。

该密钥能正常发现Bob表结构和读取其授权数据，说明凭据、资源和协作访问本身有效；随后以下9次管理请求全部返回 `403 FORBIDDEN`：

| 越权管理尝试 | 结果 |
|---|---|
| 重命名Bob表 | 403 |
| 以空字段列表归档Bob全部字段 | 403 |
| 开放Bob表全部匿名操作并清空协作者 | 403 |
| 删除Bob表 | 403 |
| 恢复Bob表 | 403 |
| 解析协作者以管理Bob表授权 | 403 |
| 读取Bob表操作日志 | 403 |
| 读取Bob记录回收站 | 403 |
| 恢复Bob已删除记录 | 403 |

额外验证：在own修改/删除权限下操作Bob创建的记录，均返回404；selected密钥不能建新表，返回403。越权后Alice再次读取的可见结构与数据、Bob表主独立读取的完整结构/ACL/活动记录/回收记录，均与原快照一致。操作诊断日志的新增属于预期审计，不将其误称为全库无变化。

## 自动验收与证据

- 复现命令：`pnpm --filter @synapse/server test:cloud-tables:agent`。需要联网读取当前发布文档；普通 `test:cloud-tables:e2e` 不增加线上文档依赖。
- 本次该命令共3文件、**29/29项通过**：原有28项数据库/HTTP测试，加1项完整独立客户端场景。执行时间19:16，真实Nest应用模块与临时PostgreSQL16，无HTTP或业务服务mock。
- 运行器最终删除本次容器及数据库，检查未留下同名测试容器；账号、表和密钥仅存在于临时库，未产生生产测试垃圾数据。
- 首次运行在客户端启动前因测试脚本正则的Unicode转义语法错误失败，未发出业务请求；修正测试脚本后完整重跑通过。这是验收脚本问题，未发现本轮产品缺陷，未改云表生产业务逻辑。
- `node --check server/test/fixtures/cloud-tables-agent-client.mjs`、`git diff --check`通过。
- 服务端完整类型检查本次未通过：运行期间其他任务新增/修改 `src/game/hall/__tests__/pending-transfers.spec.ts` 等文件，尚未对齐 `freezeTransfers`、`releaseTransfers`、`voidTransfers`、`JoinSession.admissionId` 等类型。错误文件不在本任务改动范围，未擅自修改，也不将此次全量类型检查报告为通过。
- 新增 `server/test/cloud-tables-agent.e2e.spec.ts`、`server/test/fixtures/cloud-tables-agent-client.mjs`；为现有运行器增加显式 `--agent` 模式，并同步包命令及服务端README。纯验收代码，无产品行为变更，不新增发布说明。
- 原始证据目录：`/Users/liyang/Documents/code/github/Synapse/.superpowers/cloud-tables/agent-blackbox/`，尚无在线报告链接。`result.json`记录逐次operationId、调用身份类别、方法、路径、HTTP状态、错误code、请求ID，以及0 Console/Cookie请求和Bob回读不变的结论；不记录密钥或Cookie。其余证据：`test.log`、`typecheck.log`、`first-harness-failure.log`。
