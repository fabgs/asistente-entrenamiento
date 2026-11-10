import { reloadAppAsync } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { parseThemePreference, type ThemePreference } from '@/domain/palette';

/**
 * The theme (mode and accent, PLAN.md §8) is a preference of this phone: it is kept outside the
 * database, because `src/theme.ts` needs it before anything is drawn, when the database is not open
 * yet, and so a restored copy or a reset do not change how the app looks. The secure store is the
 * storage with a synchronous read that is already in the app.
 */
const THEME_ITEM = 'theme';
/** Set while the app restarts to apply a theme: the next start opens Ajustes again. */
const RETURN_ITEM = 'theme-return';

/** Read as the bundle loads; the default if there is none or the store cannot be read (tests). */
export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(SecureStore.getItem(THEME_ITEM));
  } catch {
    return parseThemePreference(null);
  }
}

/**
 * Stores the theme and restarts the JavaScript of the app (about a second): every colour is read
 * once at start-up, so nothing can keep an old one.
 */
export async function applyTheme(theme: ThemePreference): Promise<void> {
  SecureStore.setItem(THEME_ITEM, JSON.stringify(theme));
  SecureStore.setItem(RETURN_ITEM, '1');
  await reloadAppAsync('Tema nuevo');
}

/** True once, on the start that follows `applyTheme`. */
export function consumeThemeReturn(): boolean {
  try {
    if (SecureStore.getItem(RETURN_ITEM) === null) return false;
    void SecureStore.deleteItemAsync(RETURN_ITEM);
    return true;
  } catch {
    return false;
  }
}
