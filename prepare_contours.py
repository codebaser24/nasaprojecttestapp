"""Generate interpolated topographic contours from the Mars CTX DEM.

Minor contours: every 50 metres.
Major contours: every 250 metres.

The output is a transparent PNG at the DEM's native resolution.
This script does not modify the source DEM or existing ARES overlays.
"""

from pathlib import Path
import argparse
import time

import contourpy
import numpy as np
import rasterio
from PIL import Image, ImageDraw

MINOR_INTERVAL = 50
MAJOR_INTERVAL = 250

# Major contours are brighter and thicker than minor contours.
MINOR_COLOR = (240, 226, 195, 135)
MAJOR_COLOR = (255, 247, 218, 225)

OUTPUT = Path(__file__).resolve().parent / "dist" / "jezero-contours-v2.png"


def generate_contours(source):
    started = time.perf_counter()

    print("Opening CTX DEM...")

    with rasterio.open(source) as raster:
        # Read the DEM at its original resolution.
        # Masked values represent locations without valid elevation data.
        elevation = raster.read(1, masked=True)

        height, width = elevation.shape
        valid_values = elevation.compressed()

        if valid_values.size == 0:
            raise ValueError("The DEM contains no valid elevation samples.")

        minimum = float(valid_values.min())
        maximum = float(valid_values.max())

        print(f"DEM dimensions: {width} x {height}")
        print(f"Elevation range: {minimum:.2f} to {maximum:.2f} m")

        # ContourPy uses the DEM's row and column coordinates by default.
        # This keeps the output aligned with the original raster.
        #
        # corner_mask=False prevents contour segments from crossing
        # cells containing masked (invalid) elevation samples.
        #
        # Chunking limits the size of individual contour calculations.
        generator = contourpy.contour_generator(
            z=elevation,
            name="serial",
            line_type="Separate",
            corner_mask=False,
            chunk_size=256,
        )

        # Transparent RGBA output, matching the original DEM dimensions.
        image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)

        # Begin at the first 50 m multiple inside the DEM range.
        first_level = int(np.ceil(minimum / MINOR_INTERVAL)) * MINOR_INTERVAL

        last_level = int(np.floor(maximum / MINOR_INTERVAL)) * MINOR_INTERVAL

        levels = range(
            first_level,
            last_level + 1,
            MINOR_INTERVAL,
        )

        print("Generating interpolated contours...")

        minor_count = 0
        major_count = 0

        for level in levels:
            # Marching squares interpolates the positions at which
            # the terrain crosses this exact elevation.
            lines = generator.lines(level)

            is_major = level % MAJOR_INTERVAL == 0

            color = MAJOR_COLOR if is_major else MINOR_COLOR
            thickness = 2 if is_major else 1

            segment_count = 0

            for line in lines:
                if len(line) < 2:
                    continue

                # ContourPy returns (column, row) coordinate pairs.
                # Pillow expects the same (x, y) ordering.
                draw.line(
                    [tuple(point) for point in line],
                    fill=color,
                    width=thickness,
                    joint="curve",
                )

                segment_count += 1

            if is_major:
                major_count += 1
            else:
                minor_count += 1

            print(f"Elevation {level:6d} m | " f"{segment_count} contour paths")

            # Each level's coordinate arrays can be released before
            # calculating the next level.
            del lines

        OUTPUT.parent.mkdir(parents=True, exist_ok=True)

        # Save a separate image so the original overlay remains intact.
        image.save(OUTPUT, optimize=True)

        elapsed = time.perf_counter() - started

        print()
        print("Contour generation completed.")
        print(f"Minor levels: {minor_count}")
        print(f"Major levels: {major_count}")
        print(f"Output: {OUTPUT}")
        print(f"Processing time: {elapsed:.1f} seconds")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate interpolated contours for ARES."
    )

    parser.add_argument(
        "dem",
        type=Path,
        help="Path to the original CTX DEM GeoTIFF",
    )

    args = parser.parse_args()

    if not args.dem.is_file():
        parser.error(f"DEM not found: {args.dem}")

    generate_contours(args.dem)
