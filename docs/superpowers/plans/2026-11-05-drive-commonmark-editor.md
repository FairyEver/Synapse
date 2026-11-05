# Drive CommonMark Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 普通 Markdown 关闭 JSX 解析，正文与留言共用配置，保留编辑往返内容。

**Architecture:** 在现有 MDXEditor 兼容层处理 CommonMark HTML 节点并提供共用配置；`.mdx` 使用原路径。后端 Markdown 原文继续为权威数据。

**Tech Stack:** React 19、MDXEditor 4.0.4、Lexical、Vitest/jsdom。

**Spec:** `docs/superpowers/specs/2026-11-05-drive-commonmark-editor-design.md`

## Global Constraints

- 在当前目录和 main 分支执行，不新增依赖、不启动应用或浏览器。
- 只提交本次改动；已有其他任务改动不得混入提交。
- 保留 `.mdx`、评论定位、图片上传、版本保存和源码恢复契约。

## Review Focus

- 中文尖括号与尚未闭合标签不能触发 JSX 报错。
- 未支持的 HTML、注释和代码示例不能静默消失或被执行。
- 自动链接、泛型、相对图片与表格换行经过再次解析仍保留内容。
- 正文与留言都必须使用相同普通 Markdown 配置。
- `.mdx` 的 JSX、表达式和源码回退保持原有行为。

## Task 1: 共享兼容与消费入口

- [x] 新增真实编辑器往返测试，确认当前实现出现预期失败。
- [x] 在 `mdxeditor-commonmark-compatibility-plugin.ts` 处理标准 HTML，移除 JSX 专用的普通文本改写。
- [x] 共用普通 Markdown 编辑配置，并接入 `mdxeditor-renderer.tsx` 和 `drive-message-rich-composer.tsx`。
- [x] 更新受影响的兼容/评论/表格测试；运行专项测试至通过。

## Task 2: 验证与交付

- [x] 更新模块边界、原编辑器设计和待发布说明。
- [x] 运行 Dashboard 全量单元测试、`tsc`、`check:ui`。
- [x] 复查 diff 与暂存内容，创建仅包含本次改动的中文本地提交。

## 验证记录

- 修复前实际留言组件在 `<你好>` 输入下回退源码，新增回归测试按预期失败。
- 新增普通 Markdown 保存用例先复现 HTML 图片附加属性被正则丢弃，再将该改写限制到原 MDX 路径。
- 真实 MDXEditor 的 14 类输入经过导入、追加编辑、导出与重开均保留受测内容；留言组件使用真实编辑器验证。
- Dashboard：121 个文件、983 项单元测试通过；`tsc` 与 `check:ui` 通过。不启动应用或浏览器，不部署。
- 独立审查复现百分比图片尺寸被丢弃及带实体引号的图片地址被上游 HTML 导出器损坏；新增两个红绿往返回归，不安全提升的图片保留源码节点。
- 独立审查修复后复核无剩余阻断；最后全量复测 121 个文件、983 项测试通过。
