执行知识库健康检查。

扫描 `wiki/`，检查失效 wikilink、孤立页面、缺失的必需 frontmatter、空章节、过期索引条目和缺失的交叉引用。

同时检查 `.raw/.manifest.json`：
- `sources` 是否使用 `.raw/...` key，是否记录 `hash`、`ingested_at`、`pages_created`、`pages_updated`。
- `address_map` 中的页面路径是否存在，地址是否唯一且稳定。
- wiki 页面 frontmatter 中的地址与 `address_map` 是否一致。

将报告写入 `wiki/meta/lint-report-YYYY-MM-DD.md`。除非用户明确要求，不要自动修复问题。
