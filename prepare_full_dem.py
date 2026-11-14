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


def render_elevation(samples, dx, dy, low, high):
    """Render native-resolution elevation colours with simulated hillshade."""

    height, width = samples.shape

    # Elevation colours, ordered from the lowest to highest terrain.
    # These are visualisation colours, not measured surface colours.
    palette = np.array([
        [35, 55, 72],
        [57, 111, 112],
        [132, 151, 111],
        [194, 157, 104],
        [239, 218, 177]
    ], dtype=np.float32)

    # A small lookup table avoids interpolating millions of RGB pixels.
    levels = np.linspace(0, len(palette) - 1, 256)
    lookup = np.column_stack([
        np.interp(levels, np.arange(len(palette)), palette[:, channel])
        for channel in range(3)
    ]).astype(np.float32)

    rgba = np.empty((height, width, 4), dtype=np.uint8)

    # Process horizontal strips instead of creating multiple full-size arrays.
    strip_height = 128

    for top in range(0, height, strip_height):
        bottom = min(top + strip_height, height)

        # Include one neighbouring row above and below for gradients.
        first = max(0, top - 1)
        last = min(height, bottom + 1)

        section = samples[first:last].filled(low).astype(np.float32)
        valid = ~np.ma.getmaskarray(samples[top:bottom])

        # Gradient: elevation change per metre in each direction.
        dz_dy, dz_dx = np.gradient(section, dy, dx)

        offset = top - first
        count = bottom - top

        dz_dy = dz_dy[offset:offset + count]
        dz_dx = dz_dx[offset:offset + count]

        # Surface normals describe the direction each terrain patch faces.
        normal_x = -dz_dx
        normal_y = -dz_dy
        normal_z = np.ones_like(normal_x)

        magnitude = np.sqrt(
            normal_x**2 + normal_y**2 + normal_z**2
        )

        # Simulated light from the upper-left of the map.
        light_x = -0.5
        light_y = -0.5
        light_z = 0.70710678

        illumination = (
            normal_x * light_x
            + normal_y * light_y
            + normal_z * light_z
        ) / magnitude

        illumination = np.clip(illumination, 0, 1)
        illumination = 0.45 + 0.55 * illumination

        elevation = section[offset:offset + count]

        # Convert actual elevation to one of 256 colour levels.
        normalized = np.clip(
            (elevation - low) / (high - low or 1), 0, 1
        )

        indices = (normalized * 255).astype(np.uint8)

        # Combine elevation colours with simulated lighting.
        colours = lookup[indices] * illumination[..., None]

        rgba[top:bottom, :, :3] = np.clip(
            colours, 0, 255
        ).astype(np.uint8)

        # Preserve transparency wherever the DEM has no valid data.
        rgba[top:bottom, :, 3] = valid.astype(np.uint8) * 255

    write_png("jezero-elevation.png", rgba, 6)

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
        # Generate a colour elevation layer without changing the original DEM.
    render_elevation(
        samples,
        abs(raster.transform.a),
        abs(raster.transform.e),
        low,
        high
    )
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
