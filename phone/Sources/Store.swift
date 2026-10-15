import Foundation
import Security

/// Everything the app knows, fetched straight from the GitHub API with Dan's token. No server of our own: the bus
/// (#53), the brain's runs, the runners, the land queue and the usage variable are all already on GitHub.
@MainActor
final class Store: ObservableObject {
    static let addresses = ["commander", "fixer", "loop", "all", "sessions", "cloud", "loop-worker"]
    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    @Published var repo: String = UserDefaults.standard.string(forKey: "repo") ?? "owner/mclite"
    @Published var hasToken = false
    @Published var runners: [Runner] = []
    @Published var usage: UsageRec?
    @Published var runs: [Run] = []
    @Published var pulls: [PR] = []
    @Published var masterRed: Issue?
    @Published var messages: [BusMessage] = []
    @Published var fill: String?
    @Published var error: String?
    @Published var loading = false
    @Published var lastRefresh: Date?
    private var busNumber: Int?

    private var token: String? { Keychain.get("token") ?? UserDefaults.standard.string(forKey: "token-fallback") }
    var R: String { "/repos/\(repo)" }

    init() { hasToken = token != nil }

    // MARK: GitHub

    func api(_ method: String, _ path: String, json: [String: Any]? = nil) async throws -> (Data, Int) {
        guard let token else { throw AppError("No GitHub token - add one in Settings") }
        guard let url = URL(string: "https://api.github.com" + path) else { throw AppError("bad path \(path)") }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.timeoutInterval = 20
        r.cachePolicy = .reloadIgnoringLocalCacheData
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        r.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        r.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        if let json {
            r.httpBody = try JSONSerialization.data(withJSONObject: json)
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (d, resp) = try await URLSession.shared.data(for: r)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code >= 400 && code != 404 {
            let m = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
            throw AppError("GitHub \(code): \(m?["message"] as? String ?? "error") (\(method) \(path))")
        }
        return (d, code)
    }

    func get<T: Decodable>(_ path: String, _ t: T.Type) async throws -> T? {
        let (d, code) = try await api("GET", path)
        if code == 404 { return nil }
        return try Store.decoder.decode(T.self, from: d)
    }

    // MARK: refresh

    func refreshLoop() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(nanoseconds: 30_000_000_000)
        }
    }

    func refresh() async {
        guard hasToken, !loading else { return }
        loading = true
        defer { loading = false }
        var errs: [String] = []
        do { runners = try await get("\(R)/actions/runners?per_page=100", RunnersResp.self)?.runners ?? [] }
        catch { errs.append(error.localizedDescription) }
        do {
            if let v = try await get("\(R)/actions/variables/MCLITE_USAGE", Variable.self) {
                usage = try? Store.decoder.decode(UsageRec.self, from: Data(v.value.utf8))
            }
        } catch { errs.append(error.localizedDescription) }
        do { fill = try await get("\(R)/actions/variables/FILL_WORKERS", Variable.self)?.value }
        catch { errs.append(error.localizedDescription) }
        do {
            var all: [Run] = []
            for st in ["in_progress", "queued"] {
                all += try await get("\(R)/actions/runs?status=\(st)&per_page=50", RunsResp.self)?.workflow_runs ?? []
            }
            runs = all.sorted { $0.created_at > $1.created_at }
        } catch { errs.append(error.localizedDescription) }
        do { pulls = try await get("\(R)/pulls?state=open&per_page=50", [PR].self) ?? [] }
        catch { errs.append(error.localizedDescription) }
        do {
            let sev = try await get("\(R)/issues?state=open&labels=severe&per_page=50", [Issue].self) ?? []
            masterRed = sev.first { $0.title.lowercased().hasPrefix("master is red") }
        } catch { errs.append(error.localizedDescription) }
        do { try await loadBus() }
        catch { errs.append(error.localizedDescription) }
        self.error = errs.isEmpty ? nil : errs.joined(separator: "\n")
        lastRefresh = Date()
    }

    func loadBus() async throws {
        if busNumber == nil {
            busNumber = try await get("\(R)/issues?state=open&labels=bus&per_page=1", [Issue].self)?.first?.number
        }
        guard let n = busNumber else { throw AppError("no open issue labelled bus") }
        let since = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-36 * 3600))
        var all: [GHComment] = []
        for page in 1...5 {
            let c = try await get("\(R)/issues/\(n)/comments?since=\(since)&per_page=100&page=\(page)", [GHComment].self) ?? []
            all += c
            if c.count < 100 { break }
        }
        messages = Array(all.map { BusMessage($0) }.reversed())
    }

    // MARK: derived

    var brainRunners: [Runner] { runners.filter { $0.isBrain } }
    var brainOnline: Int { brainRunners.filter { $0.status == "online" }.count }
    var workersRunning: Int { runs.filter { ($0.display_title ?? "") == "brain worker" }.count }

    func answer(for m: BusMessage) -> BusMessage? {
        messages.first { $0.from == "dan" && $0.about == String(m.id) }
    }

    /// Questions to Dan (a line "options: ...") he has not answered yet.
    var openQuestions: [BusMessage] {
        messages.filter { $0.to == "dan" && !$0.options.isEmpty && answer(for: $0) == nil }
    }

    // MARK: actions

    /// Dan's mail carries no `re:` on purpose: the brain treats replies as needing no answer and would not wake the
    /// commander for them. `about:` links it to the message it answers.
    func send(to: String, text: String, about: BusMessage?) async throws {
        if busNumber == nil { try await loadBus() }
        guard let n = busNumber else { throw AppError("bus not found") }
        var head = "to: \(to.trimmed.lowercased())\nfrom: dan\n"
        if let about { head += "about: \(about.id)\n" }
        _ = try await api("POST", "\(R)/issues/\(n)/comments", json: ["body": head + "\n" + text.trimmed])
        try? await loadBus()
    }

    func answer(_ m: BusMessage, _ choice: String) async {
        do {
            try await send(to: m.from.isEmpty ? "commander" : m.from,
                           text: "\(choice)\n\n(Dan's answer to: \(m.text.firstLine))", about: m)
        } catch { self.error = error.localizedDescription }
    }

    func wake(_ role: String, _ reason: String) async throws -> String {
        let r = reason.trimmed.isEmpty ? "started by Dan from the phone" : reason.trimmed
        _ = try await api("POST", "\(R)/actions/workflows/brain.yml/dispatches",
                          json: ["ref": "master", "inputs": ["role": role, "reason": r]])
        return "Started a \(role). It appears under Running within a minute."
    }

    func setFill(_ n: Int?) async throws -> String {
        if let n {
            let body: [String: Any] = ["name": "FILL_WORKERS", "value": String(n)]
            let (_, code) = try await api("PATCH", "\(R)/actions/variables/FILL_WORKERS", json: body)
            if code == 404 { _ = try await api("POST", "\(R)/actions/variables", json: body) }
            fill = String(n)
            // #3171: a variable change posts nothing on the bus, so the brain would not fill until the next comment
            if n > 0 { _ = try? await api("POST", "\(R)/actions/workflows/brain.yml/dispatches",
                                          json: ["ref": "master", "inputs": ["role": "waker", "reason": ISO8601DateFormatter().string(from: Date())]]) }
            return n == 0 ? "Workers off. Running ones finish their issue." : "The brain keeps \(n) worker(s) running (checked every 15 min)."
        }
        _ = try await api("DELETE", "\(R)/actions/variables/FILL_WORKERS")
        fill = nil
        return "roles.json decides again."
    }

    func save(token newToken: String, repo newRepo: String) async -> String {
        let t = newToken.trimmed, r = newRepo.trimmed
        if !r.isEmpty {
            repo = r
            UserDefaults.standard.set(r, forKey: "repo")
        }
        if !t.isEmpty {
            if Keychain.set("token", t) == errSecSuccess {
                UserDefaults.standard.removeObject(forKey: "token-fallback")
            } else {
                UserDefaults.standard.set(t, forKey: "token-fallback")
            }
        }
        hasToken = token != nil
        busNumber = nil
        guard hasToken else { return "Enter a token first." }
        do {
            let (_, code) = try await api("GET", R)
            if code == 404 { return "Repo not found, or the token can't see it." }
            await refresh()
            return error == nil ? "Connected." : "Connected, but: \(error ?? "")"
        } catch { return error.localizedDescription }
    }

    func signOut() {
        Keychain.delete("token")
        UserDefaults.standard.removeObject(forKey: "token-fallback")
        hasToken = false
    }
}
