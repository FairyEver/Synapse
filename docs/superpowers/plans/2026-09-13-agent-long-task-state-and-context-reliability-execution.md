# Agent 长任务可靠性实施记录

日期：2026-09-13。状态：部分实施，P0–P8 尚未全部完成，尚未通过真实长任务验收。

本次在已有未提交修改上增量开发，没有清理工作树、修改用户失败对话、启动应用、调用真实 Provider、新增依赖或发布。已安装 Claude Agent SDK 版本为 0.3.245。共同性能计划的 P1 增量权威历史仍未完成，不能把当前整历史检查点称为增量存储。

## 已实施行为与验证

| 问题 | 本次行为 | 验证与限制 |
| --- | --- | --- |
| R01 | 自动执行交接独立于手动恢复脱敏，保留真实路径、早期要求、当前请求和最新执行批次；有界段落省略时明确指向完整检查点 | 中文、空格、项目外临时路径和 canary 凭据回归；提示不超过 32 KiB。尚无有版本的任务契约索引 |
| R02 | conversation 持久化 taskListId，串行分配 UUID；两层 SDK env 均覆盖全局共享 ID，resume/轮换复用身份 | 真实 SDK 创建任务后连续 20 个新 query 可见原任务；另一 namespace 不可见。仓库重开和并发分配回归通过。尚未实现宿主 Task 语义镜像、SDK 任务文件的备份/删除适配 |
| R05 | 删除单用户轮次累计工具输出硬额度，只保留累计统计及单结果/单批/当前工作集预算 | 20 批工具输出超过 96 KiB 仍继续；当前 token/body 危险仍触发保护 |
| R06（部分） | SDK 整理触发值不再被再次扣 buffer 当作硬限制；删除 75%/10% 整理判定；明确保留尾部快照允许释放旧字节高水位 | 单测验证释放/未知保留尾部；真实 SDK hook 内可获取上下文快照。完整 compact 时序、水位归属、重复 boundary 去重仍待实现 |
| R08（部分） | Read/Bash/Grep/WebFetch 替换保持原生结构；MCP 替换移除旧 structuredContent；序列化外壳和转义计入额度。不能容纳完整引用或无法安全替换的结构显式停止 | 真实 SDK 出站请求验证 Read、Bash、MCP 使用替换结果；尚无无损源范围读取、交付确认及覆盖 union 账本 |
| R09（保护） | 非文本结果超预算时显式未完成并停止，不再省略后要求模型根据已有信息完成 | 原件不修改；原图持久引用及重呈现协议仍待实现 |
| R10 | 落盘异常、缺少返回记录、保存被截断时产生可恢复错误，关闭失败 query，不返回截断成功结果或自动轮换 | 三类失败注入；旧 query 不接受后续 send。尚无完整持久化维护事务 |
| R13 | timeline/transcript 和摘要基于持久化 conversation history；runtime 空页、尾页不再替代权威历史；工具计数按 toolUseId 去重 | 空页/尾页回归及脱敏导出专项通过。跨 namespace 一致高水位与大历史流式导出仍待实现 |
| R16（部分） | 新 SDK 创建前后、轮换异步边界复查取消；SDK 在进入事件循环前已经结束时也记录未完成 | 前台/Relay 既有取消回归及立即结束回归。持久 generation fence、维护崩溃恢复仍待实现 |

## 真实 SDK 协议证据

新增 `sdk-native-long-task-contract.test.ts` 使用已安装 SDK/native executable、隔离 HOME/config/cwd 和本地 loopback 响应服务，不连接真实模型或用户 MCP。

首次测试使用字符串 updatedToolOutput，Read hook 虽执行，下一次真实出站请求仍携带原始文本；改为 Read 原生结果结构后，出站请求携带替换文本且不含原始结果。该发现修复了原先 fake query 测试无法发现的治理失效。

当前夹具覆盖 Read/Bash/MCP 结果替换、MCP structuredContent 消除、PostToolBatch 内 getContextUsage、Stop 阻止首次完成，以及 task-list namespace 跨 20 次新 query 与会话隔离。测试统计出站 body 字节但没有以此标定所有生产请求；未覆盖图片替换、真实 compact 前后消息顺序、挂起 hook 的取消/close 时序和真实 Provider 请求拒绝。

## 验证命令

- Runtime 专项：budget、continuation、manual recovery、governor、transport policy、repository、session manager、SDK session、router、export、cancel、native SDK contract；另含 DataRepository schema 回归。
- 上述 13 个测试文件共 338 项通过；其中真实 SDK 协议测试约 8 秒，不代表真实任务吞吐或长时间稳定性。
- desktop typecheck、受影响文件 ESLint、hard constraints、git diff --check。
- 未修改 Renderer 可视实现、Worker/SDK 进程边界、依赖或打包资源，未启动 Renderer 或应用进行验证。

## 未完成的实施工作与发布门禁

1. P1：权威历史增量存储、正文分块、后台迁移及原子高水位；有版本的任务契约、回执、工作单元和进度账本。
2. P2：按资源/要求/工具索引的增量 checkpoint manifest、引用 hash 校验、有界分层恢复输入；当前仍会复制完整 history。
3. P3/P6：无损范围读取、并行页缺口、原图重呈现、私有 declareWorkPlan/commitProgress 协议与确定性完成门禁。原文保留和提示不能替代这些机制。
4. P4：真实 native compact 的消息/快照水位与重复通知核验、完整 token/body 校准。
5. P5：持久化维护事务、恢复确认、崩溃窗口、generation fence、跨代总预算和业务证据停滞治理。现有 completedBatches 判断仍在，R07 尚未解决。
6. P7：导出各文件共享固定高水位、流式输出、稳定路径别名、采集缺口和多代累计用量计量；R12/R14 未完成。
7. P8/R15：共同性能计划 P1–P4、100k 历史容量门禁、稳定构建真实长跑及质量审查。
8. R11 的范围/方法防缩减和 R17 的隔离临时目录生命周期尚未工程化强制。

这些包含尚未完成的代码工作，不能概括为“仅差用户授权或真实模型验收”。A01–A22 尚未全通过，不得宣布长任务可靠性已解决。真实时间长跑为 0 小时；真实 Provider 请求数为 0。
