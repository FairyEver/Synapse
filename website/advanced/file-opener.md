# File Opener

File Opener 把一个已有本机普通文件提交给操作系统的默认应用。系统 App、MCP、Workflow 和应用深链共用 `app.file_opener.file.open`。

## MCP

工具名为 `app_file_opener_file_open`，参数为一个绝对路径：

```json
{ "path": "/Users/me/Documents/report.docx" }
```

## Workflow

节点类型为 `file_opener_file_open`，配置为 `{ path, variables }`。节点输出和 `outputs.path` 都是提交给系统的绝对路径。

## 应用深链

格式为：

```text
synapse://app/file-opener/open?path=<percent-encoded-absolute-path>
```

macOS 示例：

```text
synapse://app/file-opener/open?path=%2FUsers%2Fme%2FDocuments%2Freport.docx
```

Windows 示例：

```text
synapse://app/file-opener/open?path=C%3A%5CUsers%5Cme%5CDocuments%5Creport.docx
```

HTML 示例：

```html
<a href="synapse://app/file-opener/open?path=%2FUsers%2Fme%2FDocuments%2Freport.docx">打开报告</a>
```

`path` 必须经过 URL 编码，并且目标文件必须存在于运行 Synapse 的本机。链接不支持 URL、目录、符号链接、多个文件或指定应用。

应用深链不会触发 Synapse 二次确认，也不使用签名、Origin 或来源可信性校验。只有 App manifest 通过 `deepLinks` 显式声明的 Action 才能被分发，Action 名和参数仍按 Schema 校验。

成功仅表示操作系统接受了打开请求，不保证外部应用已经启动、聚焦或完成文件加载。
