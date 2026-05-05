# Editor Scan（编辑器扫描）

<!-- Sources: desktop/src/modules/editor-scan/index.tsx; desktop/src/modules/editor-scan/components/editor-scan-sidebar.tsx; desktop/src/modules/editor-scan/components/global-overview.tsx; desktop/src/modules/editor-scan/components/project-overview.tsx; desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx; desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx; desktop/src/modules/editor-scan/lib/quick-publish.ts; desktop/src/types/editor-scan.ts; desktop/src/lib/editor-registry.ts; desktop/electron/services/editor-scan-service.ts -->

## 功能范围

Editor Scan 扫描已注册编辑器的全局和项目级 Skill / Rule，并按编辑器、内容类型和作用域展示结果。侧栏按编辑器列出扫描摘要；未检测到编辑器配置目录时显示未检测状态。

全局视图展示选中编辑器的全局 Skill 或 Rule。项目视图遍历已配置项目，并展示每个项目下选中编辑器的 Skill 或 Rule；项目路径不存在时标记“路径不存在”。

选择扫描项后可查看详情。详情中显示名称、来源、类型、路径、元数据和正文预览，并支持渲染视图和源码视图。扫描项支持复制内容、在 Finder 中显示、导入到仓库、查看已关联仓库内容、复制到其他编辑器，或在支持时移动到系统废纸篓。

## 使用方式

选择左侧编辑器后，在顶部切换 Skill / Rule，再切换全局 / 项目。选择刷新按钮可重新扫描。

打开扫描项详情后，若该项未关联仓库内容，可选择“导入到仓库”。Rule 从正文和 frontmatter 生成创建表单初始值；Skill 读取主说明文件和附件后生成创建表单初始值。

若扫描项已关联仓库内容，主操作将打开对应仓库内容详情。若关联内容已删除或不可用，页面将提示可作为新内容导入。

选择“复制到编辑器”后，系统要求选择目标编辑器和全局或项目作用域，再将当前扫描项复制到目标位置；若目标已存在，则要求确认覆盖。

## 注意事项

Skill 主文件优先按 `SKILL.md`、`skill.md`、`README.md`、`readme.md`、`index.md` 查找。目录中带 `.synapse.json` 且包含内容 ID 的 Skill 标记为 Synapse 来源，否则标记为外部来源。

Quick Publish 读取 Skill 附件时跳过隐藏文件、主说明文件、`.synapse.json` 和符号链接。单个附件超过 10MB、附件总大小超过 50MB、附件数量超过 200 个，或附件名属于敏感密钥文件时，导入草稿将失败。

移动到废纸篓前，系统检查写入权限并记录审计。部分 Rule 若没有明确边界，将显示不支持移动到废纸篓，需要在 Finder 中处理。
