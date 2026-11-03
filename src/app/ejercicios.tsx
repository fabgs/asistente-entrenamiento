import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  AppText,
  Button,
  Card,
  Divider,
  EmptyState,
  HeaderButton,
  Icon,
  ListRow,
  Loading,
  Screen,
} from '@/components/ui';
import { listExercises, type Exercise } from '@/db/repositories/exercises';
import { addSlot } from '@/db/repositories/routines';
import { normalizeForSearch } from '@/domain/format';
import { useDb, useLoader } from '@/hooks/data';
import { queueWrite, reschedule } from '@/hooks/editing';
import { colors, radius, spacing, type } from '@/theme';

/** Letter an exercise is filed under: "Á" goes with "A", anything else under "#". */
const initialOf = (name: string) => {
  const letter = normalizeForSearch(name).charAt(0).toUpperCase();
  return /[A-Z]/.test(letter) ? letter : '#';
};

/** Alphabetical without minding accents (SQLite's NOCASE would put "Á" after "Z"). */
const byName = (a: Exercise, b: Exercise) => {
  const [x, y] = [normalizeForSearch(a.name), normalizeForSearch(b.name)];
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Exercise catalog. With `pickFor` (a routine id), tapping an exercise adds it to that routine. */
export default function ExercisesScreen() {
  const { pickFor } = useLocalSearchParams<{ pickFor?: string }>();
  const routineId = pickFor ? Number(pickFor) : null;
  const db = useDb();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const { data } = useLoader((db) => listExercises(db));

  const create = (name?: string) =>
    router.push({
      pathname: '/ejercicio/[id]',
      params: { id: 'nuevo', ...(pickFor ? { pickFor } : {}), ...(name ? { nombre: name } : {}) },
    });
  const header = (
    <Stack.Screen
      options={{
        title: routineId === null ? 'Ejercicios' : 'Añadir ejercicio',
        headerRight: () => <HeaderButton icon="plus" label="Nuevo ejercicio" onPress={() => create()} />,
      }}
    />
  );

  if (!data) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }

  const wanted = normalizeForSearch(query.trim());
  const visible = data.filter((e) => normalizeForSearch(e.name).includes(wanted)).sort(byName);

  const choose = async (exercise: Exercise) => {
    if (routineId === null) {
      router.push(`/ejercicio/${exercise.id}`);
      return;
    }
    if (adding) return;
    setAdding(true);
    try {
      const slotId = await queueWrite(() => addSlot(db, routineId, exercise));
      reschedule(db);
      router.replace(`/slot/${slotId}`);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Screen>
      {header}
      <SearchField value={query} onChangeText={setQuery} />
      {visible.length === 0 ? (
        <EmptyState
          icon={wanted ? 'magnify' : 'dumbbell'}
          title={wanted ? 'Ningún ejercicio coincide' : 'Sin ejercicios todavía'}
          action={
            <View style={styles.emptyAction}>
              <Button
                kind="secondary"
                icon="plus"
                title={wanted ? `Crear «${query.trim()}»` : 'Nuevo ejercicio'}
                onPress={() => create(wanted ? query.trim() : undefined)}
              />
            </View>
          }
        />
      ) : (
        // One list; the initial of each letter sits in the leading slot of its first row, so that
        // the letters cost no height (9 rows fit at 360 × 780 dp).
        <Card flush>
          {visible.map((exercise, i) => {
            const initial = initialOf(exercise.name);
            const first = i === 0 || initialOf(visible[i - 1].name) !== initial;
            return (
              <Fragment key={exercise.id}>
                {i > 0 ? <Divider inset={first ? spacing.lg : 72} /> : null}
                <ListRow
                  onPress={() => choose(exercise)}
                  left={
                    <View style={styles.initial}>
                      {first ? <AppText variant="overline">{initial}</AppText> : null}
                    </View>
                  }
                  title={exercise.name}
                />
              </Fragment>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

/** Search box: magnifier inside, no label, and a cross to empty it. */
function SearchField({ value, onChangeText }: { value: string; onChangeText: (text: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.search, focused && styles.searchFocused]}>
      <Icon name="magnify" size={20} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Buscar ejercicio"
        placeholderTextColor={colors.muted}
        accessibilityLabel="Buscar ejercicio"
        autoCorrect={false}
        returnKeyType="search"
        style={styles.searchInput}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Vaciar la búsqueda">
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  initial: { width: 40 },
  emptyAction: { alignSelf: 'stretch', marginTop: spacing.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  searchFocused: { borderWidth: 2, borderColor: colors.primary, margin: -1 },
  searchInput: { ...type.body, flex: 1, color: colors.text, paddingVertical: spacing.sm },
});
