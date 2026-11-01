"""Generates the app icons (a tilted dumbbell) with no dependencies.

Shapes are signed-distance rounded boxes, so one sample per pixel gives anti-aliased edges.
Run from the repo root:  python scripts/generate_icons.py
Then `npx expo prebuild --platform android --clean` to copy them into the native project.
"""

import math
import struct
import zlib
from pathlib import Path

OUT = Path('assets/images')
BACKGROUND = (0x0E, 0x11, 0x16)
GREEN = (0x4A, 0xDE, 0x80)
BAR = (0xE5, 0xE7, 0xEB)
WHITE = (0xFF, 0xFF, 0xFF)
ANGLE = math.radians(35)

# Dumbbell in a [-1, 1] box before rotation: (center x, half width, half height, corner radius, part).
PARTS = [
    (0.0, 0.62, 0.07, 0.07, 'bar'),
    (-0.44, 0.08, 0.42, 0.06, 'plate'),
    (0.44, 0.08, 0.42, 0.06, 'plate'),
    (-0.62, 0.08, 0.30, 0.06, 'plate'),
    (0.62, 0.08, 0.30, 0.06, 'plate'),
    (-0.75, 0.05, 0.09, 0.04, 'plate'),
    (0.75, 0.05, 0.09, 0.04, 'plate'),
]


def rounded_box(px, py, hx, hy, r):
    qx = abs(px) - hx + r
    qy = abs(py) - hy + r
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    return outside + min(max(qx, qy), 0.0) - r


def render(size, scale, colors, background=None):
    """RGBA rows. `colors` maps part -> RGB; `scale` shrinks the drawing inside the canvas."""
    pixel = 2.0 / size / scale
    cos_a, sin_a = math.cos(ANGLE), math.sin(ANGLE)
    rows = []
    for j in range(size):
        row = bytearray()
        y = (1 - (j + 0.5) * 2 / size) / scale
        for i in range(size):
            x = ((i + 0.5) * 2 / size - 1) / scale
            # Rotate the sample point into the dumbbell's frame.
            u = x * cos_a + y * sin_a
            v = -x * sin_a + y * cos_a
            # Two layers, bar below plates, each with analytic anti-aliasing.
            dist = {'bar': 1e9, 'plate': 1e9}
            for cx, hx, hy, r, name in PARTS:
                dist[name] = min(dist[name], rounded_box(u - cx, v, hx, hy, r))
            cov = {k: min(1.0, max(0.0, 0.5 - d / pixel)) for k, d in dist.items()}
            alpha = cov['plate'] + cov['bar'] * (1 - cov['plate'])
            if alpha == 0:
                rgb = [0, 0, 0]
            else:
                rgb = [
                    (p * cov['plate'] + b * cov['bar'] * (1 - cov['plate'])) / alpha
                    for p, b in zip(colors['plate'], colors['bar'])
                ]
            if background:
                row += bytes([round(bg + (c - bg) * alpha) for c, bg in zip(rgb, background)] + [255])
            else:
                row += bytes([round(c) for c in rgb] + [round(255 * alpha)])
        rows.append(bytes(row))
    return rows


def solid(size, rgb):
    return [bytes(list(rgb) + [255]) * size for _ in range(size)]


def write_png(path, rows):
    width, height = len(rows[0]) // 4, len(rows)
    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    path.write_bytes(png)
    print(f'{path} {width}x{height}')


if __name__ == '__main__':
    two_tone = {'bar': BAR, 'plate': GREEN}
    white = {'bar': WHITE, 'plate': WHITE}
    # Launcher icon (legacy/iOS): full bleed background.
    write_png(OUT / 'icon.png', render(1024, 1.0, two_tone, BACKGROUND))
    # Adaptive icon: content kept inside the 66/108 safe circle (scale 0.72 -> radius ≤ 0.6).
    write_png(OUT / 'android-icon-foreground.png', render(512, 0.72, two_tone))
    write_png(OUT / 'android-icon-background.png', solid(512, BACKGROUND))
    write_png(OUT / 'android-icon-monochrome.png', render(432, 0.72, white))
    write_png(OUT / 'splash-icon.png', render(288, 0.95, two_tone))
    write_png(OUT / 'favicon.png', render(48, 1.0, two_tone, BACKGROUND))
    # Status-bar icon for expo-notifications: white on transparent.
    write_png(OUT / 'notification-icon.png', render(96, 0.9, white))
