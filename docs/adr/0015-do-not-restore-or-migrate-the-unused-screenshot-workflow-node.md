# 不恢复或迁移未被用户使用的截图工作流节点

经产品事实确认，已删除的 `screenshot_capture` 节点没有用户数据，因此工作流 schema 迁移不恢复该节点、不重新加入 `node-screenshots` 原生依赖、不增加兼容 fixture，也不为它设计迁移路径。该决定取代 ADR-0012。
