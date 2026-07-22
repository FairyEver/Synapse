# 文本提取使用单一格式中立能力

PDF 与 DOCX 的已有文本层提取属于同一个“文本提取”任务，对外读取使用 `app.text_extractor.document.extract` capability 和 `app_text_extractor_document_extract` MCP Tool。格式差异由能力包内部适配，对外结果统一返回规范化全文、格式和文件元数据；格式专属元数据保持可选。

需要把提取结果直接保存为本地文本文件时，使用组合 capability `app.text_extractor.document.extract_to_file` 和 MCP Tool `app_text_extractor_document_extract_to_file`。该入口必须在主进程内依次复用文本提取核心服务和文本写入文件核心服务，正文不得经过 MCP 响应或下一次 MCP 请求；响应只返回源文件与输出文件元数据。它不新增解析器，也不改变纯提取入口的只读语义。

首个可运行切片只接受 PDF，后续 App、DOCX、MCP 组合入口和 Workflow 入口必须复用同一核心服务、限制与错误契约，不得新增彼此独立的“PDF 解析”或“DOCX 解析”公共能力。文本提取不包含 OCR、语义改写、Unicode 兼容归一化或版面重建。
