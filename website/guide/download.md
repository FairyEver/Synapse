# 下载与安装

Synapse 是原生桌面应用，安装包体积小，启动即用。

## 下载地址

所有版本统一在 GitHub Releases 发布：

<div class="download-actions">

👉 **[前往下载（SynapseAppRelease Releases）](https://github.com/FairyEver/SynapseAppRelease/releases)**

</div>

在 Releases 页面选择最新版本（顶部第一条），根据你的系统下载对应安装包：

| 操作系统 | 建议下载 |
| --- | --- |
| **macOS** | `.dmg` 文件 |
| **Windows** | `.exe` 安装程序 |
| **Linux** | 暂未提供官方安装包，可以关注后续版本 |

## 安装

### macOS

1. 双击下载好的 `.dmg` 文件；
2. 把 Synapse 图标拖到 Applications 文件夹；
3. 在 Launchpad 或 Applications 里打开 Synapse。

如果系统提示"无法打开，因为来自身份不明的开发者"，可以在 **系统设置 → 隐私与安全性** 里选择"仍要打开"。

### Windows

1. 双击下载的安装程序；
2. 按向导完成安装；
3. 从开始菜单或桌面快捷方式打开 Synapse。

如果 SmartScreen 警告，点击"更多信息 → 仍要运行"。

## 首次使用：三步上手

安装完成后，完成以下三步就能开始使用 Synapse：

### 第一步 · 配置仓库目录

打开软件后，前往 **Settings**，配置一个本地目录作为仓库。

- 如果团队已经建好了共享仓库，把它 `git clone` 到本地任意位置，把这个目录填进来；
- 如果暂时没有团队仓库，先建一个本地文件夹试用也可以，等熟悉后再接入 Git。

### 第二步 · 浏览 Rules 和 Skills

切到顶部的 **Rules** 或 **Skills** 标签，就能看到仓库里已有的内容：

- 左侧选分类筛选；
- 顶部搜索框全文检索；
- 点卡片进详情弹窗查看完整正文。

如果当前仓库还是空的，就先从创建你的第一个 Rule 开始。

### 第三步 · 装到你用的 AI 编辑器

找到一个好用的 Rule 或 Skill，点右侧按钮旁的下拉菜单，选你用的编辑器（Claude Code / Cursor / Codex），再选"全局"或"项目"即可。

装完重新打开 AI 编辑器，这条规则或能力包就会生效。

---

## 在哪里找到更多帮助

- 产品还有哪些能力？ → [功能特性](/guide/features)
- 使用中遇到问题？ → [常见问题](/guide/faq)
- 想看源码、参与开发？ → [GitHub 仓库](https://github.com/FairyEver/Synapse)
