# 待办

## Database 旧 schema 兼容清理

- 创建时间：2026-04-29
- 当前状态：暂时保留兼容逻辑
- 相关代码：
  - `desktop/electron/database/service.ts`
  - `desktop/electron/database/__tests__/service.test.ts`
  - `desktop/scripts/import-legacy-database.mjs`

### 背景

Synapse Database 的列元数据从旧的 `_meta_columns.enum_values` schema 升级到了当前的 `kind` / `choices` schema。

早前实现检测到旧 schema 后，会把旧数据库文件备份后创建一个新的空数据库。这会导致内测用户已有的数据表看起来像是丢失了。

当前运行时保留了三类兼容逻辑：

- 旧数据库文件仍是旧 schema：启动时迁移到 `synapse-database.db` 并原地升级 schema。
- 当前数据库为空且存在旧 legacy 备份：恢复最新 legacy 备份后再迁移。
- 手动导入数据库：允许导入旧 schema 备份，并在导入后迁移。

### 删除建议

不要立刻删除这些兼容逻辑。

- 旧 schema 原地迁移：保留到不再支持从修复前内测版本直接升级为止。
- 旧 legacy 备份自动恢复：至少保留到 2026-05-29，并且只有在一个发布周期内没有恢复报告或相关日志后再删除。
- 旧备份导入兼容：建议保留更久，因为用户可能很久以后才导入旧备份文件。

删除前必须用测试确认以下场景仍符合预期：当前 schema 数据库、旧 schema 数据库、legacy 备份恢复、旧备份导入。
