# 编排运行规则

## 1. 文件优先

编排过程中的任何重要状态都必须写入 artifacts。不要依赖会话记忆。

必须维护：

```text
0.0-orchestrator-state.md
0.0-orchestrator-log.md
0.0-resume-prompt.md
0.0-user-decisions.md
0.<阶段编号>-validation-attempt-<次数>.md
0.<阶段编号>-validation-decision.md
```

## 2. 渐进读取

不要一次性读取所有提示词和所有 artifacts。

每个阶段只读取：

```text
整体标准
当前阶段提示词
当前阶段提示词列出的输入文件
必要的状态文件
```

stage 01 的正式项目资产路径是：

```text
/Users/liyang/Desktop/code-guide/cc-connect-main
```

stage 01 必须扫描完整项目资产，包括 Go、Web、npm、daemon、config、core、README 和测试。不要只扫描 Go。

不要用 `.ai-runs` 摘要替代真实项目资产；历史摘要只能作为辅助线索或 candidate 参考。

## 3. 验收循环

每个阶段遵循：

```text
执行
验收
修复
验收
修复
验收
争议裁决
```

普通 fail 最多 3 次。

## 4. 停止点

遇到以下情况必须暂停：

```text
needs-user-confirmation
CC Connect 项目资产路径不明确
用户确认项没有决定
00A 裁决要求用户选择
即将进入 stage 06 代码迁移
```

## 5. 阶段边界

01 到 05A 只生成迁移产物，不写业务代码。

06 才允许改代码，并且必须由用户明确确认后开始。

## 6. 汇报方式

每个阶段完成后只汇报：

```text
当前阶段
生成或更新的 artifacts
验收结论
下一步
是否需要用户确认
```
