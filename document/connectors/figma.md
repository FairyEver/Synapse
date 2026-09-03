# Figma 连接器

Figma 连接器把当前 Figma 文件的设计上下文注入 Synapse 新建的 Agent 对话。它连接的是 Figma Desktop 的本地 MCP 服务（`http://127.0.0.1:3845/mcp`），不需要 OAuth 或 Bearer Token。

## 能力边界

Synapse 使用 Figma Desktop MCP 的本地、读取型工具和 MCP Prompt：

- 可以读取设计结构、变量和样式、截图、动效以及 FigJam 选区，并据此生成代码或规则建议。
- 可以生成 Code Connect 映射提案，但不会从 Synapse 发布映射。
- 不支持从 Synapse 创建、修改、上传或发布 Figma、FigJam、Slides 文件，也不会写入 Figma 画布。

Figma 官方文档同时介绍了 Remote MCP 及其写入画布、导出资源、搜索设计库等能力。例如 `use_figma`、`create_new_file`、`generate_figma_design`、`generate_diagram`、`upload_assets` 和 `download_assets` 等 Remote-only 工具不属于 Synapse 的 Desktop 连接器；看到相关示例时，请先确认使用的是哪一种 MCP Server。

连接器状态和 Figma MCP 只注入新建的 Agent 对话。启用或关闭连接器不会改变已经创建的对话。

## 准备 Figma

1. 安装并打开最新版 Figma Desktop。
2. 打开一个 Figma Design 文件，按 `Shift+D` 切换到 Dev Mode。
3. 在右侧 Inspect 面板的 MCP server 区域点击 `Enable desktop MCP server`。
4. 确认 Figma 显示 MCP server 已在 `http://127.0.0.1:3845/mcp` 运行。

如果 Inspect 面板没有显示 MCP 开关，通过 Quick Actions 启用：

1. macOS 按 `⌘+/`，Windows 按 `Ctrl+/`，打开 Quick Actions。
2. 搜索 `Enable desktop MCP server` 并执行。
3. 回到 Figma 文件，确认本地服务已运行。

## 在 Synapse 中连接

1. 打开“连接器”。
2. 在 Figma 卡片中打开开关。Synapse 会检查 MCP 初始化和工具发现；检查失败时不会标记为已连接。
3. 创建新的 Agent 对话。
4. 在 Figma Desktop 中选中要处理的 Frame 或图层，再发送提示词。选区是 Desktop MCP 的默认上下文。

也可以把 Figma Frame 或图层链接放进提示词。Desktop MCP 不会打开网页链接，而是提取其中的 `node-id` 来定位对象。大型页面应先选中较小的目标，或先用 `get_metadata` 做结构扫描。

## Desktop MCP 工具

| 工具 | 适用范围 | 用途 |
| --- | --- | --- |
| `get_design_context` | Figma Design 选区 | 读取布局、组件、文本、样式等设计上下文；设计还原时优先调用。 |
| `get_metadata` | Figma Design | 返回页面和图层的轻量 XML 结构，不包含完整样式；适合大型文件的分层定位。 |
| `get_screenshot` | Figma Design、FigJam、Figma Slides | 获取当前选区的 PNG，用于视觉核对；一次处理一个选区。 |
| `get_variable_defs` | Figma Design | 返回选区使用的变量和样式，例如颜色、间距和字体。 |
| `get_motion_context` | Figma Design | 返回动效节点、关键帧、缓动和 CSS / Motion 代码片段；应在 `get_design_context` 之后调用。 |
| `get_figjam` | FigJam | 返回选区的 XML 元数据和节点截图；用于整理 FigJam 内容或生成代码。 |

## MCP Prompt

当 Agent 客户端支持 MCP Prompt 时，可以使用以下服务端 Prompt：

- `get_code_for_selection`：为当前选区生成代码建议。
- `create_design_system_rules`：根据已验证的设计生成项目设计系统规则。
- `map_selection_to_code_connect`：根据 `source`、`componentName` 和可选的 `nodeId` 生成 Code Connect 映射提案。

Prompt 是 MCP 服务端提供的模板，不等同于聊天输入；不同 Agent 客户端对 Prompt 的调用方式可能不同。映射提案需要在代码库中审核，不能据此声称 Figma 已完成发布。

## 随对话加载的 Skill

连接器开启后，新建的 Agent 对话会加载以下 Figma Skill：

- `figma-use`：读取设计上下文、截图、变量、动效、元数据和 FigJam 内容。
- `figma-implement-design`：按 Figma 设计在现有代码库中实现页面或组件。
- `figma-code-connect`：准备 Code Connect 映射提案。
- `figma-create-design-system-rules`：整理已验证的设计规范。
- `figma-create-new-file`：识别新建文件请求，并说明 Desktop MCP 不支持创建文件。
- `figma-generate-design`：根据说明或现有代码生成实现代码，并说明不能写回可编辑 Figma 内容。
- `figma-generate-library`：根据已打开的设计提取组件和变量信息，生成代码侧组件与 token。

## 提示词示例

发送提示词前，先在 Figma Desktop 选中目标对象，并在 Synapse 中新建 Agent 对话。下面的示例明确输入、任务和输出，减少歧义。

### 将 Figma 画板还原为本机 HTML

```text
我已在 Figma Desktop 选中要还原的画板。请把它实现为可以直接双击打开的本机 HTML 文件，并尽量还原画板中的布局、尺寸、间距、字体、颜色、圆角、阴影和视觉层级。

输出目录：<path/to/output/>

请在该目录中创建 `index.html` 和 `assets/`。如果目录不存在，可以创建它。

资源处理规则：
- 画板中的 PNG、JPG、JPEG、GIF 或 WebP 等栅格图片都保存到 `<输出目录>/assets/`，`index.html` 中使用 `./assets/<文件名>` 形式的相对路径引用，不要使用 base64、远程地址或 localhost 地址。
- SVG 默认保存为 `<输出目录>/assets/` 下的独立 `.svg` 文件并使用相对路径引用；只有尺寸较小、结构简单且内联后更便于保持语义的 SVG 图标，才可以直接内联到 HTML。
- 不要重绘或替换画板中的图片和图标。资源无法保存时，列出文件名和原因，不要用占位图静默替代。

页面应无需开发服务器即可打开。开始前检查输出目录中的 `index.html` 和 `assets/`；如果本次操作会覆盖已有文件，先报告冲突并停止。不要创建或修改 Figma 内容，完成后列出生成的 HTML、资源文件和无法从画板确认的假设。
```

### 在现有代码库实现页面或组件

```text
我已在 Figma Desktop 选中目标 Frame。请按以下顺序处理：
1. 读取该选区的设计结构和样式。
2. 结合选区截图进行视觉核对。
3. 在现有代码库中实现它，先复用已有组件、设计 token 和图标。

目标代码目录：<path>
只修改实现所需文件，不创建或修改 Figma 内容。完成后列出实际修改和无法从设计确认的假设。
```

### 只提取变量和样式

```text
只读取当前 Figma 选区使用的变量和样式，逐项给出名称、类型和实际值；按颜色、间距、字体分组。不要生成代码。
```

### 分层读取大型页面

```text
我已选中一个较大的 Figma 页面。先扫描页面的轻量结构，列出顶层 Frame 及其 node ID；根据结构找出登录表单区域后，再只读取该区域的完整设计上下文。不要一次读取整个页面，也不要修改 Figma 文件。
```

### 提取动效实现信息

```text
我已选中带有交互动效的 Frame。请读取静态设计和同一选区的动效信息；如果存在子节点动效，也一并检查。返回关键帧、时长、缓动和可直接改写到现有代码的 CSS / Motion 实现建议。
```

### 整理 FigJam 选区

```text
我已在 FigJam 选中一组流程图节点。请按节点名称和连接关系还原结构，再输出 Mermaid 流程图和待确认的缺失信息。不要把 FigJam 当作 Figma Design 图层读取，也不要修改画布。
```

### 生成 Code Connect 映射提案

```text
我已选中一个已发布的 Figma 组件。请生成 Code Connect 映射提案，使用：
- source: <组件源码路径或 URL>
- componentName: <代码组件名>
- nodeId: <可选，当前选区的 node ID>

输出映射提案和需要我确认的字段，不要声称映射已发布到 Figma。
```

### 生成设计系统规则

```text
请根据当前设计生成项目设计系统规则。只记录当前设计中可以验证的颜色、字体、间距、组件状态、动效和资源约定，并将结果保存到仓库已有的 rules/ 或 instructions/ 目录。不要凭空补充未在选区中出现的规范。
```

## 服务地址

```text
http://127.0.0.1:3845/mcp
```

官方参考：[Desktop MCP 设置](https://developers.figma.com/docs/figma-mcp-server/local-server-installation/)、[工具与 Prompt](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)、[Remote 与 Desktop 对比](https://help.figma.com/hc/en-us/articles/35281385065751-Figma-MCP-collection-Compare-Figma-s-remote-and-desktop-MCP-servers)。
