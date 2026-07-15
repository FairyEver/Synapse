# 将旧 Claude Code Agent 配置迁移到内置供应商

旧 Prompt 和 Switch 节点中的 `agent: "claude-code"` 表示当时唯一的 Claude Code Agent Runtime，而当前工作流已固定使用该 runtime，只配置供应商和模型。因此迁移时删除旧 `agent` 字段；工作流尚无新版供应商配置时，将工作流默认供应商和模型补为 `local-claude-code` 与 `default`，已有新版配置则保持不变。遇到其它未知 `agent` 值时不猜测映射，保留原数据并报告迁移异常。
