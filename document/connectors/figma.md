# Figma 连接器

Figma 连接器让 Synapse 新建的 Agent 对话读取当前 Figma 设计上下文。连接器使用 Figma Desktop 的本地 MCP（`http://127.0.0.1:3845/mcp`），不需要 OAuth 或 Bearer Token。

## 准备 Figma

1. 安装并打开最新版 Figma Desktop。
2. 打开一个 Design 文件，按 `Shift+D` 切换到 Dev Mode。
3. 在右侧 Inspect 面板的 MCP server 区域点击 `Enable desktop MCP server`。
4. 确认 Figma 显示 `MCP server enabled on http://127.0.0.1:3845/mcp`。

### 未显示启用开关

如果右侧 Inspect 面板没有显示 MCP 开关，通过 Quick Actions 启用本地服务：

1. macOS 按 `⌘+/`，Windows 按 `Ctrl+/`，打开 Quick Actions。
2. 搜索 `Enable desktop MCP server`。
3. 选择该操作并启用，确认 Figma 显示本地 MCP 已在 `http://127.0.0.1:3845/mcp` 运行。

## 在 Synapse 中连接

1. 打开“连接器”。
2. 在 Figma 卡片中打开开关。
3. 创建新的 Agent 对话。

连接器只对新建的对话生效。关闭连接器后，新对话不会加载 Figma MCP。

## MCP 工具

连接后，新建的 Agent 对话可以调用以下 Figma MCP 工具：

- `get_design_context`：读取当前选择或指定节点的设计上下文，用于设计还原和代码实现。
- `get_screenshot`：获取设计、FigJam 或 Slides 中当前选择或指定节点的截图。
- `get_metadata`：读取 Figma Design 文件的页面与节点结构。
- `get_variable_defs`：读取颜色、字体、间距等变量定义。
- `get_motion_context`：读取节点的动效与过渡信息。
- `get_figjam`：读取 FigJam 中当前选择的内容，用于生成代码或整理信息。

Figma MCP 还提供以下 Prompt：

- `get_code_for_selection`：根据当前选择生成代码建议。
- `create_design_system_rules`：根据设计生成项目设计系统规则。
- `map_selection_to_code_connect`：生成当前组件的 Code Connect 映射提案。

## Skill 列表

连接后，新建的 Agent 对话会加载以下 Skill：

- `figma-use`：读取设计上下文、截图、变量、动效、组件和 FigJam 内容。
- `figma-implement-design`：按 Figma 设计在现有代码库中实现页面或组件。
- `figma-code-connect`：根据已发布的 Figma 组件准备 Code Connect 映射提案。
- `figma-create-design-system-rules`：将已验证的设计规范整理为项目规则。
- `figma-create-new-file`：识别新建 Figma、FigJam 或 Slides 文件的请求，并说明本地 MCP 不支持从 Synapse 创建文件。
- `figma-generate-design`：基于产品说明或现有代码生成实现代码，并说明可编辑 Figma 输出的能力边界。
- `figma-generate-library`：根据已打开的设计提取组件和变量信息，用于生成代码侧的组件与令牌。

Figma MCP 以读取设计交付信息为主，不支持从 Synapse 创建、修改或发布 Figma 文件、组件库及 Code Connect 映射。

## 服务地址

本地 MCP：

```text
http://127.0.0.1:3845/mcp
```
