# 配置内容仓库

<!-- Sources: desktop/electron/services/repository-store.ts; desktop/electron/services/repository-structure-service.ts; website/team/repository-structure.md -->

## 仓库定义

仓库是 Rule、Skill 和 Prompt 的本地来源。Synapse 从仓库目录读取内容，并以可浏览、可搜索、可安装的形式呈现。

仓库与项目不同：仓库提供内容资源，项目是编辑器安装、Agent、Workflow 和 Automation 的运行范围。

## 使用本地目录

本地目录适合个人试用或独立整理。在 **Settings** 中选择一个本地目录作为仓库。

未配置团队仓库时，可先创建本地目录，再接入 Git。

## 使用 Git 仓库

Git 仓库适合团队协作、版本追踪与审核流程。已有团队仓库时，先将其 `git clone` 到本地，再在 **Settings** 中填入该目录路径。

Synapse 会在内容创建、更新、删除、恢复和永久删除时生成普通 Git commit。远端平台、访问权限和备份策略由团队维护。

## 下一步

继续阅读 [安装第一个内容](/start/first-install)。
