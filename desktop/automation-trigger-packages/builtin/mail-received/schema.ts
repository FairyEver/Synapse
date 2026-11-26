import { z } from "zod"

const nonEmptyTerm = z.string().trim().min(1).max(200)
const filterList = z.array(nonEmptyTerm).min(1).max(20)

export const mailReceivedConfigSchema = z.object({
  accountId: z.string().min(1).optional().describe("Optional local email account ID from app_mail_account_list; omit to listen to all accounts."),
  senderMatches: filterList.optional().describe("Optional sender allowlist (match any From address, case-insensitive). Each entry may be a domain like '@world-tech.com.cn' or 'world-tech.com.cn', or an exact email address like 'alice@world-tech.com.cn'."),
  subjectContains: filterList.optional().describe("Optional subject keyword allowlist (match any, case-insensitive Unicode-normalized substring)."),
  originalOnly: z.boolean().optional().describe("When true, skip replies and forwards using indexed References/In-Reply-To metadata or Re:/RE:/回复:/回复：/答复:/答复：/Fwd:/Fw:/转发:/转发： subject prefixes without downloading the body."),
}).strict()

export type MailReceivedConfig = z.infer<typeof mailReceivedConfigSchema>
