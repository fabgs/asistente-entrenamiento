import ActivityKit
import SwiftUI
import WidgetKit

/** The brand green and the dark background of the app: the Live Activity is always dark, like its notifications on Android. */
private let accent = Color(red: 0x4A / 255, green: 0xDE / 255, blue: 0x80 / 255)
private let background = Color(red: 0x0E / 255, green: 0x11 / 255, blue: 0x16 / 255)

@main
struct EntrenoWidgets: WidgetBundle {
  var body: some Widget {
    EntrenoLiveActivity()
  }
}

/**
 * The Live Activity of Entreno (1.5.7): the rest, the workout in progress, the phases, the sprints or
 * the walk, on the lock screen and in the Dynamic Island. The app's module (LiveActivities.swift)
 * starts and updates it; the times are counted here by iOS.
 */
struct EntrenoLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: EntrenoActivityAttributes.self) { context in
      LockScreenView(state: context.state, stale: context.isStale)
        .activityBackgroundTint(background)
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: context.state.symbol)
            .font(.title2)
            .foregroundStyle(accent)
            .padding(.leading, 6)
        }
        DynamicIslandExpandedRegion(.trailing) {
          TimerText(state: context.state, stale: context.isStale)
            .font(.title2.weight(.semibold))
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 120, alignment: .trailing)
            .padding(.trailing, 6)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.state.title)
            .font(.headline)
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack(alignment: .firstTextBaseline) {
            Text(context.state.body)
              .font(.subheadline)
              .foregroundStyle(.secondary)
              .lineLimit(2)
            Spacer(minLength: 8)
            if let metric = context.state.metric {
              Text(metric)
                .font(.headline)
                .monospacedDigit()
                .foregroundStyle(accent)
            }
          }
          .padding(.horizontal, 6)
        }
      } compactLeading: {
        Image(systemName: context.state.symbol)
          .foregroundStyle(accent)
      } compactTrailing: {
        TimerText(state: context.state, stale: context.isStale)
          .monospacedDigit()
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 56)
      } minimal: {
        Image(systemName: context.state.symbol)
          .foregroundStyle(accent)
      }
      .keylineTint(accent)
    }
  }
}

private struct LockScreenView: View {
  let state: EntrenoActivityAttributes.ContentState
  let stale: Bool

  var body: some View {
    HStack(alignment: .center, spacing: 14) {
      Image(systemName: state.symbol)
        .font(.system(size: 26, weight: .semibold))
        .foregroundStyle(accent)
        .frame(width: 34)
      VStack(alignment: .leading, spacing: 3) {
        Text(state.title)
          .font(.headline)
          .foregroundStyle(.white)
          .lineLimit(1)
        Text(state.body)
          .font(.subheadline)
          .foregroundStyle(.white.opacity(0.7))
          .lineLimit(2)
      }
      Spacer(minLength: 8)
      VStack(alignment: .trailing, spacing: 2) {
        TimerText(state: state, stale: stale)
          .font(.system(size: 34, weight: .bold, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(.white)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 150, alignment: .trailing)
        if let metric = state.metric {
          Text(metric)
            .font(.headline)
            .monospacedDigit()
            .foregroundStyle(accent)
        }
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 14)
  }
}

/** The time: counting down to the end, up since the start, or still (paused). An ended countdown shows 0:00 in green, as the app's ring. */
private struct TimerText: View {
  let state: EntrenoActivityAttributes.ContentState
  let stale: Bool

  var body: some View {
    let date = Date(timeIntervalSince1970: state.date)
    switch state.mode {
    case "countdown":
      if stale || date <= Date() {
        Text("0:00").foregroundStyle(accent)
      } else {
        Text(timerInterval: Date()...date, countsDown: true)
      }
    case "elapsed":
      Text(date, style: .timer)
    default:
      Text(state.still ?? "")
    }
  }
}
