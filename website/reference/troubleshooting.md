# 排障

<!-- Sources: website/start/install.md; website/start/repository.md; website/start/first-install.md; website/guide/concepts.md; website/guide/editors.md; website/advanced/diagnostics.md; website/team/share-review.md -->

## 安装包无法启动

macOS 如遇“无法打开，因为来自身份不明的开发者”提示，前往 **系统设置 → 隐私与安全性** 选择“仍要打开”。

Windows 如遇 SmartScreen 警告，选择“更多信息 → 仍要运行”。

安装包下载地址参见 [下载与安装](/start/install)。

## 无法查看仓库内容

确认 Settings 中配置的是仓库目录。仓库是 Synapse 读取和保存 Rule、Skill、Prompt 的来源目录；项目是运行和安装目标。

使用本地目录时，确认该目录已作为仓库添加。

使用 Git 仓库时，先将团队仓库 `git clone` 到本地，再在 Settings 中填入该目录路径。需要远端最新内容时，同步仓库。

## 安装按钮不可用

安装前将解析目标位置。目标状态可能是：

| 状态 | 含义 |
| --- | --- |
| `unsupported` | 当前编辑器或当前组合不支持 |
| `unavailable` | 缺少编辑器用户目录，或项目路径不存在 |
| `conflict` | Skill 目标位置已有同名目录，需要确认替换 |

选择项目级安装时，确认项目路径存在。安装对话框可选择设置中保存的项目，也可浏览其他目录。

Cursor 全局 Rule 目前不支持。可改用 Cursor 项目级 Rule，或选择其他支持全局 Rule 的编辑器组合。

## Agent 无法发送

确认已配置项目、agentType、provider 和模型。若会话绑定 Knowledge Base，确认 Knowledge Base storage root 可访问。

Agent 错误、权限请求和工具事件可在会话 timeline 中查看。需要排查本机环境时，先运行诊断并导出诊断包。

## Workflow 运行失败

先检查 Workflow 定义校验结果。prompt、switch、Codex 和 Claude Code 节点需要有效项目；prompt 和 switch 节点还需要 provider 和模型档位。

运行窗口会记录节点状态、错误和 token 用量。通过 MCP 修改定义后，应重新读取并校验定义。

## Automation 未触发

确认 Automation 已启用，trigger 配置有效，runtime inspect 中存在对应计时器或 webhook 状态。

若 executor 是 Workflow 或 Agent，继续检查目标 Workflow、项目、provider 和权限配置。

## 同步失败

Git 仓库同步执行 `git pull --ff-only --progress`。若本地或远端状态不允许 fast-forward，Git 将返回失败。

待同步推送遇到 non-fast-forward、rejected 或 fetch-first 等错误时，Synapse 先执行 `git pull --rebase`，再重试推送。

非 Git 目录不会执行 Git 同步，仅刷新本地内容索引。
