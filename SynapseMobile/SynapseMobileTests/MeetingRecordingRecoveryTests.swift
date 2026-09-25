import Foundation
import Testing

@testable import SynapseMobile

/// 一条收尾不掉的录音，什么时候才算「真的算了」。
///
/// 判据只有一个：**服务端说不认识它**（404）。那之后每次开机重试都注定失败，而那条记录在
/// 界面上根本不出现——没收尾的录音进不了列表，所以谁也不会发现它一直留在本机。反过来，
/// 网络断了、超时、5xx 都还得留着下次再试，那才是这条收尾路本来的意思。
///
/// **两个方向判错都要命**：判成「算了」会丢掉还能救的录音；判成「再试」就会永远重试一条
/// 已经救不回来的。所以这条区分单独成一个函数，由这里钉住。
struct MeetingRecordingRecoveryTests {
    private func error(status: Int) -> APIError {
        APIError(status: status, code: nil, message: "x")
    }

    /// 服务端已经不认这条录音了 —— 唯一该放手的一种。
    @Test func aMissingRecordingIsGivenUpOn() {
        #expect(MeetingRecordingSession.recoveryOutcome(for: error(status: 404)) == .giveUp)
    }

    /// 网络失败（`status == 0` 是传输层，见 `APIError.isTransport`）。
    /// 本机的残片还在，等网络回来就收得完。
    @Test func aTransportFailureIsRetried() {
        #expect(MeetingRecordingSession.recoveryOutcome(for: error(status: 0)) == .retryLater)
    }

    /// 服务端自己的毛病不是这条录音的判决 —— 换一会儿再来。
    @Test func aServerFailureIsRetried() {
        for status in [500, 502, 503, 504, 429, 408] {
            #expect(
                MeetingRecordingSession.recoveryOutcome(for: error(status: status)) == .retryLater,
                "\(status) 不该被当成「这条录音没了」"
            )
        }
    }

    /// 认不出的错误（取消、解码失败……）也算「下次再试」：宁可多试一次，也不要丢掉一条
    /// 还能救的录音。
    @Test func anUnknownFailureIsRetried() {
        struct Unexpected: Error {}
        #expect(MeetingRecordingSession.recoveryOutcome(for: Unexpected()) == .retryLater)
    }
}
