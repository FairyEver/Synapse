# Pending Release Notes

## 新增功能

- 新增 WorkBuddy 技能与 MCP 集成，支持管理全局和项目 Skill，并将 Synapse MCP 注册到 WorkBuddy 用户配置。

## 功能优化

- 移除旧的 Synapse Release Summary Skill，避免 Agent Skill 列表出现两个相近的发版入口。
- 发版成功后的企业微信通知会展示版本号和分类更新内容；内容过长时自动拆分，并在最后保留一键更新入口。

## 问题修复

- 修复一次性评论数据迁移保护长期阻止后续正常数据库迁移的问题；部署切换中备份、迁移或启动失败时会自动恢复上一版服务。

## 技术调整
