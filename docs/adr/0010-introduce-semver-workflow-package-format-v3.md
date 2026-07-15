# 新工作流包使用稳定格式名和 SemVer 格式版本

新导出包使用稳定格式名 `synapse-workflow-package` 和独立的 SemVer `formatVersion`，首个版本为 `3.0.0`；新版继续导入旧 `synapse-workflow-package-v1` 和 `v2`，但新导出不再复用已发布的 v2 标识。这使旧客户端能明确拒绝不理解的新包，避免裁掉工作流 schema 版本或新字段后静默保存。包格式版本仅描述容器契约，包内工作流的迁移仍由独立的工作流 schema 版本驱动。
