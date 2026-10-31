import SwiftUI
import UIKit

@main
struct MCLiteApp: App {
    @StateObject private var store = Store()
    var body: some Scene {
        WindowGroup { RootView().environmentObject(store) }
    }
}

struct RootView: View {
    @EnvironmentObject var store: Store
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            if store.hasToken {
                TabView {
                    StatusView().tabItem { Label("Status", systemImage: "gauge.medium") }
                    BusView().tabItem { Label("Bus", systemImage: "tray.full") }
                        .badge(store.openQuestions.count)
                    ControlView().tabItem { Label("Control", systemImage: "slider.horizontal.3") }
                    NavigationStack { SettingsView() }.tabItem { Label("Settings", systemImage: "gear") }
                }
            } else {
                NavigationStack { SettingsView() }
            }
        }
        .task { await store.refreshLoop() }
        .onChange(of: phase) { p in
            if p == .active { Task { await store.refresh() } }
        }
    }
}

// MARK: Status

struct StatusView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        NavigationStack {
            List {
                if let e = store.error {
                    Section { Text(e).font(.footnote).foregroundStyle(.red) }
                }
                if !store.openQuestions.isEmpty {
                    Section("Waiting for you") {
                        ForEach(store.openQuestions) { m in
                            NavigationLink { MessageDetail(m: m) } label: {
                                Label(m.text.firstLine, systemImage: "questionmark.bubble.fill").lineLimit(2)
                            }
                        }
                    }
                }
                Section("Brain") {
                    HStack {
                        Circle().fill(store.brainOnline > 0 ? Color.green : Color.red).frame(width: 12, height: 12)
                        Text("\(store.brainOnline)/\(store.brainRunners.count) brain runners online")
                    }
                    Text("Workers running: \(store.workersRunning) · target: \(store.fill ?? "roles.json")")
                        .font(.subheadline).foregroundStyle(.secondary)
                    ForEach(store.runners) { r in
                        HStack {
                            Circle().fill(r.status != "online" ? Color.red : (r.busy ? Color.orange : Color.green))
                                .frame(width: 9, height: 9)
                            Text(r.name)
                            Spacer()
                            Text(r.status != "online" ? r.status : (r.busy ? "busy" : "idle"))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                Section("Usage") {
                    if let u = store.usage {
                        ForEach(u.accounts.keys.sorted(), id: \.self) { k in
                            if let a = u.accounts[k] { UsageRow(name: k, a: a) }
                        }
                        Text("measured \(relative(parseISO(u.at))) on \(u.host ?? "?")"
                             + (u.diskFreeGB.map { String(format: " · C: %.0f GB free", $0) } ?? ""))
                            .font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text("no reading yet").foregroundStyle(.secondary)
                    }
                }
                Section("Master") {
                    if let red = store.masterRed {
                        Link(destination: link(red.html_url)) {
                            Label("#\(red.number) \(red.title)", systemImage: "xmark.octagon.fill").foregroundStyle(.red)
                        }
                    } else {
                        Label("no open 'master is red' issue", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    }
                }
                Section("Running (\(store.runs.count))") {
                    ForEach(store.runs) { run in
                        Link(destination: link(run.html_url)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(run.title).lineLimit(2)
                                Text("\(run.status ?? "") · started \(relative(run.created_at))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("Pull requests (\(store.pulls.count))") {
                    ForEach(store.pulls) { p in
                        Link(destination: link(p.html_url)) {
                            HStack {
                                Text("#\(p.number) \(p.title)").lineLimit(2)
                                Spacer()
                                if p.landing { Text("landing").font(.caption).foregroundStyle(.blue) }
                            }
                        }
                    }
                }
                if let t = store.lastRefresh {
                    Text("updated \(relative(t))").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("MC-Lite")
            .refreshable { await store.refresh() }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    if store.loading { ProgressView() }
                }
            }
        }
    }
}

struct UsageRow: View {
    let name: String
    let a: UsageRec.Acct
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(name + (a.email.map { " · \($0)" } ?? "") + (a.stale == true ? " (stale)" : ""))
                .font(.subheadline.bold())
            if a.ok {
                bar("week", a.week)
                bar("5 h", a.window)
            } else {
                Text(a.why ?? "no reading").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    @ViewBuilder func bar(_ label: String, _ w: UsageRec.Win?) -> some View {
        let p = w?.pct ?? 0
        HStack {
            Text(label).font(.caption).frame(width: 36, alignment: .leading)
            ProgressView(value: min(max(p, 0), 100), total: 100)
                .tint(p >= 90 ? Color.red : (p >= 70 ? Color.orange : Color.accentColor))
            Text("\(Int(p))%").font(.caption.monospacedDigit()).frame(width: 40, alignment: .trailing)
        }
        if let r = parseISO(w?.resets_at) {
            Text("resets \(relative(r))").font(.caption2).foregroundStyle(.secondary)
        }
    }
}

// MARK: Bus

struct BusView: View {
    @EnvironmentObject var store: Store
    @State private var filter = 0
    @State private var composing = false

    var shown: [BusMessage] {
        switch filter {
        case 1: return store.messages.filter { $0.to == "dan" || $0.from == "dan" }
        case 2: return store.messages
        default: return store.messages.filter { $0.to != "log" }
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Picker("Show", selection: $filter) {
                    Text("Mail").tag(0)
                    Text("Me").tag(1)
                    Text("All + log").tag(2)
                }
                .pickerStyle(.segmented)
                ForEach(shown) { m in
                    NavigationLink { MessageDetail(m: m) } label: { MessageRow(m: m) }
                }
                if shown.isEmpty { Text("nothing in the last 36 hours").foregroundStyle(.secondary) }
            }
            .navigationTitle("Bus")
            .refreshable { await store.refresh() }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { composing = true } label: { Image(systemName: "square.and.pencil") }
                }
            }
            .sheet(isPresented: $composing) { ComposeView(to: "commander", about: nil) }
        }
    }
}

struct MessageRow: View {
    let m: BusMessage
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("\(m.from.isEmpty ? "?" : m.from) → \(m.to.isEmpty ? "?" : m.to)").font(.caption.bold())
                if !m.options.isEmpty { Image(systemName: "questionmark.bubble").font(.caption).foregroundStyle(.orange) }
                if m.re != nil { Text("reply").font(.caption2).foregroundStyle(.secondary) }
                Spacer()
                Text(relative(m.date)).font(.caption2).foregroundStyle(.secondary)
            }
            Text(m.text).font(.subheadline).lineLimit(4)
        }
    }
}

struct MessageDetail: View {
    @EnvironmentObject var store: Store
    let m: BusMessage
    @State private var replying = false
    @State private var sending = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("\(m.from) → \(m.to) · \(relative(m.date))").font(.caption).foregroundStyle(.secondary)
                Text(m.text).textSelection(.enabled)
                if !m.options.isEmpty {
                    if let a = store.answer(for: m) {
                        Label("You answered: \(a.text.firstLine)", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                    ForEach(m.options, id: \.self) { o in
                        Button {
                            sending = true
                            Task { await store.answer(m, o); sending = false }
                        } label: { Text(o).frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent)
                        .disabled(sending)
                    }
                }
                Button { replying = true } label: { Label("Reply", systemImage: "arrowshape.turn.up.left") }
                    .buttonStyle(.bordered)
                Link("Open on GitHub", destination: link(m.url)).font(.footnote)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Message")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $replying) { ComposeView(to: m.from.isEmpty ? "commander" : m.from, about: m) }
    }
}

struct ComposeView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var to: String
    let about: BusMessage?
    @State private var text = ""
    @State private var sending = false
    @State private var err: String?

    init(to: String, about: BusMessage?) {
        _to = State(initialValue: to)
        self.about = about
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("address", text: $to)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(Store.addresses, id: \.self) { a in
                                Button(a) { to = a }.buttonStyle(.bordered).font(.caption)
                            }
                        }
                    }
                } header: { Text("To") } footer: {
                    Text("Mail to commander or fixer starts that session within about a minute. #N reaches the worker on issue N.")
                }
                if let about {
                    Section("About") { Text(about.text).font(.caption).lineLimit(4) }
                }
                Section("Message") { TextEditor(text: $text).frame(minHeight: 160) }
                if let err { Section { Text(err).foregroundStyle(.red) } }
            }
            .navigationTitle(about == nil ? "New mail" : "Reply")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "Sending…" : "Send") {
                        sending = true
                        Task {
                            do {
                                try await store.send(to: to, text: text, about: about)
                                dismiss()
                            } catch { err = error.localizedDescription }
                            sending = false
                        }
                    }
                    .disabled(sending || text.trimmed.isEmpty || to.trimmed.isEmpty)
                }
            }
        }
    }
}

// MARK: Control

struct ControlView: View {
    @EnvironmentObject var store: Store
    @State private var reason = ""
    @State private var workers = 4
    @State private var msg: String?
    @State private var busy = false
    struct Role: Identifiable { let id: String; let icon: String; let what: String }
    let roles: [Role] = [
        Role(id: "commander", icon: "person.badge.shield.checkmark", what: "Opus - triage, unstick, report"),
        Role(id: "fixer", icon: "wrench.and.screwdriver", what: "Sonnet - one emergency"),
        Role(id: "worker", icon: "hammer", what: "Sonnet - takes the next issue"),
        Role(id: "chore", icon: "sparkles", what: "Haiku - a small task you describe"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("why / what to do (goes into its prompt)", text: $reason, axis: .vertical)
                    ForEach(roles) { r in
                        Button {
                            act { try await store.wake(r.id, reason) }
                        } label: {
                            VStack(alignment: .leading) {
                                Label("Start a \(r.id)", systemImage: r.icon)
                                Text(r.what).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .disabled(busy)
                    }
                } header: { Text("Start a session now") } footer: {
                    Text("Runs headless on a brain runner in the sandbox VM. It reports on the bus.")
                }
                Section {
                    Text("Now: \(store.fill.map { "\($0) (set from the phone)" } ?? "roles.json decides") · running \(store.workersRunning)")
                    Stepper("Workers: \(workers)", value: $workers, in: 0...6)
                    Button("Keep \(workers) worker(s) running") { act { try await store.setFill(workers) } }.disabled(busy)
                    Button("Stop workers", role: .destructive) { act { try await store.setFill(0) } }.disabled(busy)
                    Button("Back to roles.json") { act { try await store.setFill(nil) } }.disabled(busy || store.fill == nil)
                } header: { Text("Background workers") } footer: {
                    Text("The brain checks every 15 minutes and tops workers up to this number. Running workers finish their issue. This wins over roles.json and its end date.")
                }
                if let msg { Section { Text(msg).font(.footnote) } }
            }
            .navigationTitle("Control")
            .onAppear { if let f = store.fill, let n = Int(f) { workers = n } }
        }
    }

    func act(_ f: @escaping () async throws -> String) {
        busy = true
        Task {
            do { msg = try await f() } catch { msg = "Failed: \(error.localizedDescription)" }
            busy = false
            await store.refresh()
        }
    }
}

// MARK: Settings

struct SettingsView: View {
    @EnvironmentObject var store: Store
    @State private var token = ""
    @State private var repo = ""
    @State private var status: String?
    @State private var saving = false

    var version: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "\(v) (\(b))"
    }

    var body: some View {
        Form {
            Section {
                SecureField(store.hasToken ? "token saved - paste to replace" : "GitHub token", text: $token)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("Paste token") { token = (UIPasteboard.general.string ?? "").trimmed }
                TextField("owner/repo", text: $repo)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(saving ? "Checking…" : "Save and connect") {
                    saving = true
                    Task { status = await store.save(token: token, repo: repo); token = ""; saving = false }
                }
                .disabled(saving)
            } header: { Text("GitHub") } footer: {
                Text("Make one on github.com (works from the phone): Settings → Developer settings → Fine-grained tokens → Generate. Repository access: only mclite. Permissions: Actions read/write, Administration read, Issues read/write, Pull requests read, Variables read/write. Stored in the iPhone Keychain.")
            }
            if let status { Section { Text(status) } }
            if store.hasToken {
                Section { Button("Forget the token", role: .destructive) { store.signOut() } }
            }
            Section("About") {
                Text("MC-Lite control \(version)")
                Text("Signed by Sideloadly with a free Apple ID, the app stops opening after 7 days: re-sideload the same .ipa to renew. Alerts come through ntfy.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
        .onAppear { repo = store.repo }
    }
}
