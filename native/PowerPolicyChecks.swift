import Foundation

@main struct Checks {
    static func main() {
        func reason(hour: Int = 8, lease: Double = 179, console: Bool = true,
                    ac: Bool? = false, battery: Int? = 50, thermal: Bool = true) -> String {
            PowerPolicy.reason(hour: hour, leaseRemaining: lease,
                consoleMatches: console, onAC: ac, battery: battery, thermalSafe: thermal)
        }
        precondition(reason() == "active")
        for hour in [0, 7, 21, 23] { precondition(reason(hour: hour) == "outside_schedule") }
        for hour in [8, 20] { precondition(reason(hour: hour) == "active") }
        for lease in [-1.0, 0.0, 181.0] { precondition(reason(lease: lease) == "lease_expired") }
        precondition(reason(lease: 180) == "active")
        precondition(reason(console: false) == "not_console_user")
        precondition(reason(thermal: false) == "thermal_pause")
        for battery in [0, 19, 20] { precondition(reason(battery: battery) == "battery_pause") }
        precondition(reason(battery: 21) == "active")
        for battery: Int? in [nil, -1, 101] { precondition(reason(battery: battery) == "power_unknown") }
        precondition(reason(ac: nil) == "power_unknown")
        precondition(reason(ac: true, battery: nil) == "active")
        print("Power policy safety checks passed")
    }
}
