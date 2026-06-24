# Drive

<!-- Sources: desktop/src/modules/drive/index.tsx; desktop/synapse-capabilities/shared/drive-domain.ts; server/src/drive; shared/src/urls.ts -->

## 功能范围

Drive 提供云盘文件和文件夹管理。桌面端可浏览目录、上传文件或文件夹、创建文件夹、重命名、移动、删除、恢复、查看用量，并生成分享链接。

文件支持预览、文本内容读取、下载、版本列表、历史版本下载、版本恢复、版本删除和版本保留状态更新。文件夹支持打包下载。

## 分享与站点

Drive share 生成 `/share/...` 访问链接，可按当前服务端能力配置访问范围、过期时间和密码。

Drive site 可把 Drive 文件夹发布为只读站点，路径形如 `/sites/<siteId>/`。站点支持创建、列表、访问设置更新、停用、删除和重新发布。

## MCP 能力

Drive MCP 暴露 item、file、folder、share、site、usage、stats、tree、path ensure、reorganization、direct link、trash 和 restore 能力。

整理云盘时，Agent 应先读取统计和树结构，再确保目标目录，随后生成整理计划并按 `planId` 应用。

## 注意事项

Drive MCP 不提供批量读取文件正文的接口。需要判断内容时，应少量、逐个读取可预览文本文件。
