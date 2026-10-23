import Foundation

@main
struct InternalMailReferenceCheck {
    static func main() {
        let valid = "synapse://mail-internal/message_1-2"
        precondition(InternalMailReference.parse(URL(string: valid)!) == "message_1-2")
        let invalid = [
            "synapse://mail/message_1", "https://mail-internal/message_1",
            "synapse://mail-internal/", "synapse://mail-internal/a/b",
            "synapse://mail-internal/a?", "synapse://mail-internal/a?extra=1",
            "synapse://mail-internal/a#", "synapse://mail-internal/a#extra",
            "synapse://mail-internal/a%2Fb", "synapse://mail-internal/%61",
            "synapse://user@mail-internal/a", "synapse://mail-internal:1/a",
            "synapse://mail-internal/../a", "synapse://mail-internal/a/",
            "synapse://mail-internal/" + String(repeating: "a", count: 201)
        ]
        for raw in invalid {
            precondition(InternalMailReference.parse(URL(string: raw)!) == nil, raw)
        }
        print("Internal mail reference checks passed (16 cases)")
    }
}
