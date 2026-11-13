<!-- UTF-8 public asset boundary -->
# Codex 团队 Hook 操作指南

文档/发布版本：1.0.2 · 状态：正式可用 · macOS · Python 3.9+

本文是 AI 的操作说明。用户只需发送「请根据 `<本文件链接>` 初始化hook」，也可以把动作换成检查、诊断、修改目录、启停、更新或卸载。以用户本次提供的链接为入口，每次重新读取，不要求用户粘贴长提示词。

## 1. 先判断动作，再执行对应流程

1. 读取本文，确定用户明确请求的动作。用户同时请求多个动作时按顺序执行；无法判断才询问，不把“检查/诊断”理解为“安装/修复”。
2. 确定操作目标目录及已有安装状态。只读动作只做必要读取，不创建目录或回执，不执行 Hook/collector，不测试上报。
3. 执行下表对应章节。全新安装只复用用户在本次聊天中明确给出的姓名、目录；旧文件中的值只用于识别旧安装，不能自动作为新安装的答案。当前项目只是候选，未经选择不当作授权范围。
4. 简短报告：当前状态、实际做了什么、证据及未完成项。不得把“已写配置”“已启用”“已信任”“已执行”“云端已回读”混为一个成功状态。

| 用户动作 | 流程 | 允许的效果 |
|---|---|---|
| 初始化、安装 | 第 4 节 | 安装本方案文件、合并两个 handler、生成回执 |
| 重新安装、重装 | 第 4 节及第 9 节 | 先清理本方案旧安装，再按全新安装收集配置 |
| 检查状态、看看装好了没 | 第 5 节 | 只读 |
| 诊断、排查 | 第 6 节 | 默认只读，可获取公开文件但不执行 |
| 修改姓名、追加/移除/替换目录 | 第 7 节 | 只改用户指定的配置项 |
| 启用、停用 | 第 7 节 | 只改本方案 enabled |
| 更新、升级 | 第 8 节 | 只升级本方案，保留成员配置与其他 Hook |
| 卸载、移除 | 第 9 节 | 精确移除本方案注册和安装文件，不保留配置、回执、备份或占位入口 |

这是给 AI 的流程，不是管理 CLI；launcher 没有 `--install`、`--status`、`--diagnose`、`--uninstall` 等参数，禁止编造。成员操作不包含建表、改云端权限、替换公开素材、发送通知或索取表主凭据。

若状态为“验收中”，只允许明确指定隔离目录的初始化验收，普通安装等待正式可用。Windows 未验收，不执行正式安装；不擅自安装额外依赖或启动/重启用户应用。

## 2. 资源、路径与版本

包标识 `sy-team-capture`；配置与 envelope 协议均为整数 `1`。

| 资源 | 本次发布值 |
|---|---|
| 启动器版本 | `1.0.1` |
| 启动器源码 | [launcher.py.txt](https://synapse.d2.pub/files/asset_m2gI0SFwqZKwlyC7zLzoN51qmxAbCmkC) |
| 启动器 SHA-256 | `05c2d59f2f4e9ce00a17fb1457d8cc51259eb646985c166d0754c5f3c7183879` |
| 注册格式版本 | 整数 `2`，包含安装文件缺失时无操作退出的内联保护 |
| 采集器发布版本 | `1.0.1`，实际运行版本以投递记录为准 |
| 动态采集器地址 | [collector.py.txt](https://synapse.d2.pub/files/asset_KjiwAd1FTnDkJiT77HEQqa4xlpJ4wGEv) |

文档入口可更换；运行时的动态采集器地址在同一部署内保持稳定。改远端过滤、字段映射或目标表时，只替换 collector 内容，不要求成员升级启动器。文档或 collector 版本变化本身不是本地升级条件；启动器版本/源码、协议、运行地址或注册命令格式变化才需要本地更新。本次文档为 1.0.2，运行源码仍为 1.0.1，更新点是注册格式 2 和清理流程。

目标配置目录是实际 CODEX_HOME（如果已配置），否则为 `~/.codex`；不要修改该环境变量。用户或验收上下文明确指定隔离目录时，以该目录为操作目标，不能再修改真实全局配置。

本方案目录为 `<Codex配置目录>/hooks/sy-team-capture/`：launcher.py、config.json、installation.json、last-run.json 和 backups/。检查路径归属及符号链接；回执不能授权删除或覆盖本目录外的任意路径。

## 3. 所有动作都要遵守的边界

- 只采用户所选项目根及子目录的输入正文与最新回复字段。按事件 cwd 匹配，不跟随 shell cd；不采附件、思考、工具输出或中间进度。范围外仍有一次本地检查，随后不下载、不发送、不保存正文。
- 本地只保存姓名、目录、启停配置及本方案元数据。姓名由用户自报，不是可信身份。目标云表由远端维护，仅匿名新增，原始记录不公开，但无法防止他人冒填；成员无需登录 Sy。
- 每次命中目录都下载远端程序，以当前用户权限执行。发布者可以持续更新代码，这不是沙箱。初始化前用一句话说明采集范围和这一权限；按 Codex 正常机制审核确切 Hook，不写入绕过开关或伪造信任哈希。
- 默认同步，Hook 外层 15 秒，下载硬限 5 秒，执行硬限 6 秒。存在有限等待；失败放弃，无正文队列、重试、补发或常驻服务。异步会话退出可能取消 Stop，本版不默认使用。
- 已知内部请求按特征过滤，未知内部请求及其关联回复仍可能混入。Stop 提供最新 assistant 文本，不证明所有客户端/继续回合都与已展示回复完全一致。
- 缺回执、缺新字段或拿不到官方信任状态均是证据不足，不等于未安装。检查/诊断只兼容读取旧回执；初始化或重装中，仅在归属已确认后按下节清理，不凭缺字段盲删。

## 4. 初始化：检查残留 → 必要清理 → 重新收集 → 安装 → 审核

### 4.1 先检查已有状态

确认 macOS、Python ≥3.9、Codex 支持 UserPromptSubmit/Stop；用 sys.executable 确定实际解释器。读取目标 hooks.json、必要的 config.toml、本方案源码/配置和回执，只判断本次安装所需信息。

- 未安装：进入 4.2，全新配置默认 enabled=true；用户本次明确要求停用时为 false。
- 完整、活动注册存在且来源相同：普通“初始化”保持幂等，保留现有姓名、目录和 enabled，不重复注册；旧注册格式可按第 8 节更新。单纯停用且安装完整不算卸载残留。
- **已卸载残留或不完整安装**：例如回执标记 uninstalled、无操作占位 launcher、只剩 config/last-run/backups、缺失有效注册。先证明归属，再执行第 9 节清理；清理完成后必须按全新安装进入 4.2。禁止“恢复旧配置继续用”，禁止自动继承旧姓名、旧目录、enabled=false、旧信任或旧投递证据。
- **用户明确“重新安装/重装”**：即使旧安装完整，也先执行第 9 节，再全新安装。初始化/重装请求包含清理已确认属于本方案的旧文件与条目，不重复索取清理许可。
- 演示来源、多个安装或归属不明：报告冲突，不静默迁移或覆盖。

全新安装和升级是不同动作：“更新”保留现有配置，“重装”先清理后重新配置。不能以回执缺失为由盲删，也不能因为能读出旧姓名/目录就把它们视为用户本次已确认。清理未完成时停止新安装，准确列出未清理项，不把新文件覆盖在残留上。

### 4.2 收集姓名和目录

清理后重新询问姓名和目录。仅用户本次聊天已明确给出的新值可以直接使用；否则必须询问，不从已删除的 config、备份或历史聊天静默恢复。默认 enabled=true 表示新配置允许采集，官方信任状态仍独立审核。

姓名非空、去除首尾空白后不超过 100 字；目录支持一个或多个绝对路径，解析真实路径并确认现存目录。重叠根取最长匹配根，项目名为根目录名称。

需要询问目录时，**实际问题正文/问题卡片正文**必须说明可自定义多个目录以及之后随时增删改，不只在旁边或安装后说明。可用：

> 采集目录可设置一个或多个，之后也可随时追加、移除或替换。你要使用当前项目 `<当前项目绝对路径>`，还是指定其他目录？多个目录可以分行填写。

有选择题时提供“使用当前项目”和“指定其他/多个目录”，并保留自由输入入口，不能仅给“仅当前项目”一个选项。已有明确目录时不重复问，只告知后续仍能调整。

### 4.3 写入自己的文件和 handler

创建本方案及 backups/ 目录（0700）；修改已有文件前备份。完整下载启动器，核对 SHA-256、Python 语法、LAUNCHER_VERSION 及静态 SCRIPT_URL 与第 2 节一致，再以 0600 保存。临时文件与目标放在同一目录，完整校验后原子替换，不留下半个文件。

config.json（0600）结构如下；示例值不是用户已授权的值，不原样写入。不保存表 ID、API Key 或 token。

```json
{"version":1,"enabled":true,"member_name":"实际姓名","project_roots":["实际项目绝对路径"]}
```

必须使用以下注册格式 2，不能继续直接注册 `python launcher.py ...`。内联保护存在于注册命令中，不创建另一份保护脚本：安装文件不存在时输出 `{}` 并以 0 退出，不读 stdin、不联网、不创建目录。这样新聊天缓存该命令后，仍可完整删除安装目录。

从参数数组生成命令，不能手工拼 shell 字符串。路径含空格、引号、反引号或 `$()` 时也要安全。以下源码中的 launcher_args 只帮助静态识别精确参数，不能单独作为删除授权：

```python
"""Registration fragment embedded in the operations Markdown; no management CLI."""
from pathlib import Path
import shlex

REGISTRATION_VERSION = 2
MISSING_LAUNCHER_GUARD = '''import runpy, sys
sys.argv = sys.argv[1:]
try:
    runpy.run_path(sys.argv[0], run_name="__main__")
except FileNotFoundError:
    print("{}")
'''


def hook_fragment(python_executable, installation_directory):
    root = Path(installation_directory)
    args = [python_executable, "-I", "-B", "-c", MISSING_LAUNCHER_GUARD,
            str(root / "launcher.py"), "--config", str(root / "config.json"),
            "--diagnostic", str(root / "last-run.json")]
    handler = {"type": "command", "command": shlex.join(args),
               "async": False, "timeout": 15}
    return {"hooks": {event: [{"hooks": [dict(handler)]}]
                      for event in ["UserPromptSubmit", "Stop"]}}


def launcher_args(command, installation_directory):
    """Recognize only this package's exact v1/v2 argument shape, without execution."""
    if not isinstance(command, str):
        return None
    try:
        args = shlex.split(command)
    except (ValueError, TypeError):
        return None
    if args[1:5] == ["-I", "-B", "-c", MISSING_LAUNCHER_GUARD]:
        args = args[:1] + args[5:]
    root = Path(installation_directory)
    expected = [str(root / "launcher.py"), "--config", str(root / "config.json"),
                "--diagnostic", str(root / "last-run.json")]
    return args if len(args) == 6 and args[1:] == expected else None


def current_registration(command, installation_directory):
    args = launcher_args(command, installation_directory)
    return args is not None and shlex.split(command)[1:5] == ["-I", "-B", "-c", MISSING_LAUNCHER_GUARD]
```

**这是合并片段，不是整个配置文件。** 保留 description、其他事件、同事件其他 group/handler 和其他设置；按精确参数及回执识别自己的两个 handler。同一逻辑已在 inline TOML 时不能再添加 JSON 副本。JSON 用序列化器编码，不能将 JSON 转义当 shell 转义。写前核对原文件未被并发改动，冲突时重读合并；不能安全修改 TOML 就报告，绝不整份覆盖。

installation.json（0600）记录 status=installed、package_id、launcher_version、document_version、整数 registration_version=2、实际 documentation_url、installation_directory、python_executable、launcher_sha256、collector_url、精确 registered_handlers、owned_files、backup_paths、trust_status 和验证项。兼容字段 version 与 launcher_version 相同；owned_files 及 backup_paths 要逐项记录本方案创建的文件/目录，不将他人文件混入。旧回执只有 version 时，结合源码常量与 SHA 核对，不把它当成当前文档或 collector 版本。

### 4.4 审核和验收是独立步骤

必要时只启用官方 features.hooks 对应字段，保留其他配置。正式使用通过 CLI `/hooks` 或桌面 Settings > Hooks / Review hooks 审核。无法读取当前权威状态则为 unknown；历史回执不能证明变更后的定义仍已信任。

安装授权包含一次合成输入/回复验收，可由用户在匹配项目新建聊天完成；不使用真实敏感内容。已有聊天需重新打开并独立验收，不能承诺已热加载。不要自行启动另一个模型会话、扩大写入范围或索取管理员 Key。

完成报告分别说明：配置是否已写入、enabled、信任状态、是否执行、云端是否回读。只看到 `{}` 是正常 Hook 输出，不是投递成功；last-run success 是程序回执，只有表主独立回读等证据才能确认云端正文。未完成审核或回读时准确说明，不报告整套已全部启用。

## 5. 检查状态：只读

读取目标配置、回执及必要源码，核对文件/目录权限、配置类型、真实根目录、两个 handler 是否重复、精确参数和注册格式、async=false/timeout=15，以及静态 SCRIPT_URL/启动器版本/SHA。内联保护作为字符串静态核对，不为检查执行它。

不 import 或执行本地启动器，不创建缺失目录、备份或回执，不为检查发测试消息。解释器版本检查不启动模型会话。last-run 若存在可读，缺失则报告尚无执行证据；它只保留最近一次，不证明全部历史消息都已到达。

通过当前可用的官方只读列表/界面核实启用与信任；无途径则未知，不猜 API/key。给出未安装、旧版卸载残留、不完整、停用、待审核、当前目录未匹配或配置可用等实际状态，不自动修复。目录已不存在且无本方案注册时，报告本方案安装文件和注册已清理，不创建卸载回执来记录这一事实。

## 6. 诊断：先静态检查，后定位边界

先执行第 5 节，再按顺序检查：

1. **事件条件**：启用/信任、旧聊天是否缓存配置、cwd 是否命中。不要把 shell cd 当作 cwd 改变，也不擅自操作用户应用。
2. **本地入口**：解释器、权限、命令转义、合并结果、两个事件及超时。只读/静态解析，不运行入口来“检查”。
3. **公开资源**：有界 HTTPS GET/HEAD，核对状态、完整字节、UTF-8、语法及清单；不执行下载程序，不发送姓名、目录或正文。URL 从静态源码/回执取得，不 import 代码。
4. **最近回执**：按下表解释；父目录不可写或回执目标异常会导致无法保存诊断，自身写入失败不能靠同一回执证明。
5. **云端证据**：匿名读取 403 是预期，不代表新增失败。成员无读表权限，不索取表主 Key，不自动查询/重发；超时或断连不证明没有写入。

| 现象 / outcome | 含义 |
|---|---|
| 无回执或回执较旧 | 可能未执行，也可能停用、未匹配、空回复或不适用输入被跳过；跳过通常不更新回执，先检查静态配置 |
| filtered | 命中当前远端过滤规则 |
| invalid | 输入/记录不符合要求、无法无损保存或超过容量；不等于网络故障 |
| download_failed | 下载、完整性/语法校验、下载子进程启动或时限失败 |
| script_failed / script_timeout | 远端程序异常或超时；程序可能已发请求，不能推断云端没有记录 |
| failed | HTTP 明确拒绝；本版不自动重试 |
| unknown | 可能已经提交但未拿到有效完整回执；不自动重发 |
| success | 收到合法提交回执，尚不等于已由表主回读正文 |

普通诊断到证据、原因及修复建议为止。用户明确请求“修复”或“测试上报”时执行对应动作，已有授权不再询问；仅诊断不能写云表、替换源码、清理证据。报告不回显正文、凭据或无关配置。

## 7. 修改配置、启用与停用

目录不是一次性选择，不用重装或重启，可随时说：

```text
请根据 <本文件链接> 追加采集目录 <要新增的绝对目录>
请根据 <本文件链接> 移除采集目录 <要移除的绝对目录>
请根据 <本文件链接> 将采集目录替换为 <一个或多个绝对目录>
```

先读原配置、验证新值并备份，只改指定字段，保留其余字段及 enabled。追加/移除/替换按原意执行；移除全部目录后空列表不匹配任何项目，不回退当前项目或扩大到全盘。修改目录不重置姓名，修改姓名不启用停用中的 Hook。

启用/停用只将本方案 enabled 改为 true/false，不改全局开关或其他 Hook；未安装就报告，不借启用指令安装。配置在后续事件重新读取，不补采历史。写前检查并发变更，成功后同步自己的安装回执，不伪造或改写 last-run。

## 8. 更新：区分本地入口与远端逻辑

重新读取本文并只读核对归属。文档或 collector 版本变化不触发重装；本地启动器版本、SHA、地址和注册格式均符合当前清单时，报告入口已是当前版。旧版直接调用命令须替换为第 4.3 节的格式 2，即使 launcher 本身的 SHA 未变。明确请求更新文档来源时，可只更新自己的回执。

启动器/协议/运行地址/注册格式确实变化时，备份并下载核对后替换本方案文件和必要 handler，保留姓名、目录、enabled、其他 Hook 和其他配置，再完成必要审核。属于已确认包的旧版入口可在更新请求下替换，不把单纯旧 SHA 误判为未知包；未知归属/演示来源不静默迁移。

回滚使用发布者保留的审核过的源码及清单，不整份恢复旧全局配置。文档链接可更换，不能因与历史 documentation_url 不同就拒绝同一包的合法操作。

## 9. 卸载与重装前清理：删除本方案文件和注册

**成功标准是安装目录不存在，实际配置中也没有本方案 handler。** 不再保留无操作 launcher、disabled config、uninstalled 回执、last-run 或永久备份；不把它们移动到其他目录继续保留。重复卸载不创建任何这些文件。

1. **只读盘点与证明归属。** 限定为目标 Codex 配置下的 hooks/sy-team-capture。结合规范化路径、package_id、已知正式源码/无操作入口、回执和精确命令确定归属。登记自己的固定文件、回执记录的备份目录及可确认的本方案缓存；不得仅按 sy-team 子串或 URL 批量删除。不跟随符号链接，不删除父目录，不信任回执中的越界 owned_files/backup_paths。演示来源或未知文件不能盲删；无法证明就列出并停止，不报告清理完成。
2. **先备份、停用、移除注册。** 仅为当前修改建立受限临时副本，用于失败回滚；原子停用现存有效配置，从实际 hooks.json / inline TOML 精确移除本方案条目（识别旧直接命令与新版内联保护），保留同组其他 handler、同事件其他组、description、其他设置及全局 features.hooks。写前检查并发变更；冲突时重读合并。清空的本方案 group 可移除，但不删除整个全局配置文件。
3. **结束在途窗口。** 本方案程序可能在 15 秒窗口内完成；等待本方案已开始的有限调用退出后再删除文件，不强制结束 Codex 或他人进程，不撤销已提交 HTTP。不能确认的情况如实说明，不能声称所有在途请求已撤销。
4. **删除全部可确认的本方案文件。** 逐项删除 launcher.py、config.json、installation.json、last-run.json、本方案拥有的 backups 及可确认的缓存。对每个路径重新核对范围、类型及符号链接，按已核对清单清理目录并最终 rmdir 本方案根；禁止不经盘点直接 rm -rf。失败或遇到未知文件时停止、报告剩余清单；不留下占位脚本，不在其他位置保存旧姓名/目录作为恢复配置。
5. **信任记录单独核实。** 不清空 hooks.state 或官方全局数据库。仅通过当前官方契约清理能精确确认的本方案信任项；无法定位就保留该全局状态并报告“官方信任记录未核实”，不能伪称全局元数据全部抹除。安装文件和注册的清理结果独立报告。
6. **只读验收，再清理临时副本。** 确认安装目录及本方案注册都不存在、其他 Hook/设置保留；成功后删除本次临时副本，不创建新的卸载回执/备份。结果直接写在聊天中。若清理失败，明确未完成及必要回滚证据的位置；不要继续全新安装。用户另行要求保留导出备份时才按其指定处理，并明确这不是默认无残留卸载。

**旧聊天限制必须说清：** 格式 2 的命令自带缺失文件保护，文件删除后无操作退出。1.0.0/1.0.1 旧聊天缓存的直接 Python 命令无法通过修改磁盘配置被追溯改写，删除文件后可能报找不到文件；应关闭并重新打开这些旧聊天，不为消除提示重新创建占位文件，也不自动重启用户应用。

卸载不删除云表、历史数据、公开素材或用户项目，不发测试消息。重装的清理完成后回到第 4.2 节，重新收集本次姓名/目录，不从旧文件恢复。

## 10. 运行协议与容量

UserPromptSubmit→user/prompt；Stop→assistant/last_assistant_message。envelope v1 传随机 event_id、event_name、UTC 毫秒 event_at、session_id、turn_id、member_name、project_name、platform、role、content，不传绝对项目路径或整个 Hook payload。同轮多条输入各有 ID，不互相覆盖。

输入≤4 MiB、源码≤256 KiB；有 Content-Length 时核对完整长度，再验证 UTF-8/语法。正文按实际 UTF-8 JSON 分片，每条 values≤48 KiB、单批≤900 KiB、最多100条，一条消息只发一个原子批次。按 event_id、part_index 重组；超限或不能无损存储则放弃，不截断、不拆多批。云表系统 ID/时间/版本由服务端生成，匿名 creatorUserId=null。

last-run 只含 outcome、event_id（有效事件时）、launcher_version、recorded_at，不含正文、姓名、目录或远端任意输出。正常 Hook 仅输出 `{}`，不注入上下文、不阻止或续写。临时源码/输出/诊断临时文件在本次调用后清理，不是待发送队列。

正式支持范围为 macOS；Windows、所有旧聊天/steering/中断组合未全面验收。官方信任界面仍需成员按 [Codex 官方 Hooks](https://learn.chatgpt.com/docs/hooks) 完成，不能据隔离验收声称已代每位用户操作。
