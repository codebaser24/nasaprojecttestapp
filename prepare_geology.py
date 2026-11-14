
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image
import pyogrio
from pyogrio.raw import read as read_features
from pyproj import CRS, Transformer
import rasterio
from rasterio.features import rasterize
from shapely import from_wkb, make_valid
from shapely.geometry import mapping
from shapely.ops import transform as transform_shape

ROOT = Path(__file__).resolve().parent
DEM = ROOT / "M20_JezeroCrater_CTXDEM_20m.tif"
OUT_IMAGE = ROOT / "dist" / "jezero-geology.png"
OUT_JSON = ROOT / "dist" / "jezero-geology.json"
LAYER = "GeoUnits_v1"

# Display palette only. NOT authoritative USGS symbology or mineral detection.
COLORS = [
    "#d79a80", "#7bb0a4", "#c2b077", "#a79bcf", "#d1a6c0",
    "#91a8d3", "#b5be83", "#e2b66f", "#8cbcc8", "#d09a9c",
    "#a6a0a0", "#b4a0d2", "#a6c6a0", "#d8c18e",
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gdb", type=Path, help="Path to the extracted USGS Nili.gdb directory")
    args = parser.parse_args()

    if not args.gdb.is_dir():
        parser.error(f"Geodatabase directory not found: {args.gdb}")
    if not DEM.is_file():
        parser.error(f"DEM not found: {DEM}")
    for output in (OUT_IMAGE, OUT_JSON):
        if output.exists():
            parser.error(f"Refusing to overwrite existing output: {output}")

    info = pyogrio.read_info(args.gdb, layer=LAYER)
    source_crs = info.get("crs")
    if not source_crs:
        raise RuntimeError("USGS layer has no CRS; refusing to guess coordinates")

    # raw.read supplies WKB geometries and feature attributes without requiring geopandas.
    meta, fids, wkbs, fields = read_features(
        args.gdb, layer=LAYER, columns=["unit", "name", "symbol"],
        return_fids=True,
    )
    names = list(meta["fields"])
    attributes = dict(zip(names, fields))
    for required in ("unit", "name", "symbol"):
        if required not in attributes:
            raise RuntimeError(f"Missing expected geological attribute: {required}; got {names}")

    with rasterio.open(DEM) as dem:
        width, height = dem.width, dem.height
        transform = dem.transform
        target_crs = dem.crs
        pixel_area_m2 = abs(transform.a * transform.e - transform.b * transform.d)
        if target_crs is None:
            raise RuntimeError("DEM has no CRS")
        if not (width > 0 and height > 0):
            raise RuntimeError("DEM has invalid dimensions")

    transformer = Transformer.from_crs(CRS.from_user_input(source_crs), target_crs, always_xy=True)
    records = []
    repaired_fids = []
    skipped_empty = []
    unit_details = {}
    for index, wkb in enumerate(wkbs):
        fid = int(fids[index])
        if wkb is None:
            skipped_empty.append(fid)
            continue
        geom = from_wkb(wkb)
        if not geom.is_valid:
            geom = make_valid(geom)
            repaired_fids.append(fid)
        if geom.is_empty or not geom.is_valid:
            raise RuntimeError(f"Feature FID {fid} could not be repaired")
        symbol = str(attributes["symbol"][index]).strip()
        if not symbol or symbol.lower() in ("none", "nan"):
            raise RuntimeError(f"Feature FID {fid} has no geological symbol")
        unit_name = str(attributes["name"][index]).strip()
        unit_code = str(attributes["unit"][index]).strip()
        detail = unit_details.setdefault(symbol, {"symbol": symbol, "names": set(), "unit_codes": set(), "features": 0})
        detail["names"].add(unit_name)
        detail["unit_codes"].add(unit_code)
        detail["features"] += 1
        projected = transform_shape(transformer.transform, geom)
        if projected.is_empty or not projected.is_valid:
            raise RuntimeError(f"Feature FID {fid} invalid after reprojection")
        records.append((mapping(projected), symbol))

    symbols = sorted(unit_details)
    if len(symbols) > len(COLORS):
        raise RuntimeError(f"Need {len(symbols)} colours; palette has {len(COLORS)}")
    if len(symbols) != 14:
        raise RuntimeError(f"Expected 14 geological symbols from USGS GeoUnits_v1; found {len(symbols)}: {symbols}")
    ids = {symbol: i + 1 for i, symbol in enumerate(symbols)}
    labels = rasterize(
        ((geometry, ids[symbol]) for geometry, symbol in records),
        out_shape=(height, width), transform=transform,
        fill=0, dtype="uint8", all_touched=False,
    )
    # Alpha=0 means no USGS geological classification, NOT absence of geology.
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    counts = np.bincount(labels.ravel(), minlength=len(symbols) + 1)
    units = []
    for i, symbol in enumerate(symbols, start=1):
        color = COLORS[i - 1]
        rgba[labels == i, :3] = tuple(bytes.fromhex(color[1:]))
        rgba[labels == i, 3] = 170
        detail = unit_details[symbol]
        units.append({
            "id": i,
            "symbol": symbol,
            "names": sorted(detail["names"]),
            "unit_codes": sorted(detail["unit_codes"]),
            "color": color,
            "feature_count": detail["features"],
            "pixel_count": int(counts[i]),
        })

    mapped_pixels = int(np.count_nonzero(labels))
    if mapped_pixels == 0:
        raise RuntimeError("No geology overlaps the DEM; check coordinate systems")
    metadata = {
        "schema": "ares-geology-v1",
        "source": {
            "agency": "U.S. Geological Survey",
            "publication": "Sun and Stack (2020), USGS Scientific Investigations Map 3464",
            "database": "sim3464_database.zip / Nili.gdb",
            "layer": LAYER,
            "url": "https://pubs.usgs.gov/sim/3464/",
        },
        "interpretation": "Geological map units, not direct mineral detections or rover safety ratings",
        "palette_note": "ARES visualization colours; not official USGS map colours",
        "dem": {
            "filename": DEM.name,
            "width": width, "height": height,
            "crs_wkt": target_crs.to_wkt(),
            "affine_gdal": list(transform.to_gdal()),
            "pixel_area_m2": pixel_area_m2,
        },
        "image": OUT_IMAGE.name,
        "unmapped_alpha": 0,
        "mapped_alpha": 170,
        "coverage": {
            "mapped_pixels": mapped_pixels,
            "unmapped_pixels": int(counts[0]),
            "mapped_fraction": round(mapped_pixels / (width * height), 6),
            "mapped_area_km2": round(mapped_pixels * pixel_area_m2 / 1_000_000, 3),
        },
        "geometry": {
            "input_features": len(wkbs),
            "processed_features": len(records),
            "repaired_fids": repaired_fids,
            "skipped_empty_fids": skipped_empty,
        },
        "units": units,
    }
    OUT_IMAGE.parent.mkdir(parents=True, exist_ok=True)
    # Generate both in memory first; do not overwrite any existing artifacts.
    Image.fromarray(rgba, mode="RGBA").save(OUT_IMAGE, optimize=True)
    OUT_JSON.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Generated {OUT_IMAGE.relative_to(ROOT)} ({width} x {height})")
    print(f"Generated {OUT_JSON.relative_to(ROOT)} ({len(units)} units)")
    print(f"Features: {len(records)}/{len(wkbs)}; repaired FIDs: {repaired_fids}")
    print(f"Mapped pixels: {mapped_pixels:,} ({100 * mapped_pixels / (width * height):.2f}%)")
    print("NEXT: verify output visually against DEM and official USGS reference before UI integration.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
