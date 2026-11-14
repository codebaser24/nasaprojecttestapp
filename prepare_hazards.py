"""Generate slope-based hazard classifications from the Jezero CTX DEM.

The overlay represents maximum local neighboring slope, not guaranteed
rover safety. Missing DEM measurements are excluded from calculations.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "dist"

# Slope thresholds in degrees, matching ARES route-profile limits.
LOW_LIMIT = 10.0
BALANCED_LIMIT = 18.0
SHORTEST_LIMIT = 22.0

# RGBA colours. Low-slope and unknown pixels remain transparent.
COLORS = {
    0: (0, 0, 0, 0),
    1: (255, 192, 72, 155),
    2: (255, 110, 65, 195),
    3: (174, 45, 72, 220),
}


def generate_hazards(source):
    OUTPUT.mkdir(parents=True, exist_ok=True)

    with rasterio.open(source) as raster:
        # Read native-resolution elevation values and their validity mask.
        elevation = raster.read(1, masked=True).astype(np.float32)
        invalid = np.ma.getmaskarray(elevation)
        values = elevation.filled(np.nan)

        height, width = values.shape
        dx = abs(raster.transform.a)
        dy = abs(raster.transform.e)

        print(f"DEM: {width} x {height}")
        print(f"Pixel spacing: {dx} m x {dy} m")

        # Maximum absolute grade at each pixel.
        # NaN initially means no valid neighboring slope is available.
        max_grade = np.full((height, width), np.nan, dtype=np.float32)

        # Four unique undirected directions cover all eight neighbors
        # because each valid comparison updates both endpoints.
        directions = (
            (0, 1),
            (1, -1),
            (1, 0),
            (1, 1),
        )

        for oy, ox in directions:
            # Slice two overlapping DEM regions separated by (ox, oy).
            a = np.s_[
                max(0, -oy) : height - max(0, oy),
                max(0, -ox) : width - max(0, ox),
            ]

            b = np.s_[
                max(0, oy) : height - max(0, -oy),
                max(0, ox) : width - max(0, -ox),
            ]

            run = np.hypot(ox * dx, oy * dy)

            # Invalid comparisons remain NaN and are ignored.
            grade = np.abs(values[a] - values[b]) / run

            # Update both endpoints using valid neighboring comparisons.
            np.fmax(max_grade[a], grade, out=max_grade[a])
            np.fmax(max_grade[b], grade, out=max_grade[b])

        # Classification using grade thresholds avoids repeatedly
        # calculating arctan for every DEM pixel.
        classes = np.zeros((height, width), dtype=np.uint8)

        classes[max_grade > np.tan(np.deg2rad(LOW_LIMIT))] = 1
        classes[max_grade > np.tan(np.deg2rad(BALANCED_LIMIT))] = 2
        classes[max_grade > np.tan(np.deg2rad(SHORTEST_LIMIT))] = 3

        # A separate validity mask distinguishes unknown from low slope.
        known = np.isfinite(max_grade) & ~invalid

        # Classification 255 means unknown, rather than safe.
        classes[~known] = 255

        # Create a transparent image with coloured hazard categories.
        image = np.zeros((height, width, 4), dtype=np.uint8)

        for category, color in COLORS.items():
            if category == 0:
                continue
            image[classes == category] = color

        output_image = OUTPUT / "jezero-hazards-v2.png"
        Image.fromarray(image, mode="RGBA").save(output_image)

        counts = {
            "low": int(np.count_nonzero(classes == 0)),
            "moderate": int(np.count_nonzero(classes == 1)),
            "steep": int(np.count_nonzero(classes == 2)),
            "very_steep": int(np.count_nonzero(classes == 3)),
            "unknown": int(np.count_nonzero(classes == 255)),
        }

        metadata = {
            "source": raster.name,
            "method": "Maximum absolute slope to valid neighboring DEM pixels",
            "units": "degrees",
            "pixel_spacing_m": [dx, dy],
            "thresholds_deg": {
                "moderate_above": LOW_LIMIT,
                "steep_above": BALANCED_LIMIT,
                "very_steep_above": SHORTEST_LIMIT,
            },
            "classes": counts,
            "notes": (
                "The overlay represents local slope exposure, not "
                "guaranteed rover traversability. Unknown terrain is "
                "tracked separately from low-slope terrain."
            ),
        }

        output_metadata = OUTPUT / "jezero-hazards-v2.json"
        output_metadata.write_text(
            json.dumps(metadata, indent=2),
            encoding="utf-8",
        )

        print("Hazard classification completed.")
        print(json.dumps(counts, indent=2))
        print(f"Image: {output_image}")
        print(f"Metadata: {output_metadata}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate CTX DEM slope-hazard classifications."
    )

    parser.add_argument(
        "dem",
        type=Path,
        help="Path to the source CTX DEM GeoTIFF",
    )

    args = parser.parse_args()

    if not args.dem.is_file():
        parser.error(f"DEM not found: {args.dem}")

    generate_hazards(args.dem)
