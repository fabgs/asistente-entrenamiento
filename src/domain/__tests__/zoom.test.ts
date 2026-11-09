import { clampOffset, containSize, pageAfterSwipe, pinchOffset } from '../zoom';

describe('containSize', () => {
  it('fits a landscape photo to the width and a portrait one to the height', () => {
    expect(containSize(2160, 1620, 360, 600)).toEqual({ width: 360, height: 270 });
    expect(containSize(1620, 2160, 360, 400)).toEqual({ width: 300, height: 400 });
  });

  it('without a size, the photo is the box', () => {
    expect(containSize(0, 0, 360, 600)).toEqual({ width: 360, height: 600 });
  });
});

describe('clampOffset', () => {
  it('keeps the edges of a zoomed photo inside the box', () => {
    // 360 dp wide at ×2 is 720: it can move 180 to each side.
    expect(clampOffset(500, 360, 360, 2)).toBe(180);
    expect(clampOffset(-500, 360, 360, 2)).toBe(-180);
    expect(clampOffset(50, 360, 360, 2)).toBe(50);
  });

  it('centres an axis that still fits in the box', () => {
    // 270 dp high at ×2 is 540, less than 600.
    expect(clampOffset(100, 270, 600, 2)).toBe(0);
    expect(clampOffset(40, 360, 360, 1)).toBe(0);
  });
});

describe('pinchOffset', () => {
  it('keeps the point between the fingers in place', () => {
    // Pinching at 100 dp right of the centre from ×1 to ×2: that point moves to 200, so −100.
    expect(pinchOffset(100, 0, 1, 100, 2)).toBe(-100);
    // The point under the fingers is the same before and after.
    const startOffset = -40;
    const offset = pinchOffset(60, startOffset, 1.5, 60, 3);
    expect((60 - startOffset) / 1.5).toBeCloseTo((60 - offset) / 3);
  });

  it('follows the fingers when they move', () => {
    expect(pinchOffset(0, 0, 1, 30, 1)).toBe(30);
  });
});

describe('pageAfterSwipe', () => {
  it('turns the page past a quarter of the width or with a fast swipe', () => {
    expect(pageAfterSwipe(1, 3, -100, 0, 360)).toBe(2);
    expect(pageAfterSwipe(1, 3, 100, 0, 360)).toBe(0);
    expect(pageAfterSwipe(1, 3, -40, -800, 360)).toBe(2);
    expect(pageAfterSwipe(1, 3, -40, -100, 360)).toBe(1);
  });

  it('never goes past the first or the last photo', () => {
    expect(pageAfterSwipe(0, 3, 200, 900, 360)).toBe(0);
    expect(pageAfterSwipe(2, 3, -200, -900, 360)).toBe(2);
  });
});
