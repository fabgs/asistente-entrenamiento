import * as Haptics from 'expo-haptics';
import { useFocusEffect, usePreventRemove } from 'expo-router';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { AppState, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { CardioSession } from '@/db/repositories/cardioSessions';
import { markHintSeen } from '@/db/repositories/hints';
import { formatClock, formatCountdown, formatSprintTime, NBSP } from '@/domain/format';
import { splitUnit } from '@/domain/progress';
import { lapRows, leadMs, sprintGps, sprintLabel, sprintState, type LapRow, type SprintState } from '@/domain/sprint';
import { useDb, useNow } from '@/hooks/data';
import type { SprintLive as Live } from '@/hooks/walk';
import {
  addExtraSprint,
  applyButtonStop,
  cancelSprintGo,
  dropLastSprint,
  dropRunningSprint,
  goSprint,
  shiftSprintRest,
  showOverLockScreen,
  stopSprint,
  syncSprint,
  undoSprint,
  type SprintStop,
  type SprintUndo,
} from '@/services/sprintSession';
import { colors, radius, spacing } from '@/theme';
import { onSprintButtonStop } from '../../modules/rest-timer';
import { showActions, showDialog, showSnackbar } from './Dialog';
import { Ring } from './Ring';
import { sprintMetres, sprintSpeed, SprintStats, SprintTable, StraightStats } from './Sprint';
import { AppText, BottomBar, Button, Card, Icon, ListGroup, ListRow, RowIcon, Screen, Tag, Value } from './ui';

const RING_SIZE = 264;
/** Dividers of rows with an icon start at the text: 16 + the 40 dp RowIcon + 16. */
const ROW_ICON_INSET = spacing.lg + 40 + spacing.lg;

/**
 * «¿Terminar con 3 de 6 sprints?» when finishing before the plan; straight away once it is done.
 * `at` is the time of the tap.
 */
export function askFinishSprints(session: CardioSession, at: number, onFinish: () => void): void {
  const plan = session.sprint;
  if (!plan) return;
  const done = session.laps.filter((l) => l.stopAt !== null).length;
  const state = sprintState(plan, session.laps, at);
  if (state.kind === 'done') {
    onFinish();
    return;
  }
  showDialog(
    `¿Terminar con ${done} de ${plan.sprints} sprints?`,
    state.kind === 'running' ? 'El sprint en marcha se guarda hasta ahora.' : undefined,
    [
      { text: 'Guardar', onPress: onFinish },
      { text: 'Seguir', style: 'cancel' },
    ],
  );
}

export interface SprintLiveHandle {
  /** Lets go of the back button at once, to leave in the same render (discarding). */
  allowLeaving: () => void;
}

/**
 * Sprints in progress (PLAN.md §6.8): ready, the count before the beep, running (a huge «Parar»),
 * resting and done. Everything is worked out from the laps of the session and the clock.
 */
export function SprintLive({
  ref,
  session,
  live,
  hintSeen,
  volumeHintSeen,
  leaving,
  reload,
  onFinish,
}: {
  ref?: Ref<SprintLiveHandle>;
  session: CardioSession;
  live: Live;
  hintSeen: boolean;
  /** The one-time hint about stopping with a volume button or the notification (1.5.0). */
  volumeHintSeen: boolean;
  /** The screen is about to close (discarding): back is no longer held. */
  leaving: boolean;
  reload: () => Promise<void>;
  onFinish: () => Promise<void>;
}) {
  const db = useDb();
  const now = useNow(100);
  const plan = session.sprint!;
  const state = sprintState(plan, session.laps, now);
  const rows = lapRows(session.laps, live.measures);
  const counting = state.kind === 'waiting' && state.goAt - now <= leadMs(plan);

  // Over the lock screen only while this screen is in front.
  useFocusEffect(
    useCallback(() => {
      showOverLockScreen(true);
      return () => showOverLockScreen(false);
    }, []),
  );

  // Back to the app: the beep and the countdown are checked against the laps.
  const latest = useRef(session);
  useEffect(() => {
    latest.current = session;
  });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') syncSprint(latest.current).catch((e) => console.warn('Could not sync the sprints', e));
    });
    return () => sub.remove();
  }, []);

  // A light buzz at 3, 2 and 1 of the count, with the screen in front.
  const second = counting && state.kind === 'waiting' ? Math.ceil((state.goAt - now) / 1000) : null;
  useEffect(() => {
    if (second !== null && second <= 3 && second >= 1 && AppState.currentState === 'active') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [second]);

  const allowLeaving = usePreventRemove(!leaving && (state.kind === 'running' || counting), () =>
    showSnackbar(state.kind === 'running' ? 'Toca Parar para terminar el sprint' : 'Toca Cancelar para no salir'),
  );
  useImperativeHandle(ref, () => ({ allowLeaving }), [allowLeaving]);

  const undo = async (u: SprintUndo) => {
    await undoSprint(db, session.id, u);
    await reload();
  };
  const run = (fn: () => Promise<unknown>) => async () => {
    await fn();
    await reload();
  };

  /** What a stop leaves on screen, whether it came from the panel or from a button. */
  const afterStop = async (result: SprintStop) => {
    if (result.kind === 'ignored') return;
    if (result.kind === 'false-start') {
      showSnackbar('Salida anulada', { label: 'Deshacer', onPress: () => undo(result.undo) });
    } else {
      if (!hintSeen) await markHintSeen(db, 'sprint-how');
      if (!volumeHintSeen) await markHintSeen(db, 'sprint-volume');
      showSnackbar(`Sprint ${result.number} · ${formatSprintTime(result.timeMs)}`, { label: 'Deshacer', onPress: () => undo(result.undo) });
    }
    await reload();
  };

  const stopping = useRef(false);
  const stop = async () => {
    if (stopping.current) return;
    stopping.current = true;
    try {
      const result = await stopSprint(db, session.id);
      if (result.kind !== 'ignored') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await afterStop(result);
    } finally {
      stopping.current = false;
    }
  };

  // A volume button or the notification's «Parar» (1.5.0): the press is kept by the native side
  // (which also vibrates) and applied here, when it happens and on coming back to the app.
  const buttonStop = useRef(async () => {});
  useEffect(() => {
    buttonStop.current = async () => {
      if (stopping.current) return;
      stopping.current = true;
      try {
        await afterStop(await applyButtonStop(db));
      } finally {
        stopping.current = false;
      }
    };
  });
  useEffect(() => {
    const press = () => buttonStop.current().catch((e) => console.warn('Could not apply the stop', e));
    press();
    const off = onSprintButtonStop(press);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') press();
    });
    return () => {
      off();
      sub.remove();
    };
  }, []);

  const removeLast = (row: LapRow) =>
    showActions([
      {
        text: `Quitar el sprint ${row.number}`,
        icon: 'trash-can-outline',
        destructive: true,
        onPress: async () => {
          const u = await dropLastSprint(db, session.id);
          await reload();
          if (u) showSnackbar(`Sprint ${row.number} quitado.`, { label: 'Deshacer', onPress: () => undo(u) });
        },
      },
    ]);
  const lastRow = rows.at(-1);
  const table = rows.length > 0 ? <SprintTable rows={rows} onPickLast={lastRow ? () => removeLast(lastRow) : undefined} /> : null;

  const [saving, setSaving] = useState(false);
  const finish = async () => {
    setSaving(true);
    try {
      await onFinish();
    } finally {
      setSaving(false);
    }
  };

  const gps = sprintGps(live.lastFix, live.gpsOn, now);
  const hint =
    hintSeen && volumeHintSeen ? null : (
      <Card>
        {hintSeen ? null : (
          <AppText variant="bodySm">Sal con el pitido y toca Parar al terminar. Tras el descanso, el siguiente pitido es la salida.</AppText>
        )}
        {volumeHintSeen ? null : <AppText variant="bodySm">También paras con un botón de volumen o desde la notificación.</AppText>}
      </Card>
    );

  if (state.kind === 'running') {
    const time = splitUnit(formatSprintTime(now - state.startAt));
    return (
      <Screen
        tight
        footer={
          <BottomBar actionKey={`run-${state.number}`}>
            <StopPad onStop={stop} />
          </BottomBar>
        }>
        <View style={styles.center}>
          <AppText variant="bodySm" weight="600" style={{ color: colors.accent }}>
            {sprintLabel(state.number, plan)}
          </AppText>
          <Value value={time.value} unit={time.unit} size="countdown" fit />
          {state.forgotten ? (
            <View style={styles.forgotten}>
              <AppText variant="bodySm" style={{ color: colors.warning, textAlign: 'center' }}>
                ¿Se te olvidó parar? Lleva {formatClock(now - state.startAt)}
              </AppText>
              <Button kind="text" title="Quitar este sprint" onPress={run(() => dropRunningSprint(db, session.id))} />
            </View>
          ) : null}
        </View>
      </Screen>
    );
  }

  if (state.kind === 'waiting' && counting) {
    return (
      <Screen
        tight
        footer={
          <BottomBar actionKey="countdown">
            <Button size="xl" kind="secondary" icon="close" title="Cancelar" onPress={run(() => cancelSprintGo(db, session.id))} style={styles.flex} />
          </BottomBar>
        }>
        <View style={styles.center}>
          <AppText variant="bodySm" weight="600" style={styles.muted}>
            {sprintLabel(state.number, plan)}
          </AppText>
          <AppText variant="countdown" tabular style={{ color: colors.warning }}>
            {Math.max(1, Math.ceil((state.goAt - now) / 1000))}
          </AppText>
          <AppText variant="heading">Sal con el pitido</AppText>
        </View>
        {state.number === 1 ? hint : null}
      </Screen>
    );
  }

  if (state.kind === 'waiting') {
    return (
      <RestView
        state={state}
        now={now}
        nextLabel={sprintLabel(state.number, plan)}
        last={lastRow}
        onPickLast={lastRow ? () => removeLast(lastRow) : undefined}
        onShift={(delta) => run(() => shiftSprintRest(db, session.id, delta))()}
        onSkip={run(() => goSprint(db, session.id))}
      />
    );
  }

  if (state.kind === 'done') {
    return (
      <Screen
        footer={
          <BottomBar actionKey="done">
            <Button size="xl" kind="secondary" title="Otro sprint" onPress={run(() => addExtraSprint(db, session.id))} disabled={saving} style={styles.flex} />
            <Button size="xl" icon="flag-checkered" title={saving ? 'Guardando…' : 'Terminar'} onPress={finish} disabled={saving} style={styles.flex} />
          </BottomBar>
        }>
        <AppText variant="title">{state.count} sprints hechos</AppText>
        <SprintStats rows={rows} />
        {table}
        <StraightStats rows={rows} straightM={plan.straightM} />
      </Screen>
    );
  }

  // Ready.
  const noGps = gps.state === 'off' || gps.state === 'searching' || gps.state === 'unusable';
  return (
    <Screen
      footer={
        <BottomBar actionKey="ready">
          {rows.length > 0 ? (
            <Button
              size="xl"
              kind="secondary"
              title={saving ? 'Guardando…' : 'Terminar'}
              disabled={saving}
              onPress={() => askFinishSprints(session, Date.now(), finish)}
              style={styles.flex}
            />
          ) : null}
          <Button size="xl" icon="play" title="Empezar sprint" onPress={run(() => goSprint(db, session.id))} disabled={saving} style={{ flex: 2 }} />
        </BottomBar>
      }>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="bodySm" weight="600" style={styles.muted}>
          {sprintLabel(state.number, plan)}
        </AppText>
        <AppText variant="title">Cuando quieras</AppText>
        <AppText variant="secondary">
          Descanso de {formatCountdown(plan.restSec * 1000)} entre sprints. Cada salida es un pitido tras una cuenta de {plan.leadSec}
          {NBSP}s.
        </AppText>
        {noGps ? (
          <AppText variant="secondary" style={{ color: colors.warning }}>
            Sin GPS todavía: este sprint solo medirá el tiempo
          </AppText>
        ) : null}
      </View>
      {hint}
      {table}
    </Screen>
  );
}

/** A huge green «Parar» under the thumb: it stops on touch down, the instant it is pressed. */
function StopPad({ onStop }: { onStop: () => void }) {
  const { height } = useWindowDimensions();
  return (
    <Pressable
      onPressIn={onStop}
      style={[styles.stopPad, { height: Math.round(height * 0.45) }]}
      accessibilityRole="button"
      accessibilityLabel="Parar">
      <Icon name="stop" size={64} color={colors.onPrimary} />
      <AppText variant="buttonXl" style={{ color: colors.onPrimary }}>
        Parar
      </AppText>
    </Pressable>
  );
}

/** The rest between sprints, like the one between sets: the ring, the last sprint and the next one. */
function RestView({
  state,
  now,
  nextLabel,
  last,
  onPickLast,
  onShift,
  onSkip,
}: {
  state: Extract<SprintState, { kind: 'waiting' }>;
  now: number;
  nextLabel: string;
  last: LapRow | undefined;
  onPickLast?: () => void;
  onShift: (deltaSeconds: number) => void;
  onSkip: () => void;
}) {
  const totalMs = state.goAt - (state.restFrom ?? state.goAt);
  const remaining = state.goAt - now;
  const footer = (
    <BottomBar actionKey={`rest-${state.number}`} style={{ flexDirection: 'column', gap: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Button size="lg" kind="secondary" title="−30 s" onPress={() => onShift(-30)} style={styles.flex} />
        <Button size="lg" kind="secondary" title="+30 s" onPress={() => onShift(30)} style={styles.flex} />
      </View>
      <Button size="xl" kind="secondary" icon="skip-next" title="Saltar descanso" onPress={onSkip} />
    </BottomBar>
  );
  const measured = last && last.settled && last.quality !== 'none';
  const subtitle = !last
    ? undefined
    : !last.settled
      ? 'Midiendo…'
      : last.quality === 'none'
        ? 'Sin GPS: solo el tiempo'
        : `${sprintMetres(last)} · máx. ${sprintSpeed(last)}`;
  return (
    <Screen tight footer={footer}>
      <View style={styles.restTop}>
        <AppText variant="bodySm" weight="600" style={styles.muted}>
          Descanso
        </AppText>
        <View style={{ width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' }}>
          <View style={StyleSheet.absoluteFill}>
            <Ring size={RING_SIZE} stroke={10} endsAt={state.goAt} totalMs={totalMs} over={false} color={colors.text} />
          </View>
          <AppText variant="countdown" tabular numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ maxWidth: RING_SIZE - 40 }}>
            {formatCountdown(remaining)}
          </AppText>
          <AppText variant="secondary">de {formatCountdown(totalMs)}</AppText>
        </View>
      </View>
      <ListGroup inset={ROW_ICON_INSET}>
        {last ? (
          <ListRow
            onPress={onPickLast}
            chevron={false}
            left={<RowIcon name="check" color={colors.primary} tint={colors.primaryTint} />}
            title={
              // The tag goes with the title: on the right it would cut the figures of the subtitle.
              <View style={styles.titleRow}>
                <AppText variant="rowTitle">{`Sprint ${last.number} · ${formatSprintTime(last.timeMs)}`}</AppText>
                {measured && last.quality === 'weak' ? <Tag label="GPS débil" tone="warning" /> : null}
              </View>
            }
            subtitle={subtitle}
          />
        ) : null}
        <ListRow
          left={<RowIcon name="arrow-right" color={colors.muted} />}
          title={
            <View style={{ gap: 2 }}>
              <AppText variant="label">Siguiente</AppText>
              <AppText variant="rowTitle">{nextLabel}</AppText>
            </View>
          }
          subtitle="Sale con el pitido"
        />
      </ListGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  muted: { color: colors.muted },
  center: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  forgotten: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg },
  restTop: { alignItems: 'center', gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  stopPad: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: colors.primary,
  },
});
