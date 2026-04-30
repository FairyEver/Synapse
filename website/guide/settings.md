<!-- Sources: desktop/src/modules/settings/index.tsx; desktop/src/modules/settings/data.ts; desktop/src/modules/settings/types.ts; desktop/src/modules/settings/components/repository-list-editor.tsx; desktop/src/modules/settings/components/project-list-editor.tsx; desktop/src/modules/settings/components/identity-panel.tsx; desktop/src/modules/settings/components/about-panel.tsx; desktop/src/modules/settings/components/tools-panel.tsx; desktop/src/modules/settings/components/diagnostics-panel.tsx; desktop/src/modules/settings/components/log-export-panel.tsx -->

# 设置

## 仓库

“仓库”页的设置项是“本地仓库目录”。

可以选择现有文件夹加入仓库列表，也可以新建本地仓库。新建时需要填写仓库名称和保存位置。

已有仓库可以修改名称和路径，也可以从 Synapse 的仓库记录中删除。删除本地配置只会移除 Synapse 里的仓库记录，不会删除本地目录。

仓库列表还提供初始化入口。初始化会清空该目录下除 `.git/` 目录之外的内容，界面会先显示确认。

## 项目

“项目”页的设置项是“本地项目”。

可以添加项目，填写项目名称和项目路径；也可以浏览目录自动带入路径。已有项目可以修改或删除。

项目会出现在 Rule 和 Skill 的项目级安装流程中，作为可选择的目标目录。

项目列表还会显示飞书连接器入口：未配置时显示“添加连接器”，已配置时显示“连接器配置”。

## 用户信息

“通用”页包含“外观”和本地用户信息。

外观可选“浅色”“深色”“跟随系统”。本地用户信息显示“用户 ID（本地）”，支持复制，也支持通过“接续已有身份”打开身份接续流程。

## 更新

“关于”页显示 Synapse 标识、当前版本和软件更新状态。

可用操作会随状态变化：检查更新、取消下载、重启安装。下载中会显示下载进度；下载完成后提示重启后完成安装。

## 诊断入口

设置中有两个诊断相关入口。

“诊断”页可以运行诊断、导出诊断包、复制摘要。运行后会显示结论、本机信息、应用信息、当前上下文，以及兼容性和检查项。

“调试”页包含日志和诊断概览。日志支持导出全部日志、复制到剪切板、删除全部日志和打开日志目录；诊断概览可刷新并显示版本、单实例、Side-channel、Webhook、Relay、Feishu、平台、Windows 环境、PATH 和用户数据等状态。
