import Foundation
import Testing
@testable import SynapseMobile

struct TodoTimeTests {
    @Test func instantAndUnicodeContract() throws {
        var draft = TodoDraft()
        draft.title = String(repeating: "🀄", count: 200)
        #expect(draft.validationMessage(now: Date(timeIntervalSince1970: 0)) == nil)
        draft.title += "a"
        #expect(draft.validationMessage(now: Date(timeIntervalSince1970: 0)) != nil)
        draft.title = String(repeating: "e\u{301}", count: 101)
        #expect(draft.validationMessage(now: Date(timeIntervalSince1970: 0)) != nil)
        draft.title = "a\0b"
        #expect(draft.validationMessage(now: Date(timeIntervalSince1970: 0)) != nil)
        let instant = try #require(ISO8601DateFormatter.parseWireTimestamp("2026-11-12T09:00:37.123Z"))
        let wire = TodoTime.wire(instant)
        #expect(wire == "2026-11-12T09:00:00Z")
        let shanghai = TodoTime.display(instant, timeZone: try #require(TimeZone(identifier: "Asia/Shanghai")))
        let losAngeles = TodoTime.display(instant, timeZone: try #require(TimeZone(identifier: "America/Los_Angeles")))
        #expect(shanghai != losAngeles)
    }

    @Test func foundationCalendarHandlesDSTWithoutManualOffset() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/Los_Angeles"))
        let before = try #require(ISO8601DateFormatter.parseWireTimestamp("2026-03-08T09:30:00Z"))
        let after = try #require(calendar.date(byAdding: .hour, value: 1, to: before))
        #expect(calendar.component(.hour, from: before) == 1)
        #expect(calendar.component(.hour, from: after) == 3)
        #expect(TodoTime.wire(after) == "2026-03-08T10:30:00Z")
    }
}
