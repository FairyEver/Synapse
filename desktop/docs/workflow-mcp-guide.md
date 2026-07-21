# Workflow MCP 工具参考

供 AI Agent 通过 Synapse MCP 操作工作流的参考文档。

## 1. 系统模型

- 工作流是有向无环图（DAG）
- 节点按拓扑序执行；无依赖关系的节点并行运行
- 内置节点类型包括 `prompt`、`switch`、`http_request`、`script`、`workflow_call`、`document_template_docx_generate`、`document_text_extract`、`codex`、`claude_code` 和 `end`
- 每个工作流必须有且仅有一个 `end` 节点，不允许环
- 节点通过有向边连接（`from` → `to`）
- switch 节点的出边必须携带 `branch` 字段
- `workflow_call` 节点可调用另一个已保存工作流，并把子工作流 End 输出作为自身输出
- 调用工作流的节点类型固定为 `workflow_call`，不是 `app_workflow_call`
- `document_template_docx_generate` 节点使用 DOCX 模板和 JSON 数据生成文档，并把输出文件路径作为节点输出
- `document_text_extract` 节点从一个本地 PDF 或 DOCX 文件提取完整文本
- `codex` 节点在执行项目或任务工作目录中运行本机 `codex exec`，并把 Codex 最终回复作为自身输出
- `claude_code` 节点在执行项目或任务工作目录中运行本机 `claude -p`，并把 Claude Code 最终回复作为自身输出

工作流定义中的 `meta.schemaVersion` 是由 Synapse 管理的 SemVer 数据结构版本，`version` 则是每次保存生成的修订标识，两者不是一回事。Agent 读取完整定义后再更新时必须原样保留 `meta`，不要自行改写或删除。旧结构会在读取入口迁移；未来版本或迁移失败的数据不能通过 MCP 获取正文、更新或运行。列表返回的 `loadError` 用于诊断；`rawExportAvailable` 只表示 Synapse 界面允许原样导出高版本正文。

## 2. 变量系统

节点通过 `variables` 列表绑定值，在 prompt 模板中用 `{{variableName}}` 引用。

### 绑定类型

| type | 说明 | 示例 |
|------|------|------|
| `param` | 绑定工作流参数 | `{ "type": "param", "param": "question" }` |
| `node_output` | 绑定上游节点输出 | `{ "type": "node_output", "node": "n1" }` |
| `static` | 硬编码值 | `{ "type": "static", "value": "你是一个翻译助手" }` |

变量在节点执行前解析完毕。变量名支持字母、数字、下划线和中文。
变量可用于 prompt/switch/codex/claude_code 提示词、end 输出模板、HTTP 文本字段、`workflow_call.paramTemplates`、`document_template_docx_generate` 的路径和内联 JSON 字段，以及 `document_text_extract.filePath`。script 节点会把变量作为环境变量注入，不支持在脚本文本中写 `{{变量名}}`。POSIX 使用 `$变量名`，cmd 使用 `%变量名%`，PowerShell 使用 `$env:变量名`。

单个文件或文件夹变量注入绝对路径；多选资源变量注入保持顺序的 JSON 路径数组。例如 POSIX 脚本可用 `printf '%s\n' "$input_file"` 读取单文件路径，用 `printf '%s\n' "$input_files"` 输出多文件 JSON 数组。

script 节点输出是原样 stdout。下游用 `node_output` 绑定路径、ID、JSON 标量等单值时，脚本里优先用 `printf`，不要让末尾换行混进变量。

## 3. 图约束

- 必须有且仅有一个 end 节点
- 不允许环（A → B → A）
- switch 的所有分支必须最终到达 end 节点
- switch 节点的出边必须设置 `branch` 字段
- 不允许引用不存在的上游节点输出
- 不允许引用不存在的工作流参数

## 4. 节点类型

### prompt — AI 对话节点

配置字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `providerId` | string? | 模型提供商 ID；为空时继承工作流 `defaultProviderId` |
| `modelTier` | `"default"` \| `"haiku"` \| `"sonnet"` \| `"opus"`? | 模型等级；为空时继承工作流 `defaultModelTier` |
| `projectId` | string? | 执行项目；为空时继承工作流 `defaultProjectId` |
| `timeoutMins` | number? | 节点超时分钟数；为空时继承工作流默认值，仍未配置时为 60 分钟 |
| `prompt` | string | 提示词模板，支持 `{{变量名}}` |
| `variables` | VariableBinding[] | 变量绑定列表 |

输出：AI 回复文本。

### switch — 条件分支节点

配置字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `providerId` | string? | 模型提供商 ID；为空时继承工作流 `defaultProviderId` |
| `modelTier` | `"default"` \| `"haiku"` \| `"sonnet"` \| `"opus"`? | 模型等级；为空时继承工作流 `defaultModelTier` |
| `projectId` | string? | 执行项目；为空时继承工作流 `defaultProjectId` |
| `timeoutMins` | number? | 节点超时分钟数；为空时继承工作流默认值，仍未配置时为 60 分钟 |
| `prompt` | string | 评估提示词，AI 根据此判断走哪个分支 |
| `branches` | `{ id: string, label: string }[]` | 分支列表（id 必须匹配 `/^[a-z][a-z0-9_]*/`） |
| `defaultBranch` | string? | 可选默认分支 ID |
| `variables` | VariableBinding[] | 变量绑定列表 |

输出：激活一个分支。出边必须设置 `branch` 字段对应分支 id。

### http_request — HTTP 请求节点

不需要 provider。

配置字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `method` | `"GET"` \| `"POST"` \| `"PUT"` \| `"PATCH"` \| `"DELETE"` | 请求方法 |
| `url` | string | 请求 URL，支持 `{{变量名}}` |
| `headers` | object? | 请求头键值对 |
| `query` | object? | Query 参数键值对 |
| `bodyType` | `"none"` \| `"json"` \| `"text"` | 请求体类型 |
| `body` | string? | 请求体内容 |
| `auth` | object? | none / bearer / basic 鉴权配置 |
| `timeoutMins` | number? | 超时分钟数 |
| `variables` | VariableBinding[] | 变量绑定列表 |

输出：HTTP 响应摘要。

### script — 脚本节点

不需要 provider。

配置字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `script` | string | 脚本内容 |
| `shell` | `"posix"` \| `"cmd"` \| `"powershell"`? | Shell 类型；留空时按运行平台选择默认 shell |
| `env` | object? | 环境变量键值对 |
| `pathStrategy` | `"merge"` \| `"replace"`? | PATH 处理方式 |
| `posixLogin` | boolean? | posix shell 是否按 login shell 执行 |
| `timeoutMins` | number? | 超时分钟数 |
| `variables` | VariableBinding[] | 变量绑定列表，变量名只能包含字母、数字和下划线，且不能以数字开头 |

绑定变量通过环境变量读取，不使用 `{{变量名}}` 模板语法。文件/文件夹单选值是路径字符串，多选值是有序 JSON 路径数组。

输出：脚本 stdout。

### workflow_call — 调用工作流节点

不需要 provider。它调用另一个已保存工作流，并把子工作流 End 输出作为自身输出。

配置字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `workflowId` | string | 要调用的子工作流 ID，不能是当前工作流 ID |
| `variables` | VariableBinding[] | 从父工作流参数、上游节点输出或静态值绑定变量 |
| `paramTemplates` | `Record<string, string>` | 子工作流参数名到模板文本的映射，支持 `{{变量名}}` |
| `paramBindings` | `Record<string, WorkflowParamBinding>` | 文件或文件夹子参数的类型化绑定；父子参数的资源类型和 `allowMultiple` 必须一致 |

配置前先用 `workflow_definition_list` 找到子工作流，再用 `workflow_definition_get` 读取子工作流当前 `params`。`paramTemplates` 和 `paramBindings` 的 key 应来自子工作流参数名，单值与多值资源参数不会自动互转。保存和 `workflow_definition_inspect` 会拒绝父子资源类型或 `allowMultiple` 不一致的直接绑定。子工作流内部 prompt/switch 节点仍需要通过子工作流默认值或子节点覆盖获得 provider/model/project；codex/claude_code 节点仍需要有效项目。

### document_template_docx_generate — DOCX 文档生成节点

不需要 provider。它使用 DOCX 模板和 JSON 文件或内联 JSON 数据生成文档，并把生成文件路径作为节点输出。

配置字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `templatePath` | string | DOCX 模板路径，支持 `{{变量名}}` |
| `outputPath` | string | 生成文件路径，支持 `{{变量名}}` |
| `dataSource` | `"dataPath"` \| `"inline"` | 使用 JSON 文件或内联 JSON |
| `dataPath` | string? | `dataSource` 为 `dataPath` 时必填，支持 `{{变量名}}` |
| `dataJson` | string? | `dataSource` 为 `inline` 时必填，支持 `{{变量名}}` |
| `overwrite` | boolean | 是否允许覆盖现有普通文件；符号链接目标始终拒绝 |
| `variables` | VariableBinding[] | 路径和内联 JSON 使用的变量绑定 |

输出：生成文件的 `outputPath`；生成元数据保存在节点结果 outputs 中。

### document_text_extract — 文档文本提取节点

不需要 provider。它从一个本地 PDF 或 DOCX 文件提取完整文本。

| 字段 | 类型 | 说明 |
|------|------|------|
| `filePath` | string | PDF 或 DOCX 的绝对本地路径，支持 `{{变量名}}` |
| `variables` | VariableBinding[] | `filePath` 使用的变量绑定 |

输出：完整提取文本；空文档成功输出空字符串。节点结果 outputs 仅保存 `format`、`fileName`、`size` 和可选 PDF `pages`，不重复正文。不支持 OCR、多文件、Drive 引用或 URL。

### codex — Codex 节点

不需要 provider/modelTier。它默认在解析后的项目目录中运行本机 `codex exec`；也可以通过 `workingDirectory` 指定任务级工作目录。节点会把插值后的提示词通过 stdin 传入，并把 Codex 最终回复作为节点输出。

配置字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `prompt` | string | Codex 指令模板，支持 `{{变量名}}` |
| `variables` | VariableBinding[] | 从工作流参数、上游节点输出或静态值绑定变量 |
| `projectId` | string? | 执行项目；为空时继承工作流 `defaultProjectId` |
| `workingDirectory` | string? | 可选任务工作目录，支持 `{{变量名}}`；非空时必须已存在，并作为进程 cwd 和 Codex `--cd` |
| `timeoutMins` | number? | 节点超时分钟数 |
| `approvalPolicy` | `"never"` \| `"on-request"` \| `"untrusted"` | Codex 审批策略 |
| `sandbox` | `"read-only"` \| `"workspace-write"` \| `"danger-full-access"` | Codex 沙箱模式 |
| `model` | string? | 可选 Codex 模型名 |
| `profile` | string? | 可选 Codex profile |
| `enableSearch` | boolean | 是否启用 Codex 搜索 |
| `features.goals` | `"default"` \| `"enabled"` \| `"disabled"` | Codex goals 功能开关 |
| `skipGitRepoCheck` | boolean | 是否跳过 Git 仓库检查 |
| `strictConfig` | boolean | 是否启用 Codex strict config |
| `bypassApprovalsAndSandbox` | boolean | 是否使用 Codex 审批和沙箱绕过模式 |
| `bypassHookTrust` | boolean | 是否绕过 hook trust |
| `additionalWritableDirs` | string[] | 实际工作目录外的额外可写目录，映射为重复 `--add-dir` |
| `images` | string[] | 图片路径，映射为重复 `--image` |
| `configOverrides` | `{ key: string, value: string }[]` | Codex 配置覆盖项，映射为重复 `--config key=value` |
| `captureDebugArtifacts` | boolean | 是否保存脱敏调试产物 |

最小有效配置：

```json
{
  "prompt": "总结 {{input}}",
  "variables": [],
  "approvalPolicy": "never",
  "sandbox": "workspace-write",
  "enableSearch": false,
  "features": { "goals": "enabled" },
  "skipGitRepoCheck": true,
  "strictConfig": false,
  "bypassApprovalsAndSandbox": false,
  "bypassHookTrust": false,
  "additionalWritableDirs": [],
  "images": [],
  "configOverrides": [],
  "captureDebugArtifacts": true
}
```

未配置 `workingDirectory` 时，Codex 的进程 cwd 和 `--cd` 都使用项目目录。配置后会先插值并去除首尾空白，空值或不存在的目录会让节点直接失败；`workspace-write` 的当前工作区就是这个实际工作目录。该目录不会自动加入 `additionalWritableDirs`，跨目录写入仍需显式配置可写目录。

当 `bypassApprovalsAndSandbox` 为 true 时，配置仍需保留 `approvalPolicy` 和 `sandbox` 以满足 schema，但实际执行会使用 Codex 绕过参数，不再额外传审批和沙箱 CLI 参数。运行历史中的调试信息位于 `outputs.codexDebug`；下游 `node_output` 只接收最终回复文本。

### claude_code — Claude Code 节点

不需要 provider/modelTier。它默认在解析后的项目目录中运行本机 `claude -p`；也可以通过 `workingDirectory` 指定任务级工作目录。节点会把插值后的提示词作为 print query 传入，并把 Claude Code 最终回复作为节点输出。

配置字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `prompt` | string | Claude Code 指令模板，支持 `{{变量名}}` |
| `variables` | VariableBinding[] | 从工作流参数、上游节点输出或静态值绑定变量 |
| `projectId` | string? | 执行项目；为空时继承工作流 `defaultProjectId` |
| `workingDirectory` | string? | 可选任务工作目录，支持 `{{变量名}}`；非空时必须已存在，并作为进程 cwd |
| `timeoutMins` | number? | 节点超时分钟数 |
| `permissionMode` | `"default"` \| `"acceptEdits"` \| `"plan"` \| `"auto"` \| `"dontAsk"` \| `"bypassPermissions"` | Claude Code 权限模式 |
| `model` | string? | 可选 Claude Code CLI 模型名 |
| `maxTurns` | number? | 可选最大轮数 |
| `outputFormat` | `"text"` \| `"json"` \| `"stream-json"` | Claude Code 输出格式 |
| `verbose` | boolean | 是否输出详细运行信息 |
| `safeMode` | boolean | 是否启用 safe mode |
| `bareMode` | boolean | 是否启用 bare mode |
| `noSessionPersistence` | boolean | 是否不保留 Claude Code 会话 |
| `settingSources` | `("user" \| "project" \| "local")[]` | Claude Code 设置来源，默认 `["user", "project", "local"]` |
| `settingsPath` | string? | 可选 Claude Code settings 文件路径，支持 `{{变量名}}`，必须存在 |
| `mcpConfigPath` | string? | 可选 Claude Code MCP 配置文件路径，支持 `{{变量名}}`，必须存在 |
| `strictMcpConfig` | boolean | 是否传入 strict MCP config |
| `additionalDirectories` | string[] | 额外可访问目录，支持 `{{变量名}}`，必须存在 |
| `allowedTools` | string[] | 允许的 Claude Code 工具规则 |
| `disallowedTools` | string[] | 禁用的 Claude Code 工具规则 |
| `captureDebugArtifacts` | boolean | 是否保存脱敏调试产物 |

最小有效配置：

```json
{
  "prompt": "总结 {{input}}",
  "variables": [],
  "permissionMode": "acceptEdits",
  "outputFormat": "stream-json",
  "verbose": true,
  "safeMode": false,
  "bareMode": false,
  "noSessionPersistence": false,
  "settingSources": ["user", "project", "local"],
  "strictMcpConfig": false,
  "additionalDirectories": [],
  "allowedTools": [],
  "disallowedTools": [],
  "captureDebugArtifacts": true
}
```

未配置 `workingDirectory` 时，Claude Code 的进程 cwd 使用项目目录。配置后会先插值并去除首尾空白，空值或不存在的目录会让节点直接失败。`settingsPath`、`mcpConfigPath` 和 `additionalDirectories` 也会在运行前校验存在。运行历史中的调试信息位于 `outputs.claudeCodeDebug`；下游 `node_output` 只接收最终回复文本。

### end — 终止节点

每个工作流有且仅有一个。

配置字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `outputType` | `"text"` | 输出类型（当前仅支持 text） |
| `template` | string | 输出模板，支持 `{{变量名}}` |
| `variables` | VariableBinding[] | 变量绑定列表 |

输出：工作流最终结果。

## 5. 完整工作流 JSON 示例

### 示例 1：线性链（prompt → end）

```json
{
  "id": "wf-example-1",
  "name": "简单问答",
  "version": "v_1",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000,
  "params": [
    { "name": "question", "type": "text", "default": null, "description": "用户问题" }
  ],
  "nodes": [
    {
      "id": "n1",
      "name": "AI 回答",
      "type": "prompt",
      "position": { "x": 200, "y": 200 },
      "config": {
        "providerId": "default",
        "modelTier": "default",
        "prompt": "请回答以下问题：{{question}}",
        "variables": [
          { "name": "question", "source": { "type": "param", "param": "question" } }
        ]
      }
    },
    {
      "id": "n2",
      "name": "结束",
      "type": "end",
      "position": { "x": 600, "y": 200 },
      "config": {
        "outputType": "text",
        "template": "{{answer}}",
        "variables": [
          { "name": "answer", "source": { "type": "node_output", "node": "n1" } }
        ]
      }
    }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2" }
  ]
}
```

### 示例 2：条件分支（prompt → switch → prompt/prompt → end）

对用户输入进行语言分类，根据语言走不同翻译分支。

```json
{
  "id": "wf-example-2",
  "name": "智能翻译",
  "version": "v_1",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000,
  "params": [
    { "name": "text", "type": "text", "default": null, "description": "待翻译文本" }
  ],
  "nodes": [
    {
      "id": "n1",
      "name": "语言检测",
      "type": "switch",
      "position": { "x": 200, "y": 300 },
      "config": {
        "providerId": "default",
        "modelTier": "haiku",
        "prompt": "判断以下文本的语言，只回答分支 id：\n\n{{text}}",
        "branches": [
          { "id": "chinese", "label": "中文" },
          { "id": "english", "label": "英文" }
        ],
        "defaultBranch": "english",
        "variables": [
          { "name": "text", "source": { "type": "param", "param": "text" } }
        ]
      }
    },
    {
      "id": "n2",
      "name": "翻译为英文",
      "type": "prompt",
      "position": { "x": 500, "y": 200 },
      "config": {
        "providerId": "default",
        "modelTier": "sonnet",
        "prompt": "将以下中文翻译为英文，只输出译文：\n\n{{text}}",
        "variables": [
          { "name": "text", "source": { "type": "param", "param": "text" } }
        ]
      }
    },
    {
      "id": "n3",
      "name": "翻译为中文",
      "type": "prompt",
      "position": { "x": 500, "y": 400 },
      "config": {
        "providerId": "default",
        "modelTier": "sonnet",
        "prompt": "将以下英文翻译为中文，只输出译文：\n\n{{text}}",
        "variables": [
          { "name": "text", "source": { "type": "param", "param": "text" } }
        ]
      }
    },
    {
      "id": "n4",
      "name": "结束",
      "type": "end",
      "position": { "x": 800, "y": 300 },
      "config": {
        "outputType": "text",
        "template": "{{result}}",
        "variables": [
          { "name": "result", "source": { "type": "node_output", "node": "n2" } }
        ]
      }
    }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2", "branch": "chinese" },
    { "id": "e2", "from": "n1", "to": "n3", "branch": "english" },
    { "id": "e3", "from": "n2", "to": "n4" },
    { "id": "e4", "from": "n3", "to": "n4" }
  ]
}
```

注意：end 节点的 `node_output` 绑定只会取到实际执行的上游节点输出。未执行的分支节点输出为空。

### 示例 3：嵌套调用（prompt → workflow_call → end）

父工作流先生成搜索摘要，再调用子工作流继续整理报告。

```json
{
  "id": "wf-parent",
  "name": "父工作流",
  "version": "v_1",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000,
  "defaultProjectId": "project-1",
  "defaultProviderId": "local-claude-code",
  "defaultModelTier": "sonnet",
  "params": [
    { "name": "topic", "type": "text", "default": null, "description": "主题" },
    { "name": "audience", "type": "text", "default": "内部汇报", "description": "受众" }
  ],
  "nodes": [
    {
      "id": "n1",
      "name": "生成摘要",
      "type": "prompt",
      "position": { "x": 200, "y": 200 },
      "config": {
        "prompt": "围绕 {{topic}} 生成一段搜索摘要。",
        "variables": [
          { "name": "topic", "source": { "type": "param", "param": "topic" } }
        ]
      }
    },
    {
      "id": "n2",
      "name": "调用报告工作流",
      "type": "workflow_call",
      "position": { "x": 500, "y": 200 },
      "config": {
        "workflowId": "wf-child-report",
        "variables": [
          { "name": "summary", "source": { "type": "node_output", "node": "n1" } },
          { "name": "audience", "source": { "type": "param", "param": "audience" } }
        ],
        "paramTemplates": {
          "source": "{{summary}}",
          "style": "面向 {{audience}}，语气克制"
        }
      }
    },
    {
      "id": "n3",
      "name": "结束",
      "type": "end",
      "position": { "x": 800, "y": 200 },
      "config": {
        "outputType": "text",
        "template": "{{report}}",
        "variables": [
          { "name": "report", "source": { "type": "node_output", "node": "n2" } }
        ]
      }
    }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2" },
    { "id": "e2", "from": "n2", "to": "n3" }
  ]
}
```

## 6. 推荐 Agent 工作流程

```
1. workflow_node_type_list()                          → 了解系统模型 + 可用节点类型
2. workflow_node_type_describe({ nodeType })           → 获取本次要用的每种节点配置 JSON Schema
3. workflow_definition_create({ name: "..." })         → 创建空工作流（自带 end 节点）
4. workflow_param_update({ workflowId, params })       → 定义工作流参数
5. workflow_node_create({ workflowId, node: { name, type, config, position? }, incomingEdges?, outgoingEdges? })
                                                         → 添加已连接节点（position 可省略，自动布局）
6. workflow_edge_create({ workflowId, from, to })       → 在单次保存后仍有效时补充连接
7. workflow_node_update({ workflowId, nodeId, patch })  → 配置节点（设置 prompt、variables、paramTemplates 等）
8. workflow_layout_update({ workflowId })               → 自动排列节点位置
9. workflow_definition_inspect({ definition })          → 校验完整性
10. workflow_run_execute({ workflowId, params })         → 执行工作流
11. workflow_run_get({ workflowId, runId })              → 轮询运行结果
```

文件和文件夹参数可设置 `allowMultiple: true`。此时默认值和运行值必须是有序、非空、最多 100 项且不重复的数组；即使只有一项也保持数组。MCP 运行参数的数组项可混用绝对路径字符串和匹配类型的 `local_path` 引用，任一项无效都会使整次运行失败并返回对应索引。

节点 ID 只能包含字母、数字、下划线和短横线。不要在 MCP 写入或导入工作流时使用包含路径分隔符、`..`、绝对路径或空格的节点 ID。

关键点：
- 步骤 3 创建的工作流已包含一个 end 节点，无需手动创建
- 严格校验会在每次 MCP 写入后执行，不要先保存未连接的占位节点再补边；复杂图优先本地组装完整定义后用 `workflow_definition_update`
- 步骤 5 中 `node.config` 必填，并且必须符合 `workflow_node_type_describe` 返回的节点 schema；以 `configSchema.required` 为准，必填的布尔值和数组也不能省略；position 可省略，dispatcher 自动计算布局；`incomingEdges` 为 `{ from, branch? }[]`，`outgoingEdges` 为 `{ to, branch? }[]`
- 创建 `workflow_call` 前先读取子工作流定义：文本、数字和选项参数使用 `paramTemplates`；文件/文件夹参数优先使用 `paramBindings`。多选资源参数只能直接绑定类型和 `allowMultiple` 一致的父参数
- 创建 `document_template_docx_generate` 前，先用 `workflow_node_type_describe({ nodeType: "document_template_docx_generate" })` 读取最新 schema，并按 `dataSource` 提供 `dataPath` 或 `dataJson`
- 创建 `document_text_extract` 前，先用 `workflow_node_type_describe({ nodeType: "document_text_extract" })` 读取最新 schema，并只提供 `filePath` 和 `variables`
- 创建 `codex` 前，先用 `workflow_node_type_describe({ nodeType: "codex" })` 读取最新 schema；不要给 codex 节点设置 `providerId` 或 `modelTier`
- 创建 `claude_code` 前，先用 `workflow_node_type_describe({ nodeType: "claude_code" })` 读取最新 schema；不要给 claude_code 节点设置 `providerId` 或 `modelTier`
- 步骤 8 在新增、删除或重连节点后调用，自动整理为左右层级排列，无需打开 UI
- 步骤 9 可在任何修改后调用，提前发现问题
- 步骤 11 需轮询直到 status 变为 `completed` / `failed` / `cancelled`

## 7. 常见错误

| 错误 | 说明 | 修复 |
|------|------|------|
| 节点未连接到 end | 所有路径必须最终到达 end 节点 | 补充缺失的边 |
| 保存占位节点失败 | `workflow_node_create` 保存未连接节点会被严格校验拒绝 | 用 `incomingEdges` / `outgoingEdges` 原子创建已连接节点，或用 `workflow_definition_update` 一次写入完整 DAG |
| switch 出边缺少 branch | switch 节点的每条出边必须设置 branch 字段 | `workflow_edge_create` 时传入 `branch` |
| 引用不存在的上游输出 | `node_output` 引用的节点不在当前节点的上游 | 检查 DAG 拓扑，确保被引用节点在上游 |
| 引用不存在的参数 | `param` 绑定的名称不在 `params` 列表中 | 先用 `workflow_param_update` 添加参数 |
| 创建环 | A → B → A 形成环路 | 重新设计边的方向，保持 DAG |
| 多个 end 节点 | 每个工作流只允许一个 end 节点 | 删除多余的 end 节点 |
| config 字段缺失 | 节点 config 不符合 schema | 调用 `workflow_node_type_describe` 查看必填字段 |
| branch id 格式错误 | switch 分支 id 必须匹配 `/^[a-z][a-z0-9_]*/` | 使用小写字母开头，仅含小写字母、数字、下划线 |
| 调用当前工作流 | `workflow_call.workflowId` 等于当前工作流 ID | 选择另一个已保存工作流 |
| 子工作流参数缺失 | `paramTemplates` 未提供子工作流必填参数，且子参数无默认值 | 读取子工作流 `params` 后补齐模板 |
| 子工作流模板变量未绑定 | `paramTemplates` 中使用了未出现在 `variables` 的 `{{变量名}}` | 在调用节点 `variables` 中添加绑定 |
| 子工作流多选资源来源不兼容 | 多选文件/文件夹参数使用了模板、`static`、`node_output`，或绑定的父参数类型/基数不一致 | 改为直接绑定同类型且 `allowMultiple: true` 的父参数 |
| Codex 项目缺失 | codex 节点没有 `projectId`，工作流也没有 `defaultProjectId` | 设置工作流 `defaultProjectId` 或节点 `projectId` |
| Codex 工作目录不可用 | `workingDirectory` 插值后为空或目录不存在 | 修正工作目录变量或先创建目标目录 |
| Claude Code 项目缺失 | claude_code 节点没有 `projectId`，工作流也没有 `defaultProjectId` | 设置工作流 `defaultProjectId` 或节点 `projectId` |
| Claude Code 路径不可用 | `workingDirectory`、`settingsPath`、`mcpConfigPath` 或 `additionalDirectories` 插值后不存在 | 修正路径变量或先创建目标目录/文件 |
