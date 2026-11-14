"""Inspect GeoTIFFs, align several of them onto one grid, and render their layers.

Nothing is synthesised. Every layer is rendered from a band in a selected file,
and routing products are written only when the routing requirements are met.
Only elevation is used for routing; every other band is shown for reference.

An optional sidecar `<file>.layers.json` declares what each band holds when the
GeoTIFF itself does not say, for example:
    {"bands": {"1": {"kind": "elevation", "units": "m"}}}
"""
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import zlib

import numpy as np
import rasterio
from rasterio.enums import ColorInterp, Resampling
from rasterio.warp import reproject, transform, transform_bounds
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parent
UPLOADS = ROOT / "data"
DATA_DIRS = (ROOT, UPLOADS)
BUILDS = ROOT / "builds"
CURRENT = BUILDS / "current.json"
BUILD_VERSION = 1
EXTENSIONS = (".tif", ".tiff")
MAX_LAYERS_PER_FILE = 6

KINDS = ("elevation", "thermal", "mineral", "imagery")
KEYWORDS = {
    "elevation": r"elev|height|altitude|topo|dem(?![a-z])|dtm|dsm",
    "thermal": r"thermal|temperature|brightness.?temp|themis|inertia|kelvin",
    "mineral": r"mineral|crism|olivine|pyroxene|carbonate|clay|phyllosilicate|sulfate|hydrated",
    "imagery": r"image|imagery|reflectance|albedo|visible|panchromatic|radiance",
}
METRES = {"m": 1.0, "metre": 1.0, "meter": 1.0, "metres": 1.0, "meters": 1.0, "km": 1000.0,
          "kilometre": 1000.0, "kilometer": 1000.0, "ft": 0.3048, "foot": 0.3048, "feet": 0.3048}
ROUTING_REQUIREMENTS = [
    {"id": "elevation", "label": "Elevation band (DEM): a height value for every pixel"},
    {"id": "projected_crs", "label": "Projected coordinate system with linear units, so pixel spacing is a ground distance"},
    {"id": "vertical_units", "label": "Elevation units convertible to metres"},
]
RAMPS = {"thermal": ((40, 40, 160), (255, 150, 60)), "mineral": ((20, 70, 60), (130, 240, 180)),
         "elevation": ((30, 30, 30), (235, 235, 235)), "imagery": ((0, 0, 0), (255, 255, 255)),
         "unknown": ((60, 30, 70), (230, 170, 240))}


# ---------------------------------------------------------------- inspection

def file_id(path):
    return path.relative_to(ROOT).as_posix()


def candidate_paths():
    paths = []
    for folder in DATA_DIRS:
        if folder.is_dir():
            paths += sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS)
    return paths


def resolve(identifier):
    """Map a file id to a path, accepting only files the listing would show."""
    for path in candidate_paths():
        if file_id(path) == identifier:
            return path
    raise ValueError(f"Unknown data file: {identifier}")


def spheroid(crs):
    match = re.search(r'SPHEROID\["[^"]*",\s*([0-9.eE+-]+),\s*([0-9.eE+-]+)', crs.to_wkt())
    if not match:
        return None
    a, inverse_flattening = float(match[1]), float(match[2])
    return a, a * (1 - 1 / inverse_flattening) if inverse_flattening else a


def lonlat_crs(crs):
    axes = spheroid(crs)
    return f"+proj=longlat +a={axes[0]} +b={axes[1]} +no_defs" if axes else None


def linear_units(crs):
    if not (crs and crs.is_projected):
        return None, None
    try:
        return crs.linear_units_factor
    except Exception:
        name = crs.linear_units
        return name, METRES.get((name or "").lower())


def classify(text):
    text = (text or "").lower()
    for kind in KINDS:
        if re.search(KEYWORDS[kind], text):
            return kind
    return None


def describe_bands(raster, path):
    sidecar = path.with_suffix(".layers.json")
    declared = {}
    if sidecar.exists():
        declared = json.loads(sidecar.read_text()).get("bands", {})
    bands = []
    for index in range(1, raster.count + 1):
        description = raster.descriptions[index - 1]
        units = raster.units[index - 1] or None
        tags = " ".join(f"{k} {v}" for k, v in raster.tags(index).items())
        interp = raster.colorinterp[index - 1]
        band = dict(band=index, dtype=raster.dtypes[index - 1], description=description, units=units,
                    colour=interp.name, kind=None, identifiedBy=None)
        declaration = declared.get(str(index))
        if declaration:
            band["kind"] = declaration.get("kind")
            band["units"] = declaration.get("units", units)
            band["identifiedBy"] = f"declared in {sidecar.name}"
        elif classify(f"{description} {tags}"):
            band["kind"], band["identifiedBy"] = classify(f"{description} {tags}"), "band description or metadata"
        elif units and units.lower() in ("k", "kelvin"):
            band["kind"], band["identifiedBy"] = "thermal", "band units (kelvin)"
        elif interp in (ColorInterp.red, ColorInterp.green, ColorInterp.blue):
            band["kind"], band["identifiedBy"] = "imagery", f"colour interpretation ({interp.name})"
        elif raster.count == 1 and classify(f"{path.stem} {raster.tags()}"):
            band["kind"], band["identifiedBy"] = classify(f"{path.stem} {raster.tags()}"), f"file name '{path.name}'"
        if band["kind"] not in KINDS:
            band["kind"], band["identifiedBy"] = "unknown", band["identifiedBy"] or "nothing in the file describes it"
        bands.append(band)
    return bands


_inspections = {}


def inspect(path):
    stat = path.stat()
    cache_key = (str(path), stat.st_size, stat.st_mtime_ns)
    if cache_key in _inspections:
        return _inspections[cache_key]
    info = dict(id=file_id(path), name=path.name, folder=path.parent.relative_to(ROOT).as_posix() or ".",
                sizeBytes=stat.st_size, modified=stat.st_mtime, readable=False, error=None)
    try:
        with rasterio.open(path) as raster:
            # A truncated download opens normally and fails only when its last rows are read.
            try:
                raster.read(1, window=Window(0, raster.height - 1, raster.width, 1))
            except Exception:
                raise ValueError("The file is incomplete or damaged (pixel data ends early). Download it again.")
            units_name, factor = linear_units(raster.crs)
            info.update(width=raster.width, height=raster.height, bandCount=raster.count,
                        crs=raster.crs.to_wkt().split('"')[1] if raster.crs else None,
                        projected=bool(raster.crs and raster.crs.is_projected), horizontalUnits=units_name,
                        pixelSizeM=[abs(raster.transform.a) * factor, abs(raster.transform.e) * factor] if factor else None,
                        nativePixelSize=[abs(raster.transform.a), abs(raster.transform.e)],
                        bands=describe_bands(raster, path), readable=True)
            if raster.crs and lonlat_crs(raster.crs):
                west, south, east, north = transform_bounds(raster.crs, lonlat_crs(raster.crs), *raster.bounds)
                info["lonLatBounds"] = [round(v, 4) for v in (west, south, east, north)]
            if not raster.crs:
                info["error"] = "No coordinate system: the file cannot be aligned with other files."
    except Exception as error:
        info["error"] = str(error).splitlines()[0][:200]
        info["readable"] = False
    _inspections[cache_key] = info
    return info


def list_files():
    return [inspect(path) for path in candidate_paths()]


# ----------------------------------------------------------------- alignment

def plan(identifiers):
    """Choose a reference grid and describe how each selected file lands on it."""
    if not identifiers:
        raise ValueError("Select at least one data file.")
    infos = [inspect(resolve(identifier)) for identifier in dict.fromkeys(identifiers)]
    usable = [info for info in infos if info["readable"] and not info["error"]]
    if not usable:
        raise ValueError("None of the selected files can be read.")

    def pixel(info):
        return info["pixelSizeM"][0] if info["pixelSizeM"] else float("inf")

    projected = [info for info in usable if info["pixelSizeM"]]
    with_elevation = [info for info in projected if any(b["kind"] == "elevation" for b in info["bands"])]
    reference = min(with_elevation or projected or usable, key=pixel)
    with rasterio.open(resolve(reference["id"])) as ref:
        ref_crs, ref_bounds, ref_axes = ref.crs, ref.bounds, spheroid(ref.crs)
    ref_area = (ref_bounds.right - ref_bounds.left) * (ref_bounds.top - ref_bounds.bottom)

    files = []
    for info in infos:
        entry = dict(id=info["id"], name=info["name"], nativePixelSizeM=info.get("pixelSizeM"),
                     bandCount=info.get("bandCount"), role="excluded", reason=None, reprojected=False)
        if info is reference:
            entry.update(role="reference", footprint=list(ref_bounds), coversPercent=100.0, insidePercent=100.0)
        elif not info["readable"] or info["error"]:
            entry["reason"] = info["error"] or "File cannot be read."
        else:
            with rasterio.open(resolve(info["id"])) as src:
                axes = spheroid(src.crs)
                if not axes or not ref_axes or abs(axes[0] - ref_axes[0]) / ref_axes[0] > 0.01:
                    entry["reason"] = (f"Different planetary body or ellipsoid (radius {axes[0] / 1000:.0f} km vs "
                                       f"{ref_axes[0] / 1000:.0f} km)" if axes and ref_axes else "Ellipsoid unknown")
                else:
                    left, bottom, right, top = transform_bounds(src.crs, ref_crs, *src.bounds)
                    entry["footprint"] = [left, bottom, right, top]
                    width = min(right, ref_bounds.right) - max(left, ref_bounds.left)
                    height = min(top, ref_bounds.top) - max(bottom, ref_bounds.bottom)
                    overlap = max(0, width) * max(0, height)
                    area = (right - left) * (top - bottom) or 1
                    entry["coversPercent"] = round(100 * overlap / ref_area, 1)
                    entry["insidePercent"] = round(100 * overlap / area, 1)
                    if overlap <= 0:
                        entry["reason"] = "Does not overlap the reference area."
                    else:
                        entry["role"] = "aligned"
                        entry["reprojected"] = True
        files.append(entry)
    units_name, factor = linear_units(ref_crs)
    grid = dict(reference=reference["id"], crs=reference["crs"], bounds=list(ref_bounds),
                pixelSizeM=reference["pixelSizeM"], width=reference["width"], height=reference["height"],
                projected=reference["projected"], horizontalUnits=units_name)
    return dict(grid=grid, files=files)


# --------------------------------------------------------------------- build

def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def write_png(path, pixels, color_type):
    height, width = pixels.shape[:2]
    rows = b"".join(b"\x00" + row.tobytes() for row in pixels)
    header = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header)
                     + png_chunk(b"IDAT", zlib.compress(rows, 3)) + png_chunk(b"IEND", b""))


def normalise(values):
    finite = values[np.isfinite(values)]
    if not finite.size:
        return np.zeros(values.shape, np.uint8)
    low, high = np.percentile(finite, (2, 98))
    scaled = (np.nan_to_num(values, nan=low) - low) / (high - low or 1)
    return np.round(np.clip(scaled, 0, 1) * 255).astype(np.uint8)


def colour(values, kind):
    level = normalise(values).astype(np.float32) / 255
    low, high = RAMPS.get(kind, RAMPS["unknown"])
    return [np.round(low[c] + (high[c] - low[c]) * level).astype(np.uint8) for c in range(3)]


def selection_key(identifiers):
    parts = [BUILD_VERSION]
    for identifier in dict.fromkeys(identifiers):
        stat = resolve(identifier).stat()
        parts.append([identifier, stat.st_size, stat.st_mtime_ns])
    return hashlib.sha1(json.dumps(parts).encode()).hexdigest()[:16]


def read_on_grid(src, index, ref, is_reference):
    """Return one band on the reference grid, with nodata as NaN and scale/offset applied."""
    if is_reference:
        values = src.read(index, masked=True).astype(np.float32).filled(np.nan)
    else:
        values = np.full((ref.height, ref.width), np.nan, np.float32)
        continuous = np.dtype(src.dtypes[index - 1]).kind == "f"
        reproject(source=rasterio.band(src, index), destination=values,
                  src_transform=src.transform, src_crs=src.crs, src_nodata=src.nodata,
                  dst_transform=ref.transform, dst_crs=ref.crs, dst_nodata=np.nan,
                  resampling=Resampling.bilinear if continuous else Resampling.nearest)
    scale, offset = src.scales[index - 1], src.offsets[index - 1]
    if scale != 1 or offset != 0:
        values = values * scale + offset
    return values


def build(identifiers, progress=lambda message, step, total: None):
    identifiers = list(dict.fromkeys(identifiers))
    key = selection_key(identifiers)
    out = BUILDS / key
    if (out / "meta.json").exists():
        progress("Using the previously prepared copy of this selection.", 1, 1)
        return json.loads((out / "meta.json").read_text())
    layout = plan(identifiers)
    included = [f for f in layout["files"] if f["role"] in ("reference", "aligned")]
    infos = {f["id"]: inspect(resolve(f["id"])) for f in included}
    rendered = {f["id"]: infos[f["id"]]["bands"][:MAX_LAYERS_PER_FILE] for f in included}
    total = sum(len(bands) for bands in rendered.values()) + 5
    step = 0

    def advance(message):
        nonlocal step
        step += 1
        progress(message, step, total)

    work = BUILDS / f"{key}.partial"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    reference_id = layout["grid"]["reference"]
    with rasterio.open(resolve(reference_id)) as ref:
        units_name, factor = linear_units(ref.crs)
        dx = abs(ref.transform.a) * (factor or 1)
        dy = abs(ref.transform.e) * (factor or 1)
        file_entries, layers, elevation, elevation_values = [], [], None, None
        for entry in layout["files"]:
            info = inspect(resolve(entry["id"]))
            record = {**entry, "bands": []}
            file_entries.append(record)
            if entry["role"] == "excluded":
                continue
            bands = info["bands"]
            with rasterio.open(resolve(entry["id"])) as src:
                rgb = [b["band"] for b in bands if b["kind"] == "imagery" and b["colour"] in ("red", "green", "blue")]
                rgb_values = {}
                for band in bands:
                    stats = dict(band)
                    record["bands"].append(stats)
                    if band["band"] > MAX_LAYERS_PER_FILE:
                        stats["use"] = f"Not rendered (only the first {MAX_LAYERS_PER_FILE} bands of a file are shown)"
                        continue
                    action = "Reading" if entry["role"] == "reference" else "Reprojecting"
                    advance(f"{action} band {band['band']} of {entry['name']} onto the reference grid")
                    values = read_on_grid(src, band["band"], ref, entry["role"] == "reference")
                    valid = values[np.isfinite(values)]
                    stats.update(min=float(valid.min()) if valid.size else None,
                                 max=float(valid.max()) if valid.size else None,
                                 gridCoveragePercent=round(100 * valid.size / values.size, 2))
                    if not valid.size:
                        stats["use"] = "No valid pixels on the reference grid"
                        continue
                    if band["kind"] == "elevation" and elevation is None:
                        elevation = dict(file=entry["name"], fileId=entry["id"], band=band["band"],
                                         identifiedBy=band["identifiedBy"], units=band["units"],
                                         reprojected=entry["role"] != "reference", assumptions=[])
                        elevation_values = values
                        stats["use"] = "Used for route calculations"
                        continue
                    if band["band"] in rgb and len(rgb) == 3:
                        rgb_values[band["band"]] = values
                        stats["use"] = "Shown as imagery; not used in route calculations"
                        continue
                    stats["use"] = "Shown only; not used in route calculations"
                    if band["kind"] == "elevation":
                        stats["use"] = "Shown only; another elevation band is used for routing"
                    layer_id = f"layer-{len(layers) + 1}"
                    channels = colour(values, band["kind"])
                    alpha = np.where(np.isfinite(values), 210, 0).astype(np.uint8)
                    write_png(work / f"{layer_id}.png", np.stack((*channels, alpha), axis=-1), 6)
                    layers.append(dict(id=layer_id, kind=band["kind"], file=entry["name"], fileId=entry["id"],
                                       bands=[band["band"]], identifiedBy=band["identifiedBy"], units=band["units"],
                                       image=f"{layer_id}.png", coveragePercent=stats["gridCoveragePercent"]))
                if len(rgb_values) == 3:
                    stack = [rgb_values[b] for b in sorted(rgb_values, key=lambda b: ("red", "green", "blue").index(
                        next(x["colour"] for x in bands if x["band"] == b)))]
                    layer_id = f"layer-{len(layers) + 1}"
                    alpha = np.where(np.isfinite(stack[0]), 255, 0).astype(np.uint8)
                    write_png(work / f"{layer_id}.png", np.stack((*[normalise(v) for v in stack], alpha), axis=-1), 6)
                    layers.append(dict(id=layer_id, kind="imagery", file=entry["name"], fileId=entry["id"],
                                       bands=sorted(rgb_values), identifiedBy="colour interpretation (red, green, blue)",
                                       units=None, image=f"{layer_id}.png",
                                       coveragePercent=round(100 * np.isfinite(stack[0]).mean(), 2)))

        missing, vertical = [], None
        if elevation is None:
            missing.append("elevation")
        else:
            unit = (elevation["units"] or "").lower()
            if not unit:
                vertical = 1.0
                elevation["assumptions"].append("Elevation units are not stated in the file; metres assumed.")
            elif unit in METRES:
                vertical = METRES[unit]
            else:
                missing.append("vertical_units")
        if not factor:
            missing.append("projected_crs")
        routing = dict(available=not missing, requires=ROUTING_REQUIREMENTS, missing=missing)

        meta = dict(key=key, version=BUILD_VERSION, buildUrl=f"/builds/{key}", width=ref.width, height=ref.height,
                    dx=dx, dy=dy, crs=layout["grid"]["crs"], horizontalUnits=units_name,
                    source=" + ".join(f["name"] for f in included), referenceFile=layout["grid"]["reference"],
                    files=file_entries, layers=layers, elevation=elevation or {"available": False},
                    routing=routing, baseImage=None, baseLayer=None)
        if elevation:
            elevation["available"] = True
        if lonlat_crs(ref.crs):
            west, south, east, north = transform_bounds(ref.crs, lonlat_crs(ref.crs), *ref.bounds)
            meta["lonLatBounds"] = [round(v, 4) for v in (west, south, east, north)]

        advance("Drawing the base map")
        if elevation_values is not None:
            heights = elevation_values * (vertical or 1)
            valid = heights[np.isfinite(heights)]
            low, high = float(valid.min()), float(valid.max())
            meta.update(minimum=low, maximum=high)
            shade = np.round((np.nan_to_num(heights, nan=low) - low) * 255 / (high - low or 1)).astype(np.uint8)
            alpha = np.where(np.isfinite(heights), 255, 0).astype(np.uint8)
            write_png(work / "base.png", np.stack((shade, alpha), axis=-1), 4)
            meta.update(baseImage="base.png", baseLayer="elevation")
        elif layers:
            shutil.copyfile(work / layers[0]["image"], work / "base.png")
            meta.update(baseImage="base.png", baseLayer=layers[0]["id"])

        derived = dict(slope=False, hazards=False, contours=False)
        if routing["available"]:
            advance("Saving elevation for route calculations")
            heights.astype("<f4").tofile(work / "elevation.f32")
            advance("Computing slope hazards from elevation")
            grades = np.zeros_like(heights)
            for oy, ox in ((0, 1), (1, -1), (1, 0), (1, 1)):
                a = np.s_[max(0, -oy):ref.height - max(0, oy), max(0, -ox):ref.width - max(0, ox)]
                b = np.s_[max(0, oy):ref.height - max(0, -oy), max(0, ox):ref.width - max(0, -ox)]
                grade = np.abs(heights[a] - heights[b]) / np.hypot(ox * dx, oy * dy)
                np.fmax(grades[a], grade, out=grades[a])
                np.fmax(grades[b], grade, out=grades[b])
            overlay = np.zeros((*heights.shape, 4), dtype=np.uint8)
            overlay[grades > np.tan(np.deg2rad(10))] = (255, 192, 72, 150)
            overlay[grades > np.tan(np.deg2rad(18))] = (255, 81, 69, 200)
            write_png(work / "hazards.png", overlay, 6)
            del grades
            advance("Drawing 50 m contours from elevation")
            bands_50m = np.floor(heights / 50)
            contours = np.zeros(heights.shape, dtype=bool)
            contours[:, 1:] |= np.isfinite(bands_50m[:, 1:]) & np.isfinite(bands_50m[:, :-1]) & (bands_50m[:, 1:] != bands_50m[:, :-1])
            contours[1:, :] |= np.isfinite(bands_50m[1:, :]) & np.isfinite(bands_50m[:-1, :]) & (bands_50m[1:, :] != bands_50m[:-1, :])
            overlay.fill(0)
            overlay[contours] = (228, 212, 172, 145)
            write_png(work / "contours.png", overlay, 6)
            derived = dict(slope=True, hazards=True, contours=True)
        meta["derived"] = derived

        col, row = ref.width // 2, ref.height // 2
        if lonlat_crs(ref.crs):
            xs, ys = transform(lonlat_crs(ref.crs), ref.crs, [77.40], [18.47])
            jezero_row, jezero_col = ref.index(xs[0], ys[0])
            if 0 <= jezero_row < ref.height and 0 <= jezero_col < ref.width:
                row, col = jezero_row, jezero_col
        meta["cropOrigin"] = [max(0, min(col - 120, ref.width - 240)), max(0, min(row - 84, ref.height - 168))]

    advance("Finishing")
    (work / "meta.json").write_text(json.dumps(meta, indent=1))
    shutil.rmtree(out, ignore_errors=True)
    work.rename(out)
    return meta


def set_current(meta, identifiers):
    BUILDS.mkdir(exist_ok=True)
    CURRENT.write_text(json.dumps({"key": meta["key"], "files": list(dict.fromkeys(identifiers))}))


def load_current():
    try:
        pointer = json.loads(CURRENT.read_text())
        return json.loads((BUILDS / pointer["key"] / "meta.json").read_text())
    except (FileNotFoundError, KeyError, ValueError):
        return None
