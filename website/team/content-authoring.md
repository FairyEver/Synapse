<!-- Sources: desktop/electron/services/content-write-service.ts; desktop/electron/services/content-history-service.ts; desktop/electron/services/attachments-pool-service.ts; desktop/src/types/content.ts; desktop/src/config/content-types/{types,rule,skill}.ts; desktop/src/lib/content-attachments.ts -->

# 内容编写

## Rule 编写

创建 Rule 时，需要提供 `title`、`name`、`description`、`category`、`icon`、`iconBg`、`iconType`、`iconImage` 和 `content`。当 `iconType` 不是 `image` 时，`icon` 和 `iconBg` 也必须填写。

Rule 正文写入 `main.md`。写入时会去掉正文首尾空白，并保证文件以换行结尾。

`name` 是 Rule 的标识名称字段，会写入当前版本的 `snapshot.json`。如果写入时为空白，快照中不会保留该字段。

## Skill 编写

创建 Skill 时，需要填写与 Rule 相同的基础信息，并提供 `files` 附件列表。Skill 的主说明同样写入 `main.md`。

Skill 的附件来自 `files`。每个附件记录包含 `originalName`、`size`，以及可选的 `sha256` 和 `bytes`。添加新附件时，Synapse 会检查文件名、大小和重复路径；已有附件可以通过 `sha256` 继续引用。

## 标题、简介与分类

内容创建和更新会校验 `title`、`description`、`category` 和 `content` 是否为非空字符串。

这些字段会进入当前历史版本：

| 字段 | 保存位置 |
| --- | --- |
| `title` | `snapshot.json` |
| `name` | `snapshot.json`，非空时保存 |
| `description` | `snapshot.json` |
| `category` | `snapshot.json` |
| `content` | `main.md` |

写作时可以把 `title` 用作面向用户的标题，把 `description` 写成简短说明，把 `category` 保持为可分类检索的文本。Synapse 会检查这些必填项是否填写完整。

## 附件

只有 Skill 支持附件。附件路径会先标准化：反斜杠会转为 `/`，空路径段、`.` 和 `..` 会被移除，Windows 不安全字符会被替换，末尾的点和空格会被去掉。

附件实体按内容 SHA-256 写入 `system/blobs`。历史版本的 `attachments.json` 只记录附件引用：

```json
{
  "schemaVersion": 1,
  "files": [
    {
      "originalName": "examples/input.md",
      "sha256": "<sha256>",
      "size": 1234
    }
  ]
}
```

同一版本中附件文件名不能为空，也不能重复。
