# 迁移产物目录

这个目录用于存放 CC Connect 迁移流程生成的正式产物。

命名规则：

```text
<阶段编号>.<产物序号>-<英文短名>.md
```

示例：

```text
1.1-source-inventory.md
1.2-feature-manifest.md
1.4-glossary-and-concept-map.md
2.1-synapse-product-baseline.md
2.2-product-design.md
3.2-data-compatibility-plan.md
3.3-permission-and-security-map.md
4.2-golden-test-cases.md
4.3-manual-acceptance-script.md
5.1-development-plan.md
5.3-decision-log.md
5.4-release-and-rollback-plan.md
```

除本 README 外，所有产物都应由对应阶段提示词生成或更新。

编排器状态文件使用 `0.0-*` 和 `0.<阶段编号>-validation-*` 命名，例如：

```text
0.0-orchestrator-state.md
0.0-orchestrator-log.md
0.0-resume-prompt.md
0.0-user-decisions.md
0.1-validation-attempt-1.md
0.1-validation-decision.md
```
