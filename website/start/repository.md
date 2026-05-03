# 配置内容仓库

<!-- Sources: website/guide/concepts.md; website/guide/download.md -->

## 仓库定义

仓库是 Rule 和 Skill 的本地来源。Synapse 从仓库目录读取内容，并以可浏览、可搜索的形式呈现。

仓库与项目不同：仓库提供 Rule 和 Skill，项目是安装目标。

## 使用本地目录

本地目录适合个人试用或独立整理。在 **Settings** 中选择一个本地目录作为仓库。

如暂未配置团队仓库，可先创建本地目录用于试用，再接入 Git。

## 使用 Git 仓库

Git 仓库适合团队协作、版本追踪与审核流程。已有团队仓库时，先将其 `git clone` 到本地，再在 **Settings** 中填入该目录路径。

Synapse 本身不托管内容，Git 平台选择、权限管理和备份策略由团队自行决定。

## 下一步

继续阅读 [安装第一个内容](/start/first-install)。
