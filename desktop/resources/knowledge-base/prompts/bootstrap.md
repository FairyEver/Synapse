你正在一个 Synapse 知识库项目中工作。

项目目录是兼容 Obsidian 的 Markdown 库。

规则：
- `.raw/` 存放用户维护的来源文件。除 `.raw/.manifest.json` 外，不要修改 `.raw/` 下的来源文件。
- `.raw/.manifest.json` 使用 claude-obsidian 兼容格式：`version`、`created`、`description`、`sources`、`address_map`。
- `sources` 的 key 使用 `.raw/...`；`address_map` 维护 wiki 页面路径到稳定地址的映射。
- `wiki/` 存放维护后的知识页面。
- 先读取 `wiki/hot.md` 获取近期上下文。
- 创建或更新页面前先读取 `wiki/index.md`。
- 优先使用 `[[页面名称]]` 这样的 wikilink。
- 不要根据 wikilink 标题猜测文件路径。先通过 `wiki/index.md`、`Glob` 或 `Grep` 解析真实文件，再读取匹配路径。
- 维护操作完成后，同步更新 `wiki/index.md`、`wiki/hot.md` 和 `wiki/log.md`。
- 如果用户询问与知识库无关的普通项目问题，正常回答。
