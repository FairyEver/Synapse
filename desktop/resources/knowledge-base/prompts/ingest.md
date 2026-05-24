执行知识库导入。当前主对话是 ingest coordinator。

处理 `.raw/` 下缺少 `.raw/.manifest.json` 记录或 hash 已变化的来源文件。不要编辑来源文件。对每个变更来源，创建或更新 `wiki/sources/` 中的来源页、`wiki/concepts/` 中的相关概念页、`wiki/entities/` 中的相关实体页，然后更新 `wiki/index.md`、`wiki/hot.md` 和 `wiki/log.md`。

只处理预检来源列表中的来源。除非提示明确说明这是强制导入，不要扫描整个 `.raw/`。

并行处理规则：
- 如果预检来源较多，可以使用 Claude Code Agent 工具调用 `synapse-kb-ingest-worker`。
- 每个 worker 只能收到互不重叠的 `.raw/...` 来源列表。
- worker 只负责读取分配来源并写 `wiki/sources/` 下的来源页。
- worker 不得编辑 `wiki/index.md`、`wiki/hot.md`、`wiki/log.md`、`wiki/concepts/`、`wiki/entities/` 或 `wiki/questions/`。
- worker 不得输出最终 `synapse_kb_ingest_report`；最终报告只能由 coordinator 输出一次。
- coordinator 必须在 worker 完成后统一合并概念、实体、问题、索引、热点和日志页面。

写入 wiki 页面后，不要编辑 `.raw/.manifest.json`。Synapse 会在回合结束后根据预检 hash、你的结构化报告和实际文件状态写入 manifest `sources` 和 `address_map`。

图片来源规则：
- `.raw/images/...md` 是不可变 intake record。
- 读取其中的 attachment 路径后，用 Agent 图片读取能力抽取可见文字、图表结构、实体、概念和数据。
- 把持久描述写到 `wiki/sources/`，不要改写 `.raw/images/...md`。

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
- 如果使用 worker，把 worker 写入的 `wiki/sources/` 页面和 coordinator 写入的共享页面汇总进同一个最终报告。

使用包含 `type`、`title`、`status` 和 `tags` 的 Markdown frontmatter。交叉引用使用 wikilink。最后汇报新增页面、更新页面、跳过的未变更来源和冲突。
