# 工作区文件 V1 验收记录

日期：2026-10-03～04。状态：已完成下列限定场景的功能与Apple界面验收；原自动报告与未覆盖范围分别保留。v1.0.57完整发版完成：CI、正式桌面Release与说明归档、iOS 1.0.57（71）上传、最终服务器部署、42账号站内信入库均成功；Apple后续处理与设备显示不作为上传返回成功的替代证据。

规格：[V1 spec](../specs/2026-10-03-mobile-workspace-files-and-changes-spec.md)。计划：[P00–P09](2026-10-03-mobile-workspace-files-and-changes-plan.md)。本记录区分真实运行证据、单元/静态检查和未覆盖场景，不以跳过或编译成功代替验收。

## 当前冻结产物的验收状态

后端最终读取产物通过109专项、typecheck、架构约束与真实两跳15项检查；iOS最终业务覆盖960项（分批去重，不是同批）。以下四设备完整功能矩阵后，原生行触选发现的实际低对比/持续空行已由R123修复，并完成四外观/字号组合、同App外观转换及独立原片/像素复核；Pad18最大字号两层Git通过自然AX现场与独立原片确认。最后R123 phone18受影响Browse/Composer两项109.842秒、0失败/0跳过通过。当前未发现剩余确定产品P1/P2，功能提交与完整发版已完成；最终iOS两处空析构编译规避及更新指纹见发布记录。原Pad自动ALL失败、r139自动proxy命中失败与物理设备/性能取证边界保持，不声明全App无障碍通过或界面SDK根因。

| 平台/场景 | 当前实际结果 | 原始日志 |
| --- | --- | --- |
| iPhone / iOS 18，四项完整流程 | r111：4项通过，0失败/跳过，231.492秒；独立新录像字号、0204预览、0160 Back复核通过 | `/tmp/synapse-files-ui-iphone18-r111-final-matrix.log` |
| iPhone / iOS 26，四项完整流程 | r112：4项通过，0失败/跳过，307.037秒；独立新录像字号、0204预览、0160 Back复核通过 | `/tmp/synapse-files-ui-iphone26-r112-final-matrix.log` |
| iPad / iPadOS 18，四项完整流程 | r114：浏览/引用/分页通过；Git实际两层切换完成，审计有6项partial Dynamic Type，整轮仍失败 | `/tmp/synapse-files-ui-ipad18-r114-final-matrix.log` |
| iPad / iPadOS 26，四项完整流程 | r115：四项356.018秒，4项Contrast报告而整轮失败；全部功能完成；四个浅色对象已独立量化，原始ALL失败保留 | `/tmp/synapse-files-ui-ipad26-r115-final-matrix.log` |
| iPadOS 26真实窗口伸缩 | r110：97.323秒通过；834×1210→375×491→798×1150.5→原尺寸，重开、定位与草稿有独立新录像证据 | `/tmp/synapse-files-ui-ipad26-r110-content-reopen-window.log` |
| iOS 18实际最大字号/深色搜索 | r113：57.485秒通过；实际滚到结果、打开UTF-8、菜单关闭与Reveal可达，全项审计无报告 | `/tmp/synapse-files-ui-iphone18-r113-max-dark-search.log` |
| iOS 26实际最大字号/深色引用与搜索 | r116：两项通过，0失败/跳过，195.069秒；长中文文件名、末行、菜单/关闭、两种引用与Reveal真实完成，全项审计无报告 | `/tmp/synapse-files-ui-iphone26-r116-max-dark.log` |

v1.0.57完整发版已完成，具体证据见下方发布记录。iPad原始自动审计失败仍保留；相应实际字号/色对与菜单已经取得独立复核，不由旧轮通过、静态代码或编译成功覆盖。

## 环境与修改边界

- 开工前工作区干净，先提交计划执行授权，提交 `0ee51242d`。开发、协议与桌面/iOS 分别由开发代理负责，安全和 Apple 界面由另一代理独立检查；本任务没有新增依赖或公开 capability。
- 本机 Node 22.22.3、Git 2.50.1；已有本地服务 `127.0.0.1:3001` 用于真实认证与 WebSocket/HTTP relay。
- `/tmp/synapse-workspace-files-acceptance` 是独立夹具，不修改用户项目。HEAD/index/disk 三侧 `review.txt` 分别为 BASE/STAGED/WORKTREE；含深层 UTF-8 文本。
- 22:37经设备owner交接后固定追加 `nested/paging/page-0000.txt`～`page-0204.txt`205个文本，夹具Git exclude排除该目录而普通文件浏览仍可见；此后UI矩阵期间不再变更。端点源码同步复现长文件名与分页夹具，已有不同内容拒绝覆盖。
- 桌面验收端点运行编译后的真实读取服务、PermissionGuard、受控 Git 和磁盘。终端帧仅为展示夹具，不声称启动了真实 PTY；真实 gateway 的零 PTY/租约/网格副作用另由回归验证。
- 18:47 真实 iPhone/iPad 均不可用；19:18 再核对时 iPhone 已 available，iPad 仍不可用。本次尚未对真实设备安装测试包；已询问连接 iPad 或采用模拟器记录缺口。真机半窗/窄窗伸缩及实际指针/VoiceOver 不得写成已通过。

## 已取得的证据

| 范围 | 实际结果 | 对应 AC |
| --- | --- | --- |
| 共享协议 | 全 shared 234 tests、typecheck 通过；10 操作、输出完整性、CJS/ESM、UTF-8 字节和 POSIX 字面反斜线 fixtures | 12、14、18 |
| 服务端 relay | 最终 7 suites / 110 tests 和 typecheck 通过；控制队列显式失败与优先级覆盖通过 | 09、13、15、18、22 |
| 桌面网关 | 初次整合16 main suites /411（service32/Live38/config5）与renderer161通过；后续service45/config6与Live39、formatter4分别全量通过；原renderer161增加两个真实Windows路径producer回归，最终163全部通过。发布前alternates修补后固定源码5套102/102（service53、config7、controlledRunner32、gitCommand4、clientRunner6）通过，119.23秒、exit0；desktop完整typecheck与hard constraints再次通过。Git内置转换修补后最终5套109/109（service60、config7、controlled32、gitCommand4、clientRunner6），126.18秒、exit0，完整typecheck/HARD再次exit0；root亲核原始结果。按完整替换service/config去重后main443+renderer163=606项，不是同批606。涵盖可信上下文、旧缓存绕过、账号竞态、配置/撤权、binary、FIFO、原功能回归和逐次Git元数据检查 | 09、13、15–18、23 |
| 原终端真实 relay | `mobile-relay-smoke.mjs` 18/18 checks 通过，旧手机/桌面基础路由、离线与鉴权保留 | 18 |
| 文件真实两跳 | 最终源码build:electron exit0；新端点使用独立标准配置home与最终metadata/binary读取。`workspace-files-smoke.mjs`11/11：双能力、scope、深层目录、UTF-8、搜索、staged/unstaged diff及侧预览、引用、伪句柄、HTTP真实认证回退、关闭后拒绝。日志`/tmp/synapse-files-final-compiled-build.log`、`/tmp/synapse-files-final-real-smoke.log`；夹具startedAt固定后的最终重验`/tmp/synapse-files-final-stable-fixture-smoke.log`同为11/11 | 02、03、05–09、12、16、18 |
| 最终分页夹具两跳 | 先取得13/13；指纹修订后新产物最终15/15、exit0：反序对象键续页仍100/100/5同directoryVersion、205句柄无重复，第3页搜索/预览正常；同ID顶层/嵌套键序重传复用结果，真target改变仍request_conflict，原Git/HTTP等均通过。日志 `/tmp/synapse-files-object-order-real-smoke-green.log`；修订后full build `/tmp/synapse-files-canonical-final-desktop-build.log` exit0 | 05–07、12、18 |
| iOS hosted 测试 | 定位P2修订前业务源码分3批共951项全部通过：Config7、remaining936 Swift Testing/97 suites+6 XCTest=942、Restore2（含真实30秒离线恢复）；Flow25项含同query合并与2项缓存回归。无失败或skip，不声称同批完整951。日志/xcresult为`/tmp/synapse-files-unit-final-{config,remaining,restore}`；隔离重建的xctestrun TestHostArguments/CommandLineArguments均空。定位修订后完整Flow34项已hosted实跑通过（0.248s、零失败/零skip），日志/xcresult `/tmp/synapse-files-unit-flow34-final`；去重后的最终业务覆盖960项（951−25+34），不是同批完整960。此前混合旧批943有2配置失败，未改期望或生产默认，旧失败轮不计通过 | 01、08、12–18、23 |
| 架构 | `check:hard-constraints` 通过；未新增公开 MCP、System App、Dock、Workflow、Automation 或 Deep Link；Terminal MCP 仍为 49 | 23、24 |
| 桌面打包基线（最后两项Git修订前） | 指纹与原拖拽修订后再次full build exit0，以正式electron-builder配置重新生成独立`/tmp` mac-arm64 App（1.0.54、ad-hoc 签名，未安装）；真实 ASAR gate exit0：27,967 packed /1,619 unpacked，JSON Repair、PDF/DOCX、HTML Worker 与 node-pty 包内 smoke 全通过。最终日志 `/tmp/synapse-files-canonical-final-desktop-build.log`、`/tmp/synapse-files-canonical-final-desktop-package.log`、`/tmp/synapse-files-canonical-current-packaged-asar.log`。不等同于后续正式签名、公证或 Windows 包 | 23、24 |

## 独立检查与修订

以下按最终行为归并，不把先前失败轮或被新发现接续的冻结结论计为最终通过。原始测试日志、截图和 xcresult 保留在本机 `/tmp/synapse-files-*`；其中包含失败证据，不都是通过结果。

| 发现 | 修订与关闭证据 |
| --- | --- |
| Git 外部扩展可能在后续工作树比较中执行 | 工作树比较改为安全 disk/raw blob 与有界异步差异，Git 仅使用固定只读 argv/env；真实 filter canary 未执行，index/objects 未改变。 |
| 已打开scope后新增或填充alternates可借外部对象库 | 真实macOS Git canary在旧代码3/3红；所有已知context的原生命令统一前后检查gitDir/commonDir的两种alternates，仅缺失或零字节可用。使用同一有界安全FD的实际sizeBytes拒BOM-only，覆盖cat-file三阶段及子模块HEAD。修补后3/3绿、最终5套102/102通过，另一代理独立静态检查无新增P1/P2；root核对原始成功命令后提取 `/tmp/synapse-files-alternates-final-{tests,typecheck,hard-constraints}.log`，没有另跑或混入旧轮。04:04经设备owner明确交接后full desktop build exit0，仅重启验收端点、同冻结夹具真实两跳15/15 exit0，日志 `/tmp/synapse-files-post-alternates-{desktop-build,endpoint,real-smoke}.log`；用户本地3001服务未重启。新增Windows用例不skip，但本机未原生运行。前后软件gate不等于系统级原子文件隔离。 |
| 账号切换与建连、opening 撤权存在竞态 | 捕获账号和 connection generation；清 grant/cache、abort opening/read，并在最后 await 后再验证。独立 before-token/after-grant 回执分别 cancelled/permission_denied，scope=0；Live 最终 39 tests 通过。 |
| Git 发现 metadata 检查后仍可能被换成 FIFO，阻塞读取 | 四个发现读取及子模块同类路径复用安全 FD 读取；精确授权、NOFOLLOW/NONBLOCK、普通文件/祖先/身份/增长/取消复验，pointer/commondir 4 KiB、config 64 KiB。20:44 最终冻结后 service42/config6 全量通过；独立原 open seam 6/6、0skip、718ms，无 writer 4–10ms 拒绝，在途 cancel 4ms 完成，所有槽位/队列/scope 清空。1 MiB 增长仍最多请求 4097/65537 bytes。日志 `/tmp/synapse-files-discovery-metadata-final.log`。 |
| 全局 autocrlf、includeIf、执行位与 CRLF/binary 分类有偏差 | 只读解析精确授权的标准 home/XDG global 与 local 固定快照并绑定版本；拒 include/filter 与未知系统覆盖。14 个真实配置夹具验证优先级和 native numstat；使用 Git 的 S_IXUSR，禁 system attributes。未修改用户全局配置。 |
| index NUL→disk 文本的反向 binary 与摘要不一致 | 确认 modified 后有界读取 raw index，任一侧 NUL 则整体 binary；二进制双方禁预览。单侧超过 2 MiB 时保留另一侧安全文本预览，统计未知。正反 binary、巨大侧、CRLF/filter 的独立夹具关闭；曾复现的失败不计通过。 |
| 特殊路径、闲置 scope、正文/模型放大与队列拥塞 | POSIX 字面反斜线/合法冒号/尾点保留，Windows/UNC fail-closed；定时回收和 dispose；分配前 20,000 行/4 MiB 模型预算。两跳生产 sender 有界排队，普通 ack/cancel 与真实 Live keys handler 不等待推进 clock；读页完整 exactly-once 或明确失败。FakeSocket 证据不等于真实慢网络或 PTY。 |
| 选区、搜索与离线快照行为 | String.Index 只从当前正文合法 UTF-16 边界生成；6 项纯 helper 和真实中文/emoji 草稿引用通过。搜索统一 256 UTF-16/1 KiB UTF-8。暂缺 summary 保留快照，确认结束才清理；离线重新打开按钮与 Flow 双门控，不清快照或发请求。最终 hosted 三批共951项已通过。 |
| 连续小结果搜索的 LRU 历史索引没有随删除页清理 | 独立检查定位到 pages 删除后 recency 保留旧 key，空/小页无法触发正文预算驱逐，历史索引持续增长。21:56窄修统一删除页、对应LRU记录并立即recount；2项回归覆盖128次不同空/小查询与新请求回答前的字节释放，保持目录/正文缓存和请求行为。另一代理源码复核接受，最终hosted真实实跑分别0.039s/0.001s通过，已关闭。 |
| 搜索结果“在目录中显示”未实际定位回树 | 最终独立检查发现文件分支调用预览、紧凑界面切详情；父目录无条件重载首批，后续页目标不在树中，已展开的目录也可能被toggle折叠。已有搜索重置测试未断言这些行为，951项通过不覆盖该缺陷。已修订祖先展开、父目录分页与一次定位事件；成功清预览、主动选择清旧事件并精准取消本次定位读取。新增9项回归后完整Flow34 hosted通过，独立源码复核接受；r29真实notes回树及同文件重开通过；真实后页回树与另一文件返回位置UI仍待关闭。 |
| 后页定位的惰性目标组尚未创建 | r30真实大集合中Flow已成功回树、搜索已清，但0098所在第2呈现组尚未创建，Reader直接定位内部行没有生效，屏幕仍为0000起始行。证据 `/tmp/synapse-files-r30-paged-failure.png`；已修订先呈现真实目标组、再定位内部行，按generation一次消费；r31实际0097/0098均可达且全项audit零issue。整轮后来因桌面指纹拒绝续页失败；未创建/已创建组、第三页及返回位置最终UI仍待关闭。 |
| 真正200行中的字号位置跳转、遮挡与短结果空白 | r32最终端点真正加载第2页后，出现12个具名partial Dynamic Type（0099–0110）、3个contrast（0096–0098），随后0100搜索空白，整轮16失败。录屏最大字号首行0098附近→0038，恢复后回0099；contrast目标AX位于顶部栏/搜索inset下面，均primary而非颜色不足。空白AX保留高8116、offset−5325且无文件children。已独立判读，正在采用18原生scrollPosition、组内scrollTargetLayout、按角色存真实leading ID与scope版本清理，并把inline搜索置于真实滚动视口上方；尚未关闭。证据 `/tmp/synapse-files-ui-iphone18-r32-final-paged.xcresult`、`/tmp/synapse-files-r32-font-transition.png`。r31首个边界audit因当时第二页请求失败只覆盖小集合，不能替代200行验证；新viewport0098为首行、0097屏外，测试改为分别滚动验证两侧可达，保留完整全项audit。 |
| iOS续页的JSON键序变化被当作不同参数 | r31已真实到达0097/0098并通过边界全项audit，随后0100回树收到invalid_cursor，整轮失败。独立compiled真实101文件夹具及两跳新版smoke均复现：反序keys续页拒绝、原序成功；同ID顶层/嵌套target反序重传报request_conflict。Server pending已递归排序、独立反序重传正常。桌面cursor与task两处已改私有递归稳定对象序列化，保留数组及所有原语义约束；新增3项旧源码红→专项绿，完整service45全部通过。23:18最终源码fullbuild后端点经owner交接更新，两跳新版15/15关闭协议误拒绝；最新compiled独立101文件Service canary10/10、零fail/skip、1.764s，反序及嵌套重传深相等、真target/context变化仍拒，dispose后scope/cache/active/queued均0。iOS整轮续验仍待。红/绿日志 `/tmp/synapse-files-object-order-real-smoke-{red,green}.log`。 |
| Windows Git Bash原桌面拖拽被共享formatter拒绝 | 最终独立检查复现原producer返回native `C:\\...`，新helper却只接受`/c/...`；CMD/PowerShell正常。已仅在Dropped helper为已知POSIX shell恢复HEAD原字节转义，不猜/c或/mnt/c挂载；手机strict Reference仍拒native drive/UNC。formatter4/4、renderer163/163（新增真实File与workspace resolver两个producer回归）和四套tsc/hardconstraints通过；独立源码复核接受，最新compiled formatter canary8/8、零fail/skip，native drive/UNC逐字等于HEAD输出，手机/未知shell/controls仍拒，两项P2已关闭。 |
| 原终端路径引用回归与正式包遗漏 | 共享 formatter 保留 Windows Git Bash 输出，原 renderer 回归通过；新服务、Git/config/path 与 shared CJS 预算加入正式包 gate，31 个打包夹具通过。22:27当前源码的独立mac-arm64 App也通过真实ASAR与包内smoke；正式签名与Windows包仍须CI/Release gate。旧本地1.0.46包缺新模块而失败，不计新包证据。 |

Apple 检查已修订实际命中范围、详情关闭作用域、有效 detents、两侧行号、搜索 tab 范围、显式目录/根引用、自然朗读标签、只读选择/复制、长标题菜单/关闭可达与终端 overlay 状态。iPhone26 r28、MenuPicker 修订后的 r29 均 3/3、0skip，包含树/预览/差异默认全项 audit、真实 Copy、横屏、WORKTREE→STAGED、中文/emoji 草稿与真实引用。它们是前一源码的运行证据，不能替代后续修订的最终四设备矩阵。

iOS18 矩阵发现的分段选择字号不增长、未知统计/缺失行号语义以及快速字号变化时根路径/Picker 值裁切，已按真实录屏修订。选择统一为原生 `Menu { Picker }` 和实际可换行值，`AnyLayout` 在辅助字号纵排；只读 UITextView 在测量与更新时使用同一环境 UIFontMetrics。r5 最大字号帧中的根路径完整四段、当前目录/所有文件完整；不是用静态字体、隐藏文件内容或过滤审计取得。

**此前iOS18 r29浏览整轮通过；大集合新增UI缺陷及最终四设备矩阵仍待关闭。** 原树列表分布为8项No element（4项Dynamic Type unsupported、1项部分不支持、3项clipped）；r19生产主Button结构将问题减少到3项（1项unsupported、2项clipped），当轮仍为失败。单设备收集、撤销额外 contain/isModal、移除 UIKit canvas 和只改变背景 opacity 的控制轮均未关闭它们；这些临时修改已撤回，不能归因并行、后台终端或 SDK。后续真实分组数据修订后的浏览整轮与树/搜索/预览全项audit已通过；真正200行新发现见上表，未用小集合结果代替。

r35 真正200行审计没有 Dynamic Type 报告，但整轮仍失败：2项contrast的目标0189/0191位于真实ScrollView视口上方，随后0100定位目标不可点。独立录屏判读为72秒首行0098、78秒最大字号首行0024、80秒恢复字号首行0192、91秒Reveal后首行0139；零字号报告不能证明阅读位置稳定，也不能据此修改primary颜色。已保留 `/tmp/synapse-files-ui-iphone18-r35-boundary-evidence.xcresult` 对应运行附件及 `/tmp/apple-review-r35/frame-78.png`、`frame-80.png`、`frame-91.png`。下一候选使用单个主LazyVStack登记平铺真实行ID；r36直Reader定位0098尚未生效，正在验证iOS18统一通过原生scrollPosition绑定写入目标。Apple文档没有明确禁止同级target layout，故不把实验结果解释为已确认SDK根因或已完成修复。

后续18实现改为主LazyVStack平铺行ID、按角色保留ScrollPosition与容器身份，scope/context/generation限定定位事件。r51真实首次0098定位及后半0100/第三页0204预览、0160返回位置等功能全部完成，但全项审计仍3失败。r52把位置Binding改为即时读取当前状态、保留body观察依赖后，Dynamic Type问题为0，仍有具体搜索框裁切及2个视口外contrast（0094 y120～164、0095 y172～216，真实viewport top218）。独立逐帧判读 `/tmp/apple-review-r52/frame-34.5.png` 目标完整→`frame-35.png` 漂到0056～0067且0098完全不可见→`frame-35.5.png` 返回→`frame-36.png` 最大字号目标完整→`frame-36.5.png` 默认恢复目标可见；因此功能完成及零字号报告不能证明整个转换稳定。r53仅加绘制clipped仍3失败、功能完成，已撤回无效候选。原始附件分别保留在 `/tmp/synapse-files-r51-role-attachments`、`/tmp/synapse-files-r52-live-attachments`、`/tmp/synapse-files-r53-clip-attachments`；搜索形制、位置转换与最终设备矩阵继续待验。

r54只改搜索为plain，仍3失败（具名搜索框默认22pt裁切、1项nil Dynamic Type、1个视口外contrast），已撤回。r55回到rounded基线且只补诊断，仍3审计失败、功能完成；00:41:19.844真实交互将位置存为0097，20.094回idle。后续23～27秒字号审计期间没有position setter、新request或phase变化，几何offset仍6270→5205→4140→13349→5216，录屏35秒0098完整→35.5秒0076～0087且0098全离屏。此证据排除该次漂移由绑定回写/新定位触发，不能继续用userFlag过滤native写回；真实interacting回调中的isUser也为false。原始 `/tmp/synapse-files-ui-iphone18-r55-pure-phase-diagnostic.log`、`/tmp/synapse-files-r55-font-35.png` 与`35.5.png`保留。下一实现采用iOS18原生UITableViewDiffableDataSource与UIHostingConfiguration复用行内容，并重新验收；此前滚动候选不计最终通过，UIKit选择也不表示已取得性能测量。

UIKit候选的r56小集合三处全项审计零issue，但notes回树不可点，整轮失败。r57结构日志证明没有提前回执：命令早在sidebar转场的402×622 bounds发出，真实视口仅(0,556,281,318)，目标rowRect(-121,912.7,402,66.3)全在屏外；最终table确会变为284高。首发门槛修订为本表格可交互矩形与window/祖先裁切后视口一致，保持scope/context/ticket校验，不以preferredColumn或挂window替代呈现完成。r58小集合完整1/1、零skip、默认ALL零issue通过，包含notes回树真实hittable、再开同文件、Copy与横屏；00:59:54.727中间矩形未发，54.770最终(0,556,402,284)满足门槛，54.772首次命令、54.805回执，无timer或重复定位。证据 `/tmp/synapse-files-ui-iphone18-r58-table-layout.{log,xcresult}`。这不是200行或最终四设备证据，后续大集合与原生搜索替换仍待验收。

r59大集合滚动时意外退出，仍计失败。独立读取真实crash report `/Users/liyang/Library/Logs/DiagnosticReports/SynapseMobile-2026-10-04-010121.ips`，主线程SIGSEGV符号链是strcmp→runtime_issue_os_log_fault_callback→LIBTRACE高日志量隔离→XCTAccessibilityFramework属性查询，没有应用业务/Table函数；此事实不等于产品无问题或SDK根因已定。删除临时诊断后r60原样复验没有意外退出或QUARANTINE，真正200行、0098/0100命中通过，但仍1项No element contrast，第三页因原生显示“分页已过期，请刷新”失败，整轮122.033秒。字号录屏75～82秒每0.5秒抽帧 `/tmp/synapse-files-r60-font-01.png`～`14.png`已独立核对：默认→中间→最大→恢复的14张中0098均完整可见，08最大字号自然换成两行，未见此前远距离漂离；前行可有残尾，不宣称top-leading身份或像素恒定。此项证据仍不替代最终矩阵。唯一Contrast原始No element，没有元素截图或AX关联，目标仍未知，保留失败、不判假阳性。原片 `/tmp/synapse-files-r60-table-attachments/8C13AB9F-FEED-4816-9715-A51EF938F249.mp4` 与过期截图 `/tmp/synapse-files-r60-0204-fail.png`保留。测试接续按spec的60秒idle cursor边界，在慢全项审计和0100后明确点击用户可操作的刷新，再重搜/定位0204，保留实际100/100/5、真实hittable和Back0160要求；不延长产品TTL或静默重放旧游标。

r61使用原生UITextField搜索，并在慢审计后明确刷新，再取得第三页。0204数据已存在，但真实行不可点，画面停在0135～0144；独立读取目标cell位于y4774，确认是屏外目标，不能作为AX误报处理。整轮118.060秒，1项No element Contrast、零Dynamic Type，另有定位失败。原始 `/tmp/synapse-files-ui-iphone18-r61-native-search-paged.{log,xcresult}` 和 `/tmp/synapse-files-r61-table-attachments/1246F2DC-CDDA-44F7-88B9-A66DC5572903.png` 保留。

r62仅增加每次定位最多三条结构日志，没有改变UI行为。整轮仍失败：1项No element Contrast、3项partial Dynamic Type（原生搜索输入、外部搜索按钮和1个未知目标），审计后0098的真实hittable断言失败，第三页未执行。0098录屏仍可见，因此尚不能认定与r61相同，也不删除功能断言；默认44/58pt AX高度不能证明最大字号固定高度，实际录屏搜索控件会增长。原始 `/tmp/synapse-files-ui-iphone18-r62-bounded-location-trace.{log,xcresult}` 和 `/tmp/synapse-files-r62-font-01.png`～`14.png` 保留。独立检查代理01:32在真实fixture中搜索并打开0098，但Accessibility Inspector重开后仍无法列出SynapseMobile目标、没有运行Audit；未知Contrast保持未关闭，不以检查器受限或官方系统trait传播说明推定假阳性。

r63为临时短诊断，不运行审计，也不替代正式分页场景。新scope直接搜索/定位0204仍真实hittable失败，29.002秒。01:33:09.288首命令前target207/212的row y9424.3，09.331命令后row y9625.3、window y508.3且visible202～211，证明首显确实进入视口；后续完整AX枚举与行高变化后再次离屏，不能继续归因“首调用一直未到目标”。证据 `/tmp/synapse-files-ui-iphone18-r63-fresh-third-position-baseline.{log,xcresult}` 与低量结构日志 `/tmp/synapse-files-native-table-r62-bounded.log`。下一候选只复用已呈现行的实测高度，为同类未知行提供有界估算；不全量测20k行，不操纵contentOffset/contentSize，也不以重复定位掩盖失败。独立源码复核另确认范围切回旧阅读位置与spec的“比较范围改变回顶”不符，已安排窄修；尚未有运行关闭证据。

r64实測缓存候选短流程1/1、零失败通过，30.810秒：新scope搜索0204，加载212个真实树行，完整AX枚举后目标仍hittable，实际点击读到“分页验收0204”。未知普通文件采用已呈现同类样本的66.333pt估算，target207在首次命令前后均y13891、window y508.3；仅一次非动画scrollToRow，没有校正、timer或重试。证据 `/tmp/synapse-files-ui-iphone18-r64-measured-fresh-position.{log,xcresult}` 与结构日志保留。这是r63短失败的关闭证据，仍不能替代200行全项审计和最终矩阵。独立缓存审查确认exact512条、固定role/class最多7个样本及布局失效，目录/动态控件不提供估算样本；另发现每layout全ID比较的O(n)新增成本，正式复验前改为由快照生命周期维护同步状态，字体日志也改为布局后取证，不声称已有Instruments或峰值内存测量。

r71候选消除了每layout全ID比较：同步门槛仅由update/apply生命周期维护，普通布局只读取已显示cells。另一代理逐路径复核在途更新仍为false，最新快照及元数据一致才恢复；该门槛不证明所有字号布局已稳定。r65完整200行复验仍5项失败，125.248秒：1项Contrast、3项partial Dynamic Type，随后应用意外退出。审计后0098与0100真实hittable通过，0204已到达强断言之后但实际点击时退出，0160返回未完成。本輪layout后paired日志中xSmall～accessibility5～large的Table env/native/cell全部匹配；原生搜索字体14→15→17→21→23→28→33→40→47→53→17，不能据此声称审计关闭，也没有native/env不匹配证据支持手动trait override。真实crash `/Users/liyang/Library/Logs/DiagnosticReports/SynapseMobile-2026-10-04-014825.ips` 的主线程SIGSEGV仍为strcmp→runtime_issue_os_log_fault_callback→LIBTRACE高日志量隔离→XCTAccessibilityFramework attributes→XCElementSnapshot label/identifiers；没有应用业务帧，但不能推定产品正常或SDK根因。保留 `/tmp/synapse-files-ui-iphone18-r65-measured-paged-full.{log,xcresult}`，下一轮删除临时production诊断，并以报告当刻截图继续定位审计问题，完整ALL/handler false/强点击要求不变。

r66无production临时日志后仍整轮失败，141.115秒、5项：4项审计，最后0160手滚时查询隐藏装饰Image虚拟frame期间发生应用失联。真实0204hittable及正文预览已完成，Back0160未完成。独立读取真实crash `SynapseMobile-2026-10-04-015417.ips`，仍为主线程strcmp→LIBTRACE高日志量隔离→XCTAccessibilityFramework/XCElementSnapshot elementType，不能把仅删production日志记作崩溃关闭。Contrast此轮实际具名page0096 StaticText，frame y162.7/h44.3全在Table top218上方；Element Screenshot裁到搜索框/按钮而没有该文件文字，不支持改placeholder颜色。独立录屏密采样 `/tmp/synapse-files-r66-independent/contact-font-64-66s.png`：65.0s目标0098离开视口，65.30～65.40s最大字号表空白，65.50s恢复；65.60～65.70s回默认再次空白，65.90s回位。临时配对日志匹配及最后hittable均不能证明转换全程稳定。此前r65密采样也确认68.40～68.60s与68.72～68.80s的短暂空白，证据 `/tmp/synapse-files-r65-independent/contact-blank-boundaries.png`。

r67只把18搜索改固定VStack，仍2项Contrast、3项partial，并在0160helper结束时不可点，143.607秒、6项失败；没有应用失联，不计整体通过。候选已撤回，AnyLayout本身不被判定违规。UITest原生行改检查完整primaryButton.frame，保留强hittable、实际点击和Back，避免查询AX隐藏的装饰子节点。末次定位辅助存在独立问题：5次slow拖不足以跨44行，零frame仍用于推方向，coordinate.withOffset其实是相对原始coordinate的绝对offset，旧链形成斜向终点；修订为零frame按显式方向原生滑动、16次有界动作、起止点都从同一origin计算。功能要求不放宽，下一r68仍需完整运行验证；本轮 `/tmp/synapse-files-ui-iphone18-r67-fixed-search-stack.{log,xcresult}` 保留。

早期系统搜索槽的可定位裁切改用 Apple 允许的 iOS18 原生 inline TextField，iOS26 保持 searchable。r16 实际完成搜索、清除、非空搜索后的范围重置、Return 提交、目录来源、UTF-8 预览、原生 Copy 与横屏；两张截图及自然无障碍标签确认结果显示nested来源。这些功能通过，整轮仍因树审计失败，不能计整体验收通过。r51/r52的大集合全项审计后来又报告具体inline TextField裁切；原始34pt AX frame是默认字号，最大字号录屏中搜索框已增高，不能据此断言最大时固定34pt或把新的失败算作已关闭。

List 原生对照发现静态行移入 ForEach 后出现 3 项无定位问题；每项仅用显式 VStack 保持常量 1 行后，无定位及 Dynamic Type 问题消失，但样例仍有 3 项具体 Search/Menu 问题而失败。产品同样的窄包装保留目录加载和分页，r18 仍报告原 8 项问题；故只计为符合 Apple List 身份/性能建议，不计产品审计闭环。在修复后的原生样例中复制产品标识符仍为 0 nil，不能把产品外层 identifier 直接断定为原因。被遮盖终端不可点按只证明触屏覆盖，不证明实际 VoiceOver 焦点范围。

完整复制五个entryRow到原生样例后，复现了与产品完全同形的8项nil；独立删除contextMenu、内文本VStack或改runtime标签重载均未关闭。仅让普通文件直接作为List主Button、目录保留展开与显式Menu后，样例五项Dynamic Type nil全部消失；产品r23构建成功、r19真实Browse剩3项，后半搜索/预览/Copy/横屏仍完成。该结构保留全部朗读和操作，剩余裁切仍待定位，不能宣称整体通过。

静态 State 数组五行的原生对照没有 Dynamic Type nil；仅改为初始四行，真实点按 nested 后插入同一个固定 id 的第五行并更新展开箭头/值，即新增一项 unsupported nil，与产品剩余三项的分类完全一致。日志与 xcresult 为 `/tmp/synapse-files-native-probe-directory-insertion-history`。这证明目录更新历史可触发同类问题，尚不证明原因已修复；另外两项 clipped 的目标仍无法从原始问题文本定位。

随后单变量改成ScrollView+LazyVStack，nil/clipped均消失，但README/review两行报告具体partial Dynamic Type；eager VStack对照又消除这些字号项。外层lazy、内部有界组的五行原生对照同样零Dynamic Type/clipped/nil，仍因三个probe tint contrast失败，不算完整通过。产品iOS18采用每组最多100行的有界lazy呈现、iOS26保持List；r24/r20 retry实际展开含新paging目录后的树默认全项audit为零问题，但后续notes搜索结果未出现，整轮依旧失败。证据 `/tmp/synapse-files-ui-iphone18-r20-bounded-rows-retry.xcresult`；205条分组边界、搜索及定位仍待完成，不能用小样例代替大集合验收或声明性能改善。

临时诊断r22进一步确认搜索请求与Flow已经成功：逐字setter正确，同值focus回写被合并，提交notes后searchQuery=notes、entries=1、pending=0、无failure，但真实AX仍为旧tree。捕获提交词的r21未关闭它，因此不能把异步query采样当作根因。稳定tree/search角色身份、提前构造Sections以及独立Browser观察body三轮仍未关闭搜索呈现。r26真实AX与截图仍为旧tree，证据 `/tmp/synapse-files-r26-failed-search.png`；r27/r28最小render诊断确认同一Flow的Browser body、实际search分支与行/组内容都已执行并收到一条notes，而真实屏幕仍旧tree，排除“body未重算”假设。18分组随后改为真实Group(role,start,rows)数据，组ID=(role,start)、内层ForEach(group.rows)，26分支不改；全部trace删除。无诊断产物r29 Browse整轮1/1、零skip通过，tree/search/preview默认全项audit均零问题，提交/清除/范围reset/键盘submit/父路径/原生Copy/Reveal回树/同文件重开/横屏完成。证据 `/tmp/synapse-files-ui-iphone18-r29-chunk-data.xcresult`。该实验关闭实际搜索呈现阻断，不宣称已找到SDK内部原因。

所有产品审计保持默认 `.all` 和 issue handler `false`；仅在审计调用范围按 Apple 建议设置 `continueAfterFailure=true` 以收集全部问题，恢复后功能断言继续 fail-fast。无签名登录失败、早期到达 WORKTREE 的部分场景、Copy 的测试查询错误、主动中断轮、失败或跳过项均不计产品验收通过。

r68恢复AnyLayout，仅删除HostedRow对dynamicTypeSize的额外SwiftUI环境覆盖，采用UIKit trait自动桥接；官方API允许该路径，但本轮不能证明它解决了布局原因。完整200行仍94.997秒、2项失败：该轮Dynamic Type报告为零，Contrast仍为视口上方page0096，之后0204实际点击时应用退出。真实IPS主线程仍为strcmp→LIBTRACE日志隔离→XCTAccessibilityFramework；录屏55.7秒0098下沉，55.9～56.1秒最大及恢复字号短暂空表。证据 `/tmp/synapse-files-ui-iphone18-r68-native-host-font.{log,xcresult}`、`/tmp/synapse-files-r68-independent/contact-font-55-57s.png`；单次零报告不计稳定关闭。

r69保持同一production字号路径，只将UITest预览查询限定在现有files-content、删除整App手工debugDescription附件，保留默认ALL、handler false和强位置断言。64.394秒、4项失败：3项partial Dynamic Type再次出现，审计后0098不可点；Contrast零、无应用退出，后续功能未执行。原始 `/tmp/synapse-files-ui-iphone18-r69-scoped-acceptance.{log,xcresult}` 保留。另一代理离线独立抽取49～54秒录屏，证据 `/tmp/synapse-files-r69-independent/contact-font-49-54s.png`：默认0097/0098→大字号局部空表，恢复默认52.0～52.2秒暂回0097/0098，随后52.4秒首行0189、52.6秒首行0177，最后停在0174附近。一次新字号布局出现不代表后续native估算/self-sizing修正已完成。正在修订实际host新字号几何与native self-sizing完成条件；不能把减少测试诊断或r68零报告视为产品问题关闭。

r76字号候选引入真实host DTO（ID/revision/实际DynamicTypeSize/local size），仅对已显示cell进行一次有缓存的contentView fitting，系统边距保留；同像素实际native高度匹配才采集当前epoch的有界估算，并按上一完成布局的阅读ID进行每字号epoch最多一次恢复。r76b build-for-testing通过（首轮纯DTO actor/Sendable编译错误已修订）。独立Apple源码检查确认公开API、有限映射及owner/role/reset/Reveal/drag取消；同时发现完整可见行不存在时会沿用旧anchor，超高长行可能因此回跳，待补实际相交行fallback，不能算代码检查无问题。

该候选r70正式真实200行仍82.806秒、2项失败：0 Dynamic Type报告、审计后0098强hittable通过，但1项Contrast仍为Table上方page0096；刷新后真正第3页目标0204强hittable失败。root独立打开原始图：审计后0097/0098完整，0204失败截图实际显示0135～0144，是真实位置错误。日志 `/tmp/synapse-files-ui-iphone18-r70-host-geometry.{log,xcresult}`、原始图 `/tmp/synapse-files-r70-host-geometry-attachments/5850EBC9-623B-404C-A963-D910474CE725.png` 保留；下一步核实际fitting/估算就绪，不放宽位置或Back断言。本轮不能计为最终字号、无障碍或功能关闭。

r77已窄修超高行锚点：优先完整可见行，无完整行时采用当前实际相交行，没有相交行则清当前role旧anchor，Apple独立源码复核关闭该P2。r71保留严格旧门槛并加入最多24条、每字号/revision首次的可见文件fitting诊断，81.779秒仍Contrast与fresh0204强hit两项失败，0Dynamic Type与审计后0098hit仅为本轮局部证据。诊断实际发现contentView fit默认66pt、native contentView/cell66⅓pt@3x，accessibility1/2为66→67、3为70→71、4为134⅓→135⅓、5为147⅓→148⅓。旧严格相等无法接纳当前字号真实普通行估算；不能将全部差值称一物理像素或加固定1pt补偿。日志 `/tmp/synapse-files-r71-fitting-diagnostic.log` 保留。

随后r78加入同次可见cell的完整cell fitting对照，仍不放宽旧production门槛：默认cellFit66⅓=actual66⅓，accessibility1/2为67=67、3为71=71、5为148⅓=148⅓。Apple确认这是公开的同对象拟合对照，不能命名未核实的系统差值来源或推定全表稳定；正式候选需改为cell fitting与cell.bounds比较、删除临时诊断后重新完整验收。r72诊断轮仍有审计报告，不计最终通过。

r72诊断轮92.553秒、5项失败（3项partial Dynamic Type、Contrast与0204强hit），旧门槛保持不变，原始结果不算通过。r79正式改为完整cell fitting与同cell.bounds的像素量化比较；普通文件font anchor还须当前角色/类别有效median，临时日志与对照字段全部删除。Apple再次静态复核未见新增确定P1/P2，这只能证明当前行门槛，不证明全部布局完成。

r73干净产物正式运行85.839秒、2项失败：0Dynamic Type、审计后0098及第二页0100强hittable通过，仍有视口外page0096 Contrast，刷新后真正第3页0204不可点，0160Back未执行。日志 `/tmp/synapse-files-ui-iphone18-r73-native-cell-commit.{log,xcresult}` 保留。正在核定位命令发出时当前树角色估算是否就绪，以及回执是否早于新host行的实际布局；不以源码正确或fit数值相等替代定位验收，也暂不并改预取/字体。

r80限量定位时序诊断的r74仍66.093秒、5项失败（Contrast、3项partial Dynamic Type及审计后0098强hit），未走到刷新/0204，不提供第3页定位结论。首0098实际序列：first-scroll generation1/index101/207行时median66⅓pt，约70ms后pending期间实测warm仍66⅓，ACK也66⅓；不能泛化“首次命令一律冷估算”或据此加校正。日志 `/tmp/synapse-files-r74-cold-location-diagnostic.log` 与正式 `/tmp/synapse-files-ui-iphone18-r74-cold-location-diagnostic.{log,xcresult}` 保留。下一临时短用例仅隔离fresh0204时序，不能作为无障碍或正式产品验收通过，结束后必须删除，四正式用例和ALL要求保留。

r75临时短Fresh诊断1/1通过，但没有ALL，不能算正式验收：prefix20/100/150/200均采用66⅓pt实测估算，first-scroll第207项（212总行）targetY13891pt/height66⅓、file0Y359；warm/ACK均66⅓，实际0204强hit、点按和正文通过。该对照排除“当前fit门槛普遍无法warm”解释。

r76临时完整时序wrapper保留原ALL与每个正式断言，只继续收后半，不过滤失败。125.262秒、2项失败：Contrast，随后0160点按期间应用退出。该轮字号/0098hit、第2页0100、刷新后第3页0204强hit/点按/正文、手滚0160强hit和原0204离屏均已实际完成；0160正文/Back未完成，因此不能计整轮通过。真实owner刷新old207→new2、只保留1个control ID；新prefix20/100/150/200全66⅓，generation3 targetY13891/height66⅓、warm/ACK均66⅓。本轮不支持“cold首次命令”或“跨owner旧估算已经证实”的假设，不直接新增两阶段校正或重建UIView。

root独立解析r76原始IPS：procName SynapseMobile/PID3618、null地址EXC_BAD_ACCESS/SIGSEGV，主线程strcmp→runtime_issue_os_log_fault_callback→LIBTRACE高日志量隔离→XCElementSnapshot children。文件 `/tmp/synapse-files-r76-owner-prefix-full-sequence-attachments/F942D780-4294-42C0-AC26-264FF7D12E41.ips`、日志 `/tmp/synapse-files-ui-iphone18-r76-owner-prefix-full-sequence.{log,xcresult}` 保留；同源码正式r73曾fresh失败而本轮通过，不能只用一次局部成功认定稳定，也不能称已知SDK缺陷。

r83 build通过，删除全部临时trace/wrapper后，只关闭原生cell预取并重新执行原四正式用例。正式r77结果：Browse 52.342秒、Composer 38.878秒、Git 30.405秒通过；Paged 106.005秒、Contrast及滚回0160过程应用退出两项失败，整套227.630秒、4项用例、2失败、0跳过。Paged前段0Dynamic Type报告、审计后0098强hit、0100和刷新后0204强hit/点按/正文已完成；0160正文/返回仍未完成。Contrast仍指向page-0096.txt、屏幕frame(20,162.667,362,44.333)，位于搜索区域；新IPS仍为strcmp→runtime_issue_os_log_fault_callback→LIBTRACE→XCElementSnapshot路径。原始证据 `/tmp/synapse-files-ui-iphone18-r77-display-demand-all.{log,xcresult}` 与 `/tmp/synapse-files-r77-display-demand-all-attachments/750004E2-A165-4B06-8383-60D88362E4C6.ips` 保留。独立抽取原片每0.1秒字号帧，root亲看 `/tmp/synapse-files-r77-independent/contact-font-50.1-52.4s.png`：51.7～51.8秒最大字号全空，51.9～52.1秒回默认仍空，52.2秒才从底部露0099。该轮0字号报告不证明转换稳定；关闭预取没有关闭剩余问题，已撤回，不计整体验收通过，不进入发版。

r84只对主Button尝试系统 `.accessibilityElement(children: .combine)`，目录Menu、原可见文本、完整label、点按与contextMenu保留。正式r78 Paged 136.975秒、5失败、0跳过：Contrast、3项partial Dynamic Type（包含搜索框与提交按钮）、选择0160后返回可点断言失败。刷新后0204强hit/点按/正文及0160强hit/点按/正文完成。xcresult没有IPS附件，但后续原片132.5秒确认0159/0160已正确可见、135.5秒已回Home；实际系统 `/Users/liyang/Library/Logs/DiagnosticReports/SynapseMobile-2026-10-04-030042.ips`（PID15991）仍为strcmp→LIBTRACE→XCElementSnapshot elementType的SIGSEGV。因此不计无崩溃或归因单纯位置偏移，更不计正式通过。日志 `/tmp/synapse-files-ui-iphone18-r78-primary-button-combine.{log,xcresult}`、`/tmp/synapse-files-r78-back-before.png` 与 `back-final.png` 保留；无效combine已撤回，不把公开API合法性当作frame或字号修复证据。

r85b对照只给已创建的native cell稳定标识，并把测试定位限定到该cell子树，减少整App Button属性遍历；不改变呈现、动作或定位策略。正式r79 Paged 107.782秒、4失败、0跳过：仅ALL 3项partial Dynamic Type与Contrast；0100、用户刷新、真正0204强hit/点按/正文、0160强hit/点按/正文、Back后0160仍可点且0204离屏全部完成，没有应用退出或位置断言失败。本轮证据支持保留更窄查询，不证明此前崩溃普遍根因，也不计整体验收通过。日志 `/tmp/synapse-files-ui-iphone18-r79-native-cell-query.{log,xcresult}` 保留。

下一候选只将普通tree/search文件行改为系统 `UIListContentConfiguration`；目录独立操作、controls、Git与Flow保留。原生文件须另有当前trait/真实visible cell fitting的布局校验，不伪造Hosted DTO、不绕字号epoch/普通类估算门槛，不并改位置策略或搜索字体路径。默认ALL、强hit、正文及Back断言全部保留。不得通过隐藏内容、重写AX frame、过滤ALL报告或削弱断言使验收通过。

r86原生文件候选build通过；Apple独立源码检查未见当前确定P1/P2，确认普通文件单primary路径、目录菜单独立、上下文菜单owner/视图/最新权限校验及有界当前native fitting。正式r80 Paged 41.325秒、1失败、0跳过：真实搜索结果cell点按后未进入预览（line256），尚未走到200行ALL，不能计功能或无障碍通过。日志 `/tmp/synapse-files-ui-iphone18-r80-native-entry.{log,xcresult}` 保留；先核实际点击/delegate/Flow边界，不凭编译成功替代运行，也不新增两个重复业务回调。

r87只加最多12条无正文/凭据的delegate布尔诊断，r81 Paged 42.282秒仍在首预览失败。root亲读 `/tmp/synapse-files-r81-native-action-trace.log`：native row1真实highlight→canPerform两次true→willSelect，metadata/业务callback存在、allowsSelection=true、delegate正确，但没有performPrimary回调。该次证据定位到选择/主操作边界，不泛化为SDK已知缺陷；下一窄改只允许普通原生文件进入正常选择路径，仍仅performPrimary执行业务并立即取消选择，Hosted行仍不可被表格选择，不增加didSelect业务分发。临时trace必须删除后再正式复验。

r88删除全部临时诊断后，native-only正常选择→仅performPrimary立即deselect并执行业务，补齐native动作/菜单各边界isEnabled门控。正式r82 Paged完整通过：99.006秒、1用例、0失败、0跳过，200行默认ALL全部保留且零issue；0098审计后强hit、0100、用户刷新→真正0204强hit/点按/正文、手滚0160强hit/点按/正文、Back后0160仍可点且0204离屏全部完成，无应用退出。日志 `/tmp/synapse-files-ui-iphone18-r82-native-primary-selection.{log,xcresult}` 保留。这是本候选的大目录正式通过证据，不能替代独立字号录屏、原生行contextMenu动作或最终四设备矩阵；下一补验并保持原detail菜单/草稿不发送断言。

r89只在原四用例补原生搜索长按Reveal、树中长按插入引用，不改变production r88。iOS18 iPhone正式r83四项全部通过：Browse57.861秒、Composer49.915秒、Git30.591秒、Paged98.301秒，合计236.668秒、4用例、0失败、0跳过；五处默认ALL均执行且无报告。真实搜索菜单回树/强hit、普通文件点按、原生Copy、横屏、WORKTREE→STAGED、详情菜单与树菜单两次引用保全中文emoji草稿且不发送、真正200/205文件分页定位及0160返回位置均完成。日志 `/tmp/synapse-files-ui-iphone18-r83-final-all.{log,xcresult}` 保留。

连续外部原片 `/tmp/synapse-files-iphone18-r83-final-all.mp4` 已成功finalize。root与Apple检查代理独立抽取每0.1秒字号片段：179.9秒0098仍可见；180.0～180.1秒leading变0104/0102、0098离屏；181.5秒最大字号全空、181.6～181.7秒恢复默认仍空，182.0秒才恢复0097/0098。证据 `/tmp/synapse-files-r83-independent/contact-paged-font-179.0-182.0s.png` 以及对应原帧保留。四项功能与五处ALL通过仍成立，但字号过渡P2未关闭，不能计整体验收完成或进入发版；下一单变量只限制被动layout初始化空reading anchor，避免过渡几何覆盖既有阅读身份，仍需实测判别。

同一production r88、tests r89的iPhone26正式r84：Browse66.718秒、2项ALL问题；Composer70.206秒与Git39.517秒通过；Paged112.725秒、3项Contrast问题，后者真正0204/0160正文及Back全部完成。合计289.167秒、4用例、5失败、0跳过。原始 `/tmp/synapse-files-ui-iphone26-r84-final-all.{log,xcresult}` 与 `/tmp/synapse-files-r84-phone26-final-all-attachments/` 保留。具名Clear text原生按钮frame约19.67×19pt，触控区域不达44pt；Contrast报告对象为nil，截图显示末行图标经过浮动搜索区域，但尚不能归因。下一26候选只复用已有inline UITextField及44pt显式清除/提交，保留26 List、业务Flow、原断言和默认ALL，不盲改颜色或隐藏内容。其余三设备、最终源码最大字号深色和iPad真实窗口仍待验。

r90只限制被动layout初始化尚无reading anchor的角色，实际拖动、显式定位与角色切换仍记录身份。iPhone18正式r85 Paged98.247秒、1用例通过、0 ALL报告、0跳过，真正0204与0160正文/Back全部完成。成功外录 `/tmp/synapse-files-iphone18-r85-reading-intent.mp4` 已finalize，root和Apple代理独立密采确认仍有leading0102/0098离屏和表区全空。对可变帧率原片按整片fps及绝对PTS重新采样后的精确时标为：42.1秒leading0102、0098离屏；42.8秒及43.3～43.6秒最大字号全空，43.7秒恢复默认仍空；44.1秒恢复0097/0098、44.2～44.9秒连续稳定。当前证据 `/tmp/synapse-files-r85-independent/contact-font-PTS-41.8-44.9s.png` 与 `pts-frame-*` 为准，原顺序编号图仅保留画面事实，不作为精确时标。该单变量未关闭视觉P2，功能PASS及审计零报告不能替代过渡稳定验收。26inline搜索已落源码、r91 build通过；下一18候选只将普通原生文件的高度估算交回UITableView，保留真实采样与定位门槛，不同时并入reload或修改字体。

r91共用inline搜索后的iPhone26正式r86：Browse77.274秒、2项partial Dynamic Type；Paged100.309秒、1项Contrast，真正0204/0160预览与Back后0160可点且0204离屏全部完成。合计177.583秒、2用例、3失败、0跳过，日志 `/tmp/synapse-files-ui-iphone26-r86-inline-search.{log,xcresult}` 保留。清除按钮小触控区域和此前树页Contrast不再报告，不能把减少报告等同整体验收通过；新的字号报告须按具名附件核控件，剩余Contrast没有对象时仍保持未知，不修改语义颜色或过滤。

r86原始具名附件与独立PTS录像进一步确认：两partial分别为notes.txt（42,535.667,67,20.333）和nested（42,558.667,41.667,15.667），不是搜索Field或提交按钮；两者采用系统body/footnote、无字号cap，39.9秒已明显放大，40.3秒开始被上方控件推离首屏，40.6秒最大字号首屏仅有控制区。证据 `/tmp/synapse-files-r86-phone26-inline-search-attachments/`、`/tmp/synapse-files-r86-independent/contact-search-font-PTS-39-43.4s.png`。这排除“完全不放大”解释，不证明审计误报、最大字号结果可达或与18同根因；保留原失败，不改搜索字体桥。

r92只在普通原生file/searchFile的高度估算delegate内、refreshHeightLayout之前直接返回系统automaticDimension，真实采样/当前fitting/有限median warm/每epoch一次恢复门槛不变。iPhone18正式r87 Paged98.313秒通过、0失败、0 ALL报告、0跳过，真正0204/0160预览及Back位置全部完成。成功原片 `/tmp/synapse-files-iphone18-r87-native-estimates.mp4` 已finalize。root和Apple检查代理独立查看绝对PTS每0.1秒共33帧：41.8～45.0秒0097始终前导、0098完整可见，43.6～43.8秒最大字号自然换行，43.9秒恢复默认、44.0～45.0秒持续稳定，无此前空表或远跳；38～47.5秒粗采亦保持身份。证据 `/tmp/synapse-files-r87-independent/contact-font-PTS-41.8-45.0s.png`、同目录pts原帧和正式 `/tmp/synapse-files-ui-iphone18-r87-native-estimates.{log,xcresult}` 保留。本轮18具体字号场景的功能、审计和连续视觉均通过，保留系统估算，不再叠加epoch reload。不能推广到26/iPad或替代最终四用例矩阵。

下一版本将26文件浏览接入同一已验证的原生表格/UIListContentConfiguration路径，目录、控件、Git继续Hosted，业务Flow与搜索字体路径保持；移除对应不可达List/ScrollReader分支。正式契约与计划先同步此修订，26原失败保留，须重新实跑默认ALL、菜单、定位/Back及连续录像，再冻结最终四设备矩阵。

r93统一原生浏览器后build通过。Apple代理独立静态复核未发现本次增量确定P1/P2：scope/context、三role、query/range reset、generation与真实rowID回执复验保留，窄窗先切sidebar且等本表格真实window/祖先视口后才定位；主操作单一路径、原生菜单最新owner/view/row/enabled校验、Hosted目录/controls/Git/分页仍在。测试统一查询真实UITableViewCell和完整操作区域、强isHittable；五处默认ALL、handler=false、不跳过均保留。

同一产物iPhone26正式r88两项全部通过：Browse73.852秒、Paged124.723秒，0失败、0 ALL报告、0跳过；搜索结果原生长按Reveal、Copy、预览、横屏、真正0204与0160正文/Back全部完成。日志 `/tmp/synapse-files-ui-iphone26-r88-unified-native.{log,xcresult}` 保留；成功外录 `/tmp/synapse-files-iphone26-r88-unified-native.mp4` 待独立PTS检查。源码冻结为此候选，接续最终四设备每设备四正式用例、最大字号深色和iPad实际窗口，未完成矩阵不标整体验收完成。

r88成功电影已finalize，Apple代理独立按绝对PTS密采：分页124.0～129.0秒51帧、每0.1秒，0097始终前导、0098完整可见，127.4～127.6秒最大字号自然换行、127.7秒恢复，直至129.0秒无空表、远跳或恢复漂移。证据 `/tmp/synapse-files-r88-independent/contact-paged-font-PTS-part1.png`、`part2.png` 与原帧。搜索36.0～38.9秒30帧notes.txt/nested实际放大，37.7秒仍完整，37.9～38.0秒最大字号因上方长范围控件增高而离开首屏，38.1秒恢复；本片未实际滚动验证最大字号结果可达，不从零ALL推断此项已验。证据 `/tmp/synapse-files-r88-independent/contact-browse-font-PTS-36-38.9s.png`。下一最大字号深色关键流须验证真实滚动和操作。

发布前额外后端独立检查发现P1：非空alternates/http-alternates仅在discover检查，opened scope后的共用元数据gate只验普通类型；本地Git可借授权元数据以外的对象库。已解除仅git adapter/tests这一个冻结点，UI源码、端点和夹具继续冻结。开发代理新增真实Git canary，筛选3项原生回归旧代码全部红灯（其余45项筛选未执行）：打开后新增alternates、http-alternates及cat-file -t后插入alternate均被接受，普通alternates确可读取外部独立对象库并关联授权staged路径。正在修补每次原生spawn前后安全FD复验并由另一代理独立检查；此时不计安全验收完成或可发布。最终后端产物重建、两跳smoke及更新后的专项待执行。

最终UI冻结r93的iPhone18 r89四项完整通过：Browse58.715秒、Composer50.422秒、Git30.470秒、Paged98.226秒，合计237.833秒、4用例、0失败、0跳过；五处默认全项ALL无报告，三入口、原生菜单、草稿保全不发送、两层Git与真正200/205分页及Back均完成。root独立核原始 `/tmp/synapse-files-ui-iphone18-r89-final-matrix.{log,xcresult}`。成功电影finalize后Apple代理独立采样绝对PTS153.0～156.5秒、每0.1秒36帧；0097始终前导、0098完整，155.0～155.2秒最大字号、155.3秒恢复后持续稳定，无空表、远跳或漂移。root亲看 `/tmp/synapse-files-r89-independent/contact-paged-font-PTS-153-156.5s.png` 确认上述画面。

同一冻结r93产物iPhone26最终r90四项完整通过：Browse74.961秒、Composer65.531秒、Git38.462秒、Paged126.736秒，合计305.690秒、4用例、0失败、0跳过；五处默认ALL无报告，真实菜单/Copy/横屏/引用与分页定位/Back均完成。成功电影 `/tmp/synapse-files-iphone26-r90-final-matrix.mp4` 已SIGINT正常finalize，正由Apple代理独立核新电影PTS。两台iPad的相同UI产物矩阵、最大字号深色及真正iPad窗口尚在进行；Git安全补丁独立于UI源码，不能以UI结果替代其最终后端验证。

r90新电影独立绝对PTS215.5～220.0秒、每0.1秒46帧确认0097持续前导、0098完整；217.6～217.7秒最大字号自然两行，217.8秒恢复后至220.0秒稳定，无空表、远跳或漂移。root亲看 `/tmp/synapse-files-r90-independent/contact-paged-font-dense-PTS-part1.png`；part2与原帧保留。Browse22.4～25.5秒密采显示notes.txt/nested真实放大，24.7～24.9秒最大字号被长范围控件推出首屏，25.0秒恢复；本片未实际滚到最大字号搜索结果，不计该可达性通过。

相同r93产物iPad18 r91 Browse68.092秒失败，默认ALL记录两项Text clipped；原始log两次均关联 `files-search` TextField，分别为搜索结果审计31.51秒和双列预览审计56.00秒。搜索、Reveal、重新预览与Copy/横屏后半功能继续完成，不能据此计Browse通过。正在等待具名附件/实际frame与全轮结果定位；不修改字体、过滤审计或从两台iPhone通过推断iPad通过。

r91最终原始summary为217.046秒、4用例、4失败、0跳过：Composer53.413秒通过；Git29.732秒在非hittable范围后要求compact Back失败，尚未取得STAGED；Paged65.809秒在真正0204强hit失败，截图实际仅0103～0125可见。两clip附件均为默认frame(44.5,123,161.5,44)的files-search，不能仅凭该默认frame断言最大字号未增长。全部原始log/xcresult/截图和正常finalize电影保留，继续定位与修补；未开始发布。

Apple代理进一步独立密采r91电影：201.8～203.9秒0204完整可见，204.0秒跳0108，204.1～204.5秒0103～0125；root亲看 `paged-reveal-PTS-203.90s.png`/`204.00s.png` 确认，证据目录 `/tmp/synapse-files-r91-independent/`。因此第三页已经加载且短暂定位成功，不能归因未取得目标页或regular侧栏隐藏；正在限量核定位后滚动/恢复状态。Git恢复默认后范围在双列屏内，实际AX唯一Button enabled=true、frame(249.5,338.5,74.5,44)位于table(0,100,340,1085)，仍不以图像可见替代实际强hit和STAGED点按。最大搜索帧field随字号变窄、glyph/clear仍同排，保留原clip失败，待局部布局实验。

r94仅限量位置日志的Pad18 r92 Paged65.661秒仍在fresh0204失败，不计正式通过。root独立核 `/tmp/synapse-files-r92-pad18-position-trace.log`：gen3/index207首rectY13690，scroll后rectY13196/offset12466/visible190～211，真实回执04:11:18.145；2.285秒后rectY9441、contentSize13461→9706、offset12466→5053、visible108～130。期间没有新的location/anchor/fontRestore命令，readingAnchor仍207、pendingAnchor/fontRestore均无。证据支持原生估算转实高后的几何与偏移重排，不支持Flow重放或目录未加载；不手工补偿offset/contentSize。

先同步spec/plan后，r97仅改普通原生行估算为纯读取匹配当前完整布局的actual exact/有限median，失配回系统；核SwiftUI/native字号类别一致及row/kind。delegate不刷新/写缓存/fit，采样仍512 exact/每类7，系统self-sizing和全部原强断言保留。build通过、全部临时trace已删除，Pad18 r93原强Paged正在运行。Search布局及Git导航测试暂不并改，候选尚未计关闭。

同一r97单变量的Pad18 r93 Paged95.151秒完整通过、1用例、0失败、0跳过，默认全项ALL无报告；真正0204强hit/点按/正文、手滚0160正文及Back后0160可点且0204离屏全部完成。root核原始 `/tmp/synapse-files-ui-ipad18-r93-readonly-estimates.{log,xcresult}`；本轮功能与审计关闭先前失败，成功录像仍须独立检查最大字号和定位后连续稳定，两phone新字体过程及最终矩阵尚待。Apple独立静态复核无新增确定P1/P2，指出有限median仅是估算，不是全表完成屏障。

下一局部修订在辅助字号让原输入Field同子树独占一行，装饰glyph让位，清除与提交在操作行；字体、边框、IME、Return及请求行为保持。Git测试只在实际Back存在时使用compact导航，regular侧栏滚动定位范围并真实点开Menu；进一步同时等待BASE/STAGED且WORKTREE消失，避免未暂存删除行本已含STAGED造成旧正文假通过。旧手机测试的staged关键词单断言不足以单独证明最终GUI范围切换；实际后端两跳各range/side证据仍成立，最终GUI须用加强断言重验。此时只记录候选，不计两项已关闭。

r93成功电影独立密采推翻该候选的视觉闭合：42.1～42.2秒leading0102、0098离屏；43.8～44.0秒最大字号全表空，44.2秒默认仍空，44.4秒才恢复0097/0098。root亲看 `/tmp/synapse-files-r93-pad-independent/font-dense-PTS-43.90s.png` 确认空表。功能和ALL通过保留，持续读取当前median策略不作为最终实现；不得把该轮PASS写成字号稳定。

Search辅助字号布局与加强Git断言后的Pad18 r94：Browse66.645秒通过，此前两files-search裁切不再报告；Git37.542秒真实范围菜单、BASE/STAGED且WORKTREE消失已完成，但ALL记录六项partial Dynamic Type，整轮不计通过。具名对象是scope根、详情内容相对路径、旧/新行号与±；Apple独立最大字号91.20秒原帧均真实增长且完整可见，空label对象是内容路径。此事实不等于审计误报，原六FAIL保留。证据 `/tmp/synapse-files-ui-ipad18-r94-search-git.{log,xcresult}`、`/tmp/synapse-files-r94-pad18-search-git-attachments/`、`/tmp/synapse-files-r94-pad-independent/git-font-PTS-91.20s.png`。

r100只把普通文件高度估算限定为明确定位意图的一次冻结，两类median纯读；仍保留全部采样/fitting/fontRestore门槛。第一次r95调用方法名有误，执行0项，不计验证。修正后的Pad18 r95b真实Paged94.149秒、1项、0失败/0跳过/ALL零报告；真正0204正文、0160正文及Back强位置都完成。独立电影 `/tmp/synapse-files-ipad18-r95-frozen-estimates.mp4` 正常finalize。Apple按绝对PTS54.70～60.30秒每0.1秒检查：0097持续leading、0098完整，57.50～57.70秒最大字号自然换行，57.80秒恢复后连续稳定，无空表或漂移。root亲看 `/tmp/synapse-files-r95b-pad-independent/font-PTS-057.60s.png` 与 `057.80s.png`。0204首次78.20秒定位至81.60秒完整稳定、81.70秒highlight/81.80秒正文；107.50～109.90秒Back0160 leading稳定且0204离屏。本轮证明该Pad18具体场景，不能推广为四设备通过。

r101补公开trait-change回调，只在每次字号trait变化撤销冻结/pending估算，避免未采样的L→XL→L复活旧估算；不把该回调当作布局完成，也不改fontRestore。Apple源码复核未发现确定新增P1/P2。Pad18 r96 Git36.031秒、Paged96.228秒均完整通过，合计132.259秒、2项、0失败/0跳过，默认ALL无报告；真正BASE/STAGED/noWORKTREE、0204/0160正文与Back位置完成。root亲核 `/tmp/synapse-files-ui-ipad18-r96-trait-frozen.log` 与xcresult路径。原r94失败保留，此轮实际复验关闭这两个当前场景；最终四设备矩阵、最大字号实滚搜索、独立录像和实际iPad窗口继续待验。

r96同一新电影由Apple独立密采：Git23.70～27.40秒每0.1秒六个原r94对象持续成长且完整，26.30～26.40秒最大字号、26.50秒恢复；Paged78.70～83.90秒0097 leading/0098完整，82.30～82.40秒最大、82.60秒恢复，无空表/跳移；fresh0204于103.20秒首次树中完整定位，至106.70秒点按前稳定，106.80秒highlight/106.90秒正文。关键原帧 `/tmp/synapse-files-r96-pad-independent/gitfont-PTS-026.40s.png`、`pagedfont-PTS-082.40s.png`、`pagedfont-PTS-082.60s.png` 与同目录contact保留。审计和视觉均支持当前两场景关闭，不归因原r94为SDK误报，也不外推尚未执行的平台或实际窗口。

发布前后端再复核发现P2：当前工作树SHA比较只处理CRLF，未处理Git内置ident/working-tree-encoding；ident展开的干净checkout仅同内容重写造成stat失配即可被误报modified，encoding也缺少明确门控。独立检查未发现其他生产组装/协议/alternate/ASAR确定P1/P2，但该项不能以未穷举Git组合豁免。仅解除adapter与service-test冻结，开发代理将先用真实原生Git建立红灯回归，再在工作树与cached属性preflight明确`git_unavailable`，普通文件浏览保留。端点、设备与其余backend不变，测试和最终编译两跳仍待；尚未发布。

Pad26 r97 Browse107.336秒仍有三项Contrast失败，其余目录/搜索/父路径/原生长按Reveal、预览Copy、详情Reveal和横屏动作完成；不计该用例通过。具名对象为大小frame(366,182,26,16)、修改时间(366,198,52,16)、所有文件(243,328.8,67.5,20.5)。电影 `/tmp/synapse-files-ipad26-r97-foundation.mp4` 已正常finalize，附件 `/tmp/synapse-files-r97-pad26-foundation-attachments/` 保留。开发代理离线核完整帧：LabeledContent右侧value主笔画138/138/142，白底约3.44:1；13pt footnote低于Apple小字体4.5:1依据，准备只将这两value显式使用系统primary语义，保组件/字体/布局。报告leading label为黑色不能直接归因其自身；“所有文件”原帧也为黑色，原因仍未知，不能合并解释或过滤报告。新候选须重跑完整Browse/ALL再计关闭。此时Pad26设备独占交给Apple代理做真实scene与隐藏侧栏路径，owner暂停Xcode/Sim。

root在发布准备中额外实际执行IPC codegen drift与UI tracking coverage，两项exit0；后者检查42共享primitive、57能力renderer、842 renderer文件，未用应用启动替代源码检查。

Git内置转换两例已先真实红灯：代理在独立Git fixture执行add/commit、删除后的真实checkout，再同bytes重写并改变mtime；ident与UTF-16 working-tree-encoding的原生`--no-optional-locks status --porcelain`均空，但旧service返回一项modified（ident为available、UTF16为binary）。日志 `/tmp/synapse-files-builtins-red.log` 保留，未动用户目录/端点。最初夹具校准checkout落盘与UTF16 BOM，最终两红均止于预期门控断言；生产小修与最终绿灯仍待，不把夹具校准失败计成产品红灯。

Apple代理独占Pad26进行真实交互时发现P2：宽窗Files双列选nested/notes后，用系统Toggle sidebar隐藏侧栏，再从详情Menu选“在目录中显示”；正文清成“选择文件”，侧栏仍隐藏，AX仅Show Sidebar与空态，无真实目标行。原截图 `/tmp/synapse-files-pad26-hidden-sidebar-reveal-fail.png`。这吻合官方preferredCompactColumn仅控制collapsed stack而非regular列可见性的边界；sole iOS作者将窄加columnVisibility并在成功located请求全部列/目录，保原真实viewport回执。当前是实际失败与修订计划，未计关闭；Apple仍继续实际窗口伸缩，不用canvas zoom替代。

Git转换P2已关闭：adapter只新增ident属性查询和未支持转换gate；七项新增回归覆盖两种真实干净stat-miss、scope后属性新增与同intent缓存拒绝、diskunset/cachedactive的两range拒绝及inactive正向，普通directory/disk preview保留。最终5套109/109、126.18秒、exit0，日志 `/tmp/synapse-files-builtins-final-tests.log`；完整typecheck与HARD分别在 `builtins-final-typecheck.log`/`builtins-final-hard-constraints.log` exit0。root亲读summary与HARD，另一peer独立源码复核无新增确定P1/P2。七例没有Windows skip，但当前只是mac native Git运行，native Windows仍待CI；生产源已冻结，最终产物重建与真实两跳尚待quiet交接。

Apple窗口操作本轮结束，设备明确归还sole iOS owner：读取原设置为Windowed Apps，CUA实际drag在Springboard分页、窗口角柄与顶部swipe均未使scene变化；临时Stage Manager与pointer/keyboard捕获也未取得半/窄窗。已恢复Windowed Apps、取消Stage Manager、pointer/keyboard0/0、portrait全屏夹具会话，未改字体、外观、端点或凭据。因此这轮只证明真实regular隐藏侧栏失败，不能证明半/窄窗或用canvas zoom/旋转替代。r102已离线补两metadata值primary及columnVisibility，尚未编译/实跑；owner后续将使用已有XCUITest系统gesture再尝试实际scene，P07窗口项保持待验。

最终Git转换源码冻结后，root收到sole iOS owner明确静默交接；full desktop build exit0（`/tmp/synapse-files-final-builtins-desktop-build.log`），仅对本任务fixture端点PID1561发SIGINT，旧session86913正常exit0。相同受控脚本、独立配置与固定fixture重启，新端点session36498 ready，未碰用户server3001。最终编译真实两跳 `workspace-files-smoke.mjs`15/15、exit0（`/tmp/synapse-files-final-builtins-real-smoke.log`）：双能力、同根、深层/UTF8/搜索、两Git范围与侧预览、引用、100/100/5同版本分页、键序幂等/target冲突、owner拒绝/HTTP及close后拒绝均通过。04:49后root明确将端点/所有设备交回iOS owner；UI新r102与最终矩阵使用该最终后端产物。此前ad-hoc ASAR基线是Git最后两修订前的字节，不能写成新版本正式包证据；新正式签名/公证/Windows及包结构留给发布CI/Release gate。

最终文档peer复核发现并修正规则层级冲突：mobile-runtime-contracts原把断线与手机阅读缓存清空并列，现明确桌面断owner清scope/结果，手机断线取消pending、禁新读取/引用但保留已读内存快照；重连由用户刷新/重开，不自动重放。与spec及Flow已有三态行为一致，未改运行代码。其他身份、取消例外、预算、属性gate、MCP49及生产顺序均一致。

r102 Pad26 r98 Browse与hidden-sidebar两项共65.292秒、2失败/0跳过，均在Files入口等待失败，未到ALL或侧栏修复断言。真实截图 `/tmp/synapse-files-r98-live.png` 为旧“会话资源”inspector及夹具对旧操作的“不支持”状态；endpoint已实际收到Files open/directory。root亲看截图，不能把该轮解释为metadata或sidebar修复验证。owner正核入口弹层/导航实际状态，电影已正常finalize，附件 `/tmp/synapse-files-r98-pad26-attachments/` 保留，不盲改色或以重跑等待计通过。

r98进一步真实AX定位：顶层Files sheet已呈现，只有detail“选择文件”与原生Show Sidebar，files-close实际藏在未显示sidebar；因此不是Files请求未发送，也不能按底层资源标题判定只打开旧inspector。原AX `/tmp/synapse-files-r98-pad26-attachments/61868275-EDEC-440B-BEC6-BA59E9F03BB8.txt`。新columnVisibility初始automatic沿用了系统先前隐藏列结果；下一单处修订将初始设.all，让每次新面板先呈现浏览入口，仍保用户后续隐藏与成功Reveal恢复。compact按公开契约忽略visibility，无新增机型分支。当前仍为有实际证据的候选，须重新执行入口/完整ALL/hidden-sidebar，尚未闭合。

r104构建已成功（生产变化为r102两窄修及新面板初始.all），Pad26 r99同时执行Browse、独立隐藏sidebar与实际角柄窗口用例。Browse93.364秒完整功能完成但仍三Contrast，需新targets/像素确认，不能将原3.44比例或primary候选计为修复。hidden-sidebar专项40.060秒真实通过：限定Files自己的导航栏原生Hide Sidebar，确认树目标实际不可点，再详情“在目录中显示”恢复真实可点树目标并再次打开UTF-8中文正文；当前入口与regular隐藏列P2已闭合，不推广到其他设备或窗口尺寸。角柄专项仍待，它仅按公开XCUITest系统手势操作并强核App/Main Window实际宽度变化、正文可用与恢复后草稿，不用canvas zoom或文件强坐标补救。

root额外核官方[HierarchicalShapeStyle](https://developer.apple.com/documentation/swiftui/hierarchicalshapestyle)与[Color.primary](https://developer.apple.com/documentation/swiftui/color/primary)：前者primary是当前content style第一层，后者是主内容颜色。既有Theme.ink类型为Color.primary；此API差异不能直接当三项Contrast根因。

r99窗口专项42.338秒真实通过：公开XCUITest系统角柄手势使App/Main Window从834×1210变为375×491，再恢复834×1210；窄窗正文与Menu实际可用，恢复关闭后完整“窗口草稿 😀”保留且未发送。root亲读 `/tmp/synapse-files-r99-pad26-attachments/894806A5-9725-4BB1-94F2-4A7BBB56096E.txt` 与 `5C159566-A0C4-4DB9-BCDC-E30F13631412.txt`，实际Window origin分别为(230,302)/(0,0)，不是canvas zoom。Apple离线独立movie绝对PTS170/175秒确认单栏/双栏完整；132/136秒确认隐藏侧栏定位与重开。关键帧 `/tmp/synapse-files-r99-independent/key-01.png` 至 `key-04.png`。此轮没有中间宽度或窄窗搜索/Reveal，不外推真机。

r99三项Contrast仍保留：root亲看完整预览 `B979A473-9ACD-4C72-8B22-B718E036448D.png`；Apple又核三报告同步1668×2420 App截图及element crops，两metadata value和“所有文件”深色主值均0/0/0，未见覆盖。因此两value已改为黑字，不把新失败解释为仍灰、primary未生效或SDK误报；原因仍未知，不盲换Theme.ink。下一只验证整个Files阅读根使用既有系统背景Theme.paper的单变量，保持字体、AX、toolbar和完整ALL，失败撤回。

r105测试扩展的Pad26 r100窗口用例73.891秒失败，driver总90.552秒，原始 `/tmp/synapse-files-ui-ipad26-r100-window-navigation.{log,xcresult}` 与正常finalize录屏保留。窄窗Back成功，搜索实际收到notes，目标强hit已通过；result.tap后未等异步正文/Menu就继续导致Menu匹配失败，尚未到中宽/恢复。不能把这轮计为产品定位失败或通过。后续仅修测试等待，与现有Browse同样等待UTF-8正文和Menu；滚动手势改以实际browser自身相对坐标为锚，避免浮窗App与Window原点重复叠加，保所有实际frame/hittable/点按强断言。生产背景候选r106正在单独编译验证。

r106阅读根背景候选的Pad26 r101 Browse85.245秒、19项Contrast失败；发现本轮实际继承上个未完成窗口专项的375×491浮窗，files-tree App截图750×982、所有issue带Window origin(230,302)，不是r99的834×1210基线。保留附件 `/tmp/synapse-files-r101-pad26-reading-attachments/` 与正常finalize电影；不将变化后的报告数归因Theme.paper，也不计背景关闭。owner将先用公开系统手势恢复并强核真实834×1210，再按同背景唯一变化重跑。独立Apple静态复核确认Theme.paper是既有Color(.systemBackground)，根背景公开API有效，但不等于presentation/toolbar的系统材质均变opaque；仍须实际对照。

r107测试环境清理的Pad26 r102为20.047秒失败，实际一次右下角系统拖动仅将375×491恢复为698×948、origin(69,74)，未达到要求的834×1210；原始 `/tmp/synapse-files-ui-ipad26-r102-fullscene-baseline.{log,xcresult}` 保留。不把基线清理失败计为文件功能失败；下一使用系统窗口菜单恢复Full Screen并强核尺寸，尚未执行新的背景对照。

r103为20.921秒的清理失败已定位为测试目标错误：系统绿色按钮确已把被测App/Window恢复834×1210，但UI测试runner的UIScreen.main.bounds是768×1024，helper遂把正确全屏主动缩为704×959。保留 `/tmp/synapse-files-ui-ipad26-r103-restored-fullscene.log`，撤除runner UIScreen作为被测窗口目标，不能用这轮否定系统恢复或文件功能。再次用真实系统Full Screen恢复后，r107同产物的Pad26 r104受控Browse已从实际834×1210开始；原始log `/tmp/synapse-files-ui-ipad26-r104-full-reading-surface.log`，结果与正常finalize电影仍待。

r104受控全屏对照93.635秒、1用例/3 Contrast/0跳过，全部功能完成，报告仍是大小/修改时间/所有文件；root亲读原始summary。附件 `/tmp/synapse-files-r104-pad26-reading-attachments/` 与正常SIGINT finalize电影 `/tmp/synapse-files-ipad26-r104-full-reading-surface.mp4` 保留。无效根.background候选已撤回，r108只将sheet内容根设为 `.presentationBackground(Theme.paper)`，按官方 [presentationBackground](https://developer.apple.com/documentation/swiftui/view/presentationbackground(_:)) 自动覆盖整张presentation的16.4+公开语义；仍不预判透明材质根因，结果待真实同条件ALL。测试移除临时runner UIScreen基线来源，窗口恢复改公开系统顶部双击动作并保原始App/Window尺寸强核。

r108同实际全屏的Pad26 r105对照92.461秒、1用例/3 Contrast/0跳过，原三节点仍报告，功能全部完成；root核原始 `/tmp/synapse-files-ui-ipad26-r105-presentation-surface.log` summary。整张presentation背景候选也未关闭，结束撤回，不把两种无效背景保留到最终实现。下一只对三具名标题/当前选择文本使用既有Theme.ink（Color.primary）明确前景语义token；实际黑字已证，故这是可逆API对照，不声明提高实际像素对比度或确认继承层级根因，仍保字体/布局/AX/完整审计。

Apple离线独立核r104三报告坐标与同步1668×2420原图：大小/修改时间按2×裁切后的暗glyph与原ElementScreenshot逐像素100%重合，排除这两处scale/origin错配；所有文件实际位置正确，但fractional像素rounding不足以证明误算。三处core为黑、背景254/255及249～250，原因仍未确定。r109明确Theme.ink的源码增量保标准LabeledContent标签闭包、自然字号及原Menu动作；[foregroundStyle](https://developer.apple.com/documentation/swiftui/view/foregroundstyle(_:)) 官方全文区分具体Color style与默认层级style：具体foreground关闭默认继承的材质vibrancy。这为单变量对照提供公开渲染语义依据，未证明实际存在vibrancy或与三报告相关。

r109的Pad26 r106同全尺寸85.565秒、1失败/0跳过：前两次ALL无报告，第三次预览ALL在15秒后抛审计错误Code−56“Audit failed to complete in time”；Copy/Reveal后续未执行，无新SynapseMobile crash报告。root亲读 `/tmp/synapse-files-ui-ipad26-r106-explicit-primary.log`，附件 `/tmp/synapse-files-r106-pad26-primary-attachments/` 与正常finalize电影保留。没有报告三Contrast不等于它们已关闭；生产维持r109，只做同产物完整复跑，不过滤报告或改功能断言。

r109同产物Pad26 r107复跑92.355秒、3 Contrast/0跳过，完整功能均完成，原三报告再次出现；原始 `/tmp/synapse-files-ui-ipad26-r107-explicit-primary-repeat.log`、`/tmp/synapse-files-r107-pad26-primary-attachments/` 与正常finalize电影 `/tmp/synapse-files-ipad26-r107-explicit-primary-repeat.mp4` 保留。显式Theme.ink对照无效，已撤回；当前生产回到r104基线（新面板列.all、Reveal恢复sidebar及两metadata值primary），无两种背景/具名label试验。root亲看r104完整预览原件，再请求Apple依据实际fg/bg、官方小字4.5:1标准量化独立取证；不继续盲改颜色，不把黑core、官方承认可有false-positive或本轮全部功能完成单独当三报告已关闭。窗口窄窗Back/搜索/Reveal/中宽/恢复专项与只读取证继续并行。

Apple独立按r107同步sRGB截图、报告frame×2量化三节点：大小core(770,369)前景0/背景254，20.822:1；修改时间core(803,401)前景0/背景255，21:1；所有文件core(533,663)前景0/背景250,249,249，19.983:1。黑core分别30/222/648个，旁侧同Y空白背景组合仍超过20:1，非单最暗点；抗锯齿边缘不当作字体主色。依据[Apple Sufficient Contrast](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria/)与[W3C公式及抗锯齿评估说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)，这三对当前浅色可见颜色均达小字4.5:1。此结果不等于formal ALL通过、SDK根因、全部材质或深色合规；下一仍需真实Inspector节点/色对与深色对照，原失败保留。

r110回到基线源码构建通过，phone18 r108四项239.674秒：Browse59.609、Composer50.107、Git33.007通过，Paged96.951在截图查询时App不存在而失败，整轮4项/1失败/0跳过。root亲核 `/tmp/synapse-files-ui-iphone18-r108-final-matrix.log`；附件 `/tmp/synapse-files-r108-phone18-final-attachments/` 与正常finalize原片保留。新真实crash `SynapseMobile-2026-10-04-052437.ips`为SIGSEGV，主栈仍strcmp→runtime_issue_os_log_fault_callback→LIBTRACE_CLIENT_QUARANTINED_DUE_TO_HIGH_LOGGING_VOLUME→XCElementSnapshot elementType，不据此定SDK根因或计Paged通过。

同产物Pad26窗口r10999.855秒/1失败/0跳过，唯一失败是窄窗Back后再次点同notes的UTF-8预览等待（line240）；root亲读原始 `/tmp/synapse-files-ui-ipad26-r109-window-navigation.log`。源码明确Flow在相同selection且已有contentPage时直接return，而Panel只在selected值变化时激活detail，故重复打开意图未导航；这接续r100缺等待后的强复验，不能以测试等待修订当产品关闭。已先同步spec §9与plan P07，r111只修用户选择动作即时详情导航：先当前canRead/scope门控，导航留外层并唯一调用Flow.select；缓存保留，迟到响应不再推回详情。新产物须重新验证，r108/r109作为旧快照证据保留；Pad用真实系统Full Screen控件恢复。

r111/r112增量独立源码检查无新增确定P1/P2：nativeDisk与hostedChange统一用户选择callback，UITableView主动作仍唯一；Panel先当前可读scope门控、即时large/.detail、唯一Task Flow.select。Flow在首个await之前写selected，响应仅store/rows/Markdown，不再次写selected，故读取完成不抢回已返回列表；相同缓存复用不再吞掉新导航意图。官方NavigationSplitView列绑定在Back后回.sidebar，可再显式.detail。当前只计源码检查，新实际窗口/矩阵须运行关闭。

r112同冻结产物Pad26 r110窗口专项97.323秒、1项/0失败/0跳过真实通过，root核 `/tmp/synapse-files-ui-ipad26-r110-content-reopen-window.log` summary。完整执行实际窄窗Back→搜索重开同notes UTF-8正文→详情Reveal真实目标强hit→再开→中间宽度→原角柄恢复实际834×1210→关闭后草稿完整且未发送。r109重复selection导航P2由此实际关闭；r100/r109旧失败保留，不据静态检查代替运行。正常SIGINT finalize电影 `/tmp/synapse-files-ipad26-r110-content-reopen-window.mp4` 正由Apple离线独立核实际宽/中/窄帧与交互；最终四设备矩阵仍待。

Inspector重开刷新一次后仍只列五个同名Simulator/辅助DockFolderViewService，未列SynapseMobile；All processes下Audit明确要求Select a target App，因此没取得三节点Hierarchy/highlight，不作豁免。系统Color Contrast Calculator已真实输入r107三个核心sRGB色对，13pt显示所有文件20.0:1、大小20.8:1、修改时间21.0:1，并均显示“Passes for any text size”；CUA原始画面与AX返回保留于该代理记录。此结果独立支持当前浅色色对满足Apple标准，但不等于formal ALL通过或检查器根因；实际暗色/最大字号对照继续待验。

r112同产物phone18 r111四项完整通过231.492秒、4 PASS/0失败/0跳过：Browse57.597、Composer50.226、Git32.569、Paged91.099，root亲读 `/tmp/synapse-files-ui-iphone18-r111-final-matrix.log` summary；完整默认ALL、真实两范围、205分页/0204/0160 Back及草稿均完成。附件 `/tmp/synapse-files-r111-phone18-final-attachments/` 与正常finalize电影 `/tmp/synapse-files-iphone18-r111-final-matrix.mp4` 保留，当前新轮无App退出；不将旧r108 crash改写成SDK根因。phone26 r112四项同产物正在跑，实际max/dark搜索实滚也待，不外推其他平台。

phone18 r113在实际系统最大辅助字号与dark外观下，搜索实滚/预览/Reveal57.485秒、1项/0失败/0跳过通过，root亲核 `/tmp/synapse-files-ui-iphone18-r113-max-dark-search.log`。真实滚到notes、强hit/点按UTF-8正文、详情Menu/Close可用、Reveal真实目录目标、清搜索与无键盘全部完成，默认ALL无报告；这是实际最大字号动作，不只依赖审计字体循环。原片 `/tmp/synapse-files-iphone18-r113-max-dark-search.mp4` 待正常finalize/独立核。长中文标题及Pad同三节点dark色对另待，不扩写成全部max/dark通过。

05:39 root亲核同冻结产物phone26 r112四项完整通过307.037秒、4 PASS/0失败/0跳过：Browse73.994、Composer61.546、Git42.192、Paged129.306。日志 `/tmp/synapse-files-ui-iphone26-r112-final-matrix.log` 和xcresult保留；包含真实205分页、0204正文、0160 Back位置与默认全项审计。录像正常finalize及独立字号关键段复核继续由设备owner和独立Apple代理负责。

独立Apple代理已完成r110窗口与r111 phone18新录像关键段复核。r110原AX附件与实际Scene为834×1210→(230,302)375×491→(19,0)798×1150.5→834×1210；中间宽度是798而不是半宽，不使用模拟器canvas缩放或runner屏幕大小替代。绝对PTS81.0窄窗同notes重开有UTF-8中文😀，86.0/86.5 Reveal回真实notes树并清搜索，89.0再次打开，94.5中宽双列，97.5恢复原尺寸，100.5草稿保留；全分辨率帧 `/tmp/synapse-files-r110-independent/keyframes/` 与 `/tmp/synapse-files-r110-independent/reveal/pts-86.0.png`。新重复选择导航P2的实际路径与窗口证据闭合。

r111 phone18字号过程绝对PTS179.0–184.5每0.1秒共56帧，0097始终首行、0098完整；182.2/182.3最大字号正确换行文件扩展名，182.4恢复后仍保持97/98，没有空表或远漂。证据 `/tmp/synapse-files-r111-independent/font-dense/`，最大字号`f-034.png`、恢复`f-035.png`；203秒真实0204树、204/205秒UTF-8新正文，232/233秒0160正文、234秒Back树0160首行。独立复核无新增可见问题，只证明这些实际Simulator运行，不外推Pad26对比度报告或真机辅助技术。

Pad18 r114同冻结产物最终四项252.796秒、4项/6失败/0跳过。Browse、Composer与Paged通过（Paged92.372秒），Git实际WORKTREE→STAGED完成但默认ALL报告6项“Dynamic Type font sizes are partially unsupported”：装饰+、−、两个行号1、范围根目录TextView和review.txt TextView。root亲核 `/tmp/synapse-files-ui-ipad18-r114-final-matrix.log`，不把功能完成改写为整轮通过；原录像、报告与实际字号增长/布局密采由独立Apple代理核查，旧r96两项通过不替代新轮。

05:42发布前独立backend/契约diff复核无新增确定P1/P2：alternates逐次context前后/实际零字节门禁、disk/cached内置属性门禁、registry装配、独立文件结果通道和两跳预算保持；Windows CI新增八套只读契约、maxWorkers1，正式Release继续执行四读取模块及CJS版本/预算ASAR gate。离线快照的桌面与手机分层规则已修正，Terminal公共MCP仍49。只修spec §5.1的索引描述精度：Map键为account/desktop/mobile/intentId，session另绑定完整指纹与接收校验，跨session同ID冲突而非生成新记录；无冻结代码修改或重复测试，未把尚未执行的Windows/正式发布计为通过。

Inspector限量再核时曾出现可选“Simulator > Synapse”线索，七项Options全部勾选，但Run Audit后无outline/capture，pointer无Hierarchy；刷新后应用目标又消失。五个Device Target同名Simulator而不带UDID，故无法证明临时目标对应前台Pad26进程，更没有取得同场景三节点highlight。观测 `/tmp/synapse-files-inspector-calculator-observation.txt` 保留；空列表不计PASS，检查器限制不作为审计豁免。实际Simulator截图、XCTest原始节点与独立色对/字号证据分别记录。

r114六字号对象的独立新片复核：绝对PTS146.5–149.5每0.1秒31帧，scope根路径UITextView实际增长且最大字号完整换成四行，review.txt路径、旧/新各1及±均增长；辅助字号时AnyLayout正常纵排，STAGED/WORKTREE完整，无空白或中途正文丢失。原帧与contact位于 `/tmp/synapse-files-new-final-independent/padgit-dense/`；root另实际查看148.9最大帧`f-025.png`，两列文字与关闭/菜单可见。当前源码使用公开UIFontMetrics兼容traits、系统footnote/body和AnyLayout，无字体上限；未由原片或源码证明六项不缩放或fontcap。六partial原报告继续算测试失败，不能将独立可读性复核写成ALL通过或SDK根因；下一实际最大字号/深色动作另跑。

05:46 root亲核phone26 r116实际系统最大辅助字号/深色两项195.069秒通过、0失败/0跳过：Composer122.686秒，Search72.383秒。末行review正文、长中文文件名预览及Menu/Close、扩展草稿和两种引用均真实执行；搜索实际滚到notes、UTF-8正文、Reveal与清搜索完成，默认全项ALL无报告。日志 `/tmp/synapse-files-ui-iphone26-r116-max-dark.log`、正常SIGINT finalize原片 `/tmp/synapse-files-iphone26-r116-max-dark.mp4` 和附件 `/tmp/synapse-files-r116-phone26-max-dark-attachments/` 保留；phone26已还原large/light。

独立新片Paged密采：r112 phone26绝对PTS228.5–234.5每0.1秒61帧，r114 Pad18 PTS203.0–208.5每0.1秒56帧，均97首个完整行、98完整；phone最大232.2/232.3、Pad最大206.2/206.3正确增长换行，恢复后无空表或远漂。原件 `/tmp/synapse-files-new-final-independent/phonepaged-dense/` 与 `padpaged-dense/`。这为新冻结产物的实际位置稳定证据，不把r114 Git六partial失败改为ALL通过。

05:48 root亲核Pad26 r115最终四项356.018秒、4项/4失败/0跳过：Browse97.917秒有原三Contrast；Composer73.765秒通过；Git44.570秒功能完成但新增统计文字Contrast；Paged139.766秒通过真实0204正文、手滚0160与Back位置。新增报告 `/tmp/synapse-files-r115-pad26-final-attachments/63885265-6104-45D4-A1AA-41428D8328D8.txt`，label“新增未计算行，删除未计算行”，frame(197.5,457,136.5,16)，为侧栏统计而非原metadata三节点。原片 `/tmp/synapse-files-ipad26-r115-final-matrix.mp4` 正常SIGINT finalize，全部附件同目录；新增对象浅深色与独立像素核对继续待验，不合并、过滤或计整轮通过。

phone18 r117实际最大辅助字号/深色Composer93.631秒、1项/0失败/0跳过通过，root亲读 `/tmp/synapse-files-ui-iphone18-r117-max-dark-composer.log`。末行WORKTREE、长中文文件名预览/Menu/Close、两种引用和草稿保留真实完成，默认全项ALL无报告。正常finalize原片 `/tmp/synapse-files-iphone18-r117-max-dark-composer.mp4`、附件 `/tmp/synapse-files-r117-phone18-max-dark-attachments/` 保留；此设备已还原large/light，与r113搜索共同覆盖当前phone18实际max/dark路径。

r115第四Contrast独立量化原件 `/tmp/synapse-files-new-final-independent/pad26-contrast/r115-git-counts-contrast.json`：同步App PNG为sRGB1668×2420，报告frame×2对应crop(395,914)～(667,946)，与272×32 Element PNG逐通道差最大1。文字有894个纯黑核心像素、1116个≤20暗核心；平背景250/250/250有3318像素、250/250/249有2281像素，对比20.119467/20.106952:1。不是孤立最暗像素，抗锯齿边缘不代替字体主色。当前默认浅色四具体对象均满足Apple小字4.5:1；未知自动报告与实测差异原因，仍保留四个ALL失败，不外推深色/其他交互状态。

仅保留本任务Pad26一个booted设备后，Inspector唯一“Synapse(61058)”与实际launch PID61058匹配，设备/进程归属这次已确认。七项Options勾选后Run Audit仍无有效截图/Hierarchy，原生Save导出 `/tmp/synapse-files-pad26-single-device-inspector/AuditReport_2026-10-04_05-50:51.html`，rootObject只有Screen1名称，没有图像/issues。这个空报告不计PASS或问题解释，原HTML及观测保留并结束Inspector App审计路径；后续以实际截图、动作和独立量化继续核查。

独立Apple复核按[官方Larger Text评估标准](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/larger-text-evaluation-criteria/)判断：当前六字号对象在该阅读场景确实随系统字体增长，主内容与路径完整、横纵布局重排，无明确重叠或不可读截断；当前浅色四色对满足[官方Sufficient Contrast标准](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria/)。这是限定场景的手工产品可用性结论，未发现确定仍存在的可见缺陷；自动报告与手工criteria差异仍未知。不宣称整个App的Accessibility Nutrition Labels支持、正式ALL通过或SDK原因；两Pad实际最大字号/深色及四色对继续待完成。

r115 Pad26新Paged独立按本片绝对PTS278.5–283.5每0.1秒51帧：97为首个完整行、98完整，281.2～281.4最大字号正确增长，281.5恢复后至283.5保持97/98，无空表/远跳。原件 `/tmp/synapse-files-new-final-independent/pad26paged-dense/`，未跨用r96/r114旧录像。至此当前四设备Paged字号关键段均有各自新片的独立连续证据。

r118 Pad26实际最大字号/深色三项221.276秒、2失败/0跳过：Composer147.507秒通过；Git33.150秒在原生懒加载Git列表初屏等待尚未创建的changes入口失败；Search40.619秒实际滚动、UTF-8预览、Menu/Close和Reveal全部完成，但全项审计新增一个“范围”Contrast（frame26,331.703,100.5,63.5）。报告 `/tmp/synapse-files-r118-pad26-max-dark-attachments/499610A4-FE1C-4EF5-A81D-C330A83CB480.txt`、正常finalize原片 `/tmp/synapse-files-ipad26-r118-max-dark.mp4` 保留，不能并为旧四节点。

r119 Pad18实际最大字号/深色三项158.940秒、11失败/0跳过：Composer99.192秒通过；Git27.447秒为同入口初屏等待失败；Search32.302秒真实功能全完成但10个partial Dynamic Type，分别为nested/notes.txt TextView、行号1/空marker、修改时间、notes.txt、nested、scope根TextView、搜索输入、搜索提交和大小。原日志 `/tmp/synapse-files-ui-ipad18-r119-max-dark.log` 保留，新增对象另交原件/实际增长与布局复核，不合并旧六或计整轮通过。

r119入口原AX CollectionView和截图 `/tmp/synapse-files-r119-pad18-git-max-before-scroll.png` 显示，现有Git List初屏只创建目录/branch/remote/sync；最大字号下后面的changes行需要用户实际滚动。仅UITest补presented原生List有界swipe≤8、原exists+强hittable+真实tap及滚动前后截图，生产R111保持不变；新测试产物构建 `/tmp/synapse-files-matrix-build-r113-git-max-scroll.log`，随后只复验两Pad最大字号Git动作。原等待失败仍保留，不以拉长等待或放宽断言计通过。

两手机actualmax/dark新片已独立复核：phone26 r116 PTS82～83长中文完整路径/正文、Menu/Close独立可见，95～98菜单与保留草稿，180～200搜索notes/nested→UTF-8→菜单→Reveal清查询回树；phone18 r113 PTS54～61搜索/UTF-8/Menu/Reveal，r117 PTS63～72长标题/正文/菜单/草稿，90～92原生context菜单与插入草稿。帧目录 `/tmp/synapse-files-new-final-independent/maxdark-coarse/`，未将手机结果代替Pad深色表面。

06:03发现新的实际可见对比度缺陷，继续阻止最终验收/发版：正常`files-search-reachable-preview`截图 `/tmp/synapse-files-r118-pad26-max-dark-attachments/237C14F4-F18A-476B-81E7-DAEAAC4FDA21.png` 于05:55:19.738、Search t29.88取得，点击notes t27.04，早于ALL报告t35.24，不能按审计临时issuehighlight解释。dark/AX5原生搜索行nested subtitle核心200/200/201有5318像素，平背景118/118/119有29483像素（独立背景ROI16100像素同色），对比2.714:1低于大字3:1；title核心248/248/248为4.273:1，默认小字状态另需核查。独立JSON `/tmp/synapse-files-new-final-independent/pad26-contrast/r118-native-selected-contrast.json` 与crop保留。先同步spec §9与plan P07，公开cell state/configuration与系统语义修法待确定，不隐藏次级目录/选中反馈或放宽审计；原生默认不是合规豁免。

r120 Pad18 test-only滚动helper15.911秒失败：误选CollectionView(834.5,0,360,1210)且visible frame empty，未滚动到Git入口，不计通过。R114测试候选仅筛带repo路径、实际可操作且与真实window相交的原生List。r122确已真实滚动/tap进入Files，但73.764秒在滚到review途中App不再运行；新的 `SynapseMobile-2026-10-04-060318.ips` 主栈SIGSEGV strcmp→runtime_issue_os_log_fault_callback→LIBTRACE_CLIENT_QUARANTINED_DUE_TO_HIGH_LOGGING_VOLUME→XCElementSnapshot elementType，原log/movie/attachments保留，不定SDK根因、不计通过。生产仍R111，此时先关闭上述确测可见对比度缺陷。


06:08–12原生行P2有限取证与候选：r123实际Search完成40.491秒，原范围Contrast失败仍保留。DEBUG限量12条公共cell状态记录显示默认次级文字alpha0.6，点按过程中选择状态变为true时为不透明，随后回到false又为半透明；这与截图一致，但不证明灰底内部根因。候选R116仅将原生primary与secondary文字color设为系统UIColor.label，默认transformer已为nil而未追加；背景、highlight/selection、操作和字体不变，所有临时Logger/diagnostic删除。构建`/tmp/synapse-files-matrix-build-r116-native-semantic-text.log`成功。r124实际AX5/dark40.259秒功能完成，正常持续灰底上两字主色248/248/248、背景118/118/119，对比4.273:1，满足该放大字场景3:1；原范围ALL仍失败。默认小字另需4.5:1，不能以此宣称P2关闭。原浅色默认次级字99/99/99与220/220/220为4.381:1的失败也保留，新四组合继续测量。

Pad26实际最大字号/dark Git r121功能完成126.444秒，原ALL两项Contrast失败保留。独立可见统计截图与同步报告分开记录：正常可见“2 个文件”白色字体核心4340像素（3×3内部2431）与最差背景27/27/28为17.211:1；统计主色17717像素（内部10009）与最差29/29/30为16.844:1，满足保守4.5:1。原报告frame为负y，同步Element截图只有顶部工具栏、没有目标文字，不能声称目标同步色对已匹配，或把2 FAIL改成PASS。JSON/截图/脚本保留于`/tmp/synapse-files-r121-independent-dark/`，未推断SDK原因。


R116四组合的后续证据拒绝将两.label作为最终修法：r125默认light主/副黑色核心对220灰底为15.314:1；r126默认dark两段248文字对118/118/119灰底仅4.273:1，仍低于小字4.5。JSON分别在`/tmp/synapse-files-semantic-independent/r125/`与`r126/`。r125原片PTS30.0还出现初触近黑8/9背景、白icon而固定黑字未呈现，30.5灰底才恢复，连续时长待独立密采。这是点按过程的实际可见问题，不能仅用最终preview的色对豁免。spec/plan先同步为真实state下系统content/background配置配合；R117仅做有界公开背景取证，不预判legacy、不以同值factory替换宣称修好。


R117b/r128有限背景取证：root亲读`/tmp/synapse-files-r128-native-background.log`，当前backgroundConfiguration非nil、automatic更新true，current/defaultBackgroundConfiguration/listCell实际解析一致。触按selected=true/focused=true时背景与继承tint为白色alpha1；deselect后selected/highlight=false、focused仍true，背景继承白tint alpha0.4，与持续灰底相符。此前“未赋值所以legacy背景”的说法未获证据，排除作为归因；换同值factory不能算修复。该真实focus反馈须保留，不清焦点或关selectionStyle。全局Theme.ink tint不在本次修改范围，下一修法仅限原生行的公开state配置配对。

r125初触文字消失已独立按movie原始整数frame594～614与showinfo核PTS：30.10/30.15/30.20连续三帧仅白icon，30.25灰底黑字恢复；不是contact图推测时标。证据`/tmp/synapse-files-semantic-independent/r125/touch-verified/`。r127实际AX5/light最终正常preview黑0对灰220为15.314:1，但不覆盖该过渡缺陷；四组合正常截图量测齐备而R116仍不通过。


生产候选R118仅修改原生文件cell：两个init按Apple override规则关闭自动content/background应用，由真实updateConfiguration统一重建系统配置；首次configure通过私有helper即时填入当前entry与当前state，再请求系统更新。selected或focused采用不透明.label背景与.systemBackground文字/图标配对，其它保default背景与.label文字；不清焦点、关闭selection或改全局tint。reuse清旧entry/content/background/AX身份。所有临时OSLog/Diagnostic删除，Apple独立源码检查未见新增确定缺口；这仅为静态检查，P2仍等待普通dark及其他条件的实际初触/持续态证据。


r129 R118普通dark正式Search39.931秒，UTF-8预览/Reveal功能完成、原ALL一项Contrast失败。root与Apple独立实际查看正常preview截图`/tmp/synapse-files-r129-state-pair-default-dark-attachments/4BB135C6-CDED-4D84-8D11-066985B72787.png`：原生焦点行是白背景，主/副字及file图标均未可见。候选未关闭P2，禁止推进其它三轮或发版。原片`/tmp/synapse-files-ipad26-r129-state-pair-default-dark.mp4`正常finalize59.851667秒，公开content/configuration/trait颜色差异继续有限核查，未归因SDK或语义token默认正确。


r130/r131限量公开绘制诊断未找到已证颜色/trait/alpha/层序差异：active cell/content/state/UILabel均dark，前景与attributedforeground为约28/28/30、background白，configuration/content/native alpha1，文本长度9/6、正常frame、hiddenfalse；focusonly下文字及image不highlighted，highlightColor nil，背景subview位于content前且相同z。r130正常PNG和原片仍30.6～34.1持续空行，不能由日志正常判实物正常。r132仅撤content.updated39.283秒功能完整、1原Contrast，但正常PNG`/tmp/synapse-files-r132-base-content-state-pair-attachments/D9897D49-55FB-4229-A96B-9D9D9E7CA606.png`仍白空行，故该单因素无效、恢复。下一沿独立公开UITableViewCell.focusStyle核查；custom有官方子类反馈协议，不能当清焦点/关反馈或由此先宣称根因已证。


r133限4条public focus日志证实原focusStyle为0/default，active cell.focusEffect nil但contentView存在UIFocusEffect；这仅区别独立路径，不证空行机制。r134只加官方custom+焦点回调40.184秒功能全完成、1原Contrast；正常PNG`/tmp/synapse-files-r134-native-focus-state-pair-attachments/53042C9E-8F11-4E65-ABBD-AAE0F1CDF52F.png`仍白空行，故不扩四组合并撤回无效focus修饰。下一限定真实trait解析两原语义token的单因素对照，不能由public日志推定颜色渲染原因。

06:37另一代理最终只读后端/协议/规则复核无新增确定P1/P2：owner/scope、只读Git、取消清理、两跳预算、云端不存源码与Terminal49公共MCP边界一致，组装完整。Windows CI接8专项maxWorkers1，正式ASAR gate含新增模块/CJS预算；均待真正CI/Release而非已执行。本轮未重新测试、操作端点或改源码。


r135 R123普通dark39.584秒，功能完整、原scope Contrast 1 FAIL/0skip保留。正常原PNG`/tmp/synapse-files-r135-resolved-state-pair-attachments/626550E3-110F-42BF-A6C0-7196DB215A43.png`root实际查看主/副/SF恢复可见；Apple独立核心28/28/30分别523/354/346像素对白背景255的34775像素，ratio17.014735:1>4.5。原片实际PTS29.5～34.2每0.1秒核：30.7初触仍可读，30.8起白focus至34.2持续主/副/SF可见，无旧空行或黑底黑字。JSON及连续帧在`/tmp/synapse-files-state-pair-independent/r135/`。只证明此普通dark条件，不推断r130曾有trait失配或SDK根因，P2完整关闭仍等另三组合/同面板外观变化；spec/plan已将失败试验集中到本验收记录，保规范当前实现。

r136 R123实际AX5/dark40.285秒，功能完整、原Contrast 1 FAIL/0skip保留。正常原PNG与原片在`/tmp/synapse-files-r136-max-dark-resolved-state-pair-attachments/`、`/tmp/synapse-files-ipad26-r136-max-dark-resolved-state-pair.mp4`；Apple独立主/副/SF核心28/28/30分别7155/5318/2341像素对白255背景32200像素，ratio17.014735:1同时高于3和4.5。实际PTS29.5～34.2按0.1秒核，30.3按下与30.4进入focus均完整，至34.2无消失。JSON与连续帧在`/tmp/synapse-files-state-pair-independent/r136/`。

r137 R123普通light正常原PNG396906AB前缀的主/副/SF白255核心523/354/346像素对黑0背景34775像素，ratio21:1；Apple独立按电影20fps的真实PTS29.0～35.5核查，30.85正常浅底黑字、30.90进入黑底白字，31.0～34.5持续完整，34.60退出focus后浅面黑字完整，无旧初触空闪帧。证据在`/tmp/synapse-files-state-pair-independent/r137/`；原三项Contrast报告仍保留失败，不改写为全项审计通过。

r139 Pad18实际最大字号Git的窄作用域查询复跑88.541秒，1失败/0skip。本轮真实滚到Git入口、打开WORKTREE与ALL，但`files-change-range`的tap报not hittable，frame从(16,217.5,206,44)到(16,608,206,44)，尚未执行STAGED断言；本轮没有前一r122的App crash。原日志`/tmp/synapse-files-ui-ipad18-r139-max-dark-git-scoped.log`、附件`/tmp/synapse-files-r139-max-dark-git-scoped-attachments/`及正常finalize电影`/tmp/synapse-files-ipad18-r139-max-dark-git-scoped.mp4`保留。正核实际视口、Back/sidebar及用户可见操作；不增加等待或删除强hit/BASE/STAGED/WORKTREE断言来豁免。

r138 R123 AX5/light39.635秒，Search→UTF8→Reveal全部动作完成，原Scope Contrast 1 FAIL/0skip保留。Apple独立正常原PNG主/副/SF白255核心7155/5318/2341像素对黑0背景32200像素，ratio21:1；20fps原片PTS30.05正常态→30.10黑底白字active，30.10～33.80每0.05秒密采均完整，33.90焦点退出/字号恢复后完整行上移，无旧空表。JSON、PTS与连续帧在`/tmp/synapse-files-state-pair-independent/r138/`，原片`/tmp/synapse-files-ipad26-r138-max-light-resolved-state-pair.mp4`。root亲核r137的41.003秒/3原Contrast与r138的39.635秒/1原Contrast原日志；四条件实际可见色对均达官方阈值，关闭限定路径P2，不将原ALL失败改绿。

r140 同一App的focused notes/nested行真实light→dark→light已完成，PID3096与start06:49:33三次一致，query、selection与UTF8正文保留。三正常PNG`/tmp/synapse-files-r140-live-{light-before,dark,light-restored}.png`与正常finalize电影`/tmp/synapse-files-ipad26-r140-live-appearance.mp4`保留；root实际查看dark截图主/副/SF正确可见。Apple独立三PNG主/副/SF核心523/354/346像素、背景34775像素，浅色21:1、深色17.014735:1、恢复浅色21:1；三PID原件为`/tmp/synapse-files-r140-live-appearance-pid-before.txt`、`-dark.txt`、`-restored.txt`。真实PTS38.00～38.35与47.75～48.20整页（toolbar、搜索、详情均含）随系统外观转换；38.15与47.95中间帧文字和背景同时灰过渡，对比暂降，字形仍在，未重现原持续3.6秒空白，转换完成即恢复正常色对与原行位置。连续片在`/tmp/synapse-files-state-pair-independent/r140/transition/`。不宣称每个系统过渡动画帧都达到4.5，不用四次独立launch代替同App证据。

06:55独立Apple最终审查确认R123四个实际组合与r140同App外观切换未发现新增确定P1/P2，关闭原生主/副文字可见低对比和持续空行P2。公开trait回调、按真实cell traits解析既有语义token、选择/焦点反馈及动作生命周期均保持；结论限定于已经运行和量化的场景。原ALL失败、r139实际菜单命中缺口与物理VoiceOver/FKA/指针/Reduce Motion/Instruments未取证继续如实记录，未声明全App无障碍通过或SDK根因。

06:56独立发布契约只读复核未发现新增确定阻塞：Windows八套专项路径均被Vitest include覆盖，pwsh可传现有命令，前置typecheck生成shared；正式Release先构建shared/Electron，四读取模块路径与当前dist-electron一致，CJS四预算文本存在，package files/asarUnpack保持packed归属，macOS/Windows均执行check:packaged-asar。未操作设备/端点、运行测试或发布。真正native Windows结果与新版本正式ASAR仍待CI/Release；原POSIX专属skip不得计Windows实测通过。

r141 Pad18真实AX5/dark自然AX目标（label=更改范围、value=未暂存、id=files-change-range）点击popup成功，打开详情后仍可打开菜单，实际完成STAGED→未暂存→WORKTREE→已暂存→BASE+STAGED且无WORKTREE。正常SIGINT finalize原片`/tmp/synapse-files-ipad18-r141-live-git-range.mp4`与最终PNG`/tmp/synapse-files-r141-live-git-staged.png`保留；root亲看当前已暂存、1文件+1−1、BASE→STAGED正文且无WORKTREE，最大字号完整可读。未确认生产不可操作缺口，没有根据ID传播/hitpoint猜测改生产。r139原XCTest proxy not-hittable FAIL仍保留，现场自然AX执行不等于将其自动报告改绿或证明SDK根因。独立Apple原片119.825秒窄复核无新增确定可见P1/P2：PTS20.0已暂存勾选popup与BASE/STAGED同屏，24.0切未暂存并清旧详情，54.0真实滚到review后STAGED−/WORKTREE+且两行号1完整，62.0再次popup未暂存勾选，66.0切已暂存，74.0等待桌面、76.0起BASE−/STAGED+且无WORKTREE至118.0稳定。菜单两项、统计/正文与左右列在最大字号下完整。原尺寸关键帧与映射在`/tmp/synapse-files-r141-independent/key01…04.png`、`key-PTS.json`。

r142 最终R123 phone18受影响Browse/Composer两项109.842秒、0失败/0跳过，root亲核原`/tmp/synapse-files-ui-iphone18-r142-affected-regression.log`的TEST EXECUTE SUCCEEDED。Browse60.726秒、Composer49.116秒；真实原生菜单/Copy、搜索Return、Reveal、横屏、长中文标题、两次引用与原草稿未发送均完成，执行的默认ALL无报告。正常finalize原片`/tmp/synapse-files-iphone18-r142-affected-regression.mp4`、xcresult和`/tmp/synapse-files-r142-affected-regression-attachments/`保留。最终交接`/tmp/synapse-files-ios-R123-final-handoff.json`含四色对、同PID、r139原FAIL/r141现场证据及12份Files源码SHA256；root逐份校验全部匹配。无临时Logger/OSLog/print/diagnostic残留，最终build log为`/tmp/synapse-files-matrix-build-r123-resolved-state-pair.log`；已有Swift隔离warning不作本任务扩修。

06:59最终明确quiet handoff：本任务自有四个Simulator已恢复large/light并shutdown，Xcode/UI测试与录像结束、无新夹具请求、源码/测试不再变更。owner将设备/端点归还root后，root仅向精确匹配的自有读取验收进程PID88644发送SIGINT；既有用户3001服务保持。所有设备读取使用的最终后端和R123源码指纹/证据已冻结，发版不依赖运行中的夹具。

## AC 证据与边界

下表逐条记录已验证范围，不用单个“通过”覆盖尚未取得的手工或平台证据。D 为桌面 `mobile-workspace-files-service.test.ts`，F 为 iOS `WorkspaceFilesFlowTests.swift`，W 为共享 `mobile-workspace-files.test.ts`；相邻网关/队列专项见上表日志。自动 tests 与源码约束能证明相应协议和架构行为，不能证明未运行的物理设备交互。

| AC | 已验证范围 | 尚未覆盖或最终待验 |
| --- | --- | --- |
| 01 | 三入口源码、presentation tests；r111/r112四流程与r114/r115实际Git→Files、附件草稿引用路由完成 | Pad18最大字号Git自然AX菜单r141往返真实完成；手机上传原路径由既有测试/源码复用核对 |
| 02 | D真实cwd漂移/普通目录/linked worktree/子模块内部cwd，两scope分别directory+changes同根；session cwd探测；F冻结scope | 四设备同根两tab实际完成；注册表无写为源码约束 |
| 03 | D HEAD/index/disk、staged-only、无HEAD、未跟踪；F范围保留；最终编译真实WORKTREE→STAGED两跳通过 | r111/r112与r114/r115默认实际两范围内容完成；Pad18最大字号范围r141自然AX现场真实完成，r139自动proxy FAIL保留 |
| 04 | D真实跨scope rename/删除/冲突/gitlink/type_changed/正反NUL binary/大小side，F/W未知统计和受限分页 | 不声明覆盖所有原生Git组合或实际系统属性安装文件 |
| 05 | D一层与10,001目录有界分页；F展开才请求/折叠不请求；最终编译真实深层目录通过 | 无watcher/全树/正文扫描为源码约束 |
| 06 | D深层/node_modules名称搜索、真实目录单调钟2秒空partial后complete、受控20k/请求与100k链truncated；F只提交/UTF16边界 | 非十万实体文件或真实手机耗时测量 |
| 07 | D正确三侧/空side/UTF8分页/大小side；最终编译真实UTF8与侧预览通过；Markdown后台模型复用 | 四设备UTF8、0204后页正文与Git侧内容均有真实UI证据；Markdown不执行外部程序为源码约束 |
| 08 | formatter各shell/特殊字符；6项UTF16/选区/迟到helper；真实中文emoji扩展草稿引用且无键盘/发送；gateway零PTY/租约 | 真正小/大输入选区移动、等待中手工编辑/切目标的完整UI矩阵未覆盖 |
| 09 | D owner/精确根授权/撤权窗口、live身份竞态；server握手/HTTP归属；最终compiled真实伪句柄拒绝和认证HTTP回退通过 | 未穷举所有身份/时序组合 |
| 10 | D POSIX link/祖先替换/FIFO及replacement；路径校验拒穿越/前缀越界/特殊名；UNC在FS调用前拒绝 | Windows ADS/设备/reparse原生依赖后续CI；未跑真实network drive或socket专项 |
| 11 | 原生filter canary、index/objects无变化；固定只读argv/env与非自由参数、无working-tree Git为代码/command专项；缺对象禁止lazy fetch参数 | 不声明外部diff/textconv/fsmonitor/缺对象联网分别做过真实canary |
| 12 | D正文页/配置创建删除替换与采集间漂移/跨query cursor；F缺页/重复页/版本校验；W完整性 | HEAD/index/目录漂移与cursor TTL的完整独立运行组合未穷举 |
| 13 | D cancel/open/TTL/close；pending重复与参数冲突；F关闭迟到页/引用ticket | 连续tab/文件/query真实压力、剪贴板迟到手工场景未覆盖 |
| 14 | D 10,001候选、超2MiB、多字节长行、换行/JSON模型；W最终UTF8信封 | 无端到端峰值RSS、Instruments或真实手机内存证据 |
| 15 | 同场景两个生产sender/queue拥塞，ordinary/cancel无clock推进即发送，keys实际进入LiveConnection handler，读页完整exactly-once或attributed failure；两队TTL/字节/数量 | FakeSocket集成不等于真实慢网络、完整Nestrelay或PTY输入验收 |
| 16 | gateway绕旧缓存；D命中复验/权限/TTL清理；F≤4MiB内存及owner/版本失效 | 未独立穷举LRU驱逐顺序/每种TTL组合；源码无持久化为静态核对 |
| 17 | 最终hosted通过，F离线/stale/暂缺summary/确认结束/切电脑与重新打开门控；D TTL；gateway/live断开与账号清理 | 真实断网/桌面重启/退出账号全链未跑 |
| 18 | W/F能力缺席不发送；server旧端/握手/WS/HTTP；旧终端真实relay18项 | 真实新旧三端所有版本组合未跑；生产顺序待发版记录 |
| 19 | 原生detents/内容large，r111/r112 Browse真实竖横屏；两phone最大字号dark长标题、菜单/关闭与草稿通过 | 真实硬件转向未跑 |
| 20 | 单Flow与NavigationSplitView/Stack；r110实际宽834×1210→窄375×491→中798×1150.5→原宽，Back、同文件重开、搜索/Reveal、Menu与草稿实际完成，独立新片复核通过 | 真实iPad硬件窗口/指针未跑 |
| 21 | 系统组件/语义token/±/两行号/自然AX标签，零过滤ALL；两phone默认/最大dark真实通过，Pad实际字号增长与浅深色分别独立核原片/像素 | 原始Pad ALL报告仍有失败，未宣称全App认证；R123原生行四组合与同App外观切换真实完成，原系统过渡帧另说明；物理VoiceOver/键盘指针/减弱动态手工证据未取得 |
| 22 | gateway错误与audit不含源码/路径；relay只精准目标/无summary正文缓存；现有NoticeBar复用 | 四设备默认入口、详情/菜单、关闭与草稿均有真实片；数据库/COS/遥测无正文为源码审查 |
| 23 | registry组装与dispose、Flow/client/后台模型分离、窄bridge、无依赖；v1.0.57正式macOS签名/公证、两平台ASAR/包内runtime/更新协议、typecheck/hard constraints均通过 | 未做正式桌面安装器在用户设备上的安装运行 |
| 24 | 旧Git范围、runtime/module规则、private例外、README/notes同步；核对MCP/系统Skill/Agent指南，无公开能力变更、Terminal仍49；v1.0.57原生Windows CI、正式新包、iOS（71）上传、最终部署及42账号站内信入库成功 | Apple处理、测试员安装与实际设备通知显示未在本次验收证明 |

## 最终验收结论与发布结果

- 桌面最后两项Git gate修订已冻结，109专项与完整typecheck/HARD通过，04:49最终full build与编译真实两跳15/15通过。验收端点使用独立配置home，真实adapter按精确权限读取夹具，不修改用户global。v1.0.57正式两平台ASAR/包内smoke、macOS签名与公证及原生Windows CI/安装器均已成功；不将早前缺Gate字节的独立包当正式新包。旧1.0.46缺新模块按预期失败，不计新包证据。
- iPhone18/26四流程、两Pad默认实际功能、205文件分页、字号/Back位置与Pad26真窗口复验已完成。R123原生行四组合及同App外观切换已独立核通过；Pad18最大字号Git自然AX现场r141完成两层往返，r139自动proxy失败保留。受影响phone18回归r142两项0失败/跳过通过；R123交接时12份指纹一致，后续仅NativeTable两处空析构改变，其他11份不变，Release优化编译及正式iOS归档/上传已通过。未重跑未变化的完整UI矩阵。物理VoiceOver、硬件键盘/指针、Reduce Motion与RSS/Instruments是尚未取得的证据边界。
- 独立安全最终只读复核已无新增确定P1/P2；Apple已给四色对/触选与同App外观切换的最终限定结论，未发现新增确定P1/P2，原低对比及持续空白P2关闭。Pad18范围菜单r141现场功能与独立新原片复核已完成、无新增确定可见P1/P2；r139自动proxy FAIL、自动ALL与手工criteria分别记录。
- 已完成首次Git提交、功能与修订提交、生产服务端先行部署、桌面v1.0.57 CI/Release、说明归档、TestFlight上传、最终服务器部署和全站站内信入库；各次失败和恢复结果在下方保留。

## 发布准备

最终界面验收期间再次执行的发版前检查通过：预览下一版v1.0.55的完整更新说明，生产通知接口确认42个活跃账号。此时只检查，未发送站内信、未推进版本、未发布；正式版本号和通知人数以最终发版记录为准。

### 第一轮发布与CI修订

功能提交`03612ce07`；版本提交`357aa73d8e1b564429df58948d250aede68778ef`推进1.0.55、同步iOS八个MARKETING_VERSION配置并推送main。正式推送前完整通知预检再次通过，42个活跃账号，仅预览未发送，pending说明保持原样。

CI于2026-10-03T23:00:10Z手动dispatch，精确run[37160313861](https://github.com/FairyEver/Synapse/actions/runs/37160313861)、workflow_dispatch/相同SHA/created23:00:12Z。最终四构建/运行时包检查job成功，Windows测试job与macOS完整tests失败，未dispatch Release。原日志`/tmp/synapse-files-release-v1.0.55-ci-windows-job.log`、`/tmp/synapse-files-release-v1.0.55-ci-macos-failure.log`保留；Windows八套106通过/5失败/11原POSIX跳过，212.93秒，不能计全绿；macOS完整983文件10024通过/1失败，468.23秒。

按server→desktop→iOS顺序先行`bash deploy.sh`已exit0、420秒完成：globals/在线预演/最终切换前数据库备份、迁移预演及正式迁移、服务切换和第二次health检查均成功，healthz/console/admin/深链/桌面更新/文档/Drive/凭据服务检查通过。精确log`/tmp/synapse-files-release-v1.0.55-server-before-desktop.log`，deployId`20261004_070020`。桌面/iOS包与站内信未发布。

六失败均对应测试契约与环境：Windows canary使用原始反斜杠写Git配置，原生Git同内容exit128 bad config；改slash后exit0并保clean/process完整命令，补真实`--no-includes`解析断言，仍要求external_filter_required和canary不执行。两个多次真实Git请求的集成case在Windows超过默认5秒测试总时限，仅局部设既有同类20秒，不改变生产单Git5秒/文件intent15秒或数量字节预算。Windows cmd mock原按大小写敏感且继承宿主PATHEXT；CI大写.CMD精确在Mac复现30/32，修订为Windows文件查询语义并显式覆盖fallback和大写分支，两个环境34/34绿，严格cmd.exe与完整转义仍保持。macOS旧registry预期88服务漏了已经实现的core.mobile-workspace-files；补完整89列表、terminal/guard/audit三依赖及gateway关联，registry/descriptors62/62绿。仅修测试，生产与R123 UI源码不变；原生Windows仍待新CI。

独立代理只读复核接受三测试修补：未新增skip、放松功能期望或扩大产品预算，真实配置解析和注册依赖断言反而加强。原失败及POSIX专属skip继续记录，不将本机模拟Windows视为原生Windows通过。

文件服务最终整套回归60/60通过、0失败/0跳过，101.36秒；日志`/tmp/synapse-files-windows-ci-fixture-fix-service-suite.log`，另三项针对性回归3/3通过。开发代理已冻结交接，仅修改上述测试文件。修订单独本地提交后，按发版流程推进v1.0.56并重新执行精确SHA的原生Windows及macOS CI；v1.0.55未发布，说明未归档、站内信未发送。

### 第二轮发布与集成测试时限

测试修订提交`5e7eba0ed`；版本提交`642dd92d66a86122b96500a630fa41eba07af60d`推进1.0.56并同步iOS八配置，通知预检再次通过（42活跃账号，未发送）。精确CI [37161155229](https://github.com/FairyEver/Synapse/actions/runs/37161155229)于23:15:01Z创建、workflow_dispatch与SHA相同，五job成功，只有Windows工作区协议测试job失败；未dispatch Release，pending说明保持不变。macOS完整983文件、10027测试全部通过，497.26秒；原日志`/tmp/synapse-files-release-v1.0.56-ci-macos-tests.log`。新版本先行服务端部署48秒exit0，deployId`20261004_071505`，第二次healthz及全部站点检查通过；log`/tmp/synapse-files-release-v1.0.56-server-before-desktop.log`。

Windows原先六项失败均已通过；本轮八套112通过/1失败/11原POSIX跳过，233秒，唯一新增失败为small-before/oversized-after真实Git用例默认5000ms整体时限。此用例包括仓库设置四个原生Git命令、add/commit和open/changes/双侧preview四个intent；相邻对称测试本轮6254ms通过。整组AST核对32个声明/37个展开case，既有30case显式20秒、3case显式30秒，仅4case意外继承全局5秒。开发代理将真实Git describe默认设为20秒，保留所有显式20/30秒及原断言，非Git组不变；本地Vitest4.1.5声明/实现和仓库同类用法已核对，生产单命令5秒/intent15秒与性能预算均不变。原Windows日志`/tmp/synapse-files-release-v1.0.56-ci-windows-job.log`保留，本机整套回归与独立复核待完成后推进下一轮。

后续独立复核接受该3行修订：同case在v55的4650ms通过、v56的5021ms被框架截断，其他真实Git用例普遍增加8%–12%，无对应产品deadline_exceeded；<1000ms取消断言与dispose路径仍保持。整套本地60/60通过、0失败/0跳过，102.61秒；日志`/tmp/synapse-files-windows-ci-suite-timeout-fix.log`。最终只改测试suite默认时限及验收记录，生产与12份R123 UI指纹不变，原生Windows仍待下一轮实际CI。

### 第三轮正式发布v1.0.57

时限修订独立提交`610da3798`；版本提交`2c6123c6884ccae49905597900d1dbb0ae1499bc`同步桌面/iOS 1.0.57。CI [37161828200](https://github.com/FairyEver/Synapse/actions/runs/37161828200)于23:27:25Z创建，精确SHA/workflow_dispatch匹配，六job全部成功；macOS 983文件10027/10027测试通过，473.89秒；Windows新增八套113通过、0失败、11原POSIX专属跳过，236.01秒，前两轮CI七个失败均已关闭，Windows安装器生成成功。日志`/tmp/synapse-files-release-v1.0.57-ci-macos-tests.log`、`/tmp/synapse-files-release-v1.0.57-ci-windows-job.log`，原55/56失败未改写。

再次确认remote main仍为该已测SHA后手动dispatch正式Release [37162650898](https://github.com/FairyEver/Synapse/actions/runs/37162650898)，23:43:02Z创建、同一SHA，四job均成功。macOS notarization successful，正式两平台check:packaged-asar、JS/Node runtime与更新协议smoke通过；macOS真实包内node-pty、PDF/DOCX/HTML/JSON Repair验证成功。原日志`/tmp/synapse-files-release-v1.0.57-release-{macos,windows}.log`保留。两平台安装器已上传COS，CDN刷新/校验及发布页创建成功。

精确[v1.0.57发布页](https://github.com/FairyEver/SynapseAppRelease/releases/tag/v1.0.57)已加入三节产品说明，readback逐字匹配生成正文，保留从原body提取的全部六条CDN URL和一键更新地址；assets数组为空符合当前分发方式。额外真实HTTP复核三安装器HEAD与三元数据GET全部200，三元数据version均1.0.57，证据`/tmp/synapse-files-release-v1.0.57-cdn-verification.json`。归档`docs/releases/v1.0.57.md`及pending重置的专门提交`e1bc3bc22`已push，未再dispatch CI/Release，并已用系统默认浏览器打开匹配发布页。

先行服务器部署48秒exit0，deployId`20261004_072725`；正式包及说明归档成功后并行启动`pnpm mobile:release`（实际1.0.57、build70）与`bash deploy.sh`。最终部署47秒exit0，deployId`20261004_075802`、全部站点检查通过，log`/tmp/synapse-files-release-v1.0.57-server-final.log`。build70归档失败，未上传、未发送站内信；iOS恢复步骤见下段。该轮桌面发布时R123源码未变，产品请求/资源预算始终保持。

### iOS Release编译规避与同版本恢复

build70的正式归档exit65，脚本仅保留stdout尾部，活动日志为空。独立保留完整stdout/stderr的真机目标Release编译复现：Swift6.3.3/effective5.10的EarlyPerfInliner在`WorkspaceFilesNativeTable.Coordinator`合成析构崩溃；先给该类显式空析构后，原符号通过、同优化器继续在本文件泛型`WorkspaceFilesNativeHostingSource`合成析构崩溃。原log`/tmp/synapse-files-release-v57-release-compile.log`与`/tmp/synapse-files-release-v57-explicit-deinit.log`保留。

最终仅`WorkspaceFilesNativeTable.swift`增加两处空`deinit {}`和原因注释，共7行；未关闭优化、修改actor/config、移除功能或更改字段销毁。独立复核确认ARC及父类析构仍执行，`dismantleUIView→detach`、弱捕获、回调/缓存清理、布局和所有动作原字节不变，依据[Swift官方析构语义](https://docs.swift.org/latest/documentation/the-swift-programming-language/deinitialization/)。最终同设置arm64/iOS18、Release `-O`/WMO完整compile/link/dSYM成功、exit0，日志`/tmp/synapse-files-release-v57-explicit-deinit-both.log`，没有编译错误/崩溃。该无签名产物版本1.0.57、默认build1，仅为编译验证，不冒充正式build70/71。

最终源相对R123为11/12文件原指纹不变，NativeTable新SHA256为`e6ce48c30cf439ca1944c16a16374de2ff76032f98b74d69e2ce8492e8a115c7`；更新冻结记录`/tmp/synapse-files-ios-v57-final-handoff.json`。原12文件R123交接是当时事实，后续发布产物以此修订指纹为准。独立检查已接受最小源码规避；不重复未变化的完整UI矩阵或桌面CI/Release，按同一v1.0.57恢复正式`pnpm mobile:release`，上传成功后再发送通知。

源码规避及配套验证计划/记录提交`defb67e99`已push，仅iOS源与文档，无桌面/服务端代码变化。2026-10-04 00:07Z原版本脚本重试实际1.0.57（71），正式ARCHIVE SUCCEEDED、EXPORT SUCCEEDED、uploaded提示及进程exit0均已亲核；log`/tmp/synapse-files-release-v1.0.57-ios-release-retry.log`。这是真正上传成功，与前述无签名build1分开记录；不等待Apple后续处理，不声明测试员已安装。APNS网关始终生产false，未改配置。

正式上传与最终服务器部署两命令均成功后，使用归档`docs/releases/v1.0.57.md`按稳定请求ID`release:v1.0.57`发送站内信。2026-10-04 00:11Z脚本exit0，服务端确认mail`cmut2feit001nl52p4nvju417`入库、收件人42人，log`/tmp/synapse-files-release-v1.0.57-mail.log`；该结果证明数据库接受及收件副本数量，不冒充通知设备显示或阅读。没有重复bump、重发桌面包或重复群发，完整发版完成。

## Apple 依据

系统 sheet、有效 detents 和紧凑高度遵循 [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)、[presentationDetents](https://developer.apple.com/documentation/swiftui/view/presentationdetents(_:selection:))、[medium](https://developer.apple.com/documentation/swiftui/presentationdetent/medium)。列表详情适配遵循 [NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview)；关闭动作按 [DismissAction](https://developer.apple.com/documentation/swiftui/dismissaction) 的 iOS 18 作用域处理。搜索、显式目录操作与行号朗读分别依据 [Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)、[Context menus](https://developer.apple.com/design/human-interface-guidelines/context-menus)、[VoiceOver](https://developer.apple.com/design/human-interface-guidelines/voiceover)。这是实现与审查依据，不能推断 Codex 截图的内部框架或替代实际窗口验收。

大字号代码行采用 [AnyLayout](https://developer.apple.com/documentation/swiftui/anylayout) 按实际Dynamic Type切换系统横/纵布局并保留子视图状态；字体选择遵循 [Typography](https://developer.apple.com/design/human-interface-guidelines/typography)，未设置字号上限。

树列表每个 ForEach 项用显式 VStack 保持常量一行，加载和本目录分页保留在该项中，依据 [Demystify SwiftUI performance](https://developer.apple.com/videos/play/wwdc2023/10160/) 对 List 身份收集与按需创建行的说明；这项结构建议不替代无障碍审计结果。

文件视图统一采用 [MenuPickerStyle](https://developer.apple.com/documentation/swiftui/menupickerstyle)，iOS14起可用；这是针对18实际最大字号证据的产品选择，不能推断Codex内部实现或替代18全项审计。
