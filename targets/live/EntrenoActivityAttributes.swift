import ActivityKit
import Foundation

/**
 * The Live Activity of Entreno (1.5.7). The same struct, field by field, lives in the app's module
 * (modules/rest-timer/ios/EntrenoActivityAttributes.swift): ActivityKit pairs them by name. Change
 * both at once.
 */
struct EntrenoActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "countdown" to `date`, "elapsed" since `date`, or "still" (paused: `still` as it is).
    var mode: String
    /// SF Symbol.
    var symbol: String
    var title: String
    var body: String
    /// Seconds since 1970.
    var date: Double
    /// A figure next to the time (the distance of a walk).
    var metric: String?
    var still: String?
  }
}
