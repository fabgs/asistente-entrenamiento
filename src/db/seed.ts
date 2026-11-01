import { recommend } from '@/domain/progression';
import { dateOfWeekday, localDateString } from '@/domain/schedule';
import type { ProgressionSettings } from '@/domain/types';
import { int, type Db } from './db';
import { targetColumns } from './repositories/routines';
import { createRecommendation } from './repositories/weightChanges';
import type { SeedData } from './seedTypes';

const WEEKS_AGO = { anterior: 2, hoy: 1 } as const;

/**
 * Loads data/seed/seed.json into an empty database (PLAN.md §3).
 * Returns false and does nothing if routines already exist.
 */
export async function importSeed(db: Db, seed: SeedData, now: Date): Promise<boolean> {
  const existing = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM routine');
  if ((existing?.n ?? 0) > 0) return false;

  const nowMs = now.getTime();
  const progression: ProgressionSettings = {
    defaultIncrementKg: seed.settings.defaultIncrementKg,
    mode: seed.settings.progressionMode,
    sessionsBelowToDecrease: seed.settings.sessionsBelowToDecrease,
  };

  await db.withTransactionAsync(async () => {
    const p = seed.profile;
    await db.runAsync(
      `INSERT INTO profile (id, sex, birth_date, height_cm, activity_factor, deficit_kcal, protein_g_per_kg, fat_g_per_kg, water_l_per_kg)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.sex,
      p.birthDate,
      p.heightCm,
      p.activityFactor,
      p.deficitKcal,
      p.proteinGPerKg,
      p.fatGPerKg,
      p.waterLPerKg,
    );
    const s = seed.settings;
    await db.runAsync(
      // dev_mode is written explicitly: its column default (1) dates from the testing phase.
      `INSERT INTO settings (id, rest_seconds_default, default_increment_kg, progression_mode, sessions_below_to_decrease, daily_reminder_enabled, daily_reminder_time, dev_mode)
       VALUES (1, ?, ?, ?, ?, ?, ?, 0)`,
      s.restSecondsDefault,
      s.defaultIncrementKg,
      s.progressionMode,
      s.sessionsBelowToDecrease,
      int(s.dailyReminderEnabled),
      s.dailyReminderTime,
    );
    await db.runAsync(
      'INSERT INTO weight_log (date, weight_kg) VALUES (?, ?)',
      localDateString(now),
      p.weightKg,
    );

    const exerciseIds = new Map<string, number>();
    for (const e of seed.exercises) {
      const r = await db.runAsync(
        'INSERT INTO exercise (name, type, equipment) VALUES (?, ?, ?)',
        e.name,
        e.type,
        e.equipment,
      );
      exerciseIds.set(e.name, r.lastInsertRowId);
    }

    for (const [ri, routine] of seed.routines.entries()) {
      const routineId = (
        await db.runAsync('INSERT INTO routine (name, position) VALUES (?, ?)', routine.name, ri)
      ).lastInsertRowId;
      for (const wd of routine.weekdays) {
        await db.runAsync('INSERT INTO routine_weekday (routine_id, weekday) VALUES (?, ?)', routineId, wd);
      }

      const slotIds: number[] = [];
      for (const [si, slot] of routine.slots.entries()) {
        const exerciseId = exerciseIds.get(slot.exercise);
        if (exerciseId === undefined) throw new Error(`Unknown exercise in seed: ${slot.exercise}`);
        const r = await db.runAsync(
          `INSERT INTO routine_slot (routine_id, exercise_id, position, weight_kg, sets, target_kind, rep_min, rep_max,
             fixed_reps, failure_minus, per_side, unit, progression, allow_decrease, increment_kg, rest_seconds, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          routineId,
          exerciseId,
          si,
          slot.weightKg,
          slot.sets,
          ...targetColumns(slot.target),
          int(slot.perSide),
          slot.unit,
          slot.progression,
          int(slot.allowDecrease),
          slot.incrementKg,
          slot.restSeconds,
          slot.note,
        );
        slotIds.push(r.lastInsertRowId);
      }

      // Past performances from the Excel become imported sessions so progression has data.
      const latestSessionBySlot = new Map<number, number>();
      for (const label of ['anterior', 'hoy'] as const) {
        const entries = routine.slots
          .map((slot, i) => ({ slot, slotId: slotIds[i], perf: slot.history.find((h) => h.label === label) }))
          .filter((x) => x.perf);
        if (entries.length === 0) continue;

        const day = dateOfWeekday(now, routine.weekdays[0], WEEKS_AGO[label]);
        const startedAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 6, 30).getTime();
        const sessionId = (
          await db.runAsync(
            `INSERT INTO workout_session (routine_id, date, started_at, finished_at, status, imported, notes)
             VALUES (?, ?, ?, ?, 'finished', 1, 'Importado del Excel')`,
            routineId,
            localDateString(day),
            startedAt,
            startedAt + 60 * 60 * 1000,
          )
        ).lastInsertRowId;

        for (const { slot, slotId, perf } of entries) {
          latestSessionBySlot.set(slotId, sessionId);
          for (const [i, reps] of perf!.reps.entries()) {
            await db.runAsync(
              `INSERT INTO set_log (session_id, slot_id, exercise_id, set_index, weight_kg, reps, is_extra, completed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              sessionId,
              slotId,
              exerciseIds.get(slot.exercise)!,
              i + 1,
              perf!.weightKg,
              reps,
              int(i + 1 > slot.sets),
              startedAt + i * 1000,
            );
          }
        }
      }

      // Pending recommendations only: slot weights stay as in the Excel until accepted.
      for (const [i, slot] of routine.slots.entries()) {
        const history = [...slot.history].reverse().map((h) => ({ weightKg: h.weightKg, reps: h.reps }));
        const rec = recommend(
          {
            sets: slot.sets,
            target: slot.target,
            progression: slot.progression,
            allowDecrease: slot.allowDecrease,
            incrementKg: slot.incrementKg,
            weightKg: slot.weightKg,
          },
          null,
          history,
          progression,
        );
        if (rec.action === 'increase' || rec.action === 'decrease') {
          await createRecommendation(db, {
            slotId: slotIds[i],
            sessionId: latestSessionBySlot.get(slotIds[i]) ?? null,
            fromKg: slot.weightKg,
            toKg: rec.toKg,
            reason: rec.reason,
            source: 'import',
            now: nowMs,
          });
        }
      }
    }

    for (const [i, c] of seed.cardio.entries()) {
      await db.runAsync(
        'INSERT INTO cardio_activity (weekday, name, target, intensity, notes, position) VALUES (?, ?, ?, ?, ?, ?)',
        c.weekday,
        c.name,
        c.target,
        c.intensity,
        c.notes,
        i,
      );
    }

    const foodIds = new Map<string, number>();
    for (const f of seed.foods) {
      const r = await db.runAsync(
        'INSERT INTO food (name, fat_per_100g, carbs_per_100g, protein_per_100g) VALUES (?, ?, ?, ?)',
        f.name,
        f.fatPer100g,
        f.carbsPer100g,
        f.proteinPer100g,
      );
      foodIds.set(f.name, r.lastInsertRowId);
    }
    for (const [i, item] of seed.dietPlan.entries()) {
      const foodId = foodIds.get(item.food);
      if (foodId === undefined) throw new Error(`Unknown food in seed: ${item.food}`);
      await db.runAsync(
        'INSERT INTO diet_item (weekday, meal, food_id, grams, position) VALUES (?, ?, ?, ?, ?)',
        item.weekday,
        item.meal,
        foodId,
        item.grams,
        i,
      );
    }
  });
  return true;
}
