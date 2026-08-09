# Skill

<!-- Sources: desktop/src/modules/skills/index.tsx; desktop/src/config/content-types/skill.ts; desktop/electron/services/content-write-service.ts; desktop/electron/services/content-skill-source-service.ts -->

## 用途

Skill 是由主说明和附件组成的能力包。适合保存需要文件材料配合的工作说明。

## 附件

Skill 可包含文件或文件夹附件。目录结构会被保留，安装后写入 Skill 目录。

附件内容按 SHA-256 写入仓库的 `system/blobs`，历史版本中的 `attachments.json` 记录附件引用。

## 浏览与搜索

Skill 位于资源仓库 App。页面支持按分类浏览、关键词搜索、收藏、最近浏览、最近删除和版本查看。

## 下载

Skill 下载为 `.zip` 文件，包含主说明文件和全部附件。

## 安装

Skill 支持安装到 Antigravity、Claude Code、Codex、Cursor、Hermes、Windsurf 和 WorkBuddy。安装时选择编辑器和安装范围。

全局安装写入编辑器用户目录。项目级安装写入所选项目目录。

## 适用场景

Skill 适合保存：

- 多文件提示材料
- 模板和示例
- 脚本或配置文件
- 较长参考资料
- 可复用工作说明

仅需一段 Markdown 指令时，使用 [Rule](/guide/rules)。
