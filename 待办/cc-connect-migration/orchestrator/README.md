# CC Connect 迁移编排器

这个目录用于把 `prompts/00~07` 串成一个可恢复的单会话状态机。

## 启动方式

在新的 Codex 对话中发送：

```text
请读取并执行：待办/cc-connect-migration/orchestrator/START_HERE.md
```

Codex 应按 `START_HERE.md` 的状态机自动推进：

```text
执行阶段提示词
→ 写 artifacts
→ 运行验收门
→ fail 时修复
→ 最多 3 次
→ 仍 fail 时运行 00A 裁决
→ pass 后进入下一阶段
```

## CC Connect 来源路径

正式项目资产路径：

```text
/Users/liyang/Desktop/code-guide/cc-connect-main
```

stage 01 必须以该目录为正式来源证据，并扫描完整项目资产，包括 Go、Web、npm、daemon、config、core、README 和测试。不要只扫描 Go。

## 状态文件

编排器必须维护这些文件：

```text
待办/cc-connect-migration/artifacts/0.0-orchestrator-state.md
待办/cc-connect-migration/artifacts/0.0-orchestrator-log.md
待办/cc-connect-migration/artifacts/0.0-resume-prompt.md
待办/cc-connect-migration/artifacts/0.0-user-decisions.md
```

这些文件用于解决上下文压缩、中断、换会话、验收次数丢失的问题。

跨对话交接使用：

```text
待办/cc-connect-migration/orchestrator/HANDOFF_PROTOCOL.md
待办/cc-connect-migration/artifacts/0.0-latest-handoff.md
```

如果用户通过远程控制软件操作、不方便复制长文本，所有对话结束前都应更新 `0.0-latest-handoff.md`，让下一个对话直接读取这张纸条。

## 自动化边界

编排器能自动推进的内容：

```text
读取提示词
生成阶段产物
运行验收门
按验收问题修复产物
记录状态
进入下一阶段
```

编排器必须暂停并询问用户的内容：

```text
needs-user-confirmation
项目资产路径或 CC Connect 项目位置缺失
需要用户决定纳入 / 合并 / 替代 / 丢弃 / 暂缓
00A 裁决结果需要用户取舍
执行迁移代码前的最终确认
```

暂停、阻塞、等待用户确认或无人值守完成待用户检查时，编排器必须先更新 state/log/resume/summary，再按 `待办/cc-connect-migration/整体标准.md` 的“用户通知规则”发送 Bark 手机通知，并把通知结果写入 log。
