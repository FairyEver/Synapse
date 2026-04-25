# CC Connect 迁移自动编排启动提示词

把下面整段发送给 Codex，即可启动单会话编排。

```text
目标：自动编排 CC Connect 迁移到 3S 的前期产物生成、验收、修复、复验、裁决和收口流程。

角色与职责：
你是 CC Connect 迁移编排负责人。你的职责不是替代各阶段角色，而是按固定状态机调用已有阶段提示词，维护状态文件，确保流程可恢复、可验收、可停止。你必须把上下文写入 artifacts 文件，不能依赖当前会话长期记忆。

核心要求：

1. 不要一次性把所有提示词内容塞进上下文。每到一个阶段，只读取当前阶段提示词和它列出的输入文件。
2. 每完成一个动作，都更新：
   - 待办/cc-connect-migration/artifacts/0.0-orchestrator-state.md
   - 待办/cc-connect-migration/artifacts/0.0-orchestrator-log.md
   - 待办/cc-connect-migration/artifacts/0.0-resume-prompt.md
3. 每个阶段生成产物后，立即运行待办/cc-connect-migration/prompts/00-阶段验收门.md。
4. 如果验收 fail，回到当前阶段提示词修复产物，再验收。
5. 同一阶段最多 3 次普通验收 fail。第 3 次 fail 后，运行待办/cc-connect-migration/prompts/00A-验收争议裁决.md。
6. 如果裁决结论是 continue-fix，只修复裁决列出的阻塞问题。
7. 如果裁决结论是 pass-with-notes，记录 notes 后进入下一阶段。
8. 如果裁决结论是 needs-user-confirmation，暂停并向用户提出具体选择。
9. 如果任何阶段出现 needs-user-confirmation，暂停，不要自行拍板。
10. 如果上下文接近压缩、任务中断或需要用户稍后继续，确保待办/cc-connect-migration/artifacts/0.0-resume-prompt.md 足以恢复。

启动前检查：

1. 读取 待办/cc-connect-migration/整体标准.md。
2. 读取 待办/cc-connect-migration/使用方式.md。
3. 确认 待办/cc-connect-migration/prompts/ 下存在：
   - 00-阶段验收门.md
   - 00A-验收争议裁决.md
   - 01-功能全集盘点.md
   - 02-产品设计与信息架构.md
   - 03-迁移映射设计.md
   - 04-验收账本设计.md
   - 05-最终开发计划.md
   - 05A-开发计划完整性复核.md
   - 06-分批执行迁移.md
   - 07-收口审计.md
4. 如果 待办/cc-connect-migration/artifacts/ 不存在，创建它。
5. 如果 待办/cc-connect-migration/artifacts/0.0-orchestrator-state.md 已存在，先读取它并从记录的 next_action 恢复，不要从头开始。
6. 如果 state 不存在，按下面阶段顺序从 01 开始。

阶段顺序：

stage 01：
执行 待办/cc-connect-migration/prompts/01-功能全集盘点.md。
验收 待办/cc-connect-migration/prompts/00-阶段验收门.md。
目标产物：
- 待办/cc-connect-migration/artifacts/1.1-source-inventory.md
- 待办/cc-connect-migration/artifacts/1.2-feature-manifest.md
- 待办/cc-connect-migration/artifacts/1.3-open-questions.md
- 待办/cc-connect-migration/artifacts/1.4-glossary-and-concept-map.md

stage 02：
执行 待办/cc-connect-migration/prompts/02-产品设计与信息架构.md。
验收 待办/cc-connect-migration/prompts/00-阶段验收门.md。
目标产物：
- 待办/cc-connect-migration/artifacts/2.1-synapse-product-baseline.md
- 待办/cc-connect-migration/artifacts/2.2-product-design.md

stage 03：
执行 待办/cc-connect-migration/prompts/03-迁移映射设计.md。
验收 待办/cc-connect-migration/prompts/00-阶段验收门.md。
目标产物：
- 待办/cc-connect-migration/artifacts/3.1-migration-map.md
- 待办/cc-connect-migration/artifacts/3.2-data-compatibility-plan.md
- 待办/cc-connect-migration/artifacts/3.3-permission-and-security-map.md

stage 04：
执行 待办/cc-connect-migration/prompts/04-验收账本设计.md。
验收 待办/cc-connect-migration/prompts/00-阶段验收门.md。
目标产物：
- 待办/cc-connect-migration/artifacts/4.1-verification-ledger.md
- 待办/cc-connect-migration/artifacts/4.2-golden-test-cases.md
- 待办/cc-connect-migration/artifacts/4.3-manual-acceptance-script.md

stage 05：
执行 待办/cc-connect-migration/prompts/05-最终开发计划.md。
验收 待办/cc-connect-migration/prompts/00-阶段验收门.md。
目标产物：
- 待办/cc-connect-migration/artifacts/5.1-development-plan.md
- 待办/cc-connect-migration/artifacts/5.3-decision-log.md
- 待办/cc-connect-migration/artifacts/5.4-release-and-rollback-plan.md

stage 05A：
执行 待办/cc-connect-migration/prompts/05A-开发计划完整性复核.md。
验收 待办/cc-connect-migration/prompts/00-阶段验收门.md。
目标产物：
- 待办/cc-connect-migration/artifacts/5.2-development-plan-review.md

stage 06：
不要自动开始代码迁移，除非用户明确确认。
如果用户确认执行代码迁移，则按 待办/cc-connect-migration/artifacts/5.1-development-plan.md 分批执行 待办/cc-connect-migration/prompts/06-分批执行迁移.md。

stage 07：
当 06 完成后执行 待办/cc-connect-migration/prompts/07-收口审计.md。
目标产物：
- 待办/cc-connect-migration/artifacts/7.1-final-audit.md
- 待办/cc-connect-migration/artifacts/7.2-reverse-coverage-check.md

状态文件格式：

每次更新 待办/cc-connect-migration/artifacts/0.0-orchestrator-state.md 时，必须使用：

# CC Connect 迁移编排状态

当前阶段：
当前动作：
当前阶段验收次数：
最近结论：
阻塞问题：
需要用户确认：
已完成阶段：
已生成产物：
下一步动作：
恢复提示文件：
最后更新时间：

日志规则：

每次更新 待办/cc-connect-migration/artifacts/0.0-orchestrator-log.md 时，追加一条：

时间：
阶段：
动作：
输入：
输出：
结论：
下一步：

恢复提示规则：

每次更新 待办/cc-connect-migration/artifacts/0.0-resume-prompt.md 时，写入一段可以直接复制到新 Codex 对话的提示词。它必须包含：

1. 当前项目路径。
2. 需要读取的状态文件。
3. 当前阶段。
4. 下一步动作。
5. 已完成产物。
6. 若存在阻塞，列出阻塞问题。

开始执行：

现在先执行“启动前检查”。如果状态文件不存在，从 stage 01 开始。每完成一个阶段或遇到阻塞，都简短汇报当前阶段、结论和下一步。
```

