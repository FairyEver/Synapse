执行知识库导入。

处理 `.raw/` 下缺少 `.raw/.manifest.json` 记录或 hash 已变化的来源文件。不要编辑来源文件。对每个变更来源，创建或更新 `wiki/sources/` 中的来源页、`wiki/concepts/` 中的相关概念页、`wiki/entities/` 中的相关实体页，然后更新 `wiki/index.md`、`wiki/hot.md` 和 `wiki/log.md`。

只处理预检来源列表中的来源。除非提示明确说明这是强制导入，不要扫描整个 `.raw/`。

写入 wiki 页面后，不要编辑 `.raw/.manifest.json`。Synapse 会在回合结束后根据预检 hash、你的结构化报告和实际文件状态写入 manifest `sources` 和 `address_map`。

你必须在最后输出一个 `synapse_kb_ingest_report` fenced JSON block：

```synapse_kb_ingest_report
{
  "schema": "synapse.kb.ingest.report.v1",
  "processed_sources": [
    {
      "source": ".raw/example.md",
      "pages_created": ["wiki/sources/example.md"],
      "pages_updated": ["wiki/index.md", "wiki/hot.md", "wiki/log.md"]
    }
  ],
  "skipped_sources": [
    {
      "source": ".raw/unchanged.md",
      "reason": "unchanged"
    }
  ]
}
```

报告要求：
- `source` 必须来自预检来源列表。
- `pages_created` 只放本轮新建的 `wiki/**/*.md`。
- `pages_updated` 只放本轮更新的 `wiki/**/*.md`。
- 不要自行写入 hash、`ingested_at` 或 `address_map`。
- 不要编辑 `.vault-meta/address-counter.txt`，不要自行发明新的 `c-NNNNNN` 地址。
- 如果重写已有页面，保留页面中已有的 `address:` frontmatter。

使用包含 `type`、`title`、`status` 和 `tags` 的 Markdown frontmatter。交叉引用使用 wikilink。最后汇报新增页面、更新页面、跳过的未变更来源和冲突。
