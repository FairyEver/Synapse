# Skill 列表可更新提示

日期：2026-05-21

## 概述

当用户已经把仓库中的 Skill 安装到编辑器后，如果仓库里的该 Skill 之后产生新版本，Skill 列表卡片应在安装状态区提示“可更新”。列表只展示聚合状态；详情里的安装状态面板继续展示具体哪个编辑器或项目需要更新。

## 用户确认的口径

- “有新版本”指仓库当前 Skill 版本比用户当时安装出去的版本新。
- 不按原作者判断，也不关心更新者是谁。
- 只要任意一个已安装位置落后，列表卡片就显示“可更新”。
- 选择列表方案 A：把提示放在卡片底部安装状态区，紧邻编辑器安装图标。

## 现状

- 列表卡片由 `desktop/src/modules/content/components/content-grid.tsx` 渲染。
- 卡片底部的 `ContentCardFooter` 已展示 `EditorInstallBadges` 和安装按钮。
- `InstallStatusProvider` 从 `window.synapse.installStatus.getAll()` 拉取 `InstallStatusMap`，目前只表达安装位置，不表达版本状态。
- `desktop/electron/services/install-status-cache-service.ts` 扫描编辑器目录并按 `contentId` 归集已安装项。
- Skill 安装目录已有 `.synapse.json`，当前只记录 `{ "id": detail.id }`。
- 详情页的 `EditorInstallStatusPanel` 已有 `needs_update` 状态文案，但 Skill 路径目前只按 `synapseContentId === contentId` 判断为 `installed`。

## 设计

### 安装元数据

Skill 安装时继续写 `.synapse.json`，并新增仓库版本字段：

```json
{
  "id": "skill-content-id",
  "repositoryVersion": "latest-history-dirname"
}
```

`repositoryVersion` 使用安装时 `detail.latestHistoryDirname`。它代表仓库当前快照版本，适合回答“这份安装是否来自当前仓库版本”。

兼容规则：
- 旧安装目录只有 `id` 时，先视为 `installed`，不在列表显示“可更新”。
- 用户重新安装或更新后，新的 `.synapse.json` 会写入 `repositoryVersion`，之后开始精确判断。
- `.synapse.json` 解析失败时保持现有扫描容错：该安装项不应让列表崩溃。

### 扫描和状态模型

扩展主进程扫描结果与缓存类型：

- `EditorScanSkillItem` 增加 `repositoryVersion: string | null`。
- `InstallStatusEntry` 增加 `status: "installed" | "needs_update"`。
- `InstallStatusMap` 仍按 `contentId` 聚合，避免改变渲染端调用方式。

缓存构建时需要知道仓库当前版本：

1. 扫描编辑器安装目录，读取每个 Skill 的 `.synapse.json`。
2. 对有 `synapseContentId` 的 Skill，查仓库当前 meta/detail 中的 `latestHistoryDirname`。
3. 如果安装元数据中的 `repositoryVersion` 存在且不同于仓库当前 `latestHistoryDirname`，标记该安装位置为 `needs_update`。
4. 其他情况标记为 `installed`。

如果仓库中找不到对应 `contentId`，不生成列表安装状态。这类孤儿安装仍由编辑器扫描页处理，不在仓库列表卡片中提示。

### 列表 UI

在 `EditorInstallBadges` 当前编辑器图标组旁增加一个 `Badge`：

- 有任意 entry 为 `needs_update` 时显示 `可更新`。
- 没有可更新项时保持现状，只显示安装编辑器图标。
- Badge 使用 shadcn `Badge`，`variant="secondary"`，不新增颜色。
- 文案只用“可更新”，不加解释段落。
- Badge 的 `title` 使用“已安装版本落后”，不增加额外可见文案。

卡片结构不改变：
- 仍在底部 footer 展示，和安装状态语义绑定。
- 不把提示放到标题旁，避免误解为仓库条目本身的独立状态。
- 不把主按钮直接改成“更新”，避免多编辑器/多项目时语义不清。

### 详情和操作

详情页安装状态面板继续使用现有 `needs_update` 行状态：

- Skill 的 `resolveForContent` 需要用 `.synapse.json.repositoryVersion` 与 `detail.latestHistoryDirname` 比较。
- `needs_update` 行的操作仍走现有安装流程，相当于重新安装当前仓库版本。
- 更新成功后刷新 install status cache，并推送 `install-status.changed`，列表 Badge 自动消失。

### 错误处理

- 扫描单个安装目录失败时记录 `logger.warn`，继续扫描其他目录。
- 仓库版本读取失败时不显示“可更新”，保守退回已安装状态。
- 不在 UI 中暴露内部版本号、历史目录名或解析失败细节。

## 不做的事

- 不做远程检查，不主动拉取作者仓库。
- 不比较安装目录的文件内容。
- 不用 `modifiedAt` 判断更新。
- 不在列表卡片上展开具体编辑器/项目明细。
- 不为旧安装目录批量回填版本元数据。

## 测试

- 安装 Skill 后 `.synapse.json` 包含 `id` 和 `repositoryVersion`。
- 仓库 Skill 更新后，已安装旧版本的列表卡片显示“可更新”。
- 重新安装当前版本后，“可更新”消失。
- 多个安装位置中只要一个落后，列表显示“可更新”。
- 旧 `.synapse.json` 只有 `id` 时仍显示已安装，不误报可更新。
- 详情页安装状态面板对 Skill 显示 `needs_update` 行。
