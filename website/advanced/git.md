# Git

<!-- Sources: desktop/src/modules/git/index.tsx; desktop/src/modules/git/lib/git-remote.ts; desktop/electron/services/git-client -->

## 功能范围

Git 系统 App 用于检查仓库状态、提交、同步和处理常见远端错误。它服务 Synapse 内容仓库，不替代完整 Git 客户端。

Git provider 识别覆盖 GitHub、Gitee 和 GitLab 等常见远端。界面可根据远端类型给出 SSH key、token 或仓库页面入口。

## 仓库操作

内容仓库位于 Git 仓库内时，Synapse 在创建、更新、删除、恢复和永久删除内容时生成普通 Git commit，并将待推送记录加入队列。

同步使用 fast-forward pull。待推送遇到 non-fast-forward、rejected 或 fetch-first 时，Synapse 会先 rebase，再重试 push。

## 注意事项

Git 操作失败会被归类为认证、远端访问、工作树状态、路径或未知错误。排障时优先查看 Git 系统 App 和诊断日志。
