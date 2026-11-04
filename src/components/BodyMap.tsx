import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Body, { type ExtendedBodyPart, type Slug } from 'react-native-body-highlighter';
import type { Muscle } from '@/domain/muscles';
import type { Sex } from '@/domain/nutrition';
import { colors, spacing } from '@/theme';

export type BodySide = 'front' | 'back';

/**
 * The muscles each region of the drawing stands for, per view. The shoulder is one region on each
 * side: from the front it shows the front and side heads, from the back the rear head. Muscles the
 * drawing has no region for are folded into a neighbour (see `MUSCLE_KEYS`).
 */
const REGIONS: Record<BodySide, Partial<Record<Slug, Muscle[]>>> = {
  front: {
    chest: ['chest'],
    deltoids: ['front_delts', 'side_delts'],
    biceps: ['biceps'],
    triceps: ['triceps'],
    forearm: ['forearms'],
    trapezius: ['traps'],
    abs: ['abs'],
    obliques: ['obliques'],
    quadriceps: ['quads'],
    adductors: ['adductors'],
    calves: ['calves'],
  },
  back: {
    trapezius: ['traps'],
    deltoids: ['rear_delts'],
    'upper-back': ['lats', 'upper_back'],
    'lower-back': ['lower_back'],
    triceps: ['triceps'],
    forearm: ['forearms'],
    gluteal: ['glutes'],
    hamstring: ['hamstrings'],
    adductors: ['adductors'],
    calves: ['calves'],
  },
};

/** Parts that are not muscles: drawn as plain body. Each part brings its own grey, so all are painted. */
const PLAIN: Slug[] = ['head', 'hair', 'neck', 'hands', 'knees', 'tibialis', 'ankles', 'feet'];

/** The ramp of the map, from nothing to the most (theme.ts). */
export const HEAT = [colors.heat0, colors.heat1, colors.heat2, colors.heat3, colors.heat4] as const;

export const regionMuscles = (side: BodySide, slug: Slug): Muscle[] => REGIONS[side][slug] ?? [];

const WIDTH = 200;

/**
 * Front and back of the body side by side, each region painted by the highest level (0–4) of its
 * muscles. Tapping a region passes its muscles; `selected` outlines the regions that hold it.
 * Head, hands, feet and joints are drawn as plain body and do nothing.
 */
export const BodyMap = memo(function BodyMap({
  levels,
  sex,
  width,
  selected = null,
  onPress,
}: {
  levels: Partial<Record<Muscle, number>>;
  sex: Sex;
  /** Of each view; the height is twice that. */
  width: number;
  selected?: Muscle | null;
  onPress?: (muscles: Muscle[], side: BodySide) => void;
}) {
  const partsOf = (side: BodySide): ExtendedBodyPart[] => [
    ...PLAIN.map((slug) => ({ slug, styles: { fill: colors.cardAlt, stroke: colors.card, strokeWidth: 2 } })),
    ...(Object.entries(REGIONS[side]) as [Slug, Muscle[]][]).map(([slug, muscles]) => {
      const level = Math.max(0, ...muscles.map((m) => levels[m] ?? 0));
      const isSelected = selected !== null && muscles.includes(selected);
      return {
        slug,
        styles: {
          fill: HEAT[Math.min(level, HEAT.length - 1)],
          stroke: isSelected ? colors.text : colors.card,
          strokeWidth: isSelected ? 10 : 2,
        },
      };
    }),
  ];

  return (
    <View style={styles.row}>
      {(['front', 'back'] as const).map((side) => (
        <View key={side} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Body
            data={partsOf(side)}
            side={side}
            gender={sex}
            scale={width / WIDTH}
            border={colors.border}
            defaultFill={colors.cardAlt}
            onBodyPartPress={(part) => {
              const muscles = part.slug ? regionMuscles(side, part.slug) : [];
              if (muscles.length > 0) onPress?.(muscles, side);
            }}
          />
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  // The drawing leaves room above the head and below the feet: a little of it is taken back.
  row: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginTop: -spacing.md, marginBottom: -spacing.sm },
});
