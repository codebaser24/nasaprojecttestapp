"""Inspect GeoTIFFs, align several of them onto one grid, and render their layers.

Nothing is synthesised. Every layer is rendered from a band in a selected file,
and routing products are written only when the routing requirements are met.
Only elevation is used for routing; every other band is shown for reference.

An optional sidecar `<file>.layers.json` describes the file when the GeoTIFF
itself does not, for example:
    {"source": {"citation": "...", "license": "...", "url": "..."},
     "bands": {"1": {"kind": "mineral", "note": "...",
                     "classes": {"2": {"name": "Olivine"}, "1": {"name": "Rim", "hidden": true}}}}}
Bands with a colour table, or with declared classes, are drawn as class maps.

Methods adapted from teammates' branches: the hillshaded elevation colours,
three-level slope hazards and interpolated contours come from Gihan Kesara's
prepare_full_dem.py, prepare_hazards.py and prepare_contours.py (kesara branch).
"""
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import zlib

import contourpy
import numpy as np
from PIL import Image, ImageDraw
import rasterio
from rasterio.enums import ColorInterp, Resampling
from rasterio.warp import reproject, transform, transform_bounds
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parent
UPLOADS = ROOT / "data"
INCLUDED = ROOT / "included-data"  # Data files that come with the repository.
DATA_DIRS = (INCLUDED, ROOT, UPLOADS)
BUILDS = ROOT / "builds"
CURRENT = BUILDS / "current.json"
MISSION = ROOT / "mission.json"
BUILD_VERSION = 4
EXTENSIONS = (".tif", ".tiff")
MAX_LAYERS_PER_FILE = 6
MAX_CLASSES = 64

# Checked in this order, so a "CRISM geologic map" counts as mineral data.
KINDS = ("elevation", "thermal", "mineral", "geology", "imagery")
KEYWORDS = {
    "elevation": r"elev|height|altitude|topo|dem(?![a-z])|dtm|dsm",
    "thermal": r"thermal|temperature|brightness.?temp|themis|inertia|kelvin",
    "mineral": r"mineral|crism|olivine|pyroxene|carbonate|clay|phyllosilicate|sulfate|hydrated",
    "geology": r"geolog|litholog|geo.?units?",
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
         "geology": ((70, 50, 40), (230, 200, 160)),
         "elevation": ((30, 30, 30), (235, 235, 235)), "imagery": ((0, 0, 0), (255, 255, 255)),
         "unknown": ((60, 30, 70), (230, 170, 240))}
# Display colours for classes that neither the file nor its sidecar colours.
CLASS_COLOURS = ("#e6a23c", "#63d92a", "#3dbae8", "#962dc4", "#e92d23", "#d1a6c0", "#8cbcc8", "#b5be83",
                 "#e2b66f", "#91a8d3", "#a6c6a0", "#d79a80")
# Elevation colours from low to high (visualisation colours, not surface colours).
ELEVATION_PALETTE = ((35, 55, 72), (57, 111, 112), (132, 151, 111), (194, 157, 104), (239, 218, 177))
HAZARD_CLASSES = ((10, "Moderate: steeper than 10° (above the lower-slope route limit)", (255, 192, 72, 155)),
                  (18, "Steep: steeper than 18° (above the balanced route limit)", (255, 110, 65, 195)),
                  (22, "Very steep: steeper than 22° (above every route limit)", (174, 45, 72, 220)))
CONTOUR_MINOR_M, CONTOUR_MAJOR_M = 50, 250
CONTOUR_MINOR_COLOUR, CONTOUR_MAJOR_COLOUR = (240, 226, 195, 135), (255, 247, 218, 225)


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


def sidecar_path(path):
    return path.with_suffix(".layers.json")


def read_sidecar(path):
    sidecar = sidecar_path(path)
    if not sidecar.exists():
        return {}
    try:
        return json.loads(sidecar.read_text(encoding="utf-8"))
    except ValueError as error:
        raise ValueError(f"{sidecar.name} is not valid JSON: {error}")


def describe_bands(raster, path, sidecar):
    declared = sidecar.get("bands", {})
    bands = []
    for index in range(1, raster.count + 1):
        description = raster.descriptions[index - 1]
        units = raster.units[index - 1] or None
        tags = " ".join(f"{k} {v}" for k, v in raster.tags(index).items())
        interp = raster.colorinterp[index - 1]
        band = dict(band=index, dtype=raster.dtypes[index - 1], description=description, units=units,
                    colour=interp.name, kind=None, identifiedBy=None, note=None, classes=None,
                    categorical=interp == ColorInterp.palette)
        declaration = declared.get(str(index))
        if declaration:
            band["kind"] = declaration.get("kind")
            band["units"] = declaration.get("units", units)
            band["note"] = declaration.get("note")
            band["classes"] = declaration.get("classes")
            band["categorical"] = band["categorical"] or bool(band["classes"])
            band["identifiedBy"] = f"declared in {sidecar_path(path).name}"
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


def file_version(path):
    """Size and modification time of a file and its sidecar, so editing either is noticed."""
    stat = path.stat()
    sidecar = sidecar_path(path)
    return [stat.st_size, stat.st_mtime_ns, sidecar.stat().st_mtime_ns if sidecar.exists() else None]


def inspect(path):
    stat = path.stat()
    cache_key = (str(path), *file_version(path))
    if cache_key in _inspections:
        return _inspections[cache_key]
    info = dict(id=file_id(path), name=path.name, folder=path.parent.relative_to(ROOT).as_posix() or ".",
                sizeBytes=stat.st_size, modified=stat.st_mtime, readable=False, error=None, source=None)
    try:
        sidecar = read_sidecar(path)
        info["source"] = sidecar.get("source")
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
                        bands=describe_bands(raster, path, sidecar), readable=True)
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


HIDDEN = BUILDS / "hidden-files.json"


def hidden_files():
    """Files the user has hidden from the Data files list. Hiding never touches the file itself."""
    try:
        return set(json.loads(HIDDEN.read_text()))
    except (FileNotFoundError, ValueError):
        return set()


def set_hidden(identifier, hidden):
    resolve(identifier)  # Only files the listing would show can be hidden.
    names = hidden_files()
    if hidden:
        names.add(identifier)
    else:
        names.discard(identifier)
    BUILDS.mkdir(exist_ok=True)
    HIDDEN.write_text(json.dumps(sorted(names)))


def list_files():
    hidden = hidden_files()
    return [{**inspect(path), "hidden": file_id(path) in hidden, "included": path.parent == INCLUDED}
            for path in candidate_paths()]


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
    # PNG "Sub" filter: store each byte as the difference from the pixel to its left,
    # which compresses smooth images far better than raw rows.
    filtered = pixels.copy()
    filtered[:, 1:] -= pixels[:, :-1]
    rows = np.empty((height, 1 + filtered[0].nbytes), np.uint8)
    rows[:, 0] = 1
    rows[:, 1:] = filtered.reshape(height, -1)
    header = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header)
                     + png_chunk(b"IDAT", zlib.compress(rows.tobytes(), 3)) + png_chunk(b"IEND", b""))


def stretch(values):
    """Value range used for colouring: the 2nd to 98th percentile, so outliers do not wash it out."""
    finite = values[np.isfinite(values)]
    if not finite.size:
        return 0.0, 1.0
    low, high = np.percentile(finite, (2, 98))
    return float(low), float(high)


def normalise(values):
    low, high = stretch(values)
    scaled = (np.nan_to_num(values, nan=low) - low) / (high - low or 1)
    return np.round(np.clip(scaled, 0, 1) * 255).astype(np.uint8)


def colour(values, kind):
    level = normalise(values).astype(np.float32) / 255
    low, high = RAMPS.get(kind, RAMPS["unknown"])
    return [np.round(low[c] + (high[c] - low[c]) * level).astype(np.uint8) for c in range(3)]


def hex_colour(rgb):
    return "#" + "".join(f"{int(c):02x}" for c in rgb[:3])


def ramp_legend(kind, values, units):
    low, high = stretch(values)
    ramp = RAMPS.get(kind, RAMPS["unknown"])
    legend = dict(type="ramp", low=low, high=high, units=units, colours=[hex_colour(c) for c in ramp],
                  note="Colours run from the 2nd to the 98th percentile of the values")
    if kind == "imagery":
        # Image brightness is not a quantity to read off; the legend just shows dark to bright.
        legend.update(labels=["Darker", "Brighter"], note="Contrast stretched between the 2nd and 98th percentile of brightness")
    return legend


def render_classes(values, src, index, band):
    """Colour a class map using the sidecar's colours, else the file's colour table.

    Returns the RGBA image and a legend listing every class present on the grid.
    """
    try:
        table = src.colormap(index)
    except ValueError:
        table = {}
    declared = band.get("classes") or {}
    valid = np.isfinite(values)
    present = np.unique(values[valid]).astype(np.int64)
    if present.size > MAX_CLASSES:
        return None, None
    rgba = np.zeros((*values.shape, 4), np.uint8)
    items = []
    for position, value in enumerate(present):
        info = declared.get(str(value), {})
        rgb = info.get("colour") or (hex_colour(table[value]) if value in table else CLASS_COLOURS[position % len(CLASS_COLOURS)])
        selected = valid & (values == value)
        hidden = bool(info.get("hidden"))
        if not hidden:
            rgba[selected] = (*bytes.fromhex(rgb[1:]), 215)
        items.append(dict(value=int(value), name=info.get("name", f"Class {value}"), colour=rgb, hidden=hidden,
                          reason=info.get("reason"), gridPercent=round(100 * int(selected.sum()) / values.size, 2)))
    return rgba, dict(type="classes", items=items)


def elevation_image(heights, dx, dy, low, high):
    """Colour elevation from low to high and shade it as if lit from the upper left.

    Adapted from render_elevation in Gihan Kesara's prepare_full_dem.py (kesara branch).
    Cells next to missing elevation are left unshaded instead of being compared with a fill value.
    """
    palette = np.array(ELEVATION_PALETTE, np.float32)
    levels = np.linspace(0, len(palette) - 1, 256)
    lookup = np.column_stack([np.interp(levels, np.arange(len(palette)), palette[:, c]) for c in range(3)])
    rows, columns = heights.shape
    rgba = np.zeros((rows, columns, 4), np.uint8)
    for top in range(0, rows, 256):
        bottom = min(top + 256, rows)
        first, last = max(0, top - 1), min(rows, bottom + 1)
        section = heights[first:last]
        if section.shape[0] > 1 and columns > 1:
            # Gradient: elevation change per metre down the rows and across the columns.
            dz_dy, dz_dx = (np.nan_to_num(g[top - first:top - first + bottom - top])
                            for g in np.gradient(section, dy, dx))
            # Light from the upper left: x points right, y points down the map, z up.
            light = (-0.5 * -dz_dx + -0.5 * -dz_dy + 0.70710678) / np.sqrt(dz_dx ** 2 + dz_dy ** 2 + 1)
            light = 0.45 + 0.55 * np.clip(light, 0, 1)
        else:
            light = np.ones((bottom - top, columns))
        block = heights[top:bottom]
        index = np.round(np.clip((np.nan_to_num(block, nan=low) - low) / (high - low or 1), 0, 1) * 255).astype(np.uint8)
        rgba[top:bottom, :, :3] = np.clip(lookup[index] * light[..., None], 0, 255).astype(np.uint8)
        rgba[top:bottom, :, 3] = np.where(np.isfinite(block), 255, 0)
    return rgba


def hazard_image(heights, dx, dy):
    """Classify each cell by its steepest slope to a valid neighbour.

    Adapted from Gihan Kesara's prepare_hazards.py (kesara branch). Cells with no valid
    neighbour stay transparent ("unknown"), rather than being shown as low slope.
    """
    rows, columns = heights.shape
    grades = np.full(heights.shape, np.nan, np.float32)
    # Four directions cover all eight neighbours, because each comparison updates both cells.
    for oy, ox in ((0, 1), (1, -1), (1, 0), (1, 1)):
        a = np.s_[max(0, -oy):rows - max(0, oy), max(0, -ox):columns - max(0, ox)]
        b = np.s_[max(0, oy):rows - max(0, -oy), max(0, ox):columns - max(0, -ox)]
        grade = np.abs(heights[a] - heights[b]) / np.hypot(ox * dx, oy * dy)
        np.fmax(grades[a], grade, out=grades[a])
        np.fmax(grades[b], grade, out=grades[b])
    rgba = np.zeros((rows, columns, 4), np.uint8)
    known = np.isfinite(grades)
    items = [dict(name="Up to 10° (not shaded)", colour=None, gridPercent=None)]
    for degrees, name, colour_value in HAZARD_CLASSES:
        rgba[known & (grades > np.tan(np.deg2rad(degrees)))] = colour_value
    for position, (degrees, name, colour_value) in enumerate(HAZARD_CLASSES):
        upper = HAZARD_CLASSES[position + 1][0] if position + 1 < len(HAZARD_CLASSES) else None
        selected = known & (grades > np.tan(np.deg2rad(degrees)))
        if upper is not None:
            selected &= grades <= np.tan(np.deg2rad(upper))
        items.append(dict(name=name, colour=hex_colour(colour_value), gridPercent=round(100 * int(selected.sum()) / grades.size, 2)))
    items[0]["gridPercent"] = round(100 * int((known & (grades <= np.tan(np.deg2rad(HAZARD_CLASSES[0][0])))).sum()) / grades.size, 2)
    return rgba, dict(type="classes", items=items,
                      note="Steepest slope from each cell to a neighbouring cell. Hazards smaller than one cell are not visible.")


def contour_image(heights):
    """Draw contours at every 50 m (minor) and 250 m (major) elevation.

    Adapted from Gihan Kesara's prepare_contours.py (kesara branch). Marching squares
    interpolates where the surface crosses each level, so lines run between cell centres
    instead of following cell edges. Lines never cross missing elevation.
    """
    rows, columns = heights.shape
    valid = heights[np.isfinite(heights)]
    image = Image.new("RGBA", (columns, rows), (0, 0, 0, 0))
    if rows < 2 or columns < 2 or not valid.size:
        return np.asarray(image), 0
    generator = contourpy.contour_generator(z=np.ma.masked_invalid(heights), name="serial",
                                            line_type="Separate", corner_mask=False, chunk_size=256)
    draw = ImageDraw.Draw(image)
    first = int(np.ceil(valid.min() / CONTOUR_MINOR_M)) * CONTOUR_MINOR_M
    last = int(np.floor(valid.max() / CONTOUR_MINOR_M)) * CONTOUR_MINOR_M
    count = 0
    for level in range(first, last + 1, CONTOUR_MINOR_M):
        major = level % CONTOUR_MAJOR_M == 0
        for line in generator.lines(level):
            if len(line) > 1:
                # Contour coordinates are cell centres; image pixels start at the cell's corner.
                draw.line([(x + 0.5, y + 0.5) for x, y in line], fill=CONTOUR_MAJOR_COLOUR if major else CONTOUR_MINOR_COLOUR,
                          width=2 if major else 1, joint="curve")
        count += 1
    return np.asarray(image), count


def selection_key(identifiers):
    parts = [BUILD_VERSION]
    for identifier in dict.fromkeys(identifiers):
        parts.append([identifier, *file_version(resolve(identifier))])
    if MISSION.exists():
        parts.append(["mission.json", MISSION.stat().st_mtime_ns])
    return hashlib.sha1(json.dumps(parts).encode()).hexdigest()[:16]


# ------------------------------------------------------------------- mission

def load_mission():
    """The planned mission: an objective and named targets given by longitude and latitude."""
    if not MISSION.exists():
        return None
    try:
        return json.loads(MISSION.read_text(encoding="utf-8"))
    except ValueError as error:
        raise ValueError(f"mission.json is not valid JSON: {error}")


def locate_targets(mission, ref):
    """Place the mission's targets on the reference grid; targets outside it are left out."""
    lonlat = lonlat_crs(ref.crs)
    if not mission or not lonlat:
        return []
    placed = []
    for target in mission.get("targets", []):
        xs, ys = transform(lonlat, ref.crs, [target["lon"]], [target["lat"]])
        row, col = ref.index(xs[0], ys[0])
        if 0 <= row < ref.height and 0 <= col < ref.width:
            placed.append({**target, "cell": [int(col), int(row)], "data": []})
    return placed


def describe_value(value, legend, units):
    """Text for what one layer shows at one cell: its class name, or its value and units."""
    if legend and legend["type"] == "classes":
        item = next((entry for entry in legend["items"] if entry.get("value") == int(value)), None)
        if item is None:
            return None
        return item["name"] + (" (detected, but not drawn on the map)" if item.get("hidden") else "")
    return f"{value:.4g} {units}" if units else f"{value:.4g} (units not stated in the file)"


def steepest_slope(heights, row, col, dx, dy):
    """Steepest slope in degrees from one cell to any valid neighbouring cell."""
    steepest = 0.0
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            r, c = row + oy, col + ox
            if (oy or ox) and 0 <= r < heights.shape[0] and 0 <= c < heights.shape[1] and np.isfinite(heights[r, c]):
                rise = abs(float(heights[r, c]) - float(heights[row, col]))
                steepest = max(steepest, float(np.degrees(np.arctan(rise / np.hypot(ox * dx, oy * dy)))))
    return steepest


def read_on_grid(src, index, ref, is_reference, categorical=None):
    """Return one band on the reference grid, with nodata as NaN and scale/offset applied.

    Class maps are resampled to the nearest cell so classes are never blended; continuous
    values (elevation, temperature, image brightness) are interpolated bilinearly.
    """
    if is_reference:
        values = src.read(index, masked=True).astype(np.float32).filled(np.nan)
    else:
        values = np.full((ref.height, ref.width), np.nan, np.float32)
        continuous = not categorical if categorical is not None else np.dtype(src.dtypes[index - 1]).kind == "f"
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
    mission = load_mission()
    with rasterio.open(resolve(reference_id)) as ref:
        targets = locate_targets(mission, ref)
        units_name, factor = linear_units(ref.crs)
        dx = abs(ref.transform.a) * (factor or 1)
        dy = abs(ref.transform.e) * (factor or 1)
        file_entries, layers, elevation, elevation_values = [], [], None, None
        for entry in layout["files"]:
            info = inspect(resolve(entry["id"]))
            record = {**entry, "bands": [], "source": info.get("source")}
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
                    values = read_on_grid(src, band["band"], ref, entry["role"] == "reference", band["categorical"])
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
                    pixels = legend = None
                    if band["categorical"]:
                        pixels, legend = render_classes(values, src, band["band"], band)
                    if pixels is None:
                        channels = colour(values, band["kind"])
                        # Photographs are drawn opaque; data layers slightly see-through. The opacity slider applies to both.
                        alpha = np.where(np.isfinite(values), 255 if band["kind"] == "imagery" else 210, 0).astype(np.uint8)
                        pixels, legend = np.stack((*channels, alpha), axis=-1), ramp_legend(band["kind"], values, band["units"])
                    write_png(work / f"{layer_id}.png", pixels, 6)
                    layers.append(dict(id=layer_id, kind=band["kind"], file=entry["name"], fileId=entry["id"],
                                       bands=[band["band"]], identifiedBy=band["identifiedBy"], units=band["units"],
                                       image=f"{layer_id}.png", coveragePercent=stats["gridCoveragePercent"],
                                       legend=legend, note=band["note"], source=info["source"]))
                    # Record what this layer shows at each mission target (image brightness is not a useful reading).
                    for target in targets if band["kind"] != "imagery" else []:
                        col, row = target["cell"]
                        if np.isfinite(values[row, col]):
                            text = describe_value(float(values[row, col]), legend, band["units"])
                            if text:
                                target["data"].append(dict(kind=band["kind"], file=entry["name"], layer=layer_id,
                                                           text=text, usedForRouting=False))
                if len(rgb_values) == 3:
                    stack = [rgb_values[b] for b in sorted(rgb_values, key=lambda b: ("red", "green", "blue").index(
                        next(x["colour"] for x in bands if x["band"] == b)))]
                    layer_id = f"layer-{len(layers) + 1}"
                    alpha = np.where(np.isfinite(stack[0]), 255, 0).astype(np.uint8)
                    write_png(work / f"{layer_id}.png", np.stack((*[normalise(v) for v in stack], alpha), axis=-1), 6)
                    layers.append(dict(id=layer_id, kind="imagery", file=entry["name"], fileId=entry["id"],
                                       bands=sorted(rgb_values), identifiedBy="colour interpretation (red, green, blue)",
                                       units=None, image=f"{layer_id}.png",
                                       coveragePercent=round(100 * np.isfinite(stack[0]).mean(), 2),
                                       legend=None, note=None, source=info["source"]))

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
        legends = {}
        if elevation_values is not None:
            heights = elevation_values * (vertical or 1)
            valid = heights[np.isfinite(heights)]
            low, high = float(valid.min()), float(valid.max())
            meta.update(minimum=low, maximum=high)
            if factor:
                write_png(work / "base.png", elevation_image(heights, dx, dy, low, high), 6)
                note = "Shaded as if lit from the upper left. Display colours, not surface colours."
            else:
                # Without ground distances the shading would be wrong, so show plain elevation.
                shade = np.round((np.nan_to_num(heights, nan=low) - low) * 255 / (high - low or 1)).astype(np.uint8)
                write_png(work / "base.png", np.stack((shade, np.where(np.isfinite(heights), 255, 0).astype(np.uint8)), axis=-1), 4)
                note = "Grey scale; not shaded because the pixel spacing is not a ground distance."
            legends["elevation"] = dict(type="ramp", low=low, high=high, units="m",
                                        colours=[hex_colour(c) for c in (ELEVATION_PALETTE if factor else ((0, 0, 0), (255, 255, 255)))],
                                        note=note)
            meta.update(baseImage="base.png", baseLayer="elevation")
            for target in targets:
                col, row = target["cell"]
                if np.isfinite(heights[row, col]):
                    slope = f" · steepest slope to a neighbouring cell {steepest_slope(heights, row, col, dx, dy):.1f}°" if factor else ""
                    target["data"].insert(0, dict(kind="elevation", file=elevation["file"], layer="elevation",
                                                  text=f"{heights[row, col]:.0f} m{slope}", usedForRouting=True))
        elif layers:
            shutil.copyfile(work / layers[0]["image"], work / "base.png")
            meta.update(baseImage="base.png", baseLayer=layers[0]["id"])

        derived = dict(slope=False, hazards=False, contours=False)
        if routing["available"]:
            advance("Saving elevation for route calculations")
            heights.astype("<f4").tofile(work / "elevation.f32")
            advance("Classifying slope hazards (10°, 18°, 22°) from elevation")
            overlay, legends["hazards"] = hazard_image(heights, dx, dy)
            write_png(work / "hazards.png", overlay, 6)
            del overlay
            advance(f"Drawing interpolated contours ({CONTOUR_MINOR_M} m and {CONTOUR_MAJOR_M} m) from elevation")
            overlay, levels = contour_image(heights)
            write_png(work / "contours.png", overlay, 6)
            legends["contours"] = dict(type="lines", items=[
                dict(name=f"Every {CONTOUR_MINOR_M} m", colour=hex_colour(CONTOUR_MINOR_COLOUR), width=1),
                dict(name=f"Every {CONTOUR_MAJOR_M} m", colour=hex_colour(CONTOUR_MAJOR_COLOUR), width=2)],
                note=f"{levels} contour levels, interpolated between elevation cells")
            derived = dict(slope=True, hazards=True, contours=True,
                           hazardThresholdsDeg=[degrees for degrees, _, _ in HAZARD_CLASSES],
                           contourIntervalsM=[CONTOUR_MINOR_M, CONTOUR_MAJOR_M])
        meta["derived"] = derived
        meta["legends"] = legends

        meta["mission"] = ({key: mission.get(key) for key in ("name", "objective", "basis")}
                           if mission and targets else None)
        meta["targets"] = targets
        col, row = ref.width // 2, ref.height // 2
        if targets:
            col = int(np.mean([target["cell"][0] for target in targets]))
            row = int(np.mean([target["cell"][1] for target in targets]))
        elif lonlat_crs(ref.crs):
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
