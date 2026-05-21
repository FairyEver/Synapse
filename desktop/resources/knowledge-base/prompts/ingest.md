执行知识库导入。

处理 `.raw/` 下缺少 `.raw/.manifest.json` 记录或 hash 已变化的来源文件。不要编辑来源文件。对每个变更来源，创建或更新 `wiki/sources/` 中的来源页、`wiki/concepts/` 中的相关概念页、`wiki/entities/` 中的相关实体页，然后更新 `wiki/index.md`、`wiki/hot.md` 和 `wiki/log.md`。

只处理预检来源列表中的来源。除非提示明确说明这是强制导入，不要扫描整个 `.raw/`。

写入 wiki 页面后，为每个已处理来源更新 `.raw/.manifest.json`，写入提供的 sha256 hash、ISO 格式的 `ingested_at`、`pages_created` 和 `pages_updated`。

使用包含 `type`、`title`、`status` 和 `tags` 的 Markdown frontmatter。交叉引用使用 wikilink。最后汇报新增页面、更新页面、跳过的未变更来源和冲突。
