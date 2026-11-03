/**
 * What covers the bottom of the screen, so a Snackbar can sit right above it: the BottomBar of the
 * screen in front (only one at a time; it reports 0 when it goes away) and the tab bar while the
 * tabs are in front.
 */
let bottomBarHeight = 0;
let tabBarHeight = 0;
const listeners = new Set<(height: number) => void>();

const notify = () => listeners.forEach((l) => l(getBottomInset()));

export function setBottomBarHeight(height: number): void {
  bottomBarHeight = height;
  notify();
}

export function setTabBarHeight(height: number): void {
  tabBarHeight = height;
  notify();
}

export const getBottomInset = () => bottomBarHeight + tabBarHeight;

export function onBottomInset(listener: (height: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
