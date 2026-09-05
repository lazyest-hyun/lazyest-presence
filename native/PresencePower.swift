import Darwin
import Foundation
import IOKit
import IOKit.ps
import SystemConfiguration

private let label = "com.lazyest.presence.power"
private let executable = "/Library/PrivilegedHelperTools/" + label
private let plist = "/Library/LaunchDaemons/" + label + ".plist"
private let socketDirectory = "/var/run/" + label
private let socketPath = socketDirectory + "/control.sock"
private let stateDirectory = "/var/db/" + label
private let marker = stateDirectory + "/owns-sleep-disabled"
private let files = FileManager.default

private enum Failure: Error { case denied, invalid, system }

private func consoleUID() -> uid_t? {
    var uid: uid_t = 0
    var gid: gid_t = 0
    guard SCDynamicStoreCopyConsoleUser(nil, &uid, &gid) != nil, uid > 0 else { return nil }
    return uid
}

// Only fixed system tools and fixed maintenance arguments are invoked by this helper.
@discardableResult private func run(_ tool: String, _ arguments: [String]) -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: tool)
    process.arguments = arguments
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    do { try process.run() } catch { return false }
    let deadline = ProcessInfo.processInfo.systemUptime + 8
    while process.isRunning && ProcessInfo.processInfo.systemUptime < deadline { usleep(20_000) }
    if process.isRunning { kill(process.processIdentifier, SIGKILL) }
    process.waitUntilExit()
    return process.terminationStatus == 0
}

private func safeRootDirectory(_ directory: String) throws {
    if !files.fileExists(atPath: directory) {
        try files.createDirectory(atPath: directory, withIntermediateDirectories: false,
                                  attributes: [.posixPermissions: 0o755])
    }
    var info = stat()
    guard lstat(directory, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
          info.st_uid == 0, info.st_mode & 0o022 == 0 else { throw Failure.denied }
}

private func sleepDisabled() -> Bool? {
    let entry = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"))
    guard entry != 0 else { return nil }
    defer { IOObjectRelease(entry) }
    return IORegistryEntryCreateCFProperty(entry, "SleepDisabled" as CFString, kCFAllocatorDefault, 0)?
        .takeRetainedValue() as? Bool
}

private func restoreOwnedSetting() -> Bool {
    guard files.fileExists(atPath: marker) else { return true }
    guard run("/usr/bin/pmset", ["-a", "disablesleep", "0"]), sleepDisabled() == false else { return false }
    do { try files.removeItem(atPath: marker); return true } catch { return false }
}

private func rootWrite(_ data: Data, to destination: String, mode: mode_t) throws {
    let temporary = destination + "." + UUID().uuidString + ".tmp"
    defer { try? files.removeItem(atPath: temporary) }
    try data.write(to: URL(fileURLWithPath: temporary), options: .withoutOverwriting)
    guard chown(temporary, 0, 0) == 0, chmod(temporary, mode) == 0,
          rename(temporary, destination) == 0 else { throw Failure.system }
}

private func maintain(_ action: String, owner: uid_t) throws {
    guard geteuid() == 0, owner > 0, consoleUID() == owner else { throw Failure.denied }
    try safeRootDirectory(stateDirectory)
    // Stop before restoring so a concurrently renewed lease cannot re-enable the setting.
    if run("/bin/launchctl", ["print", "system/" + label]) {
        guard run("/bin/launchctl", ["bootout", "system/" + label]) else { throw Failure.system }
    }
    guard restoreOwnedSetting() else {
        if files.fileExists(atPath: plist) { _ = run("/bin/launchctl", ["bootstrap", "system", plist]) }
        throw Failure.system
    }
    if action == "remove" {
        for item in [plist, executable] { if files.fileExists(atPath: item) { try files.removeItem(atPath: item) } }
        if files.fileExists(atPath: socketDirectory) { try safeRootDirectory(socketDirectory); try files.removeItem(atPath: socketDirectory) }
        if files.fileExists(atPath: stateDirectory) { try files.removeItem(atPath: stateDirectory) }
        return
    }
    guard action == "install" else { throw Failure.invalid }
    try safeRootDirectory("/Library/PrivilegedHelperTools")
    try safeRootDirectory("/Library/LaunchDaemons")
    let source = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().path
    guard source != executable, run("/usr/bin/codesign", ["--verify", "--strict", source]) else { throw Failure.invalid }
    let data = try Data(contentsOf: URL(fileURLWithPath: source))
    try rootWrite(data, to: executable, mode: 0o755)
    let properties: [String: Any] = [
        "Label": label, "ProgramArguments": [executable, "serve", String(owner)],
        "RunAtLoad": true, "KeepAlive": true, "ThrottleInterval": 5,
        "ProcessType": "Background", "ExitTimeOut": 12,
        "StandardOutPath": "/dev/null", "StandardErrorPath": "/dev/null"
    ]
    try rootWrite(try PropertyListSerialization.data(fromPropertyList: properties, format: .xml, options: 0),
                  to: plist, mode: 0o644)
    guard run("/bin/launchctl", ["enable", "system/" + label]),
          run("/bin/launchctl", ["bootstrap", "system", plist]) else { throw Failure.system }
}

private func powerSnapshot() -> (Bool?, Int?) {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
          let kind = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() else { return (nil, nil) }
    let onAC = (kind as String) == kIOPSACPowerValue
    var percent: Int?
    if let sources = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] {
        for source in sources {
            guard let values = IOPSGetPowerSourceDescription(info, source)?.takeUnretainedValue() as? [String: Any],
                  values[kIOPSTypeKey] as? String == kIOPSInternalBatteryType,
                  let current = values[kIOPSCurrentCapacityKey] as? Int,
                  let maximum = values[kIOPSMaxCapacityKey] as? Int, maximum > 0 else { continue }
            percent = current * 100 / maximum
        }
    }
    return (onAC, percent)
}

private final class PowerService {
    let owner: uid_t
    var expiresAt: TimeInterval = 0
    var reason = "lease_expired"
    init(owner: uid_t) { self.owner = owner }

    func update() {
        let now = ProcessInfo.processInfo.systemUptime
        let time = Calendar.current.dateComponents([.hour], from: Date())
        let (ac, battery) = powerSnapshot()
        let thermal = ProcessInfo.processInfo.thermalState
        reason = PowerPolicy.reason(hour: time.hour ?? -1,
            leaseRemaining: expiresAt - now, consoleMatches: consoleUID() == owner,
            onAC: ac, battery: battery, thermalSafe: thermal == .nominal || thermal == .fair)
        if reason != "active" {
            if !restoreOwnedSetting() { reason = "restore_failed" }
            return
        }
        guard let disabled = sleepDisabled() else { reason = "unsupported_system"; _ = restoreOwnedSetting(); return }
        let owns = files.fileExists(atPath: marker)
        if disabled {
            if !owns { reason = "external_sleep_setting" }
            return
        }
        do {
            // Persist ownership before enabling, so launchd restart can recover even after SIGKILL.
            try rootWrite(Data("owned\n".utf8), to: marker, mode: 0o600)
            guard run("/usr/bin/pmset", ["-a", "disablesleep", "1"]), sleepDisabled() == true else {
                reason = "enable_failed"; _ = restoreOwnedSetting(); return
            }
        } catch { reason = "enable_failed"; _ = restoreOwnedSetting() }
    }

    func reply(_ op: String) -> [String: Any] {
        if op == "renew" { expiresAt = ProcessInfo.processInfo.systemUptime + PowerPolicy.leaseSeconds }
        if op == "release" { expiresAt = 0 }
        update()
        return ["ok": !["restore_failed", "enable_failed", "unsupported_system"].contains(reason),
                "installed": true, "managedByPresence": true,
                "active": reason == "active", "reason": reason,
                "leaseRemainingSeconds": max(0, Int(expiresAt - ProcessInfo.processInfo.systemUptime))]
    }
}

private var stopping = false
private func stopSignal(_ signal: Int32) { stopping = true }

private func serve(owner: uid_t) throws {
    guard geteuid() == 0, owner > 0,
          URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().path == executable else { throw Failure.denied }
    try safeRootDirectory(stateDirectory)
    try safeRootDirectory(socketDirectory)
    guard restoreOwnedSetting() else { throw Failure.system }
    if files.fileExists(atPath: socketPath) { try files.removeItem(atPath: socketPath) }
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { throw Failure.system }
    defer { close(fd); unlink(socketPath); _ = restoreOwnedSetting() }
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    let bytes = Array(socketPath.utf8CString)
    guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw Failure.invalid }
    withUnsafeMutableBytes(of: &address.sun_path) { buffer in
        bytes.withUnsafeBytes { buffer.copyBytes(from: $0) }
    }
    let result = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    guard result == 0, chown(socketPath, owner, 0) == 0, chmod(socketPath, 0o600) == 0,
          listen(fd, 8) == 0 else { throw Failure.system }
    signal(SIGTERM, stopSignal); signal(SIGINT, stopSignal); signal(SIGPIPE, SIG_IGN)
    let service = PowerService(owner: owner)
    while !stopping {
        service.update()
        var descriptor = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        guard poll(&descriptor, 1, 2000) > 0 else { continue }
        let client = accept(fd, nil, nil)
        guard client >= 0 else { continue }
        defer { close(client) }
        var uid: uid_t = 0; var gid: gid_t = 0
        guard getpeereid(client, &uid, &gid) == 0, uid == owner else { continue }
        var timeout = timeval(tv_sec: 1, tv_usec: 0)
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var data = Data(); var byte: UInt8 = 0
        let readDeadline = ProcessInfo.processInfo.systemUptime + 1
        while data.count < 128 && ProcessInfo.processInfo.systemUptime < readDeadline
                && read(client, &byte, 1) == 1 && byte != 10 { data.append(byte) }
        guard data.count < 128, byte == 10,
              let request = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              request.count == 1, let op = request["op"], ["status", "renew", "release"].contains(op),
              let response = try? JSONSerialization.data(withJSONObject: service.reply(op)) else { continue }
        let output = response + Data([10])
        output.withUnsafeBytes { buffer in _ = write(client, buffer.baseAddress, buffer.count) }
    }
}

@main struct PresencePower {
    static func main() {
        umask(0o077)
        let args = Array(CommandLine.arguments.dropFirst())
        do {
            guard args.count == 2, let owner = UInt32(args[1]), owner > 0 else { throw Failure.invalid }
            switch args[0] {
            case "install", "remove": try maintain(args[0], owner: owner)
            case "serve": try serve(owner: owner)
            default: throw Failure.invalid
            }
        } catch { fputs("Presence power operation failed. No credentials or personal paths are logged.\n", stderr); exit(1) }
    }
}
