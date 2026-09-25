import Foundation
import Testing
@testable import SynapseMobile

/// 提交一条问题反馈之后该对用户说什么。
///
/// 六句话里有五句是从桌面端 dispatcher（`desktop/app-capabilities/problem-feedback/
/// main/dispatcher.ts`）抄过来的 —— 同一个后端、同一种失败，两端说同一句话，人才不必
/// 分别学。第六句（`.unknown`）只在手机上出现：桌面端在进程里提交，断网是一种失败；
/// 手机在移动网络里提交，请求发出去而响应没回来是完全正常的一种处境。
struct ProblemFeedbackOutcomeTests {

    @Test func successSaysSoAndPromisesNothingMore() {
        #expect(ProblemFeedbackOutcome.submitted.message == "问题反馈已提交")
    }

    @Test func invalidInputMatchesTheDesktopWording() {
        #expect(ProblemFeedbackOutcome.rejected.message == "问题反馈内容不符合提交要求。")
    }

    @Test func rateLimitedMatchesTheDesktopWording() {
        #expect(ProblemFeedbackOutcome.rateLimited.message == "问题反馈提交过于频繁。")
    }

    @Test func aServerFailureMatchesTheDesktopWording() {
        #expect(ProblemFeedbackOutcome.notSubmitted.message == "问题反馈未提交。")
    }

    /// 内容已经送出去了而结果不知道 —— 这句话必须说「可能已经提交」，
    /// 否则用户会重发，而后端会把它当第二条。
    @Test func anUnknownOutcomeSaysItMayHaveArrived() {
        #expect(ProblemFeedbackOutcome.unknown.message == "问题反馈提交结果未知，内容可能已经提交。")
    }

    /// 命中的风险类别要说得出来，但**不复述命中的内容**：这一行字本身会出现在屏幕上，
    /// 而它旁边就是用户刚刚粘进来的东西。
    @Test func aPrivacyRiskNamesTheCategoryWithoutQuotingIt() {
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "authentication_secret").message
                == "问题反馈包含不允许提交的隐私风险：看起来是密钥或密码。"
        )
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "local_path").message
                == "问题反馈包含不允许提交的隐私风险：看起来是本机文件路径。"
        )
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "identity").message
                == "问题反馈包含不允许提交的隐私风险：看起来是邮箱、IP 或设备标识。"
        )
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "user_content").message
                == "问题反馈包含不允许提交的隐私风险：看起来是对话或代码内容。"
        )
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "unsafe_url").message
                == "问题反馈包含不允许提交的隐私风险：看起来是一个不安全的链接。"
        )
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "correlation_identifier").message
                == "问题反馈包含不允许提交的隐私风险：看起来是精确时间或请求标识。"
        )
    }

    /// 服务端将来多一个类别时，回落成通用那句，不是空白。
    @Test func anUnknownPrivacyCategoryFallsBack() {
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "something_new").message
                == "问题反馈包含不允许提交的隐私风险。"
        )
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: nil).message
                == "问题反馈包含不允许提交的隐私风险。"
        )
    }
}
