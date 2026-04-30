<!-- Sources: desktop/src/modules/rules/index.tsx; desktop/src/modules/rules/utils.ts; desktop/src/modules/rules/components/rule-create-dialog.tsx; desktop/src/modules/content/components/content-browser-page.tsx; desktop/src/modules/content/hooks/use-content-download-actions.tsx; desktop/src/modules/content/components/content-install-dialog.tsx; desktop/src/config/content-types/rule.ts; desktop/electron/services/content-download-service.ts; desktop/electron/services/content-install-service.ts; desktop/src/definitions/editor/*/{editor,adapter,install,forms}.ts* -->

# Rule

## 用途

Rule 是一段可安装到编辑器的 Markdown 正文，用来保存可复用的工作规则、写作规范或行为约束。

新建 Rule 时需要填写标题、名称、简介、分类、正文和图标/图片。名称只能使用小写字母、数字、连字符，长度最多 64 字符，首尾必须是字母或数字；安装到编辑器时会用作文件名或规则标识。

示例：

```md
提交代码前先运行类型检查；不要提交临时调试输出。
```

## 浏览与搜索

Rule 页面会按分类展示内容，并提供搜索、排序、收藏、最近浏览和最近删除入口。

搜索会匹配标题、简介、创建者和修改者。排序选项包括最近修改、最近创建、名称 A-Z、名称 Z-A。

删除后的 Rule 会进入最近删除，可以恢复，也可以永久删除。

## 下载

Rule 支持下载到本地。下载时会打开保存对话框，默认文件名来自标题，扩展名为 `.md`。

下载内容只包含 Rule 正文。

## 安装

Rule 支持安装到编辑器。安装入口会先选择编辑器，再选择全局或项目范围；项目范围可以从已配置项目中选择，也可以浏览其他目录。

不同编辑器的写入方式由当前编辑器定义决定：

| 编辑器 | 全局 | 项目 |
| --- | --- | --- |
| Claude Code | `~/.claude/rules/{name}.md` | `{projectPath}/.claude/rules/{name}.md` |
| Codex | `$CODEX_HOME/AGENTS.md`，未设置时为 `~/.codex/AGENTS.md` | `{projectPath}/AGENTS.md` |
| Cursor | 不支持全局 Rule 安装 | `{projectPath}/.cursor/rules/{name}.mdc` |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` | `{projectPath}/.windsurf/rules/{name}.md` |

Codex 和 Windsurf 的全局 Rule 会写入同一个规则文件中的 Synapse 标记区块。Claude Code、Cursor 和 Windsurf 的项目 Rule 会写入独立文件。

项目安装时，部分编辑器会要求填写规则元数据：Claude Code 可填写 `paths`，Cursor 可填写 `description`、`globs` 和 `alwaysApply`，Windsurf 可选择 `trigger` 并按模式填写 `description` 或 `globs`。

如果正文里包含变量占位符，安装前会进入变量替换确认；替换值可以继续保存到当前仓库变量。

## 什么时候用 Rule

当规则只需要一段文本就能表达时，用 Rule。

适合写成 Rule 的内容：

- 代码风格约束
- 提交流程要求
- 输出格式规范
- 固定审查清单

如果需要附带模板、示例文件、脚本或参考资料，用 Skill。
