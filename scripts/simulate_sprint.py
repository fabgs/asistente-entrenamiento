"""Simulates sprints on the Android emulator by sending GPS fixes with `adb emu geo fix`, one a second.

Standing still until the start, then the profile of the test fixture (0 → 4 → 7 → 8 × 7 → 5 → 1 → 0 m/s,
about 73 m) northwards, then standing still again. Without a Doppler speed the app measures from the
positions and marks the sprint as weak (≈); `--doppler` sends the speed with each fix, as a phone does,
and the sprint counts as well measured.

    python scripts/simulate_sprint.py              # press Enter when the beep sounds
    python scripts/simulate_sprint.py --wait 5     # the beep is 5 s away (just tapped «Empezar sprint»)
    python scripts/simulate_sprint.py --wait 5 --sprints 2 --rest 90
    python scripts/simulate_sprint.py --wait 5 --doppler

Run it from the repo root, with adb on the PATH (as AGENTS.md says, adb always from the root).
"""

import argparse
import math
import subprocess
import threading
import time

LAT0, LON0 = 41.3655, 2.1585
M_PER_DEG_LAT = 6_371_008.8 * math.pi / 180
SPEEDS = [4, 7, 8, 8, 8, 8, 8, 8, 8, 5, 1]  # m/s at seconds 1…11 after the beep
KNOT = 0.514444  # m/s
doppler = False


def fix(lat: float, lon: float, speed: float = 0.0) -> None:
    args = ['adb', 'emu', 'geo', 'fix', f'{lon:.7f}', f'{lat:.7f}']
    if doppler:
        # The console takes the velocity last, in knots, after an altitude and the satellites.
        args += ['0', '12', f'{speed / KNOT:.2f}']
    subprocess.run(args, check=False, capture_output=True)


# One fix a second on the wall clock: `adb` takes a few hundred ms, and sleeping a whole second
# after each call would space the fixes unevenly (the GPS then sometimes catches two steps at once).
_next = time.monotonic()


def tick() -> None:
    global _next
    _next += 1
    time.sleep(max(0.0, _next - time.monotonic()))


def stand(lat: float, seconds: float) -> None:
    for _ in range(round(seconds)):
        fix(lat, LON0)
        tick()


def sprint(lat: float, direction: int) -> float:
    """Runs one sprint from `lat`; returns where it ends."""
    d = 0.0
    previous = 0.0
    for v in SPEEDS:
        d += (previous + v) / 2
        previous = v
        fix(lat + direction * d / M_PER_DEG_LAT, LON0, v)
        tick()
    return lat + direction * d / M_PER_DEG_LAT


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--wait', type=float, help='seconds to the first beep (otherwise, press Enter at the beep)')
    parser.add_argument('--sprints', type=int, default=1)
    parser.add_argument('--rest', type=float, default=90, help='seconds between sprints (the rest of the plan)')
    parser.add_argument('--after', type=float, default=15, help='seconds standing still after the last sprint')
    parser.add_argument('--doppler', action='store_true', help='send the speed with each fix: a well measured sprint')
    args = parser.parse_args()
    global doppler
    doppler = args.doppler

    lat = LAT0
    if args.wait is None:
        print('Standing still: press Enter when the beep sounds.')
        pressed = threading.Event()
        threading.Thread(target=lambda: (input(), pressed.set()), daemon=True).start()
        while not pressed.is_set():
            fix(lat, LON0)
            tick()
    else:
        stand(lat, args.wait)
    for i in range(args.sprints):
        print(f'Sprint {i + 1}')
        lat = sprint(lat, 1 if i % 2 == 0 else -1)
        if i < args.sprints - 1:
            stand(lat, args.rest - len(SPEEDS))
    stand(lat, args.after)
    print('Done')


if __name__ == '__main__':
    main()
