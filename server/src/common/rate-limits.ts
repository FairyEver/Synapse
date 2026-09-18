export const RATE_LIMIT_TTL_MS = 60_000
export const DEFAULT_API_RATE_LIMIT_PER_MINUTE = 600
export const DRIVE_UPLOAD_RATE_LIMIT_PER_MINUTE = 2400
export const DOCUMENT_IMAGE_UPLOAD_RATE_LIMIT_PER_MINUTE = 60
export const UPDATE_INTENT_ISSUE_RATE_LIMIT_PER_MINUTE = 10
export const UPDATE_INTENT_VERIFY_RATE_LIMIT_PER_MINUTE = 30
/**
 * 语音识别签名。签出来的 URL 花的是平台的语音配额，所以比默认宽松额度收紧一些。
 * 一条语音指令对应一次录音，30 次/分钟对正常使用是够的（签名有效期 5 分钟，
 * 客户端不需要频繁续签）。
 */
export const VOICE_ASR_SESSION_RATE_LIMIT_PER_MINUTE = 30

/**
 * 会议录音的分片上传。一分钟按 1 MB 一片算，正常录音远到不了这个量；给得宽是因为
 * 分片是连续流的，卡住一次会直接断掉正在进行的录音。
 */
export const MEETING_UPLOAD_RATE_LIMIT_PER_MINUTE = 600
