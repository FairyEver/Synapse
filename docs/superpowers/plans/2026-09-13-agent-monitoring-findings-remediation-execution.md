# Agent 监视整改实施记录

日期：2026-09-13。状态：**部分实施，不能宣布本计划完成或图片自动恢复已交付**。

对应[实施计划](2026-09-13-agent-monitoring-findings-remediation-plan.md)。本次完成失败状态修复、导出采集缺口标记和原生图片协议探测；没有启动应用、读取原始三个压缩包、修改被监视对话、调用真实 Provider、迁移用户数据或发布。

## M00：基线与事实来源

- 开始时 HEAD：`e809ecc11ab2895eb3b477716e0b2b4ef6694c50`；工作区有 184 项未提交修改。已保存起始 diff 和修改文件副本，提交只包含本任务增量。
- desktop 源码版本：`0.2.457`；已安装 Claude Agent SDK/native：`0.3.245`。
- 只读核对安装包 Info.plist：`com.fairyever.synapse`，版本及 build version 均为 `0.2.457`。没有安装包的源码提交映射，不证明其包含工作区修复；未对安装包进行长任务验收。
- 同目录另一个用户任务「执行 Agent 四项缺口修复计划」正在改造共用 DataRepository/历史结构。本任务复用其 native fixture，没有重复创建历史库、原子 API、任务镜像或 HandoffRecord。其基础提交不是本任务产出。

| 事实 | 来源和本次处理 | 不确定性 |
| --- | --- | --- |
| F01：81 文件、33 文本、48 图片，182,030,632 总字节、161,017,892 文本字节 | 引用原计划第 2 节的监视清单，作为后续合成大任务 oracle | 本次未重读原件，数量不代表取得、交付或理解 |
| F02：Read 截断及 offset 跳跃 | 引用原计划；当前 governor 仍将 Read 元数据拼入正文，尚无资源版本范围账本 | 尚不能判断原对话所有缺口；T01–T08 未验收 |
| F03：首张图片后 execution_failed，监视 recoverable=false | 原计划描述历史现象；本次回归重现归一化把 SDK 的 true 改为 false，并修复 | 未证明历史故障只有这一原因；不是 HTTP 6 MiB 错误证据 |
| F04：10 文本完成标记，其余未验收 | 引用原计划；没有修改原清单或补写 PASS | 标记不等于宿主覆盖证明 |
| F05：A 包 4 个 JSON 解析失败 | 本次对当前导出的全部 9 个 JSON 文件测试嵌套引号、转义、路径、中文、emoji、超长字段和 canary | 合成包可解析，未复现原包损坏，不能宣称历史包已修复或三包均损坏 |
| F06：预算讨论及过度因果结论 | 引用原计划，诊断导出新增缺采集状态 | 未做真实模型语义评测，不能声称推理质量已解决 |

## M01：真实 SDK 图片协议

`sdk-native-image-contract.test.ts` 使用共用隔离 loopback fixture：真实已安装 SDK/native、独立配置和临时目录、合成 1×1 PNG，不连接用户 MCP 或真实 Provider。

| 场景 | 结果 | 证据层级 |
| --- | --- | --- |
| PostToolUse 挂起时保存待呈现元数据 | 可完成，下一请求尚未发送 | acquired；只是测试文件保存，不是生产事务 |
| 挂起时等待 interrupt 确认，再释放 hook | 旧 query 没有后续请求 | loopback request-observed |
| interrupt 确认后 close，再释放 hook | 旧 query 没有后续请求 | loopback request-observed |
| hook 正常返回 continue=false | 原图未进入后续请求 | loopback request-observed |
| 干净 query 原生 Read 同一原件 | 请求含原生 image block；字节与原件逐字节相等，原件摘要未变 | 二进制交付，不是视觉语义通过 |
| 仅 close 后释放挂起 hook | **门禁失败：仍有第二次请求，包含原图** | 已保留缺陷复现测试；该测试断言缺陷存在，绝不计作 I06 验收通过 |

探测中 `abortController.abort()` 后 close，以及 `Query.return()` 也观察到额外请求，未采用这些未经证明安全的替代方案。上述成功路径只证明当前合成场景，不能覆盖取消异常、interrupt 不响应、其它 hook 改写或真实 Provider 行为。未向生产代码接入图片自动交接，也未删除现有停止保护。

该缺陷复现测试与 SDK 版本相关；修复 SDK 关闭屏障后应将其改成“无后续请求”的验收断言，并重新跑全部图片/批次/取消门禁，不应保留“必须泄漏”的产品约束。

## M07：本次产品修复

1. `diagnosticFromAgentError → normalizeExecutorEvent → outcomeToAgentEvent` 保留显式失败恢复标志；缺省不推断为 true。取消/超时的既有优先级和终态锁定保持有效。
2. Router 将错误的 `turnOutcome` 与 `recoverable` 一起写入 history，修复原先只存在于即时事件、重放时丢失结构化终态的问题。
3. 同步 renderer 类型及 IPC schema。回归覆盖 router 结果、phase、持久事件和 history，以及 history → renderer 投影 → IPC → MCP inspect；MCP runtime 为 idle 时仍能读到失败及恢复标志。不是运行应用做的端到端验收。
4. SDK 导出采集状态新增 `sourceStatus`：`captured`、`not-recorded`、`read-failed`。后两者 `observedEventCount=null`；实际导出条数仍可为 0，读取失败继续进入 manifest.skipped。
5. 当前结构化脱敏后序列化的路径已通过全部 JSON 可解析、凭据/Base64 不泄漏及输入不变测试。没有改写历史坏包，也没有把此测试描述为历史损坏修复。

本次未增加 capability/MCP 工具或权限，注册数量不变；同步权威系统 Skill 的 Agent 观察规则。`recoverable=true` 不表示成功或授权自动续跑。

## 验证证据

- 最初新增失败归一化回归按预期失败：true 被投影为 false。修复后该回归通过。
- Router 回归又发现 history 漏存 turnOutcome；补齐字段后 93 项 router 测试通过。
- turn-outcome、export、IPC schema：3 文件 52 项通过；renderer 重放专项 1 项通过。MCP idle 读取曾在当前工作区的临时集成夹具中通过；能力包本身仍属于此前未提交依赖，永久 MCP 集成测试待该依赖提交后纳入，本次没有将该能力包一起提交。
- 原生图片最终 4 项测试通过，其中 **3 项兼容性测试、1 项已知缺陷复现**；I06 仍失败。
- desktop 全量：917 文件，916 通过、1 失败；8,720 项通过、1 失败。失败是 `data-table-view-focus.test.tsx` 的取消删除后焦点归还，未修改该模块；单独复跑该文件 4 项通过，未放宽断言。
- hard constraints、IPC codegen 一致性及本次修改文件 ESLint 通过。
- desktop typecheck：产品、Electron、preload 阶段通过，测试阶段受并行历史迁移任务的 `history-repository.test.ts` 两项类型错误阻塞；本任务新增测试的类型问题已修复。未擅自修改其它任务正在开发的文件。
- 另将“已提交 HEAD + 本次提交差异”导出到隔离目录验证：6 个专项文件共 130 项通过，完整 desktop typecheck 通过。该快照不包含其它任务的未提交代码；因此本次提交本身通过独立验证。它仍不代表前述全量工作区、I06 或真实长任务验收通过。
- 真实 Provider 请求数 0；真实长任务运行时长 0；未运行打包或安装版本验收。

测试命令使用 `pnpm --filter @synapse/desktop run test <文件...>`。原计划的 `run test -- <文件...>` 在当前脚本中会触发全量扫描，已更正；中止的探测运行未计入通过数。

## 剩余工单与门禁

| 工单 | 当前状态及下一步 |
| --- | --- |
| M00 | 基线、事实/推断区分及消费者已记录；原监视构建的准确源码身份仍未知 |
| M01 | 图片主路径有真实协议证据；强停 I06 未通过，不能将失败复现算作通过；共享 Task/Stop/compact 夹具由共用计划维护 |
| M02 | 等待共用历史、资源/进度索引和 generation 事务契约完成；新增原子基础不等于生产交接事务已经完成 |
| M03 | 未实施精确源范围、单行可逆分页及覆盖合并，依赖 M02；不能把预览保存视为完整消费 |
| M04 | **未交付**：关闭屏障仍不满足 I06，持久 HandoffRecord/原图生命周期未就绪；保持自动重呈现禁用 |
| M05 | 未交付：原生 Task metadata 宿主镜像及双完成门禁依赖前序；第 3.2 节严格模式限定已向用户提问，尚无本任务确认 |
| M06 | 未交付：有效覆盖进度、跨代费用和停滞账本依赖 M05 |
| M07 | 失败状态、当前 JSON 可解析性和未采集标记已实施；一致 snapshotRevision、稳定路径别名、大导出内存/取消/磁盘满及历史坏包定位未完成 |
| M08 | 未执行。待所有代码和协议门禁通过，再取得真实 Provider/启动及原件访问的相应授权，进行目标构建长任务验收 |

下一步应先解决 SDK 强停期间的请求屏障，并衔接共用计划的存储/交接契约；不能以新建第二套账本、重放工具或删除停止保护绕过这些依赖。
