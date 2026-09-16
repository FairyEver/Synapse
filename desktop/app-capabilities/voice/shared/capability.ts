export const VOICE_APP_ID = "voice" as const
export const VOICE_SETTINGS_NAMESPACE = "app.voice.settings" as const

/**
 * SecretKey 是唯一真正需要保密的字段，放加密的 `app.secrets.items`；appid 与
 * secretid 不是密钥（secretid 相当于用户名），走普通设置项，便于在设置里直接看到。
 */
export const VOICE_SECRET_KEY_NAME = "TENCENT_ASR_SECRET_KEY" as const

/** 大模型 2.0 档，中英混说 + 方言，且比通用引擎便宜。可在设置里切换。 */
export const VOICE_DEFAULT_ENGINE_MODEL_TYPE = "16k_zh_en_2.0" as const

/**
 * 临时热词表。项目里全是专有名词，通用引擎不认识它们，热词是收益最高的一项。
 * 权重 11 是「超级热词」，只给必须正确的词用——设多了会拉低整体字准率。
 */
export const VOICE_DEFAULT_HOTWORD_LIST =
  "Synapse|11,SynapseMobile|10,mobile-gateway|10,devicectl|10,pnpm|8,git|8,xterm|8" as const

/** 1 = 科技领域，对本项目对口。0 关 / 2 电影 / 3 歌曲。 */
export const VOICE_DEFAULT_DOMAIN = 1 as const
