# Codex 团队 Hook 1.0.2

正式支持 macOS、Python 3.9+。成员操作入口由 `release.json` 的 document URL 给出；对外文档由 `operations.template.md` 生成到 `docs/agent-guides/codex-team-hook.md`。发布状态以清单和验收记录为准。

运行层只有 `launcher.py` 和远端 `collector.py`，本次两者仍为 1.0.1。`registration.py` 是嵌入 Markdown 的注册片段来源，不作为额外本地程序安装；格式 2 通过内联缺失文件保护让缓存的新命令在完整卸载后无操作退出。安装、状态、诊断、配置及卸载由操作 Markdown 指导 AI 执行，没有独立管理 CLI。

全新安装遇到已确认的卸载残留，或用户明确重装时，先清理本方案文件和注册，再从本次用户输入收集姓名/目录，默认 enabled=true。普通健康安装的重复初始化保持幂等，更新保留配置。卸载不再保留配置、回执、占位脚本或永久备份；归属不明的文件不盲删，未清理完不能声称卸载完成。旧版直接命令的历史聊天仍需关闭重开，不能追溯修改其内存缓存。

## 验证

不联网的独立测试：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/codex-team-hook -p 'test_*.py' -v
```

`acceptance.py --run --phase configure` / `--phase uninstall` 会发起真实模型调用，默认操作仓库 `work/codex-team-hook-release/` 内的隔离配置；不会注册真实全局 Hook。可用 `--work-dir` 指定本仓库 work/ 内的新目录。检查点绑定文档、启动器及采集器的版本和哈希，禁止复用旧版检查点跳过新版验收。

`runtime_acceptance.py --run` 搭配 `--mode model`、`--mode long` 或 `--mode update` 和相同的 `--work-dir`，会先核对检查点及实际安装源码/回执，再向正式表发送合成验收记录，仅限明确授权的维护验收。运行结果不能代替表主回读。

本次验收的进度/原始日志保存在上述 Git 忽略目录。当前版本证据记录在 `validation.json`；1.0.0 的完整十项生命周期保存在 `validation-1.0.0.json`，1.0.1 的四组真实 AI 操作及云端回读保存在 `validation-1.0.1.json`，不把历史结果标成新版重测。这些文件不保存账号凭据或真实业务正文。正式表的本轮验收样本回读并留存证据后，只按本轮精确 ID 移入回收站，不清空表或处理其他数据。

## 维护发布

1. 修改 collector 时保持 envelope v1 与云表字段兼容，增加采集器版本。运行独立测试。
2. 通过 Synapse MCP 搜索当前上传/替换工具契约，使用清单中确切 collector assetId 替换同一公开资源，不新建运行 URL，不把表主 Key 写进程序。
3. 更新 release.json 中源码哈希、文档发布版本及独立的 launcher_version/collector_version。只有本地入口确实变化时才升级 launcher；为其创建新的版本化公开素材，保留旧文件以便核对历史 SHA 和回滚。collector 仍使用原稳定 URL。
4. 修改注册格式时同步 registration_version/registration_sha256。运行 `python3 scripts/codex-team-hook/build_document.py`；构建核对源码哈希及版本常量，将同一注册片段嵌入文档，并处理当前公开素材的 UTF-8 前缀兼容。不要直接编辑生成后的 Markdown。
5. 替换清单中的 document assetId，匿名下载并比较全部字节。文档地址不写进运行入口，用户可以通过发布后的任意实际 Markdown URL 发起操作。

此发布流程仅更新独立 Hook 资源，不启动 Synapse 的 CI、Release、iOS 上传或服务器部署。既有演示包及其数据继续保留。
