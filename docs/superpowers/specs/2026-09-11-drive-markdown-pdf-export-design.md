# Drive Markdown PDF 导出设计

## 产品边界

- 本人云盘和有效分享浏览页都可从 Markdown 文件的更多菜单导出 PDF。
- PDF 只包含请求时刻的服务端 Markdown 正文快照，不包含工具栏、目录、评论、批注或本地未保存内容。
- 导出同步完成并直接下载，不创建任务、数据库记录、历史版本或长期缓存。
- 版式固定为 A4 浅色、16 mm 页边距，复用当前 GitHub Markdown CSS、分级有序列表和 Mermaid 规则。

## 权限与快照

- owner 接口复用文件归属校验。
- share 接口复用启用、过期、密码 Cookie、根文件和文件夹子树校验；未解锁继续返回 `DRIVE_SHARE_UNLOCK_REQUIRED`。
- 已载入的实时协作文档使用请求时刻的 Yjs 文本；否则读取当前 Drive 对象。导出不触发 checkpoint。
- Markdown 上限 10 MiB；每个用户或匿名分享 IP 每分钟最多 5 次。

## 图片边界

- API 根据 Markdown Projection 的 `resourceKey` 去重和解析图片，并在交给渲染器前全部转换为 data URI。
- 相对图片只能读取同一 owner 的 Drive 对象；分享场景还必须位于分享文件夹子树内。单文件分享沿用现有相对图片授权集合。
- `/object/*` 复用 Document Hosted Image；`/files/*` 复用 Public Asset；data URI 必须通过受支持位图格式的文件签名校验。
- HTTP/HTTPS 只允许 80/443，最多三次重定向。每跳重新解析 DNS，只固定到公开 IP，禁止凭据、私网、回环、链路本地、保留地址和元数据地址；不转发 Cookie、Authorization 或 Referer。
- SVG 和失效、超时、格式不符的图片显示不含原 URL 的占位；超出单图 10 MiB 或图片合计 64 MiB 时拒绝导出。唯一图片最多 256 个。

## 渲染服务

- `@synapse/pdf-renderer` 是独立 Chromium 服务，只接受共享密钥保护的 `{ schemaVersion: 1, title, html }`。
- 浏览器进程复用，每次请求创建独立 context/page；并发 2、排队 8，队列满返回 429。
- 页面网络请求全部阻断。容器仅连接 internal network，以非 root、只读文件系统、临时目录、`no-new-privileges` 和 CPU/内存/PID 限制运行。
- 输出最大 64 MiB，总导出超时 60 秒。API 将渲染器不可用映射为 502，超时映射为 504。

## 响应与可观测性

- 成功响应为 `application/pdf`、`Content-Disposition: attachment` 和 `Cache-Control: private, no-store`。
- `X-Synapse-Pdf-Image-Warnings` 与 `X-Synapse-Pdf-Diagram-Warnings` 返回占位数量，网页端在下载后提示。
- 网页端记录 `web.drive.preview.export-pdf` 的成功、失败和耗时；正文、图片 URL、Cookie 与内部密钥不得进入日志或埋点。

## 部署不变量

- API 与 PDF 渲染器使用相同发布标签构建、启动、健康检查和回滚。首次引入渲染器时须在停止旧 API 前验证新容器；若切换失败且没有旧渲染器，回滚应删除新渲染器并以 `--no-deps` 恢复旧 API。
- `PDF_RENDERER_URL` 与 `PDF_RENDERER_INTERNAL_SECRET` 必须经过生产环境校验，密钥不得复用其它服务密钥。
- 本功能不注册 MCP capability，不修改能力注册表。
