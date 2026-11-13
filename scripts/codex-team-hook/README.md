# Codex 团队 Hook 1.0.0

正式支持 macOS、Python 3.9+。成员操作入口由 `release.json` 的 document URL 给出；对外文档由 `operations.template.md` 生成到 `docs/agent-guides/codex-team-hook.md`。发布状态以清单和验收记录为准。

运行层只有 `launcher.py` 和远端 `collector.py`。安装、状态、诊断、配置及卸载由操作 Markdown 指导 AI 执行，没有独立管理 CLI。

## 验证

不联网的独立测试：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/codex-team-hook -p 'test_*.py' -v
```

`acceptance.py --run --phase configure` / `--phase uninstall` 会发起真实模型调用，并操作仓库 `work/codex-team-hook-release/` 内的隔离配置；不会注册真实全局 Hook。`runtime_acceptance.py --run` 搭配 `--mode model`、`--mode long` 或 `--mode update` 会使用该隔离安装向正式表发送合成验收记录，仅限明确授权的维护验收。运行结果不能代替表主回读。

本次验收的进度/原始日志保存在上述 Git 忽略目录。交付证据记录在 `validation.json`，不保存账号凭据或真实业务正文。正式表的本轮验收样本回读并留存证据后，按精确 ID 移入回收站。

## 维护发布

1. 修改 collector 时保持 envelope v1 与云表字段兼容，增加采集器版本。运行独立测试。
2. 通过 Synapse MCP 搜索当前上传/替换工具契约，使用清单中确切 collector assetId 替换同一公开资源，不新建运行 URL，不把表主 Key 写进程序。
3. 更新 release.json 中源码哈希和版本；只有本地入口确实变化时才升级 launcher 并更新其公开资源/哈希。
4. 运行 `python3 scripts/codex-team-hook/build_document.py`。构建会核对源码哈希并处理当前公开素材的 UTF-8 前缀兼容；不要直接编辑生成后的 Markdown。
5. 替换清单中的 document assetId，匿名下载并比较全部字节。文档地址不写进运行入口，用户可以通过发布后的任意实际 Markdown URL 发起操作。

此发布流程仅更新独立 Hook 资源，不启动 Synapse 的 CI、Release、iOS 上传或服务器部署。既有演示包及其数据继续保留。
