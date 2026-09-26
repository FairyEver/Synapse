# 业务字段语义复核：以 Portal 功能与可见性为边界

用户明确：SDK 只负责与 Portal 页面的功能性、可见性对齐；前端不显示、也不参与对应页操作的数据，不要求 SDK 额外提供。此前把外部管理端及完整后端 DTO 当成交付范围，造成了过度扩展。本轮已修正真实 `catalog.describe()` 输出，不再以研究上游全部数据模型作为这五个能力的完成条件。

本轮仅只读参考源码，无业务接口调用、无 Web/Java 修改、无新浏览器或线上实测。Web 版本锚点 `test/portal/main` / `d3cf56bdc76c73c5eb9252be84b9b39b3900b48e`；Java `test/test` / `dcb3f360194e63c33cfd7ef9df4360355ff13533`。本表路径相对 Web 仓库。

## 实际保留与排除

| 能力 | 保留的页面字段及行为 | 排除或收敛 |
| --- | --- | --- |
| `study-course-text-list` | `education/course/text-course/list.vue` 的 ID、标题、录入人/时间、修改人/时间、查看次数、导流、语音状态与试听链接；行操作使用课程 `id`、`creator` 和远端 `news.id`。该 Portal 编辑页实际回显的作者、来源、基础浏览量、文章样式、分享时效、可阅读量、封面/正文/标签亦说明；语音弹窗回显方式/播报人/识别文字。 | 不要求宝典 `antiepidemic.media`、远端同步/发布/热点元数据、其他类型资源。`sharingLimitation` 确实在 Portal 编辑页显示，不能删除；按页面原值显示、无单位换算。不是用其他产品中同名字段推断单位。 |
| `study-course-video-list` | `education/course/video-course/list.vue` 的标题、类别、时长（秒）、查阅/评论/点赞数、创建人/时间；保留课程/资源 ID 与 creator。Portal 编辑回显的类别、讲师 ID、直播日期、分享时效、导流、可播放秒、封面/标签/文件/简介。 | 去掉宝典和外部视频管理元数据。分享时效没有 Portal 单位提示；撤回原先套用 zhdj-admin 的 5..600 秒约束。视频总时长 `duration` 和导流 `maySee` 才有明确秒单位；maySee 控件 0..180。 |
| `study-course-im-list` | `education/course/im-course/list.vue` 的课程名、人数、群主姓名与工号、创建人、创建/解散时间；课程状态实际上读外层 `record.isDel`，0 使用/1 解散。课程 ID、创建者 ID、groupId 与 chatRoomMuted 是行操作必需标识/判断。 | 排除不显示的 joinmode/jumpType、群成员列表及旧 mute。`joinmode=0` 仅为尚未实现的创建提交常量，不要求研究全枚举。解散动作在 Portal 已注释，不能宣称可调用。chatRoomMuted=true 表示当前禁言，页面按钮为“解禁”。 |
| `study-statistics-student-list` | `education/statistics/student/list.vue` 的工号、姓名、电话、班级、应学/实学班课数、听课时长、完成率、互动次数和两项平均成绩。`studyTime` 是没有单位格式化的原值列。 | 不添加秒/分钟/小时，不做换算；无需为了复现原值显示研究 app 上报协议，不再列单位研究阻塞。 |
| `perf-manage-insurance-list` | `hr/manage/insurance/list.vue` 的名称、证件号、个人/公司社保、个人/公司公积金，以及行 ID；四项数字均按页面原值显示。 | 不添加页面没有的币种、元分或除以100转换，不扩张为缴费/结算能力；额外单位研究不再是该只读列表的完成前提。 |

图文 `news.maySee` 在 Portal 编辑控件明确是 0..50 的百分数；视频 `videos.maySee` 是 0..180 秒，已拆分说明。原先“允许阅读/观看量”的泛化描述已删除。生成语音方式按 Portal 弹窗原文：1 识别文字、2 识别图片、3 上传语音。

三个课程能力仍只读，不把页面存在的编辑、同步、评论、语音或禁言动作宣称为 SDK 已实现。该任务不扩展尚未开发功能。现有后端请求与原始响应透传保持兼容，未列出属性属于兼容扩展，不展示、不解释、不参与业务决策；不再用重复调用相同列表取得 JSON 冒充动态语义 schema。

## 仍有效的业务证据与边界

- 考核结果 `money` 的“元”依据仍成立：Java `KpiMonthProtocolServiceImpl` 直接合入元制考核工资，SDK 不进行元分转换。此字段确为 Portal 列表字段，未因范围收敛撤回。
- 合同模板 `catalog.describeSchema('contract-template-content')` 仍提供 Portal 编辑器对应的 13 个可新建组件及变量/表格结构；未扩展合同写行为，保存仍 `onlySubmit=1`。
- 课程后端历史 500 故障、空资源和分页证据仍保留为失败说明；本轮没有声称后台故障已修复或重新实测成功。
- 五项原“语义阻塞”按用户明确的范围定义已闭合：隐藏扩展不在页面契约内，页面原值显示也已有准确用法。不是把未知单位猜成已知，也不是放松结构检查。

## 离线验证与反证

- `pnpm exec vitest run test/ai-contract-business.test.ts test/page-visible-business.test.ts`：21 项通过；使用真实 `catalog.describe()` 返回值，独立核对页面列清单、外层课程状态、语音链接、内部 ID 归属、阅读量/播放秒差别及兼容透传。
- `pnpm typecheck`：通过。
- 真实修改 `src/catalog/contracts-business.ts` 后各自运行测试：①反转 IM 0/1 状态；②移除 voiceUrl 说明；③视频 maySee 秒误改百分比；④给两种分享时效强加秒单位。四次均因目标语义断言变红，随后恢复并重跑 21 项通过。
- 未执行真实读写或 Java 测试；全仓文档生成、完整检查、其他并行模块和最终提交由主代理统一复核。
