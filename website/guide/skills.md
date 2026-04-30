<!-- Sources: desktop/src/modules/skills/index.tsx; desktop/src/modules/skills/types.ts; desktop/src/modules/skills/utils.ts; desktop/src/modules/skills/components/skill-create-dialog.tsx; desktop/src/modules/skills/components/skill-version-view.tsx; desktop/src/modules/content/components/content-browser-page.tsx; desktop/src/modules/content/hooks/use-content-download-actions.tsx; desktop/src/modules/content/components/content-install-dialog.tsx; desktop/src/config/content-types/skill.ts; desktop/electron/services/content-download-service.ts; desktop/electron/services/content-install-service.ts; desktop/src/definitions/editor/shared-skill-directory.ts; desktop/src/definitions/editor/*/{editor,adapter,install}.ts -->

# Skill

## 用途

Skill 是带主说明和附件的能力包。它适合保存比单段规则更完整的工作流，例如需要参考模板、样例文件或脚本的任务。

新建 Skill 时需要填写中文名称、名称、简介、分类和主说明。名称只能使用小写字母、数字、连字符，长度为 3-50 字符；安装到编辑器时会用作 Skill 目录名。

示例：

```md
阅读输入的接口说明，按附件里的模板生成 API 文档。
```

## 附件

Skill 可以添加附件。当前创建界面支持拖入文件或文件夹，也支持通过按钮选择文件或文件夹。

目录结构会保留到附件路径中。单个附件最大 10 MB；文件名为空、重复或超过大小限制的附件会被跳过或报错。

详情页会显示附件列表和附件大小。没有附件时显示“没有附件”。

## 浏览与搜索

Skill 页面会按分类展示内容，并提供搜索、排序、收藏、最近浏览和最近删除入口。

搜索会匹配标题、简介、创建者和修改者。排序选项包括最近修改、最近创建、名称 A-Z、名称 Z-A。

删除后的 Skill 会进入最近删除，可以恢复，也可以永久删除。

## 下载

Skill 支持下载到本地。下载时会打开保存对话框，默认文件名来自标题，扩展名为 `.zip`。

下载包会包含一个 `main.md` 主说明文件和全部附件。附件路径来自创建 Skill 时保存的附件名或目录结构。

## 安装

Skill 支持安装到编辑器。安装入口会先选择编辑器，再选择全局或项目范围；项目范围可以从已配置项目中选择，也可以浏览其他目录。

安装时，Synapse 会写入一个 Skill 目录。目录中包含 `SKILL.md`、Synapse 记录用的 ID 文件和全部附件。`SKILL.md` 会包含 Skill 名称和简介的 frontmatter，以及主说明正文。

不同编辑器的目标目录由当前编辑器定义决定：

| 编辑器 | 全局 | 项目 |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/{skillName}/` | `{projectPath}/.claude/skills/{skillName}/` |
| Codex | `~/.agents/skills/{skillName}/` | `{projectPath}/.agents/skills/{skillName}/` |
| Cursor | `~/.cursor/skills/{skillName}/` | `{projectPath}/.cursor/skills/{skillName}/` |
| Windsurf | `~/.codeium/windsurf/skills/{skillName}/` | `{projectPath}/.windsurf/skills/{skillName}/` |

安装 Skill 会整体替换目标目录中的现有内容。若目标位置已有同名 Skill，确认替换后旧目录会备份为 `-backup`。

如果主说明里包含变量占位符，安装前会进入变量替换确认；替换值可以继续保存到当前仓库变量。

## 什么时候用 Skill

当任务需要正文之外的文件材料时，用 Skill。

适合写成 Skill 的内容：

- 带模板的文档生成流程
- 带样例输入输出的分析流程
- 需要脚本或配置文件辅助的工作流
- 需要保留目录结构的参考资料包

如果只有一段文本规则，用 Rule。
