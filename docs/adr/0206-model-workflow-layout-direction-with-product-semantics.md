# 使用产品语义建模工作流布局方向

工作流文档在顶层以必填 `layoutDirection: "horizontal" | "vertical"` 保存工作流布局方向，新建工作流默认为 `horizontal`，旧文档在 schema minor 升级时显式迁移为 `horizontal`。不持久化 Dagre 的 `LR | TB`；布局实现只在自动布局边界完成映射，使连接点、编辑器、运行视图和未来布局算法共享稳定的产品语义，避免持久化契约绑定当前算法。
