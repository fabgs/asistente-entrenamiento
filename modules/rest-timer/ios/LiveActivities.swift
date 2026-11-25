import ActivityKit
import Foundation

/**
 * The Live Activity (1.5.7): what Android shows in its fixed notification and its bubble, iOS shows
 * on the lock screen and in the Dynamic Island. One at a time: the workout in progress (or a walk)
 * underneath, and a countdown (the rest, the phases, the next sprint) on top of it until it ends.
 * The times are counted by iOS itself, so they stay right with the app asleep.
 */
final class LiveActivities {
  typealias State = EntrenoActivityAttributes.ContentState

  static let shared = LiveActivities()

  /// What shows when no countdown is on: the workout in progress or the walk.
  private var base: State?
  /// The end of the countdown on top of it.
  private var countdownEnd: Date?

  private var current: Activity<EntrenoActivityAttributes>? {
    Activity<EntrenoActivityAttributes>.activities.first
  }

  /// A countdown to `endsAt` (epoch ms) on top of whatever there is.
  func countdown(endsAt: Double, title: String, body: String) {
    let end = Date(timeIntervalSince1970: endsAt / 1000)
    countdownEnd = end
    show(State(mode: "countdown", symbol: "timer", title: title, body: body, date: end.timeIntervalSince1970), staleDate: end)
  }

  /// The countdown ends early (skipped, the set started): back to what was underneath.
  func stopCountdown() {
    countdownEnd = nil
    showBaseOrEnd()
  }

  /// The workout in progress, its time counting up from `startedAt` (epoch ms). A countdown on top stays.
  func ongoing(startedAt: Double, title: String, body: String) {
    base = State(mode: "elapsed", symbol: "dumbbell.fill", title: title, body: body, date: startedAt / 1000)
    if let end = countdownEnd, end > Date() { return }
    countdownEnd = nil
    show(base!, staleDate: nil)
  }

  /// A sprint running since `startAt` (epoch ms); one still to start shows its countdown instead.
  func sprint(startAt: Double, title: String, body: String) {
    let start = Date(timeIntervalSince1970: startAt / 1000)
    if start > Date() { return }
    countdownEnd = nil
    show(State(mode: "elapsed", symbol: "figure.run", title: title, body: body, date: start.timeIntervalSince1970), staleDate: nil)
  }

  func stopSprint() {
    if let end = countdownEnd, end > Date() { return }
    showBaseOrEnd()
  }

  /// A walk being recorded: the time from `activeStart` (epoch ms, its pauses left out) or, paused, `still`.
  func cardio(activeStart: Double, paused: Bool, still: String?, title: String, body: String, metric: String?, symbol: String) {
    base = State(
      mode: paused ? "still" : "elapsed",
      symbol: symbol,
      title: title,
      body: body,
      date: activeStart / 1000,
      metric: metric,
      still: still
    )
    countdownEnd = nil
    show(base!, staleDate: nil)
  }

  func endAll() {
    base = nil
    countdownEnd = nil
    let activities = Activity<EntrenoActivityAttributes>.activities
    Task {
      for activity in activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }

  private func showBaseOrEnd() {
    if let base { show(base, staleDate: nil) } else { endAll() }
  }

  private func show(_ state: State, staleDate: Date?) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    let content = ActivityContent(state: state, staleDate: staleDate)
    if let activity = current {
      Task { await activity.update(content) }
      return
    }
    // Only possible with the app in front (a set done, a walk started); later updates work from the background.
    _ = try? Activity.request(attributes: EntrenoActivityAttributes(), content: content, pushType: nil)
  }
}
