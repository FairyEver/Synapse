<!-- Sources: desktop/electron/services/content-write-service.ts; desktop/electron/services/content-history-service.ts; desktop/electron/services/attachments-pool-service.ts; desktop/electron/services/content-capability-validator.ts; desktop/electron/services/content-skill-source-service.ts; desktop/src/config/content-types/{types,rule,skill,prompt}.ts; desktop/src/types/content.ts -->

# 内容编写

## Rule 编写

创建 Rule 时，需要提供 `name`、`title`、`description`、`category`、`content` 和外观字段。Rule 正文写入 `main.md`。

`name` 是 Rule 的稳定标识，将写入当前版本的 `snapshot.json`。安装到编辑器时，该字段参与文件名或规则标识。

## Skill 编写

创建 Skill 时，需要填写与 Rule 相同的基础信息，并提供 `files` 附件列表。Skill 的主说明写入 `main.md`。

通过 Content MCP 创建 Skill 时，也可以使用 `sourceDirectoryPath` 导入本地 Skill 目录。此时 Synapse 会读取 Skill 主文件，并把目录内非隐藏文件作为附件导入；`files` 和 `sourceDirectoryPath` 不能同时提供。

## Prompt 编写

创建 Prompt 时，需要提供 `title`、`description`、`category`、`content` 和外观字段。Prompt 不需要 `name`，也不支持附件。

## 标题、简介与分类

内容创建和更新将校验 `title`、`description`、`category` 和 `content` 是否为非空字符串。

以下字段将进入当前历史版本：

| 字段 | 保存位置 |
| --- | --- |
| `title` | `snapshot.json` |
| `name` | `snapshot.json`，Rule 和 Skill 非空时保存 |
| `description` | `snapshot.json` |
| `category` | `snapshot.json` |
| `content` | `main.md` |

## 附件

仅 Skill 支持附件。附件路径先进行标准化：反斜杠转为 `/`，空路径段、`.` 和 `..` 被移除，Windows 不安全字符被替换，末尾的点和空格被移除。

附件实体按内容 SHA-256 写入 `system/blobs`。历史版本的 `attachments.json` 仅记录附件引用。

同一版本中附件文件名不能为空，也不能重复。

## 图片图标

当 `iconType` 为 `image` 时，Content MCP 接收 `iconImagePath` 或 `iconImageBase64`，二者只能提供一个。Synapse 会校验输入是否为图片，并将图片居中裁剪、缩放为 256 x 256 PNG 后保存为 `icon.png`。

图片输入最大 5 MB。若输入不是图片、为空或超过限制，写入会被拒绝。
