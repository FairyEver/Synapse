import Testing

@testable import SynapseMobile

/// What the app says about the connection, and to whom it says it.
///
/// The bug these pin is that two unrelated problems produced one sentence. A phone with
/// no usable network and a phone whose computer is switched off both read "电脑离线",
/// so the user was sent to go and look at a computer that was already running while the
/// actual fault was in their hand.
struct ConnectivityTests {
    // MARK: - The socket's own words

    /// The reason has been carried on `.waiting` since it was written and never read,
    /// so a phone waiting on its network and a phone waiting on its credential said the
    /// same thing. Which one it is decides what the user should go and check.
    @Test func aWaitSaysWhatItIsWaitingFor() {
        #expect(RealtimeState.waiting("网络中断，正在重连").label == "网络中断，正在重连")
        #expect(RealtimeState.waiting("需要重新登录").label == "需要重新登录")
    }

    @Test func aWaitWithNothingToSayFallsBackToThePlainWord() {
        #expect(RealtimeState.waiting("").label == "等待网络")
    }

    @Test func theOtherSocketStatesKeepTheirOwnWords() {
        #expect(RealtimeState.idle.label == "未连接")
        #expect(RealtimeState.connecting.label == "连接中")
        #expect(RealtimeState.connected.label == "已连接")
        #expect(RealtimeState.unauthenticated.label == "需要登录")
    }

    // MARK: - Whose problem it is

    /// The socket being down is the phone's problem, and it is the one that matters:
    /// while the socket is down the computer list is either empty because it was never
    /// fetched or stale from before, so nothing it says about a computer is trustworthy.
    @Test func aDeadSocketIsReportedAsTheServersAbsence() {
        #expect(Connectivity.noServer("等待网络").label == "等待网络")
    }

    @Test func aLiveSocketWithNoComputerNamesTheComputer() {
        #expect(Connectivity.noComputer.label == "电脑不在线")
    }

    @Test func aWorkingConnectionSaysSo() {
        #expect(Connectivity.online.label == "已连接")
    }

    /// The whole point of telling them apart: the two send the user to different places.
    @Test func eachProblemSendsTheUserSomewhereDifferent() {
        #expect(Connectivity.noServer("等待网络").guidance == "请检查这台手机的网络。")
        #expect(Connectivity.noComputer.guidance == "请在电脑上打开 Synapse 并登录。")
    }

    /// Nothing to explain while the connection is fine — and there is no empty state to
    /// explain it in either.
    @Test func aWorkingConnectionHasNoAdviceToGive() {
        #expect(Connectivity.online.guidance == nil)
    }

    /// Every problem that can put an empty state on screen has something to say in it.
    /// A headline with nothing under it reads as a dead end.
    @Test func everyProblemWithAnEmptyStateHasASecondLine() {
        #expect(Connectivity.noServer("等待网络").guidance != nil)
        #expect(Connectivity.noComputer.guidance != nil)
        #expect(Connectivity.viewedComputerOffline.guidance != nil)
    }

    /// Being left on a computer that has gone away is not the same problem as having no
    /// computer at all, and the two send the reader to different places: one to the
    /// switch that is already on screen, the other to a machine that is switched off.
    /// Collapsing them back into one sentence is the original defect.
    @Test func aComputerThatWentAwayIsNotTheSameAsNoComputer() {
        #expect(Connectivity.viewedComputerOffline.label != Connectivity.noComputer.label)
        #expect(Connectivity.viewedComputerOffline.guidance != Connectivity.noComputer.guidance)
    }
}
