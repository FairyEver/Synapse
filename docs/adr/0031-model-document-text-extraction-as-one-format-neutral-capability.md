# 文档文本提取使用单一格式中立能力

PDF 与 DOCX 的已有文本层提取属于同一个“文档文本提取”任务，对外统一使用 `app.document_text_extractor.document.extract` capability 和 `app_document_text_extractor_document_extract` MCP Tool。格式差异由能力包内部适配，对外结果统一返回规范化全文、格式和文件元数据；格式专属元数据保持可选。

首个可运行切片只接受 PDF，后续 App、DOCX 和 Workflow 入口必须复用同一核心服务、限制与错误契约，不得新增彼此独立的“PDF 解析”或“DOCX 解析”公共能力。文本提取不包含 OCR、语义改写、Unicode 兼容归一化或版面重建。
