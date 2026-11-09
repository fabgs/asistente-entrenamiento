"""Simulates a walk on the Android emulator by sending GPS fixes with `adb emu geo fix`.

The route is a built-in shape around Montjuïc (the same ones as the tests of `routeMatch`) or a GPX
or JSON file, walked at `--speed` with the slow drift of a phone's GPS. It can be walked the other
way round, with a detour (a parallel street to one side) and with stops. Start the walk in the app
(«Iniciar»), then run this; tap «Terminar» when it says Done.

    python scripts/simulate_walk.py --shape loop --speed 8              # 1.4 km block in ~3 min
    python scripts/simulate_walk.py --shape loop --speed 8 --reverse    # the same, the other way round
    python scripts/simulate_walk.py --shape loop --speed 8 --detour 150 # a variant
    python scripts/simulate_walk.py --gpx ruta.gpx --speed 1.4 --stop 0.5:60
    python scripts/simulate_walk.py --shape line --print                # the fixes, without the emulator

Shapes (metres east and north of the start): `loop`, a 400 × 300 m block anticlockwise (1.4 km);
`outback`, 700 m along a street and back (1.4 km); `line`, 600 m east and 400 m north (1 km).
The app drops fixes faster than 10 m/s, so keep `--speed` under 9. A JSON file is a list of
[lat, lon] or [lat, lon, ele]. Run it from the repo root, with adb on the PATH (AGENTS.md).
"""

import argparse
import json
import math
import random
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

LAT0, LON0 = 41.3655, 2.1585
M_PER_DEG_LAT = 111_195.0
M_PER_DEG_LON = M_PER_DEG_LAT * math.cos(math.radians(LAT0))

SHAPES = {
    'loop': [(0, 0), (400, 0), (400, 300), (0, 300), (0, 0)],
    'outback': [(0, 0), (700, 0), (0, 0)],
    'line': [(0, 0), (600, 0), (600, 400)],
}


def from_shape(name: str) -> list[tuple[float, float, float]]:
    """Corners of a shape as (lat, lon, altitude); a hill in the middle gives it some climb."""
    corners = SHAPES[name]
    total = sum(math.dist(a, b) for a, b in zip(corners, corners[1:]))
    points, along = [], 0.0
    for i, (x, y) in enumerate(corners):
        if i > 0:
            along += math.dist(corners[i - 1], (x, y))
        points.append((LAT0 + y / M_PER_DEG_LAT, LON0 + x / M_PER_DEG_LON, 60 + 25 * math.sin(math.pi * along / total)))
    return points


def from_file(path: str) -> list[tuple[float, float, float]]:
    if path.lower().endswith('.json'):
        with open(path, encoding='utf-8') as f:
            return [(p[0], p[1], p[2] if len(p) > 2 else 60.0) for p in json.load(f)]
    root = ET.parse(path).getroot()
    points = []
    for el in root.iter():
        if el.tag.split('}')[-1] in ('trkpt', 'rtept'):
            ele = next((c.text for c in el if c.tag.split('}')[-1] == 'ele'), None)
            points.append((float(el.get('lat')), float(el.get('lon')), float(ele) if ele else 60.0))
    if len(points) < 2:
        sys.exit(f'{path}: no track or route points')
    return points


def to_xy(points):
    lat0, lon0 = points[0][0], points[0][1]
    m_lon = M_PER_DEG_LAT * math.cos(math.radians(lat0))
    xy = [((lon - lon0) * m_lon, (lat - lat0) * M_PER_DEG_LAT, ele) for lat, lon, ele in points]
    return xy, (lambda x, y: (lat0 + y / M_PER_DEG_LAT, lon0 + x / m_lon))


def densify(xy, step=2.0):
    """A point every `step` metres, with the distance walked to it."""
    out = [(xy[0][0], xy[0][1], xy[0][2], 0.0)]
    along = 0.0
    for (ax, ay, ae), (bx, by, be) in zip(xy, xy[1:]):
        length = math.hypot(bx - ax, by - ay)
        n = max(1, round(length / step))
        for k in range(1, n + 1):
            f = k / n
            out.append((ax + (bx - ax) * f, ay + (by - ay) * f, ae + (be - ae) * f, along + length * f))
        along += length
    return out


def add_detour(dense, metres: float, start: float, end: float):
    """Between two fractions of the way, walks a parallel street `metres` to the right."""
    total = dense[-1][3]
    s0, s1 = start * total, end * total
    ramp = min(abs(metres), (s1 - s0) / 3)
    out = []
    for i, (x, y, e, s) in enumerate(dense):
        if s0 < s < s1:
            a = dense[max(0, i - 1)]
            b = dense[min(len(dense) - 1, i + 1)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            norm = math.hypot(dx, dy) or 1
            k = min(1.0, (s - s0) / ramp, (s1 - s) / ramp)
            # Right of the way: (dy, -dx).
            x, y = x + metres * k * dy / norm, y - metres * k * dx / norm
        out.append((x, y, e, s))
    # The distance walked changes with the detour.
    along, result = 0.0, [out[0][:3] + (0.0,)]
    for a, b in zip(out, out[1:]):
        along += math.hypot(b[0] - a[0], b[1] - a[1])
        result.append(b[:3] + (along,))
    return result


def at_distance(dense, d: float):
    lo, hi = 0, len(dense) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if dense[mid][3] < d:
            lo = mid + 1
        else:
            hi = mid
    return dense[lo]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group()
    source.add_argument('--shape', choices=sorted(SHAPES), default='loop')
    source.add_argument('--gpx', help='GPX (trkpt or rtept) or JSON file with the route')
    parser.add_argument('--speed', type=float, default=1.4, help='metres per second (default 1.4, walking)')
    parser.add_argument('--every', type=float, default=1.0, help='seconds between fixes (the app reads one every 3 s)')
    parser.add_argument('--reverse', action='store_true', help='walk it the other way round')
    parser.add_argument('--detour', type=float, default=0, help='walk a parallel street this many metres to the right')
    parser.add_argument('--detour-at', default='0.55:0.75', help='fractions of the way where the detour starts and ends')
    parser.add_argument('--stop', action='append', default=[], help='FRACTION:SECONDS standing still, e.g. 0.5:30 (repeatable)')
    parser.add_argument('--drift', type=float, default=4, help='metres of slow GPS drift (default 4)')
    parser.add_argument('--accuracy', type=float, default=5, help='not sent: adb has no accuracy; for --print only')
    parser.add_argument('--seed', type=int, default=1)
    parser.add_argument('--wait', type=float, default=5, help='seconds standing at the start (default 5)')
    parser.add_argument('--after', type=float, default=10, help='seconds standing at the end (default 10)')
    parser.add_argument('--print', action='store_true', help='print the fixes as CSV instead of sending them')
    args = parser.parse_args()
    if args.speed >= 10:
        print('Warning: the app drops fixes faster than 10 m/s', file=sys.stderr)

    points = from_file(args.gpx) if args.gpx else from_shape(args.shape)
    if args.reverse:
        points = points[::-1]
    xy, to_latlon = to_xy(points)
    dense = densify(xy)
    if args.detour:
        start, end = (float(v) for v in args.detour_at.split(':'))
        dense = add_detour(dense, args.detour, start, end)
    total = dense[-1][3]
    stops = sorted((float(f) * total, float(s)) for f, s in (v.split(':') for v in args.stop))

    rng = random.Random(args.seed)
    phase = (rng.uniform(0, 6.3), rng.uniform(0, 6.3))
    started = time.monotonic()
    next_at = started
    clock = 0.0

    def send(x: float, y: float, e: float, s: float) -> None:
        nonlocal next_at, clock
        x += args.drift * math.sin(s / 53 + phase[0]) + rng.uniform(-1, 1)
        y += args.drift * math.cos(s / 71 + phase[1]) + rng.uniform(-1, 1)
        lat, lon = to_latlon(x, y)
        if args.print:
            print(f'{clock:.0f},{lat:.7f},{lon:.7f},{e:.1f},{args.accuracy:.0f}')
        else:
            subprocess.run(['adb', 'emu', 'geo', 'fix', f'{lon:.7f}', f'{lat:.7f}', f'{e:.1f}'], check=False, capture_output=True)
            # On the wall clock: adb takes a few hundred ms.
            next_at += args.every
            time.sleep(max(0.0, next_at - time.monotonic()))
        clock += args.every

    def stand(p, seconds: float) -> None:
        for _ in range(round(seconds / args.every)):
            send(p[0], p[1], p[2], p[3])

    if args.print:
        print('t_s,lat,lon,ele,accuracy')
    print(f'Route of {total:.0f} m at {args.speed} m/s: about {total / args.speed / 60:.1f} min', file=sys.stderr)
    stand(dense[0], args.wait)
    d = 0.0
    while d < total:
        while stops and stops[0][0] <= d:
            print(f'Stop of {stops[0][1]:.0f} s at {d:.0f} m', file=sys.stderr)
            stand(at_distance(dense, d), stops.pop(0)[1])
        send(*at_distance(dense, d))
        d += args.speed * args.every
    stand(dense[-1], args.after)
    print('Done', file=sys.stderr)


if __name__ == '__main__':
    main()
