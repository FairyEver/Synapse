# agent-6-1778952188-f1x 第 1 轮

- 时间：2026-05-17 18:40
- 方向：模块 UI（Direction C — app-shell/logging.ts）
- 结果：修复
- 问题：emitRendererLog 的 .catch(() => {...}) 不捕获错误参数，bridge.write 失败时实际错误被丢弃，调试时日志无声丢失
- 修改文件：desktop/src/app-shell/logging.ts
- 验证：tsc --noEmit 通过，check:hard-constraints 通过
