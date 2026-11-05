# 终端资源修复验证记录（2026-11-05）

范围：当前对话确认的第 1、2 项；当前仓库 main 工作区开发，不涉及自动关闭策略、Renderer 挂载、进程资源隔离、依赖或公开工具数量。

## 实现

- 原始输出使用环形缓冲，同时约束单会话 10 MiB / 16,384 块及全局 256 MiB。包含空块，保留原始序号与丢失统计；全量淘汰后报告 gap 与恢复水位。最新单块超过单会话字节额度时保留该块的旧契约不变，全局额度仍可淘汰它。
- 全局淘汰扫描各缓冲队首，不再对整段历史生成快照并排序；增量输出定位使用序号二分查找。
- 删除最后一个输出块时立即释放其空会话索引与首序号索引。进一步核对发现，旧结构保存本来也会重建块索引，因此早先孤立 insert/delete 实验不应作为正常生命周期中该索引无限增长的证据。
- Agent 档案仅随活动终端常驻内存，启动不全量读取数据库历史；注销移除活动档案，真实历史保留原数据库。从未启动 Agent 的 launching 占位不再写成历史。终端仍在时的 Agent ended 投影保留。
- 结构保存使用内部 saveStructuralState，提交元数据和未保存的输出增量，保持其他会话的输出与检查点；不生成全部终端画面。终端删除不再生成即将丢弃的检查点。
- 结构写入失败保留待保存标记与输出水位，后续运行时写入不能掩盖失败的结构更新。已有删除意图、加密块、权限和审计机制保留。

## 回归与审查

- 块数、空块、多字节、环绕、恢复历史、完全淘汰后的 gap 和精确读取边界。
- Agent 历史冷存储、100 个未启动会话注销、真实历史保留；异步 stat 期间当前或后续扫描会话注销后不得复活。
- 全局淘汰不复制历史；重命名不调用画面序列化、完整历史快照或已保存输出扫描。
- 结构保存期间新输出、写入失败重试、写入期间进程退出；目标删除保留其他会话的原始输出与检查点。
- 使用真实 DataRepository 与加密块存储进行 25 次 create → output → rename → exit 循环，每轮检查会话、标签、输出文件、删除意图与监听器清空。PTY 为受控替身，没有启动或关闭用户的真实终端。
- 回归强度验证：移除失败后的结构待保存标记时，并发输出重试用例按预期失败；恢复后通过。
- 独立只读审查发现的异步探测复活问题已修复并补两例 RED → GREEN。审查另进行 200,000 次纯内存随机参考模型对比，覆盖小额度、UTF-8、空块与超大单块，全部一致。

## 性能比较

环境：Node v22.22.3，macOS arm64。基线为提交 `2fe65cc5b944070c26999e40bd605268d6e80089`；使用 git show 在内存读取基线模块，没有切换分支或另建工作区。每组独立运行 3 次，以下为中位数。

| 工作负载 / 指标 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 200,000 个单字符输入块，实际保留块数 | 200,000 | 16,384 |
| 上述缓冲释放前后、稳定 GC 的堆差值 | 23.32 MiB | 1.88 MiB |
| 从上述缓冲淘汰 2,000 块 | 449.25 ms | 0.04 ms |
| 8 会话、800 个输出块、4 KiB 全局额度，输出处理 | 22.54 ms | 4.50 ms |
| 上述全局淘汰产生的完整缓冲快照 | 8,232 | 0 |
| 上述全局淘汰复制的输出对象 | 520,771 | 0 |
| 32 会话、每会话 5,200 行输出后，重命名一个会话 | 921.78 ms | 0.20 ms |
| 上述重命名同步序列化的画面 | 32 | 0 |

同一输入规模下保留块数变化是新增额度的预期效果，淘汰耗时同时反映容量限制与队列算法变化。小块内存按同一进程中缓冲释放前后稳定 GC 的差值测量，避免将模块加载和 TypeScript 转译启动垃圾误计入缓冲。

复现命令（仓库根目录）：

```bash
node --expose-gc desktop/scripts/checks/terminal-resource-benchmark.mjs --baseline-ref 2fe65cc5b944070c26999e40bd605268d6e80089
node --expose-gc desktop/scripts/checks/terminal-resource-benchmark.mjs
```

该脚本使用真实核心仿真器、内存存储和 PTY 替身，隔离核心 CPU 与对象开销；不包括磁盘等待、Renderer、真实 CLI/MCP 子进程，也不是真实应用的 32 PTY 或 24 小时容量验收。原始三轮 JSON 位于本机 `.superpowers/sdd/2026-11-05-terminal-resource-bounds/benchmark-*.json`，尚无在线链接。

## 执行结果与限制

- 终端 main/shared、系统 Skill 包和 mobile gateway 最终专项：30 个文件、528 项全部通过（6.87 秒），包含结构写入期间退出与不扫描历史的追加回归。
- desktop 主进程 `tsc -p tsconfig.electron.json --noEmit`：通过。
- `check:hard-constraints`：通过；最终 diff 和暂存范围在提交前检查。
- 全库 `pnpm run test`：1,104 文件通过、8 文件失败、2 文件跳过；11,395 项通过、36 项失败、2 项跳过。失败涉及 automation-module、causal-editor、editor-app、inline-editor、renderer trigger-registry、main-window、use-main-navigation、mobile-workspace-files-service。完整原始失败名称在本机 `.superpowers/sdd/2026-11-05-terminal-resource-bounds/desktop-tests.log`，尚无在线链接。
- 导航测试隔离重跑通过；mobile-workspace-files-service 隔离重跑原失败场景通过，但另一项 staged/unstaged baseline 测试达到原有 20 秒超时，不能宣称该文件整体验证通过。
- 完整 desktop typecheck 两次均未通过：首次为其他自动化改动中的 activeDays 旧测试类型，末次为正在修改的 automation-runs-dialog.tsx 语法错误。记录位于本机 `.superpowers/sdd/2026-11-05-terminal-resource-bounds/typecheck-final.log`，尚无在线链接。额外扩大到旧 Terminal 测试的类型检查还发现已有 fixture 缺少默认属性等问题，不计为已通过检查。
- 全库失败文件不在本次代码修改范围，未为取得绿色结果改动它们。以上全库结果是当时共享工作区的快照，其他任务仍在修改和提交。

## 交付与回滚

本次只做本地提交，不推送、不部署。运行中的驻留任务仍计入现有 32 会话上限；高碎片输出会比原先更早裁剪原始历史，调用者按既有 gap 与恢复水位处理。回滚本次提交可恢复旧缓存和存储路径；没有数据库 schema 迁移或历史数据删除。
