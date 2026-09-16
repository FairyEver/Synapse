export const VOICE_APP_ID = "voice" as const
export const VOICE_SETTINGS_NAMESPACE = "app.voice.settings" as const

/**
 * SecretKey 是唯一真正需要保密的字段，放加密的 `app.secrets.items`；appid 与
 * secretid 不是密钥（secretid 相当于用户名），走普通设置项，便于在设置里直接看到。
 */
export const VOICE_SECRET_KEY_NAME = "TENCENT_ASR_SECRET_KEY" as const

/**
 * 混元内测版。**实测选它，不是 16k_zh_en_2.0**。
 *
 * 2026-09-17 用真实指令 A/B 过（同一个音频跑四个引擎）：
 *
 *   跑一下 pnpm test，然后 git status 看看 SynapseMobile 改了什么
 *     16k_zh_en_2.0      → 泡一下PMPN test, 然后git statustus, 看看synapse mobile…
 *     16k_zh_en          → 泡一下PMPM dev prod…
 *     16k_zh             → 跑一下p npm dev prod…
 *     Hy-ASR-3.0-preview → 跑一下 pnpm test，然后 git status 看看 SynapseMobile 改了什么
 *
 * 三条实测结论，两条和设计文档的假设相反：
 * 1. **它当前支持热词**。文档写的「上下文传入及热词增强即将开放」已经不成立：
 *    传 hotword_list 不报错，而且实测生效 —— `mobile-gateway`、`devicectl`、
 *    `SynapseMobile` 都是从热词表里救回来的。
 * 2. **它比大模型 2.0 准得多**，热词救不回来的 `pnpm`（16k_zh_en_2.0 出 PMPM）
 *    它本来就读得对。
 * 3. **首字还更快**：621–726ms，对比 16k_zh_en_2.0 的 718–932ms。
 *
 * 它唯一的限制是音频 60 秒以内，而 `max_speak_time` 本来默认就是 60 秒，对
 * 一条语音指令不构成约束。可在设置里切换。
 */
export const VOICE_DEFAULT_ENGINE_MODEL_TYPE = "Hy-ASR-3.0-preview" as const

/**
 * 临时热词表。项目里全是专有名词，通用引擎不认识它们，热词是收益最高的一项。
 * 权重 11 是「超级热词」，只给必须正确的词用——设多了会拉低整体字准率。
 */
export const VOICE_DEFAULT_HOTWORD_LIST =
  "SynapseMobile|10,mobile-gateway|10,devicectl|10,pnpm|10,git status|10,Synapse|8,xterm|8" as const

/** 1 = 科技领域，对本项目对口。0 关 / 2 电影 / 3 歌曲。 */
export const VOICE_DEFAULT_DOMAIN = 1 as const
