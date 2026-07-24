import type {
  ProblemFeedbackInputField,
  ProblemFeedbackInputReason,
  ProblemFeedbackPrivacyCategory,
} from "./problem-feedback.js"

export const PROBLEM_FEEDBACK_POLICY_FIXTURES = {
  valid: [
    {
      name: "minimum useful context",
      input: {
        content: [
          "场景：使用 Synapse 内置 Skill 执行公开能力。",
          "实际情况：工具返回了与公开契约不一致的结果。",
          "判断理由：相同输入按公开说明应返回成功。",
        ].join("\n"),
      },
    },
    {
      name: "approved placeholders and public diagnostics",
      input: {
        content: [
          "场景：读取 <project>/<module>/<file>。",
          "实际情况：Synapse 1.2.3 返回公开错误码 E_PUBLIC_42。",
          "必要公开文档：https://docs.example.invalid/synapse/problem-feedback",
          "文件 SHA-256：0123456789abcdef0123456789abcdef",
        ].join("\n"),
      },
    },
  ],
  invalidInput: [
    {
      name: "request must be an object",
      input: null,
      field: "request",
      reason: "type",
    },
    {
      name: "unknown field",
      input: { content: "场景：合成场景。", title: "extra" },
      field: "request",
      reason: "unknown_field",
    },
    {
      name: "content required",
      input: {},
      field: "content",
      reason: "required",
    },
    {
      name: "leading whitespace",
      input: { content: " 场景：合成场景。" },
      field: "content",
      reason: "leading_or_trailing_whitespace",
    },
    {
      name: "unpaired surrogate",
      input: { content: "场景：\ud800" },
      field: "content",
      reason: "invalid_unicode",
    },
    {
      name: "tab",
      input: { content: "场景：\t合成场景。" },
      field: "content",
      reason: "forbidden_character",
    },
  ] satisfies ReadonlyArray<{
    readonly name: string
    readonly input: unknown
    readonly field: ProblemFeedbackInputField
    readonly reason: ProblemFeedbackInputReason
  }>,
  privacy: [
    {
      category: "authentication_secret",
      rejected: "场景：请求失败。\nAuthorization: Bearer ghp_SYNTHETICCANARY12345678901234567890",
      allowed: "场景：请求失败。\nAuthorization: Bearer <token>",
    },
    {
      category: "authentication_secret",
      rejected: "场景：请求失败。\nAuthorization: Bearer <token> SYNTHETIC-CANARY",
      allowed: "场景：请求失败。\nAuthorization: Bearer <token>",
    },
    {
      category: "authentication_secret",
      rejected: "场景：验证失败。\nPIN: 1234",
      allowed: "场景：PIN 输入框拒绝了四位虚构值。",
    },
    {
      category: "authentication_secret",
      rejected: "场景：验证失败。\nverification code: 123456",
      allowed: "场景：verification code format 应为六位数字。",
    },
    {
      category: "authentication_secret",
      rejected: "场景：验证失败。\n验证码：123456",
      allowed: "场景：验证码格式应为六位数字。",
    },
    {
      category: "authentication_secret",
      rejected: "场景：恢复失败。\nrecovery code: SYNTHETIC-CANARY-2468",
      allowed: "场景：recovery code: <secret>",
    },
    {
      category: "authentication_secret",
      rejected: "场景：导入失败。\nseed phrase: synthetic canary words only",
      allowed: "场景：seed phrase length 应显示为 12 words。",
    },
    {
      category: "authentication_secret",
      rejected: "场景：导入失败。\nseed phrase: <secret> abandon ability able about above",
      allowed: "场景：导入失败。\nseed phrase: <secret>",
    },
    {
      category: "authentication_secret",
      rejected: "场景：恢复失败。\nrecovery code: <secret> SYNTHETIC-CANARY-2468",
      allowed: "场景：恢复失败。\nrecovery code: <secret>",
    },
    {
      category: "authentication_secret",
      rejected: "场景：导入失败。\n助记词：synthetic canary words only",
      allowed: "场景：助记词长度应显示为 12 个词。",
    },
    {
      category: "local_path",
      rejected: "场景：读取 /Users/synthetic-canary/private/project/file.ts 时失败。",
      allowed: "场景：读取 <project>/<module>/<file> 时失败。",
    },
    {
      category: "local_path",
      rejected: "场景：执行 /usr/local/bin/synthetic-tool 时失败。",
      allowed: "场景：文档把 usr/local/bin/synthetic-tool 作为相对示例。",
    },
    {
      category: "local_path",
      rejected: "场景：读取 /Applications/Synapse/config.json 时失败。",
      allowed: "场景：读取 <project>/<module>/<file> 时失败。",
    },
    {
      category: "local_path",
      rejected: "场景：读取 /Library/Application Support/Synapse/config.json 时失败。",
      allowed: "场景：公开路由 /api/problem-feedback 返回错误。",
    },
    {
      category: "local_path",
      rejected: "场景：写入 /dev/null 时失败。",
      allowed: "场景：文档使用 dev/null 作为相对示例。",
    },
    {
      category: "identity",
      rejected: "场景：联系 synthetic-canary@example.invalid 后复现。",
      allowed: "场景：由 <user> 在通用环境中复现。",
    },
    {
      category: "user_content",
      rejected: [
        "diff --git a/synthetic/file.ts b/synthetic/file.ts",
        "--- a/synthetic/file.ts",
        "+++ b/synthetic/file.ts",
        "@@ -1 +1 @@",
      ].join("\n"),
      allowed: "场景：使用虚构值执行最小复现，实际返回公开错误码 E_PUBLIC_42。",
    },
    {
      category: "unsafe_url",
      rejected: "复现链接：https://docs.example.invalid/guide?request=synthetic-canary",
      allowed: "复现链接：https://docs.example.invalid/guide",
    },
    {
      category: "correlation_identifier",
      rejected: "场景：请求失败。\nrequest-id: synthetic-canary-123456",
      allowed: "场景：连续两次请求中的第二次失败，request-id: <request-id>",
    },
  ] satisfies ReadonlyArray<{
    readonly category: ProblemFeedbackPrivacyCategory
    readonly rejected: string
    readonly allowed: string
  }>,
} as const
