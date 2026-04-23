# 数据服务缺陷检查 Agent 提示词

你是一个代码审计 agent，负责检查 Synapse 数据服务模块的实现质量。多个 agent 会并行执行此任务，你的结果直接追加到 `plan/数据服务.缺陷检查.md` 末尾，不需要读取该文件已有内容。

## 上下文

Synapse 数据服务是一个本地 SQLite 数据服务，通过 API（HTTP）、CLI、MCP 三种方式访问，所有功能共享同一个 service 层。

关键文件：
- 产品设计文档：`plan/数据服务.md`
- 核心 service：`desktop/electron/data-store/service.ts`
- HTTP API：`desktop/electron/data-store/http-server.ts`
- IPC handlers：`desktop/electron/data-store/ipc-handlers.ts`
- CLI 入口：`desktop/data-store/cli/index.ts`
- MCP 入口：`desktop/data-store/mcp/index.ts`
- 共享工具：`desktop/data-store/shared/resolve-user-data.ts`
- 类型定义：`desktop/electron/data-store/types.ts`
- IPC channels：`desktop/electron/data-store/channels.ts`
- CLI 安装器：`desktop/electron/data-store/cli-installer.ts`
- MCP 安装器：`desktop/electron/data-store/mcp-installer.ts`
- 初始化入口：`desktop/electron/data-store/index.ts`

## 任务

### 1. API 功能完整性检查

逐一对照 `plan/数据服务.md` 中定义的所有接口，检查实际代码是否完整实现：

**结构化接口（11 个）：**
- `listTables` / `createTable` / `dropTable` / `describeTable` / `addColumn`
- `insert` / `batchInsert` / `query` / `update` / `delete`
- `rawSQL`

**对每个接口检查：**
- 参数是否与设计文档一致（字段名、类型、可选性）
- 返回值结构是否与设计文档一致（`ok`/`data`/`affected`/`total` 等字段）
- 错误处理是否合理
- 边界情况是否覆盖

**额外检查：**
- `query` 的 `where` 语法：简单等值匹配（对象形式）和表达式匹配（数组形式）是否都支持
- `query` 的 `orderBy` 语法：字符串形式和对象形式是否都支持
- `query` 不传 `limit` 时是否默认 100 条
- `query` 响应是否包含 `total` 字段
- `rawSQL` 的限制规则：是否禁止 `_` 前缀表操作、是否禁止 `ATTACH`/`DETACH`
- `rawSQL` 返回值是否根据语句类型自动判断（SELECT → rows，其他 → changes）
- JSON 列是否自动序列化/反序列化
- 建表是否自动加 `id` 自增主键
- 表名/列名校验规则是否正确
- `_meta_tables` 系统表是否正确维护
- 导入导出功能是否完整

### 2. CLI 功能完整性和健壮性

**完整性：对照设计文档的命令列表，检查 CLI 是否全部实现：**
- `synapse tables` / `create` / `drop` / `describe` / `add-column`
- `synapse insert --data` / `insert --batch`
- `synapse query` (含 `--where` / `--limit`)
- `synapse update` / `delete`
- `synapse sql`
- `synapse status`

**健壮性检查：**
- 参数缺失时是否有友好错误提示
- JSON 解析失败时是否有错误处理
- app 未运行时是否正确检测并提示
- `data-server.json` 不存在时是否正确处理
- PID 检测是否可靠（进程已死但文件残留的情况）
- Node.js 版本检查是否正确
- `--where k=v` 解析逻辑是否健壮（特殊字符、多个条件、值中包含 `=` 等）
- `--data` 和 `--batch` 的 JSON 解析是否有错误处理
- 未知命令是否有提示
- 网络请求超时是否有处理
- 并发调用是否安全

### 3. MCP 功能完整性和健壮性

**完整性：对照设计文档的 tool 列表，检查 MCP 是否全部实现：**
- `list_tables` / `create_table` / `drop_table` / `describe_table` / `add_column`
- `insert` / `batch_insert` / `query` / `update` / `delete`
- `raw_sql`

**健壮性检查：**
- JSON-RPC 协议合规性（`jsonrpc: "2.0"`、`id`、`method`、`params`）
- `initialize` / `tools/list` / `tools/call` 方法是否正确实现
- 错误响应格式是否符合 JSON-RPC 规范（`error.code`、`error.message`）
- tool 参数传递是否正确（MCP tool name → HTTP action 的映射）
- tool 的 `inputSchema` 是否与实际 API 参数一致
- app 未运行时的错误处理
- 无效 tool name 的错误处理
- 无效 JSON 输入的错误处理
- stdio 读取是否健壮（不完整的行、空行等）
- 并发请求是否安全（多个 tool call 同时到达）

### 4. 三端能力对等性检查

逐一比对 HTTP API、CLI、MCP 三者暴露的功能，找出不对等的地方：
- 是否有某个接口只在 HTTP 有但 CLI/MCP 没有
- 是否有某个接口的参数在不同端不一致
- 是否有某个接口的返回值在不同端不一致
- IPC 有但 HTTP/CLI/MCP 没有的功能（如 `exportDB`/`importDB`/`installCLI`/`registerMCP`/`getStatus` 等管理功能）是否合理

### 5. 可脚本测试的项目

编写并执行测试脚本来验证以下场景（需要 Synapse app 正在运行）：

**基础 CRUD 流程：**
```bash
# 读取端口信息
cat ~/Library/Application\ Support/Synapse/data-server.json

# 用 curl 测试 HTTP API
PORT=<port>; TOKEN=<token>
curl -s -X POST http://127.0.0.1:$PORT/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"listTables"}'
```

**并发测试：**
```bash
# 并发写入测试（多个 agent 同时执行正好测试并发）
for i in $(seq 1 10); do
  curl -s -X POST http://127.0.0.1:$PORT/api \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"action\":\"insert\",\"table\":\"bookmarks\",\"data\":{\"title\":\"concurrent_$i\",\"url\":\"http://test$i.com\",\"tags\":\"test\",\"note\":\"并发测试\"}}" &
done
wait
```

**边界输入测试：**
- 空表名、超长表名、特殊字符表名
- 空 JSON、畸形 JSON
- 不存在的表名
- 不存在的列名
- 不存在的 id
- SQL 注入尝试（验证是否安全）
- `rawSQL` 尝试操作 `_meta_tables`
- `rawSQL` 尝试 `ATTACH`
- 未认证请求（不带 token / 错误 token）
- 非 POST 请求
- 非 `/api` 路径

**CLI 测试（如果 synapse 命令可用）：**
```bash
synapse tables
synapse create test_agent_$(date +%s) title:text body:text
synapse describe test_agent_xxx
synapse insert test_agent_xxx --data '{"title":"hello","body":"world"}'
synapse query test_agent_xxx
synapse query test_agent_xxx --where title=hello
synapse query test_agent_xxx --limit 1
synapse update test_agent_xxx 1 --data '{"title":"updated"}'
synapse delete test_agent_xxx 1
synapse drop test_agent_xxx
synapse sql 'SELECT 1'
synapse status
```

**MCP 测试（通过 stdin 发送 JSON-RPC）：**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node desktop/dist-data-store/mcp/index.js
```

### 6. Service 层深度审查

- `open()` 中数据库损坏恢复逻辑是否完整
- WAL 模式是否正确启用
- 事务使用是否正确（`batchInsert` 是否在单个事务内）
- `_meta_tables` 的维护是否与实际表操作同步
- `jsonColumns` 缓存是否在所有场景下保持一致（建表、加列、删表、导入后）
- `close()` 是否安全（重复调用、未打开时调用）
- `importDatabase()` 流程是否安全（验证 → 关闭 → 替换 → 重新打开）
- `exportDatabase()` 是否处理了目标路径不可写的情况
- `buildWhere()` 是否有 SQL 注入风险
- `buildOrderBy()` 是否有 SQL 注入风险（`dir` 字段是否校验）
- `toSqlValue()` 是否覆盖所有类型
- 并发读写是否安全（WAL 模式下的行为）

## 输出格式

将检查结果追加到 `plan/数据服务.缺陷检查.md` 末尾，格式如下：

```markdown
---

## Agent 检查报告 - [你的检查重点，如"API完整性+CLI健壮性"]

检查时间：YYYY-MM-DD HH:MM

### 缺陷列表

#### [严重程度: 🔴 严重 / 🟡 中等 / 🟢 轻微]

**[缺陷标题]**
- 位置：`文件路径:行号`
- 问题：具体描述
- 预期行为：设计文档要求什么
- 实际行为：代码实际做了什么
- 影响：会导致什么问题

### 测试结果

（如果执行了脚本测试，记录测试命令和结果）

### 能力对等性矩阵

| 功能 | HTTP API | CLI | MCP | IPC | 备注 |
|------|----------|-----|-----|-----|------|
| ... | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ... |
```

## 注意事项

- 只检查和测试，不修改任何代码
- 不需要启动服务，但如果 app 正在运行可以用 curl 测试 HTTP API
- 多个 agent 并行执行，直接追加到文件末尾，不要读取或修改其他 agent 的内容
- 并行 agent 的测试操作本身就是并发测试的一部分
- 充分思考不同使用场景：AI 编辑器通过 MCP 调用、开发者通过 CLI 调用、渲染进程通过 IPC 调用
- 关注三端能力是否对等，找出不一致的地方
