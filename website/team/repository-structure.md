<!-- Sources: desktop/electron/services/repository-structure-service.ts; desktop/electron/services/repository-store.ts; desktop/electron/services/content-history-service.ts; desktop/electron/services/attachments-pool-service.ts; desktop/src/config/content-types/{index,types,rule,skill,prompt}.ts; desktop/src/types/content.ts -->

# 仓库结构

## 仓库目录

Synapse 仓库是一个本地目录。仓库记录包含 `uuid`、`name`、`localPath` 和 `contentDirs`，其中 `contentDirs` 用于将内容类型映射到目录名。

默认内容目录如下：

| 内容类型 | 默认目录 |
| --- | --- |
| Rule | `rules` |
| Skill | `skills` |
| Prompt | `prompts` |

初始化仓库结构时，Synapse 创建上述内容目录，以及 `system/users` 和 `system/blobs`。目录校验同时检查 `rules`、`skills`、`prompts`、`system/users` 和 `system/blobs` 是否存在。

每条内容保存在对应内容目录下的独立内容 ID 目录中。内容目录内包含 `meta.json` 和 `history/`；每个历史版本目录包含 `snapshot.json`、`main.md` 和 `attachments.json`。若内容使用图片图标，同时在内容目录下写入 `icon.png`。

附件文件不直接保存在内容历史目录中。附件内容按 SHA-256 存入 `system/blobs/<前2位>/<第3-4位>/<sha256>`，历史版本中的 `attachments.json` 记录原始文件名、SHA-256 和大小。

## Rules

Rule 的默认仓库目录是 `rules`，内容类型为 `rule`。Rule 支持正文、下载、复制和安装到编辑器，无需附件列表。

## Skills

Skill 的默认仓库目录是 `skills`，内容类型为 `skill`。Skill 支持附件，创建和更新时需要提供 `files` 附件列表。

## Prompts

Prompt 的默认仓库目录是 `prompts`，内容类型为 `prompt`。Prompt 支持正文、版本查看和 Content MCP 维护，不支持附件和编辑器安装。

## Git 仓库与本地目录

Synapse 先将仓库作为本地目录读取，检查目录是否存在，并判断该目录是否位于 Git 仓库内。

若目录不是 Git 仓库，内容写入后仅刷新本地索引。若目录是 Git 仓库，Synapse 使用检测到的 Git 根目录执行暂存和提交；仓库同步使用 `git pull --ff-only --progress`。

初始化 Git 仓库结构时，Synapse 暂存仓库目录范围内的结构改动，提交信息为 `[synapse] initialize repository structure`。若初始化后的推送失败，将本次推送记录到待同步队列。
