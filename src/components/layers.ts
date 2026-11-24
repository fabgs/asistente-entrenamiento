/**
 * What covers the bottom of the screen, so a Snackbar can sit right above it: the BottomBar of the
 * screen in front and the tab bar while the tabs are in front. Screens stack, so several bars can be
 * mounted at once: the one in front is the last one mounted, and when it goes away the one under it
 * counts again (going back from a screen with a bar to another with a bar left the Snackbar over
 * the button).
 */
const bottomBars = new Map<object, number>();
let tabBarHeight = 0;
const listeners = new Set<(height: number) => void>();

const notify = () => listeners.forEach((l) => l(getBottomInset()));

/** `owner` is the bar itself; null when it goes away. */
export function setBottomBarHeight(owner: object, height: number | null): void {
  if (height === null) bottomBars.delete(owner);
  else bottomBars.set(owner, height);
  notify();
}

export function setTabBarHeight(height: number): void {
  tabBarHeight = height;
  notify();
}

/**
 * The native tab bar of iOS (1.5.6) cannot be measured: each tab says, while it is in front, how much
 * of the bottom the bar takes (its safe area). Switching tabs, the new one may speak before the old
 * one is quiet: they all say the same, so any of them will do.
 */
const nativeTabBars = new Map<object, number>();

export function setNativeTabBarHeight(owner: object, height: number | null): void {
  if (height === null) nativeTabBars.delete(owner);
  else nativeTabBars.set(owner, height);
  notify();
}

export const getBottomInset = () =>
  ([...bottomBars.values()].at(-1) ?? 0) + Math.max(tabBarHeight, ...nativeTabBars.values());

export function onBottomInset(listener: (height: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
