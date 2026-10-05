import Foundation
import Testing

@testable import SynapseMobile

@MainActor
struct TerminalFileIntakeCleanupTests {
    @Test func screeningDiscardsOnlyThePreparedCopiesThatWereRefused() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let keptURL = directory.appendingPathComponent("kept.txt")
        let refusedURL = directory.appendingPathComponent("refused.txt")
        try Data("kept".utf8).write(to: keptURL)
        try Data("refused".utf8).write(to: refusedURL)
        let kept = PickedFile(url: keptURL, name: "kept.txt", size: 4, mimeType: "text/plain")
        let refused = PickedFile(url: refusedURL, name: "refused.txt",
            size: Int64(AppConfiguration.relayMaxFileBytes) + 1, mimeType: "text/plain")
        let files = [kept, refused]
        let screened = screenPickedFiles(files, alreadyWaiting: 0)
        TerminalFileIntake.discardRejected(files, keeping: screened.accepted)
        #expect(FileManager.default.fileExists(atPath: keptURL.path))
        #expect(!FileManager.default.fileExists(atPath: refusedURL.path))
        TerminalFileIntake.discard(kept)
        #expect(!FileManager.default.fileExists(atPath: keptURL.path))
    }
}
