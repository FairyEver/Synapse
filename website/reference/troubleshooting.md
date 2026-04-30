# 排障

<!-- Sources: website/start/install.md; website/start/repository.md; website/start/first-install.md; website/guide/concepts.md; website/guide/editors.md; website/team/share-review.md; website/reference/downloads.md -->

## 安装包无法打开

macOS 如遇“无法打开，因为来自身份不明的开发者”提示，前往 **系统设置 → 隐私与安全性** 选择“仍要打开”。

Windows 如遇 SmartScreen 警告，点击“更多信息 → 仍要运行”。

安装包下载地址见 [下载](/reference/downloads)。

## 看不到仓库内容

先确认 Settings 中配置的是仓库目录。仓库是 Synapse 读取和保存 Rule、Skill 的来源目录；项目是安装目标目录。

如果使用本地目录，确认该目录已经作为仓库添加。若暂时没有团队仓库，可以先创建本地目录试用。

如果使用 Git 仓库，先将团队仓库 `git clone` 到本地，再在 Settings 中填入该目录路径。需要远端最新内容时，同步仓库。

## 安装按钮不可用

安装前会解析目标位置。目标状态可能是：

| 状态 | 含义 |
| --- | --- |
| `unsupported` | 当前编辑器或当前组合不支持 |
| `unavailable` | 缺少编辑器用户目录，或项目路径不存在 |
| `conflict` | Skill 目标位置已有同名目录，需要确认替换 |

如果选择项目级安装，确认项目路径存在。安装对话框可以选择设置中保存的项目，也可以浏览其他目录。

Cursor 全局 Rule 当前不支持。可以改用 Cursor 项目级 Rule，或选择其他支持全局 Rule 的编辑器组合。

## 同步失败

Git 仓库同步会执行 `git pull --ff-only --progress`。如果本地或远端状态不允许 fast-forward，Git 会返回失败。

待同步推送遇到 non-fast-forward、rejected 或 fetch-first 这类错误时，Synapse 会先执行 `git pull --rebase`，再重试推送。

非 Git 目录不会执行 Git 同步，只会刷新本地内容索引。
