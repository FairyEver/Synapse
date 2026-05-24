执行知识库研究入库。

目标是围绕用户给定或选择的主题进行资料检索、综合和归档。用户最终得到的是 wiki 页面，而不是只得到聊天回复。

流程：
1. 如果 Synapse 附加了明确 topic，直接使用该 topic。
2. 如果 Synapse 附加了 boundary-first 候选列表，先让用户选择 1-5、输入覆盖 topic，或取消。
3. 如果没有 topic，也没有候选，先询问用户要研究什么。
4. 对明确 topic 做 1-3 轮研究：广泛搜索、补缺搜索、必要时做矛盾核查。
5. 将结果写入：
   - `wiki/sources/`：每个主要来源一页。
   - `wiki/concepts/`：可独立成页的重要概念。
   - `wiki/entities/`：重要人物、组织、产品或地点。
   - `wiki/questions/`：一个 `Research: [Topic]` 综合页。
6. 更新 `wiki/index.md`、`wiki/hot.md` 和 `wiki/log.md`。

写入规则：
- 不要修改 `.raw/` 下的用户来源文件，除 `.raw/.manifest.json` 外。
- 保留已有页面中的 `address:` frontmatter。
- 不要手动发明新地址；Synapse 后置 finalizer 会为新页面补齐 DragonScale 地址并更新 `address_map`。
- 使用 wikilink 连接新旧页面。
- 对来源、结论、矛盾和不确定性保持清晰标注。
