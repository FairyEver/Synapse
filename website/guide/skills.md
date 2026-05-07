<!-- Sources: desktop/src/modules/skills/index.tsx; desktop/src/modules/skills/types.ts; desktop/src/modules/skills/utils.ts; desktop/src/modules/skills/components/skill-create-dialog.tsx; desktop/src/modules/skills/components/skill-version-view.tsx; desktop/src/modules/content/components/content-browser-page.tsx; desktop/src/modules/content/hooks/use-content-download-actions.tsx; desktop/src/modules/content/components/content-install-dialog.tsx; desktop/src/config/content-types/skill.ts; desktop/electron/services/content-download-service.ts; desktop/electron/services/content-install-service.ts; desktop/src/definitions/editor/shared-skill-directory.ts; desktop/src/definitions/editor/*/{editor,adapter,install}.ts -->

# Skill

## 用途

Skill 是带主说明和附件的能力包，适用于保存比单段规则更完整的工作流，例如需要参考模板、样例文件或脚本的任务。

新建 Skill 时需要填写中文标题、标识名称、简介、分类、主说明和图标/图片。标识名称只能使用小写字母、数字、连字符，长度最多 64 字符，首尾必须是字母或数字；安装到编辑器时将作为 Skill 目录名。

示例：

```md
阅读输入的接口说明，按附件中的模板生成 API 文档。
```

## 附件

Skill 可添加附件。目前创建界面支持拖入文件或文件夹，也支持通过按钮选择文件或文件夹。

目录结构将保留到附件路径中。单个附件最大 10 MB；文件名为空、重复或超过大小限制的附件将被跳过或提示错误。

详情页显示附件列表和附件大小。没有附件时显示“没有附件”。

## 浏览与搜索

Skill 页面按分类展示内容，并提供搜索、排序、收藏、最近浏览和最近删除入口。

搜索匹配标题、简介、创建者和修改者。排序选项包括最近修改、最近创建、名称 A-Z、名称 Z-A。

删除后的 Skill 进入最近删除，支持恢复或永久删除。

## 下载

Skill 支持下载到本地。下载时打开保存对话框，默认文件名来自标题，扩展名为 `.zip`。

下载包包含一个 `main.md` 主说明文件和全部附件。附件路径来自创建 Skill 时保存的附件名或目录结构。

## 安装

Skill 支持安装到编辑器。安装流程需先选择编辑器，再选择全局或项目范围；项目范围可从已配置项目中选择，也可浏览其他目录。

安装时，Synapse AI Studio 写入一个 Skill 目录。目录中包含 `SKILL.md`、Synapse AI Studio 记录用的 ID 文件和全部附件。`SKILL.md` 包含 Skill 名称和简介的 frontmatter，以及主说明正文。

不同编辑器的目标目录由当前编辑器定义决定：

| 编辑器 | 全局 | 项目 |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/{skillName}/` | `{projectPath}/.claude/skills/{skillName}/` |
| Codex | `~/.agents/skills/{skillName}/` | `{projectPath}/.agents/skills/{skillName}/` |
| Cursor | `~/.cursor/skills/{skillName}/` | `{projectPath}/.cursor/skills/{skillName}/` |
| Windsurf | `~/.codeium/windsurf/skills/{skillName}/` | `{projectPath}/.windsurf/skills/{skillName}/` |

安装 Skill 将整体替换目标目录中的现有内容。重新安装同一 Skill 时将原子替换目标目录；若目标位置已有另一个同名 Skill，确认替换后旧目录将备份为 `-backup`。

若主说明中包含变量占位符，安装前将进入变量替换确认；替换值可继续保存到当前仓库变量。

## 适用场景

任务需要正文之外的文件材料时，使用 Skill。

适合使用 Skill 的内容：

- 带模板的文档生成流程
- 带样例输入输出的分析流程
- 需要脚本或配置文件辅助的工作流
- 需要保留目录结构的参考资料包

仅包含一段文本规则时，使用 Rule。
