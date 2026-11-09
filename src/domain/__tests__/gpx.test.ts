import { distanceM } from '../gps';
import { checkGpxRoute, gpxFileName, GpxError, parseGpx, toGpx, walkElevation } from '../gpx';
import { at, LOOP, walkAlong } from './routeFixtures';

// Shaped like a Wikiloc download (made up, around Montjuïc: no personal data): metadata, a waypoint
// with its own name, a track named with CDATA, two segments with altitude and time, extensions.
const WIKILOC = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" creator="Wikiloc - https://www.wikiloc.com" version="1.1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata>
    <name>Wikiloc - Montjuïc &amp; jardines</name>
    <author><name>Alguien</name></author>
  </metadata>
  <wpt lat="41.36600" lon="2.15900"><ele>90</ele><name>Fuente</name></wpt>
  <trk>
    <name><![CDATA[Vuelta a Montjuïc & jardines]]></name>
    <type>Senderismo</type>
    <trkseg>
      <trkpt lat="41.365500" lon="2.158500"><ele>60.2</ele><time>2026-10-01T07:00:00Z</time></trkpt>
      <trkpt lon="2.158620" lat="41.365500"><ele>61.0</ele><time>2026-10-01T07:00:08Z</time></trkpt>
      <trkpt lat='41.365500' lon='2.158740'><ele>62.5</ele></trkpt>
      <trkpt lat="41.365501" lon="2.158741"><ele>62.5</ele></trkpt>
      <trkpt lat="41.365600" lon="2.158900"><extensions><speed>1.2</speed></extensions></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="41.366000" lon="2.159300"/>
      <trkpt lat="41.366100" lon="2.159500"><ele>abc</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe('parseGpx', () => {
  it('reads a Wikiloc track: its name, its segments and the altitude, without the waypoints', () => {
    const track = parseGpx(WIKILOC);
    expect(track.name).toBe('Vuelta a Montjuïc & jardines');
    expect(track.segments).toHaveLength(2);
    // The point 0.1 m after the third is left out.
    expect(track.segments[0].map((p) => p.ele)).toEqual([60.2, 61, 62.5, null]);
    expect(track.segments[0][1]).toMatchObject({ lat: 41.3655, lon: 2.15862 });
    expect(track.segments[1]).toEqual([
      { lat: 41.366, lon: 2.1593, ele: null },
      { lat: 41.3661, lon: 2.1595, ele: null },
    ]);
  });

  it('reads the route of a GPX without a track, with namespace prefixes, and the name of the file', () => {
    const xml = `<gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1"><gpx:metadata><gpx:name>Al río</gpx:name></gpx:metadata>
      <gpx:rte><gpx:rtept lat="40.4" lon="-3.7"/><gpx:rtept lat="40.401" lon="-3.7"/><gpx:rtept lat="40.402" lon="-3.7"/></gpx:rte></gpx:gpx>`;
    const track = parseGpx(xml);
    expect(track.name).toBe('Al río');
    expect(track.segments).toEqual([
      [
        { lat: 40.4, lon: -3.7, ele: null },
        { lat: 40.401, lon: -3.7, ele: null },
        { lat: 40.402, lon: -3.7, ele: null },
      ],
    ]);
  });

  it('has no name when the file gives none', () => {
    const xml = '<gpx><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.001" lon="1"/></trkseg></trk></gpx>';
    expect(parseGpx(xml).name).toBeNull();
  });

  it('rejects what is not a GPX, a file cut in half and a GPX with nothing to follow', () => {
    const fails = (xml: string, message: string) => {
      expect(() => parseGpx(xml)).toThrow(GpxError);
      expect(() => parseGpx(xml)).toThrow(message);
    };
    fails('{"app":"entreno"}', 'No es un fichero GPX.');
    fails(WIKILOC.slice(0, WIKILOC.indexOf('<trkseg>', 600)), 'El fichero GPX está incompleto.');
    fails('<gpx><wpt lat="1" lon="1"><name>Solo un punto</name></wpt></gpx>', 'El GPX no tiene ninguna ruta');
    fails('<gpx><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>', 'El GPX no tiene ninguna ruta');
    fails('<gpx><trk><trkseg><trkpt lat="95" lon="1"/><trkpt lat="x" lon="1"/></trkseg></trk></gpx>', 'El GPX no tiene ninguna ruta');
  });
});

describe('a GPX as a route', () => {
  it('rejects one with too many points or too short', () => {
    const many = { name: null, segments: [Array.from({ length: 20_001 }, (_, i) => ({ ...at(i * 6, 0), ele: null }))] };
    expect(() => checkGpxRoute(many)).toThrow('El GPX tiene demasiados puntos para una ruta.');
    const short = { name: null, segments: [[{ ...at(0, 0), ele: null }, { ...at(60, 0), ele: null }]] };
    expect(() => checkGpxRoute(short)).toThrow('La ruta del GPX mide menos de 100 m.');
    expect(() => checkGpxRoute(parseGpx(WIKILOC))).toThrow('menos de 100 m');
    const fine = { name: null, segments: [walkAlong(LOOP).map((p) => ({ ...p, ele: null }))] };
    expect(() => checkGpxRoute(fine)).not.toThrow();
  });

  it('names the file after the walk or the route, without characters a file cannot have', () => {
    expect(gpxFileName('Ver hormigas', '2026-11-09')).toBe('Ver hormigas 2026-11-09.gpx');
    expect(gpxFileName('Ida/vuelta: «río»?')).toBe('Ida-vuelta- «río»-.gpx');
    expect(gpxFileName('  ')).toBe('Ruta.gpx');
  });

  it('gives each point of a walk the altitude of its profile at the metres walked', () => {
    const segments = [[at(0, 0), at(100, 0), at(200, 0)], [at(300, 0), at(400, 0)]];
    // Without joining segments: the second starts at 200 m walked.
    const ele = walkElevation(segments, [
      { d: 0, a: 50 },
      { d: 100, a: 60 },
      { d: 200, a: null },
      { d: 300, a: 80 },
    ]);
    expect(ele(0, 0)).toBe(50);
    expect(ele(0, 1)).toBeCloseTo(60, 0);
    expect(ele(0, 2)).toBeCloseTo(70, 0);
    expect(ele(1, 0)).toBeCloseTo(70, 0);
    expect(ele(1, 1)).toBeCloseTo(80, 0);
    expect(walkElevation(segments, [{ d: 0, a: null }])(0, 0)).toBeNull();
  });
});

describe('toGpx', () => {
  it('writes a walk that reads back the same, with its altitude and start', () => {
    const segments = [walkAlong(LOOP, { seed: 1 }).slice(0, 60), walkAlong(LOOP, { seed: 1 }).slice(64)];
    const xml = toGpx({
      name: 'Ver hormigas <al alba> & vuelta',
      segments,
      startedAt: Date.UTC(2026, 10, 5, 7, 51),
      ele: (s, i) => (s === 0 ? 60 + i / 10 : null),
    });
    expect(xml).toContain('<name>Ver hormigas &lt;al alba&gt; &amp; vuelta</name>');
    expect(xml).toContain('<time>2026-11-05T07:51:00.000Z</time>');
    const back = parseGpx(xml);
    expect(back.name).toBe('Ver hormigas <al alba> & vuelta');
    expect(back.segments.map((s) => s.length)).toEqual(segments.map((s) => s.length));
    for (const [k, segment] of back.segments.entries()) {
      for (const [i, p] of segment.entries()) expect(distanceM(p, segments[k][i])).toBeLessThan(0.2);
    }
    expect(back.segments[0][10].ele).toBe(61);
    expect(back.segments[1][0].ele).toBeNull();
  });

  it('skips empty segments', () => {
    const xml = toGpx({ name: 'Recta', segments: [[], [at(0, 0), at(100, 0)]] });
    expect(xml.match(/<trkseg>/g)).toHaveLength(1);
  });
});
