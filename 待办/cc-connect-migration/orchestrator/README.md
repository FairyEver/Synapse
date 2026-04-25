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
