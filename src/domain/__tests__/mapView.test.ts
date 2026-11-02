import { fitView, outline, project, TILE_SIZE, tilesFor } from '../mapView';

describe('map view', () => {
  it('projects like slippy map tiles', () => {
    // Puerta del Sol, Madrid, is in tile 16/32093/24711.
    const p = project({ lat: 40.4169, lon: -3.7035 }, 16);
    expect(Math.floor(p.x / TILE_SIZE)).toBe(32093);
    expect(Math.floor(p.y / TILE_SIZE)).toBe(24711);
  });

  it('zooms in as far as the route allows and centres it', () => {
    const route = [
      { lat: 40.41, lon: -3.71 },
      { lat: 40.43, lon: -3.69 },
    ];
    const view = fitView(route, 360, 240);
    const a = project(route[0], view.zoom);
    const b = project(route[1], view.zoom);
    for (const p of [a, b]) {
      expect(p.x - view.originX).toBeGreaterThanOrEqual(24);
      expect(p.x - view.originX).toBeLessThanOrEqual(360 - 24);
      expect(p.y - view.originY).toBeGreaterThanOrEqual(24);
      expect(p.y - view.originY).toBeLessThanOrEqual(240 - 24);
    }
    // One more zoom level would not fit.
    expect(Math.abs(project(route[1], view.zoom + 1).y - project(route[0], view.zoom + 1).y)).toBeGreaterThan(240 - 48);
  });

  it('caps the zoom for a single point', () => {
    expect(fitView([{ lat: 40.4, lon: -3.7 }], 360, 240).zoom).toBe(17);
  });

  it('scales a short route to fill a thumbnail, keeping its shape', () => {
    // ~170 m east-west, ~20 m north-south.
    const [line] = outline([[{ lat: 40.415, lon: -3.686 }, { lat: 40.41518, lon: -3.684 }]], 56, 56, 6);
    expect(line[0].x).toBeCloseTo(6);
    expect(line[1].x).toBeCloseTo(50);
    // Centred vertically, and much flatter than it is wide.
    expect((line[0].y + line[1].y) / 2).toBeCloseTo(28);
    expect(Math.abs(line[0].y - line[1].y)).toBeLessThan(10);
  });

  it('lists the tiles that cover the view', () => {
    const view = { zoom: 3, originX: 100, originY: 300 };
    const tiles = tilesFor(view, 300, 200); // x 100–400, y 300–500
    expect(tiles.map((t) => `${t.x},${t.y}`)).toEqual(['0,1', '1,1']);
    expect(tiles[0]).toMatchObject({ left: -100, top: -44 });
  });
});
