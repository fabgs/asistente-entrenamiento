import { useEffect, useState } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { clampOffset, containSize, DOUBLE_TAP_ZOOM, MAX_ZOOM, pageAfterSwipe, pinchOffset } from '@/domain/zoom';

export interface PagerPhoto {
  id: number;
  uri: string;
  width: number;
  height: number;
}

const SETTLE = { duration: 220 };
/** Past the first or the last photo, a swipe moves a third of the finger: there is nothing there. */
const EDGE_RESISTANCE = 1 / 3;
/** Below this the photo is back at its size (a pinch rarely ends exactly at ×1). */
const ZOOMED = 1.01;

/**
 * The photos one per page (PLAN.md §6.10): swipe to the next one; pinch or double tap to zoom, and
 * zoomed, drag to look around. Pages and zoom live in one set of gestures on the UI thread, so a pinch
 * never turns the page. Zoomed, a swipe moves the photo: zoom out to change photos.
 */
export function PhotoPager({
  photos,
  initialIndex,
  width,
  onIndexChange,
}: {
  photos: PagerPhoto[];
  initialIndex: number;
  /** Of each page: the screen's. */
  width: number;
  onIndexChange: (index: number) => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [height, setHeight] = useState(0);
  const count = photos.length;
  const sizes = photos.map((p) => [p.width, p.height] as const);

  const page = useSharedValue(initialIndex);
  const pagerX = useSharedValue(-initialIndex * width);
  const boxHeight = useSharedValue(0);
  const scale = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  // Where the current gesture started.
  const start = useSharedValue({ scale: 1, x: 0, y: 0, focalX: 0, focalY: 0, zoomed: false });

  // A rotation (or a new width) keeps the page in place.
  useEffect(() => {
    pagerX.set(-page.get() * width);
  }, [width, page, pagerX]);

  const changePage = (next: number) => {
    setIndex(next);
    onIndexChange(next);
  };

  const fitted = () => {
    'worklet';
    const [w, h] = sizes[page.get()] ?? [0, 0];
    return containSize(w, h, width, boxHeight.get());
  };
  const resetZoom = (animate: boolean) => {
    'worklet';
    scale.set(animate ? withTiming(1, SETTLE) : 1);
    offsetX.set(animate ? withTiming(0, SETTLE) : 0);
    offsetY.set(animate ? withTiming(0, SETTLE) : 0);
  };

  const pinch = usePinchGesture({
    onActivate: (e) => {
      'worklet';
      start.set({
        scale: scale.get(),
        x: offsetX.get(),
        y: offsetY.get(),
        focalX: e.focalX - width / 2,
        focalY: e.focalY - boxHeight.get() / 2,
        zoomed: true,
      });
    },
    onUpdate: (e) => {
      'worklet';
      const s = start.get();
      const next = Math.min(MAX_ZOOM, Math.max(1, s.scale * e.scale));
      const fit = fitted();
      scale.set(next);
      offsetX.set(clampOffset(pinchOffset(s.focalX, s.x, s.scale, e.focalX - width / 2, next), fit.width, width, next));
      offsetY.set(clampOffset(pinchOffset(s.focalY, s.y, s.scale, e.focalY - boxHeight.get() / 2, next), fit.height, boxHeight.get(), next));
    },
    onDeactivate: () => {
      'worklet';
      if (scale.get() < ZOOMED) resetZoom(true);
    },
  });

  // One finger: the photo when zoomed, the pages otherwise. Two fingers are the pinch's.
  const pan = usePanGesture({
    maxPointers: 1,
    minDistance: 8,
    onActivate: () => {
      'worklet';
      start.set({ ...start.get(), x: offsetX.get(), y: offsetY.get(), zoomed: scale.get() >= ZOOMED });
    },
    onUpdate: (e) => {
      'worklet';
      if (start.get().zoomed) {
        const fit = fitted();
        offsetX.set(clampOffset(start.get().x + e.translationX, fit.width, width, scale.get()));
        offsetY.set(clampOffset(start.get().y + e.translationY, fit.height, boxHeight.get(), scale.get()));
        return;
      }
      const atEdge = (page.get() === 0 && e.translationX > 0) || (page.get() === count - 1 && e.translationX < 0);
      pagerX.set(-page.get() * width + e.translationX * (atEdge ? EDGE_RESISTANCE : 1));
    },
    onDeactivate: (e) => {
      'worklet';
      if (start.get().zoomed) return;
      const next = pageAfterSwipe(page.get(), count, e.translationX, e.velocityX, width);
      pagerX.set(withTiming(-next * width, SETTLE));
      if (next !== page.get()) {
        page.set(next);
        resetZoom(false);
        scheduleOnRN(changePage, next);
      }
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (e) => {
      'worklet';
      if (scale.get() >= ZOOMED) {
        resetZoom(true);
        return;
      }
      const fit = fitted();
      // Zooms on the point tapped, as far as the edges allow.
      const tapX = e.x - width / 2;
      const tapY = e.y - boxHeight.get() / 2;
      const x = clampOffset(pinchOffset(tapX, 0, 1, tapX, DOUBLE_TAP_ZOOM), fit.width, width, DOUBLE_TAP_ZOOM);
      const y = clampOffset(pinchOffset(tapY, 0, 1, tapY, DOUBLE_TAP_ZOOM), fit.height, boxHeight.get(), DOUBLE_TAP_ZOOM);
      scale.set(withTiming(DOUBLE_TAP_ZOOM, SETTLE));
      offsetX.set(withTiming(x, SETTLE));
      offsetY.set(withTiming(y, SETTLE));
    },
  });

  const gestures = useSimultaneousGestures(pinch, pan, doubleTap);

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pagerX.get() }] }));

  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    boxHeight.set(h);
    setHeight(h);
  };

  return (
    <GestureDetector gesture={gestures}>
      <View style={styles.box} onLayout={onLayout} collapsable={false}>
        {height > 0 ? (
          <Animated.View style={[styles.strip, { width: width * count, height }, stripStyle]}>
            {photos.map((photo, i) => (
              <Page
                key={photo.id}
                photo={photo}
                pageIndex={i}
                // Only the photo shown and its neighbours are decoded: a 2160 px photo weighs ~18 MB.
                loaded={Math.abs(i - index) <= 1}
                width={width}
                height={height}
                page={page}
                scale={scale}
                offsetX={offsetX}
                offsetY={offsetY}
              />
            ))}
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

function Page({
  photo,
  pageIndex,
  loaded,
  width,
  height,
  page,
  scale,
  offsetX,
  offsetY,
}: {
  photo: PagerPhoto;
  pageIndex: number;
  loaded: boolean;
  width: number;
  height: number;
  page: SharedValue<number>;
  scale: SharedValue<number>;
  offsetX: SharedValue<number>;
  offsetY: SharedValue<number>;
}) {
  // Only the page shown is zoomed; the others wait at their size.
  const style = useAnimatedStyle(() => {
    const shown = page.get() === pageIndex;
    return {
      transform: [
        { translateX: shown ? offsetX.get() : 0 },
        { translateY: shown ? offsetY.get() : 0 },
        { scale: shown ? scale.get() : 1 },
      ],
    };
  });
  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      {loaded ? (
        <Animated.View style={[{ width, height }, style]}>
          <Image source={{ uri: photo.uri }} style={{ width, height }} resizeMode="contain" accessibilityIgnoresInvertColors />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, overflow: 'hidden' },
  strip: { flexDirection: 'row' },
});
