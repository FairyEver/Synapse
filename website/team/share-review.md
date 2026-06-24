<!-- Sources: desktop/electron/services/content-submission-service.ts; desktop/electron/services/content-write-service.ts; desktop/electron/services/repository-git-service.ts; desktop/electron/services/pending-pushes-service.ts; desktop/electron/services/repository-store.ts; desktop/src/types/content.ts; desktop/src/types/repository.ts -->

# 分享与审核

## 创建内容

创建 Rule、Skill 或 Prompt 时，Synapse 使用当前激活仓库和仓库身份保存内容。内容写入仓库目录，并生成新的内容 ID 与历史版本。

创建完成后，Synapse 记录 `id`、`type`、`title`、`latestHistoryDirname` 和 `modifiedAt`。若仓库不是 Git 仓库，Synapse 刷新内容索引并显示本地保存结果。

## 提交

若仓库位于 Git 仓库内，Synapse 先设置本地提交身份：

| Git 配置 | 值 |
| --- | --- |
| `user.name` | `Synapse Bot` |
| `user.email` | `bot@synapse.local` |

随后 Synapse 暂存本次变更涉及的文件，并创建提交。内容提交信息格式为：

```text
[synapse] <action> <type> <id前8位>
```

`action` 可取 `create`、`update`、`delete`、`restore` 或 `purge`。

创建、更新和恢复先保存并创建提交，随后将推送任务加入待同步队列。删除和永久删除先将提交加入待同步队列，再尝试推送；若推送成功，系统清除对应待同步记录。

## 冲突

更新、删除或恢复内容时，Synapse 检查 `baseHistoryDirname`。若当前最新历史版本与请求中的基础版本不同，并且请求未包含 `force`，结果将返回 `status: "conflict"`，同时返回最新版本目录名、修改时间和修改者显示名。

## 审核

Synapse 目前不内置单独的审核状态或审批队列。团队可使用 Git 平台审核 Synapse 创建的普通 Git commit。

## 同步

仓库同步检查本地目录状态。非 Git 目录刷新本地内容索引；Git 目录执行：

```text
git pull --ff-only --progress
```

待同步记录包含 `commitHash`、`action`、`targetId`、`title`、创建时间、重试次数和最后错误。执行待同步推送时，Synapse 按队列尝试 `git push`；遇到 non-fast-forward、rejected 或 fetch-first 等错误时，先执行 `git pull --rebase`，再重试推送。
