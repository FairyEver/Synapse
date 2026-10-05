import Testing
@testable import SynapseMobile

struct DriveIntakeFeedbackTests {
    @Test func successfulAndCancelledPickersDoNotShowAnError() {
        #expect(DriveFileIntake.failureMessage(selected: 2, prepared: 2) == nil)
        #expect(DriveFileIntake.failureMessage(selected: 0, prepared: 0) == nil)
    }

    @Test func unreadableFilesReportWhetherTheEntireSelectionFailed() {
        #expect(DriveFileIntake.failureMessage(selected: 1, prepared: 0) == "未能读取所选文件，请重新选择。")
        #expect(DriveFileIntake.failureMessage(selected: 3, prepared: 2) == "部分文件未能读取，请重新选择。")
    }
}
