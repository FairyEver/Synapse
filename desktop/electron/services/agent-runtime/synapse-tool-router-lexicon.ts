/**
 * MCP `search` 的中文词表。
 *
 * `search` 的索引是工具名与英文描述，中文查询与它没有词面交集，所以必须有一层
 * 「中文词 -> 工具名里真实出现的英文段」的桥。本模块只做这件事：把查询串里
 * 命中的中文词展开成英文 token，交给既有的 Fuse + lexicalRelevance 排序管线。
 *
 * 两条硬约束（由 `tests/unit/synapse-tool-router-search.test.ts` 的门禁强制）：
 * 1. `term` 长度 >= 2 字。单字条目（如「表」）会命中「报表」这类复合词引入假阳性。
 * 2. `token` 必须是工具名里真实出现的段。发出的 token 若不在任何 `name` 里，
 *    就匹配不到 `name` 字段，展开等于无效。
 */

/** 出现在多个工具名里、但没有语义、不值得配中文词的粘合段。每条必须给理由。 */
export const EXEMPT_SEGMENTS: Readonly<Record<string, string>> = {
  to: "extract_to_file 的结构助词，语义由 extract 与 file 承载",
  set: "set_visibility 的动词，语义由 visibility 承载",
  used: "used_model 的修饰词，语义由 model 承载",
}

/**
 * 中文词 -> 工具名段。同义词各占一行；同一个中文词映射到两个 token 是有意的，
 * 需要时把它列两遍（如「文件」同时给 item 与 file）。
 *
 * 条目顺序决定 `lexiconTokens` 的输出顺序，而输出顺序会影响
 * `mergeFuseResults` 的输入次序与 `uniqueQueryTokens` 的首次出现次序，
 * 所以排定后不要随手重排。
 */
export const LEXICON: readonly (readonly [term: string, token: string])[] = [
  // ---------------- 名词：domain 与实体 ----------------
  ["云盘", "drive"],
  ["网盘", "drive"],
  ["终端", "terminal"],
  ["数据库", "database"],
  ["表格", "table"],
  ["工作流", "workflow"],
  ["定时任务", "automation"],
  ["自动化", "automation"],
  ["定时", "automation"],
  ["仓库", "repository"],
  ["技能", "skill"],
  ["资源", "resource"],
  ["规则", "rule"],
  ["模型", "model"],
  ["价格", "price"],
  ["账号", "account"],
  ["登录", "login"],
  ["对话", "conversation"],
  ["助手", "agent"],
  ["供应商", "provider"],
  ["设置", "settings"],

  // ---------------- 名词：drive ----------------
  ["文件", "item"],
  ["文件", "file"],
  ["条目", "item"],
  ["文件夹", "folder"],
  ["目录树", "tree"],
  ["版本", "version"],
  ["历史版本", "version"],
  ["分享", "share"],
  ["链接", "link"],
  ["直链", "direct"],
  ["站点", "site"],
  ["网站", "site"],
  ["网页", "html"],
  ["网页", "site"],
  ["评论", "comment"],
  ["批注", "annotation"],
  ["线程", "thread"],
  ["回收站", "trash"],
  ["同步", "sync"],
  ["绑定", "binding"],
  ["排除", "exclude"],
  ["多条规则", "rules"],
  ["冲突", "conflict"],
  ["快照", "snapshot"],
  ["用量", "usage"],
  ["统计", "stats"],
  ["整理", "reorganization"],
  ["落地", "materialize"],
  ["路径", "path"],
  ["打包", "zip"],

  // ---------------- 名词：terminal ----------------
  ["会话", "session"],
  ["标签", "workspace"],
  ["工作区", "workspace"],
  ["分组", "group"],
  ["分屏", "pane"],
  ["分个屏", "pane"],
  ["命令", "command"],
  ["快捷", "command"],
  ["能力", "capabilities"],
  ["诊断", "diagnostics"],
  ["操作", "operation"],
  ["视图", "view"],
  ["元数据", "metadata"],
  ["全局", "global"],

  // ---------------- 名词：database ----------------
  ["字段", "column"],
  ["记录", "row"],
  ["数据", "row"],
  ["批量", "rows"],
  ["状态", "state"],
  ["选项", "choice"],
  ["概览", "overview"],
  ["数量", "count"],
  ["日志", "log"],
  ["摘要", "summary"],
  ["SQL", "sql"],

  // ---------------- 名词：其他 ----------------
  ["密钥", "secrets"],
  ["节点", "node"],
  ["连线", "edge"],
  ["定义", "definition"],
  ["类型", "type"],
  ["提示词", "prompt"],
  ["文档", "document"],
  ["模板", "template"],
  ["EJS", "ejs"],
  ["docx", "docx"],
  ["JSON", "json"],
  ["文本", "text"],
  ["提取器", "extractor"],
  ["生成器", "generator"],
  ["打开器", "opener"],
  ["写入器", "writer"],
  ["执行器", "executor"],
  ["触发器", "trigger"],
  ["回调", "webhook"],
  ["运行时", "runtime"],
  ["预设", "preset"],
  ["配置项", "param"],
  ["参数", "param"],
  ["布局", "layout"],
  ["消息", "message"],
  ["轮次", "turn"],
  ["权限", "permission"],
  ["通知", "notifier"],
  ["通知", "notification"],
  ["声音", "sound"],
  ["系统", "system"],
  ["问题", "problem"],
  ["反馈", "feedback"],
  ["报告", "report"],
  ["可见性", "visibility"],
  ["访问", "access"],
  ["本地", "local"],
  ["内容", "content"],
  ["原始", "raw"],

  // ---------------- 动词 ----------------
  ["列表", "list"],
  ["列出", "list"],
  ["清单", "list"],
  // 中文的疑问式列举是最常见的「list」表达，不映射就等于返回空集
  ["有哪些", "list"],
  ["哪些", "list"],
  ["几次", "list"],
  ["查询", "get"],
  ["读取", "get"],
  ["读取", "read"],
  ["最新输出", "output"],
  ["新建", "create"],
  ["创建", "create"],
  ["新增", "create"],
  ["更新", "update"],
  ["修改", "update"],
  ["插入", "upsert"],
  ["删除", "delete"],
  ["清空", "clear"],
  ["移除", "remove"],
  ["改名", "rename"],
  ["重命名", "rename"],
  ["移动", "move"],
  ["还原", "restore"],
  ["回滚", "restore"],
  ["预览", "preview"],
  ["观察", "observe"],
  ["监看", "observe"],
  ["检查", "inspect"],
  ["描述", "describe"],
  ["解决", "resolve"],
  ["应用", "apply"],
  ["确保", "ensure"],
  ["打开", "open"],
  ["启动", "launch"],
  ["开始", "start"],
  ["跑一下", "launch"],
  ["执行", "execute"],
  ["运行", "run"],
  ["跑过", "run"],
  ["几次", "run"],
  ["生成", "generate"],
  ["提取", "extract"],
  ["写入", "write"],
  ["输入", "input"],
  ["输出", "output"],
  ["发送", "send"],
  ["提交", "submit"],
  ["提交", "commit"],
  ["应答", "respond"],
  ["引导", "steer"],
  ["停止", "stop"],
  ["停下", "stop"],
  ["停用", "disable"],
  ["启用", "enable"],
  ["暂停", "pause"],
  ["恢复", "resume"],
  ["重新扫描", "rescan"],
  ["上传", "upload"],
  ["下载", "download"],
  ["导入", "import"],
  ["安装", "install"],
  ["分叉", "fork"],
  ["重新发布", "republish"],
  ["公开", "public"],
  ["固定", "pin"],
  ["调整", "resize"],
  ["播放", "play"],
  ["粘贴", "paste"],
  ["覆盖", "override"],
  ["申请", "acquire"],
  ["续期", "renew"],
  ["释放", "release"],
  ["强制", "force"],
  ["控制", "control"],
  ["排序", "reorder"],
  ["修复", "repair"],
]

export function lexiconTokens(query: string): string[] {
  const normalized = query.toLowerCase()
  const tokens: string[] = []
  for (const [term, token] of LEXICON) {
    // 两边都小写化：查询被 toLowerCase 过，含大写字母的词条（如「SQL」）否则永不命中。
    if (normalized.includes(term.toLowerCase()) && !tokens.includes(token)) tokens.push(token)
  }
  return tokens
}
