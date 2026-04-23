---
name: testing
paths:
  - desktop/src/**/*.test.*
  - desktop/electron/**/*.test.*
  - desktop/src/**/*.spec.*
  - desktop/electron/**/*.spec.*
---

# 测试规则

## 重点测试区域

- Git 推送流程（冲突、中断、恢复）
- 目录监控（文件变更检测）
- 自动更新下载
- 搜索性能（Fuse.js 大数据集）
- 编辑器安装（各 adapter 的文件写入）

## 测试原则

- 网络/文件 IO 相关测试必须覆盖异常路径
- IPC handler 测试验证参数校验和错误返回
- 渲染进程组件测试关注用户交互流程，不测实现细节
- 不 mock 能直接测的东西；只在隔离外部依赖时 mock

## 运行方式

- 测试命令使用 `--run` 模式（单次执行），不用 watch 模式
- Electron 主进程测试和渲染进程测试分开运行
