# Database

<!-- Sources: desktop/src/modules/database/index.tsx; desktop/src/modules/database/hooks/use-database.ts; desktop/src/modules/database/components/create-table-dialog.tsx; desktop/src/modules/database/components/data-table-view.tsx; desktop/src/modules/database/components/table-schema-sheet.tsx; desktop/src/modules/database/components/database-column-types.ts; desktop/electron/database/service.ts; desktop/electron/database/types.ts -->

## 能做什么

Database 提供本地数据表管理。你可以创建表、切换表、查看表结构、添加列、编辑表备注和列说明、编辑单选或多选字段的选项、增删改行、分页查看数据、筛选数据、导入导出表。

表会自动包含系统列 `id`、`created_at` 和 `updated_at`。自定义列支持文本、整数、小数、是/否、日期、时间戳、单选、多选、JSON 和二进制类型。

表格视图可以复制表结构，也可以复制当前页内容为 CSV 或 Markdown 表格，并支持下载 CSV 或 Excel 文件。表导出使用 Synapse 的表导出格式，导入同名表时会提示替换。

## 怎么使用

点击“新建表”，填写表名、可选描述和至少一个自定义列。表名和列名必须以英文字母开头，只能包含字母、数字和下划线。`id`、`created_at`、`updated_at` 是系统保留列，不需要也不能作为自定义列添加。

选择表后，在表格中新增、编辑或删除行。切换表、翻页、打开表结构、导出或筛选前，页面会先尝试保存当前未提交的行编辑。

在表结构弹窗中可以修改表备注、编辑列说明、添加新列。单选和多选列必须配置选项；已有单选或多选列可以打开选项编辑器调整选项。

点击导入会先检查待导入文件。如果文件中的表名已存在，确认后会删除本地同名表并导入文件中的数据。

## 注意事项

Database 每页查询 50 行。筛选条件支持 `=`、`!=`、`>`、`<`、`>=`、`<=`、`LIKE` 和 `CONTAINS`，并可按全部或任一条件组合。

表名和列名不能以下划线开头。Synapse 也会拒绝语义明显不匹配的列定义，例如把名称像多选字段的列建成普通文本或 JSON，或者把名称像布尔字段的列建成整数。

页面会监听 Database 变更事件，并在短暂延迟后刷新表列表、当前查询结果和表结构。读取失败时可以点击“重试”重新加载。
