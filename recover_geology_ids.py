
"""Recover numerical geological unit IDs from the existing ARES geology PNG."""

import json
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent

METADATA_PATH = ROOT / "dist" / "jezero-geology.json"
IMAGE_PATH = ROOT / "dist" / "jezero-geology.png"
OUTPUT_PATH = ROOT / "dist" / "jezero-geology-ids.bin"


def main():
    metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))

    width = metadata["dem"]["width"]
    height = metadata["dem"]["height"]

    # Keep the original pixel values, including transparency.
    with Image.open(IMAGE_PATH) as source:
        image = np.asarray(source.convert("RGBA"))

    if image.shape != (height, width, 4):
        raise ValueError("Geology PNG dimensions do not match the DEM.")

    if OUTPUT_PATH.exists():
        raise FileExistsError(
            f"Refusing to overwrite existing file: {OUTPUT_PATH}"
        )

    # Zero means the geological unit is unmapped.
    labels = np.zeros((height, width), dtype=np.uint8)
    mapped = image[:, :, 3] == metadata["mapped_alpha"]
    unmapped = image[:, :, 3] == metadata["unmapped_alpha"]

    if not np.all(mapped | unmapped):
        raise ValueError("Unexpected alpha value in geology PNG.")

    assigned = np.zeros((height, width), dtype=bool)

    for unit in metadata["units"]:
        unit_id = unit["id"]
        color = unit["color"]

        rgb = tuple(bytes.fromhex(color.lstrip("#")))

        matches = mapped & np.all(
            image[:, :, :3] == rgb,
            axis=2
        )

        if np.any(assigned & matches):
            raise ValueError(f"Duplicate classification: {unit['symbol']}")

        actual_count = int(np.count_nonzero(matches))
        expected_count = unit["pixel_count"]

        if actual_count != expected_count:
            raise ValueError(
                f"{unit['symbol']}: expected {expected_count} pixels, "
                f"found {actual_count}"
            )

        labels[matches] = unit_id
        assigned |= matches

        print(f"{unit_id:2}  {unit['symbol']:6}  {actual_count:,} pixels")

    if not np.array_equal(assigned, mapped):
        raise ValueError("Some mapped pixels have unknown geological colors.")

    if int(np.count_nonzero(mapped)) != metadata["coverage"]["mapped_pixels"]:
        raise ValueError("Total mapped pixel count does not match metadata.")

    if int(np.count_nonzero(unmapped)) != metadata["coverage"]["unmapped_pixels"]:
        raise ValueError("Total unmapped pixel count does not match metadata.")

    # Only write the output after every validation has passed.
    labels.tofile(OUTPUT_PATH)

    print(f"\nVerified {width} x {height} geological pixels.")
    print(f"Saved: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
