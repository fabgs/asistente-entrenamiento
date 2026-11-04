import { countOwnIncrements } from '../repositories/exercises';
import { getSettings, updateSettings } from '../repositories/settings';
import { DEMO_SEED } from '../demoSeed';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 2, 7, 0);

describe('editable rules of the weight suggestions', () => {
  it('counts the exercises with their own increment, in the catalog or in an active routine', async () => {
    const db = await createTestDb();
    await importSeed(db, DEMO_SEED, NOW);
    const before = await countOwnIncrements(db);
    const [a, b] = await db.getAllAsync<{ id: number }>('SELECT id FROM exercise ORDER BY id LIMIT 2');
    await db.runAsync('UPDATE exercise SET increment_kg = 1 WHERE id = ?', a.id);
    await db.runAsync('UPDATE routine_slot SET increment_kg = 5 WHERE exercise_id = ?', b.id);
    expect(await countOwnIncrements(db)).toBe(before + 2);
    // A deleted exercise no longer counts.
    await db.runAsync('UPDATE exercise SET archived = 1 WHERE id = ?', a.id);
    expect(await countOwnIncrements(db)).toBe(before + 1);
  });

  it('reads rules out of range as the engine can use them', async () => {
    const db = await createTestDb();
    await importSeed(db, DEMO_SEED, NOW);
    await db.runAsync("UPDATE settings SET default_increment_kg = 0, progression_mode = 'fast', sessions_below_to_decrease = 0");
    expect(await getSettings(db)).toMatchObject({ defaultIncrementKg: 2.5, progressionMode: 'average', sessionsBelowToDecrease: 1 });
    await updateSettings(db, { defaultIncrementKg: 1.25, progressionMode: 'strict', sessionsBelowToDecrease: 3 });
    expect(await getSettings(db)).toMatchObject({ defaultIncrementKg: 1.25, progressionMode: 'strict', sessionsBelowToDecrease: 3 });
  });
});
