"""Render every source pixel for the full DEM viewer without resampling."""
import json
from pathlib import Path
import struct
import sys
import zlib

import numpy as np
import rasterio
from rasterio.warp import transform


def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


source = Path(sys.argv[1])
output = Path(__file__).with_name("dist")


def write_png(name, pixels, color_type):
    height, width = pixels.shape[:2]
    rows = b"".join(b"\x00" + row.tobytes() for row in pixels)
    header = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    (output / name).write_bytes(b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header)
                               + png_chunk(b"IDAT", zlib.compress(rows, 6)) + png_chunk(b"IEND", b""))


with rasterio.open(source) as raster:
    samples = raster.read(1, masked=True)
    valid = samples.compressed()
    low, high = float(valid.min()), float(valid.max())
    mask = np.ma.getmaskarray(samples)
    shade = np.round((samples.filled(low).astype(np.float64) - low) * 255 / (high - low or 1))
    pixels = np.stack((shade.astype(np.uint8), np.where(mask, 0, 255).astype(np.uint8)), axis=-1)
    write_png("jezero-full.png", pixels, 4)
    values = samples.astype("<f4").filled(np.nan)
    values.tofile(output.parent / "jezero-full.f32")
    dx, dy = abs(raster.transform.a), abs(raster.transform.e)
    grades = np.zeros_like(values)
    for oy, ox in ((0, 1), (1, -1), (1, 0), (1, 1)):
        a = np.s_[max(0, -oy):raster.height-max(0, oy), max(0, -ox):raster.width-max(0, ox)]
        b = np.s_[max(0, oy):raster.height-max(0, -oy), max(0, ox):raster.width-max(0, -ox)]
        grade = np.abs(values[a] - values[b]) / np.hypot(ox * dx, oy * dy)
        np.fmax(grades[a], grade, out=grades[a])
        np.fmax(grades[b], grade, out=grades[b])
    overlay = np.zeros((*values.shape, 4), dtype=np.uint8)
    overlay[grades > np.tan(np.deg2rad(10))] = (255, 192, 72, 150)
    overlay[grades > np.tan(np.deg2rad(18))] = (255, 81, 69, 200)
    write_png("jezero-hazards.png", overlay, 6)
    bands = np.floor(values / 50)
    contours = np.zeros(values.shape, dtype=bool)
    contours[:, 1:] |= np.isfinite(bands[:, 1:]) & np.isfinite(bands[:, :-1]) & (bands[:, 1:] != bands[:, :-1])
    contours[1:, :] |= np.isfinite(bands[1:, :]) & np.isfinite(bands[:-1, :]) & (bands[1:, :] != bands[:-1, :])
    overlay.fill(0)
    overlay[contours] = (228, 212, 172, 145)
    write_png("jezero-contours.png", overlay, 6)
    xs, ys = transform("+proj=longlat +a=3396190 +b=3376200 +no_defs", raster.crs, [77.40], [18.47])
    row, col = raster.index(xs[0], ys[0])
    metadata = dict(width=raster.width, height=raster.height, dx=abs(raster.transform.a),
                    dy=dy, minimum=low, maximum=high, cropOrigin=[col - 120, row - 84],
                    source="USGS Mars 2020 CTX Science Investigation DEM")
    (output / "jezero-full.json").write_text(json.dumps(metadata))
    print(metadata)
