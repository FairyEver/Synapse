import Foundation
import Testing

@testable import SynapseMobile

@MainActor
struct TerminalActionContextTests {
    private func context(_ desktop: String = "desktop-a", account: Int = 1, viewing: Int = 1) -> TerminalActionContext {
        TerminalActionContext(desktopId: desktop, accountGeneration: account, viewingGeneration: viewing)
    }

    @Test func switchingComputersWhileUnlockWaitsPreventsTheWrite() async {
        let original = context()
        var current: TerminalActionContext? = original
        var resume: CheckedContinuation<Void, Never>?
        var sent = false
        let writing = Task {
            if await original.remainsCurrent(while: {
                await withCheckedContinuation { resume = $0 }
            }, current: { current }) { sent = true }
        }
        while resume == nil { await Task.yield() }
        current = context("desktop-b", viewing: 2)
        resume?.resume()
        await writing.value
        #expect(!sent)
    }

    @Test func returningToTheOriginalComputerDoesNotRestoreAQueuedWrite() async {
        let original = context()
        var current: TerminalActionContext? = original
        var resume: CheckedContinuation<Void, Never>?
        let authorization = Task {
            await original.remainsCurrent(while: {
                await withCheckedContinuation { resume = $0 }
            }, current: { current })
        }
        while resume == nil { await Task.yield() }
        current = context(viewing: 3)
        resume?.resume()
        #expect(await authorization.value == false)
    }

    @Test func signingOutBeforeAQueuedWriteDoesNotEvenRequestUnlock() async {
        let original = context()
        var unlocks = 0
        let authorized = await original.remainsCurrent(while: { unlocks += 1 }, current: { nil })
        #expect(!authorized)
        #expect(unlocks == 0)
    }

    @Test func aNewAccountCannotContinueTheOutgoingAccountsUnlock() async {
        let original = context()
        var current: TerminalActionContext? = original
        var resume: CheckedContinuation<Void, Never>?
        let authorization = Task {
            await original.remainsCurrent(while: {
                await withCheckedContinuation { resume = $0 }
            }, current: { current })
        }
        while resume == nil { await Task.yield() }
        current = context(account: 2)
        resume?.resume()
        #expect(await authorization.value == false)
    }

    @Test func anUnchangedContextContinuesAfterUnlock() async {
        let original = context()
        var unlocks = 0
        let authorized = await original.remainsCurrent(while: { unlocks += 1 }, current: { original })
        #expect(authorized)
        #expect(unlocks == 1)
    }
}
