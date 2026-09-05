import Foundation

enum PowerPolicy {
    static let leaseSeconds: TimeInterval = 180
    static func reason(hour: Int, leaseRemaining: TimeInterval,
                       consoleMatches: Bool, onAC: Bool?, battery: Int?, thermalSafe: Bool) -> String {
        guard (8..<21).contains(hour) else { return "outside_schedule" }
        guard consoleMatches else { return "not_console_user" }
        guard leaseRemaining > 0, leaseRemaining <= leaseSeconds else { return "lease_expired" }
        guard thermalSafe else { return "thermal_pause" }
        guard let onAC else { return "power_unknown" }
        if !onAC {
            guard let battery, (0...100).contains(battery) else { return "power_unknown" }
            guard battery > 20 else { return "battery_pause" }
        }
        return "active"
    }
}
