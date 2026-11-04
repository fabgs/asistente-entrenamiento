import { useEffect } from 'react';
import { AppState } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * A ring that empties clockwise from 12 o'clock, like a clock hand, until `endsAt`, and is full
 * once `over`. It moves on the UI thread in one continuous animation, not in the steps of the
 * countdown; coming back to the app starts it again from where it should be.
 */
export function Ring({
  size,
  stroke,
  endsAt,
  totalMs,
  over,
  color,
}: {
  size: number;
  stroke: number;
  endsAt: number;
  totalMs: number;
  over: boolean;
  color: string;
}) {
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  const progress = useSharedValue(1);

  useEffect(() => {
    const run = () => {
      cancelAnimation(progress);
      const left = endsAt - Date.now();
      if (over || left <= 0) {
        progress.set(over ? 1 : 0);
        return;
      }
      // +30 s can leave more than the rest planned: the ring then starts full.
      progress.set(Math.min(1, left / Math.max(totalMs, left)));
      progress.set(withTiming(0, { duration: left, easing: Easing.linear }));
    };
    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => {
      subscription.remove();
      cancelAnimation(progress);
    };
  }, [endsAt, totalMs, over, progress]);

  // The dash pattern repeats every 2 × length: this offset leaves only the last part of the
  // circle, from the moving end to 12 o'clock.
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: length * (1 + progress.get()) }));

  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.cardAlt} strokeWidth={stroke} fill="none" />
      <AnimatedCircle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${length} ${length}`}
        animatedProps={animatedProps}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}
