# 穿透管理 API

## Reaching Synapse tools

The Synapse MCP server publishes only two tools: `search` and `invoke`. Search the `tunnel` domain, obtain the desired canonical tool's complete schema, and invoke that exact name with matching arguments. Never call a catalog name without discovering it first.

工具名与 capability 点替换下划线一一对应：

| 工具 | 参数 |
| --- | --- |
| `app_tunnel_mapping_list` | 可选 offset（默认0）、limit（默认20，最大100）、clientInstanceId；返回 items / total / nextOffset，直到 nextOffset=null |
| `app_tunnel_mapping_get` | id |
| `app_tunnel_mapping_create` | port、稳定 UUID requestId |
| `app_tunnel_mapping_update` | id、port、expectedRevision |
| `app_tunnel_mapping_set_enabled` | id、enabled、expectedRevision |
| `app_tunnel_mapping_delete` | id、expectedRevision |

返回链接、端口、所属设备、enabled、revision、运行摘要与日期。运行状态为 connecting / running / local-unavailable / offline / stopped / authorization-required / error；running 仅表示可连接本机端口，不保证业务响应成功。无请求日志和正文读取接口。401 需登录；403 权限不足或其他设备；409 需刷新；410 地址退役；429 达到配额。不同过滤条件从 offset=0 重新分页。
