---
title: 定时任务环境变量
---

# 定时任务环境变量

Synapse 定时任务在独立进程中运行。本文说明 PATH 和环境变量的处理方式。

## 为什么需要关注 PATH？

macOS 应用程序启动时，`PATH` 只包含系统默认路径（`/usr/bin:/bin`）。通过 nvm、Homebrew、asdf 等工具安装的 `node`、`python`、`brew` 命令不在这个最小 PATH 中。

Synapse 默认通过登录 Shell 获取你的完整 PATH，自动合并到任务环境中。

## PATH 模式

在任务配置中，你可以选择 PATH 的处理方式：

### 合并（默认）

将你自定义的 PATH 条目与登录 Shell 的 PATH 合并，去除重复项。你的自定义条目排在前面。

适合大多数场景：任务可以找到 nvm/Homebrew 安装的工具，同时也能使用你额外指定的路径。

### 替换

使用你自定义的 PATH，不合并登录 Shell 的 PATH。

适合需要严格控制可执行文件搜索路径的场景。

## 登录 Shell

默认情况下，POSIX shell 以登录模式（`-lc`）运行，这会加载 `~/.profile`、`~/.bash_profile`、`~/.zshrc` 等配置文件，让 nvm/asdf 等工具的路径自动生效。

如果你取消勾选"以登录 Shell 执行"，shell 将以非登录模式（`-c`）运行，启动更快但 PATH 可能不完整。

> 此选项仅在 Shell 类型为 POSIX 时显示。

## 环境变量

在"环境变量"文本框中，每行写一个 `KEY=value`。这些变量会与系统允许的变量合并后传给任务进程。

Synapse 使用环境变量白名单机制，只传递必要的系统变量（如 `PATH`、`HOME`、`USER`、`SHELL`、`TMPDIR` 等）和你自定义的变量。

## 运行诊断

当任务执行失败时，结果面板底部会显示"诊断"区域，包含：

- **Shell**：实际执行的命令和参数
- **PATH**：传给进程的完整 PATH 条目列表
- **Env keys**：传给进程的环境变量名称

利用这些信息可以快速定位"命令找不到"等环境问题。

## 常见问题

### 任务报错 command not found

1. 确认 PATH 模式为"合并"
2. 确认"以登录 Shell 执行"已勾选
3. 在诊断区域检查 PATH 是否包含目标工具的安装目录

### nvm/asdf 安装的 node 找不到

nvm 和 asdf 需要在 shell profile 中初始化。确保：
- 使用 POSIX shell
- 登录 Shell 模式已启用
- `~/.profile` 或 `~/.zshrc` 中包含 nvm/asdf 的初始化脚本
