import Foundation

struct AppError: LocalizedError {
    let msg: String
    init(_ m: String) { msg = m }
    var errorDescription: String? { msg }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    var firstLine: String { split(separator: "\n", omittingEmptySubsequences: true).first.map(String.init) ?? "" }
}

func link(_ s: String) -> URL { URL(string: s) ?? URL(string: "https://github.com")! }

struct GHLabel: Decodable, Hashable { let name: String }

struct Runner: Decodable, Identifiable {
    let id: Int
    let name: String
    let status: String
    let busy: Bool
    let labels: [GHLabel]
    var isBrain: Bool { labels.contains { $0.name == "brain" } }
}
struct RunnersResp: Decodable { let runners: [Runner] }

struct Run: Decodable, Identifiable {
    let id: Int
    let name: String?
    let display_title: String?
    let status: String?
    let created_at: Date
    let html_url: String
    var title: String {
        let n = name ?? "run", t = display_title ?? ""
        return t.isEmpty || t == n ? n : "\(n): \(t)"
    }
}
struct RunsResp: Decodable { let workflow_runs: [Run] }

struct PR: Decodable, Identifiable {
    let id: Int
    let number: Int
    let title: String
    let html_url: String
    let labels: [GHLabel]
    var landing: Bool { labels.contains { $0.name == "land" } }
}

struct Issue: Decodable, Identifiable {
    let id: Int
    let number: Int
    let title: String
    let html_url: String
}

struct GHComment: Decodable {
    let id: Int
    let body: String?
    let created_at: Date
    let html_url: String
}

struct Variable: Decodable { let name: String; let value: String }

/// tools/usaged.mjs publishes this to the repo variable MCLITE_USAGE every 5 minutes.
struct UsageRec: Decodable {
    struct Win: Decodable { let pct: Double?; let resets_at: String? }
    struct Acct: Decodable {
        let ok: Bool
        let email: String?
        let why: String?
        let week: Win?
        let window: Win?
        let stale: Bool?
    }
    let at: String?
    let host: String?
    let diskFreeGB: Double?
    let accounts: [String: Acct]
}

func parseISO(_ s: String?) -> Date? {
    guard let s else { return nil }
    let plain = s.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
    return ISO8601DateFormatter().date(from: plain)
}

func relative(_ d: Date?) -> String {
    guard let d else { return "" }
    return RelativeDateTimeFormatter().localizedString(for: d, relativeTo: Date())
}

/// One bus message (issue #53): "to: X\nfrom: Y\n[re: id]\n[about: id]\n\ntext". A line "options: A | B | C" in
/// the text makes it a multiple-choice question the app shows as buttons.
struct BusMessage: Identifiable, Hashable {
    let id: Int
    let to: String
    let from: String
    let re: String?
    let about: String?
    let text: String
    let date: Date
    let url: String

    init(_ c: GHComment) {
        id = c.id
        date = c.created_at
        url = c.html_url
        var f: [String: String] = [:]
        var body: [String] = []
        var header = true
        for raw in (c.body ?? "").replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n") {
            if header {
                let l = raw.trimmed
                if l.isEmpty {
                    if !f.isEmpty { header = false }
                    continue
                }
                if let i = l.firstIndex(of: ":") {
                    let k = l[..<i].lowercased()
                    if ["to", "from", "re", "about", "reply"].contains(k) {
                        f[k] = String(l[l.index(after: i)...]).trimmed
                        continue
                    }
                }
                header = false
            }
            body.append(raw)
        }
        to = (f["to"] ?? "").lowercased()
        from = (f["from"] ?? "").lowercased()
        re = f["re"]
        about = f["about"]
        text = body.joined(separator: "\n").trimmed
    }

    var options: [String] {
        for line in text.components(separatedBy: "\n") {
            let l = line.trimmed
            if l.lowercased().hasPrefix("options:") {
                return l.dropFirst(8).split(separator: "|").map { String($0).trimmed }.filter { !$0.isEmpty }
            }
        }
        return []
    }
}
