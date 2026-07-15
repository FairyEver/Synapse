---
status: superseded by ADR-0016
---

# 恢复 file_conversion 为隐藏的工作流兼容节点

在尚无语义等价的新工作流节点可供迁移时，`file_conversion` 恢复为 deprecated 兼容节点：它不出现在新建节点面板中，但已有工作流仍可加载、查看、验证和运行。不把该节点强行改写为语义不等价的现有节点；只有未来提供等价替代能力、新的 schema 迁移和历史 fixture 验证后才能删除该兼容节点。
