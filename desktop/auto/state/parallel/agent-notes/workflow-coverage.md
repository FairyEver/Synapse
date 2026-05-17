# Workflow 测试覆盖状态

## http_request
- GET+headers+query ✅
- POST+JSON body ✅
- PUT+text body ✅
- PATCH+param注入 ✅
- DELETE method ✅
- Bearer auth ✅
- 无效URL错误处理 ✅
- node_output变量绑定到URL ✅

## script
- 单命令执行 ✅
- S1 多行脚本+管道 ✅
- S2 自定义环境变量 ✅
- S3 失败+stderr ✅

## 混编
- http_request→prompt（变量绑定）✅

## 其他
- DeepSeek flash 配置验证 ⚠️（402余额不足，配置正常）
- Switch 分支路由 ❌（end节点通过switch分支边时engine bug）
- 并行节点执行 ✅

## 未覆盖
- timeout 配置
- switch 分支路由（需修复engine bug后重测）
- 混编 M2 (script→http_request)
- 混编 M3 (并行扇出汇聚)
- 混编 M4 (script→switch→路由)
- end node template
