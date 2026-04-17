# Synapse UI 编写规则

## 0. 规范优先级

`doc/DESIGN.md` 是 Synapse 当前视觉与样式规范的最高优先级来源。

只要任务涉及以下任一内容，都必须先遵守 `doc/DESIGN.md`：

- 颜色
- 字体
- 字号
- 行高
- 间距
- 阴影
- 圆角
- 组件外观
- 页面结构
- 深浅主题切换

如果本文件与 `doc/DESIGN.md` 有冲突，以 `doc/DESIGN.md` 为准。

## 1. 目标

Synapse 的 UI 代码默认追求：

- 清晰
- 稳定
- 易扩展
- 易维护

默认基线是 shadcn/ui 当前 preset，而不是额外的品牌化视觉系统。

## 2. 当前视觉基线

当前仓库应统一落在同一套 shadcn 基线上：

- 以 `components.json` 中声明的 style preset 为准
- 以 `src/styles/globals.css` 中的 token 与字体导入为准
- app shell 与业务模块使用同一套颜色、边框、圆角、阴影与 focus 规则
- 不再维护独立的壳层品牌样式

如果任务没有明确要求重新设计，就不要主动添加新的视觉风格。

## 3. 组件优先级

优先级从高到低应为：

1. 现有共享组件
2. `src/components/ui/` 中的 shadcn/ui 组件
3. 通过组合已有组件得到的新业务组件
4. 最后才是必要的轻量自定义结构

能用现有组件完成，就不要手搓一套平行 UI。

## 4. Tailwind 使用边界

Tailwind 主要用于：

- 布局
- 间距
- 尺寸
- 响应式
- 溢出控制
- 轻量排版

推荐优先使用：

- `flex` `grid` `block` `hidden`
- `gap-*` `p-*` `px-*` `py-*` `m-*`
- `w-*` `h-*` `min-h-*` `max-w-*`
- `items-*` `justify-*`
- `overflow-*`
- `rounded-*`
- `text-sm` `text-base` `text-lg` `font-medium` `font-semibold`
- `bg-background` `text-foreground` `bg-card` `border-border` `bg-muted` `text-muted-foreground`
- `sm:` `md:` `lg:` `xl:`

默认避免：

- 与 shadcn preset 无关的硬编码颜色
- 大量任意阴影与圆角
- 渐变类
- 装饰性动画
- 装饰性 absolute/fixed 定位
- 很长的 `className` 串

## 5. shadcn/ui 使用规则

优先复用以下类型的组件：

- `Button`
- `Card`
- `Input`
- `Textarea`
- `Label`
- `Dialog`
- `Sheet`
- `Tabs`
- `DropdownMenu`
- `Tooltip`
- `Badge`
- `ScrollArea`
- `Separator`

规则：

- 默认保留组件基础视觉风格
- 先组合，再定制
- 不为了“更好看”随意改内部源码
- 需要新增组件时，优先通过 shadcn CLI 生成或严格对齐 CLI 输出
- 需要定制时，优先调整主题 token 或共享组件层，而不是在页面里零散覆盖

## 6. 页面结构顺序

实现页面时优先顺序应为：

1. 页面骨架
2. 状态流
3. 交互逻辑
4. 细节样式

不要先做花哨样式，再回头补结构和状态。

## 7. className 纪律

`className` 应做到：

- 短
- 稳定
- 可读
- 以布局类和 token 类为主

如果一个组件的 `className` 变得很长、重复、充满装饰性细节，优先考虑：

- 提炼成更小的组件
- 复用已有组件
- 减少不必要的视觉定制

## 8. 模块页面默认样式方向

业务模块页面默认应偏向：

- `Card` 分区
- 清晰标题与说明
- 简洁表单
- 列表与空状态
- 明确的主次操作按钮
- 与共享 preset 一致的中性色表面、边框、阴影和 focus ring

默认不应偏向：

- 海报式页面
- 页面级品牌包装
- 大量悬浮元素
- 复杂动效
- 纯展示型排版

## 9. 什么时候可以突破这些限制

仅在以下情况下，可以适度加入额外视觉处理：

- 用户明确要求重新设计
- 需要统一切换 preset 或主题
- 该样式直接服务于功能理解，而不是纯装饰

即使需要突破，也应保持克制，并优先复用已有 shadcn 基线。
