"""Serve the atlas, manage the loaded data files, and compute slope-constrained routes."""
from functools import lru_cache
from array import array
from heapq import heappop, heappush
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from math import atan2, degrees, hypot, isfinite
import mmap
from pathlib import Path
import re
import threading
from urllib.parse import parse_qs, unquote, urlsplit
import warnings

import numpy as np
import rasterio
from rasterio.warp import transform as warp_transform

import dataset

ROOT = Path(__file__).resolve().parent
PROFILES = {"balanced": (18, 2), "low-exposure": (10, 6), "shortest": (22, 0)}
MAX_UPLOAD_BYTES = 4 * 1024 ** 3
build_lock = threading.Lock()
build_status = {"state": "idle"}


def current_meta():
    # Read the pointer on every request so a command-line preparation is picked up too.
    return dataset.load_current()


@lru_cache(maxsize=2)
def elevation_grid(key):
    meta = json.loads((dataset.BUILDS / key / "meta.json").read_text())
    with (dataset.BUILDS / key / "elevation.f32").open("rb") as source:
        data = mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ)
    if len(data) != meta["width"] * meta["height"] * 4:
        data.close()
        raise ValueError("Elevation file has an unexpected size. Load the files again.")
    return {**meta, "elevation": memoryview(data).cast("f")}


class SearchLimitReached(ValueError):
    pass


class InsufficientData(ValueError):
    pass


def routing_source(meta):
    """Return the data routing may use, or raise if the loaded files lack it."""
    if not meta:
        raise InsufficientData("No data files are loaded. Select files in the Data files tab.")
    routing = meta["routing"]
    if not routing["available"]:
        needed = [r["label"] for r in routing["requires"] if r["id"] in routing["missing"]]
        raise InsufficientData("Not enough data available to generate a route. Missing: " + "; ".join(needed))
    elevation = meta["elevation"]
    return [f"Elevation (band {elevation['band']} of {elevation['file']})",
            "Slope, computed from neighbouring elevation cells"]


def find_route(grid, start, goal, profile, extended=False):
    width, height = grid["width"], grid["height"]
    elevations = grid["elevation"]
    dx, dy = grid["dx"], grid["dy"]
    limit, penalty = PROFILES[profile]

    def elevation(point):
        x, y = point
        if not (0 <= x < width and 0 <= y < height):
            return None
        value = elevations[y * width + x]
        return value if value is not None and isfinite(value) else None

    def distance(a, b):
        return hypot((a[0] - b[0]) * dx, (a[1] - b[1]) * dy)

    if elevation(start) is None or elevation(goal) is None:
        raise ValueError("Choose two points within valid DEM coverage.")
    goal_height = elevation(goal)
    diagonal = hypot(dx, dy)

    def remaining(point, height):
        x = abs(point[0] - goal[0])
        y = abs(point[1] - goal[1])
        paired = min(x, y)
        return paired * diagonal + (x - paired) * dx + (y - paired) * dy + penalty * abs(height - goal_height)

    queue = [(remaining(start, elevation(start)), 0, start)]
    # Compact storage keeps a full-raster search within a predictable memory budget.
    costs = array("d", [float("inf")]) * (width * height) if extended else {}
    previous = array("i", [-1]) * (width * height) if extended else {}

    def key(point):
        return point[1] * width + point[0] if extended else point

    costs[key(start)] = 0
    expanded = 0
    while queue:
        _, cost, current = heappop(queue)
        current_key = key(current)
        if cost != costs[current_key]:
            continue
        if current == goal:
            path = [goal]
            while path[-1] != start:
                parent = previous[key(path[-1])]
                path.append((parent % width, parent // width) if extended else parent)
            path.reverse()
            steps = [(distance(a, b), elevation(b) - elevation(a)) for a, b in zip(path, path[1:])]
            return dict(path=path, elevationsM=[round(elevation(point), 1) for point in path],
                        distanceM=round(sum(run for run, _ in steps)),
                        ascentM=round(sum(max(0, rise) for _, rise in steps)),
                        maxSlopeDeg=round(max((degrees(atan2(abs(rise), run)) for run, rise in steps), default=0), 1))
        expanded += 1
        if not extended and expanded > 3_000_000:
            raise SearchLimitReached("Search limit reached. An extended search may take longer.")
        x, y = current
        current_height = elevation(current)
        for ox, oy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            neighbor = (x + ox, y + oy)
            target = elevation(neighbor)
            if target is None or (ox and oy and (elevation((x + ox, y)) is None or elevation((x, y + oy)) is None)):
                continue
            run = distance(current, neighbor)
            grade = abs(target - current_height) / run
            if degrees(atan2(grade, 1)) > limit:
                continue
            candidate = cost + run * (1 + penalty * grade)
            neighbor_key = key(neighbor)
            best = costs[neighbor_key] if extended else costs.get(neighbor_key, float("inf"))
            if candidate < best:
                costs[neighbor_key] = candidate
                previous[neighbor_key] = current_key
                heappush(queue, (candidate + remaining(neighbor, target), candidate, neighbor))
    raise ValueError("No route meets the slope limit between these points.")


@lru_cache(maxsize=4)
def reference_georeferencing(key):
    """Affine transform and coordinate systems of the loaded selection's reference grid."""
    meta = json.loads((dataset.BUILDS / key / "meta.json").read_text())
    with rasterio.open(dataset.resolve(meta["referenceFile"])) as reference:
        return reference.transform, reference.crs, dataset.lonlat_crs(reference.crs)


def region(meta, x0, y0, x1, y1, size):
    """Describe a window of the reference grid: corner coordinates and, when available,
    elevation averaged into at most `size` samples along the longer side."""
    x0, x1 = sorted((max(0, min(meta["width"], x0)), max(0, min(meta["width"], x1))))
    y0, y1 = sorted((max(0, min(meta["height"], y0)), max(0, min(meta["height"], y1))))
    if x1 - x0 < 2 or y1 - y0 < 2:
        raise ValueError("The region must be at least 2 cells wide and tall.")
    result = dict(window=[x0, y0, x1, y1], corners=None, heightsM=None)
    transform, crs, lonlat = reference_georeferencing(meta["key"])
    if lonlat:
        xs, ys = zip(transform * (x0, y0), transform * (x1, y1))
        lons, lats = warp_transform(crs, lonlat, list(xs), list(ys))
        result["corners"] = dict(northWest=[lons[0], lats[0]], southEast=[lons[1], lats[1]])
    if meta["routing"]["available"]:
        heights = np.memmap(dataset.BUILDS / meta["key"] / "elevation.f32", dtype="<f4", mode="r",
                            shape=(meta["height"], meta["width"]))[y0:y1, x0:x1]
        step = max(1, -(-max(x1 - x0, y1 - y0) // max(8, min(400, size))))
        rows, columns = -(-(y1 - y0) // step), -(-(x1 - x0) // step)
        padded = np.full((rows * step, columns * step), np.nan, np.float32)
        padded[:y1 - y0, :x1 - x0] = heights
        blocks = padded.reshape(rows, step, columns, step)
        with np.errstate(invalid="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            averaged = np.nanmean(blocks, axis=(1, 3))
        valid = averaged[np.isfinite(averaged)]
        result.update(cellsPerSample=step, columns=columns, rows=rows,
                      heightsM=[None if not isfinite(v) else round(float(v), 1) for v in averaged.ravel()],
                      minimumM=float(valid.min()) if valid.size else None,
                      maximumM=float(valid.max()) if valid.size else None,
                      method=f"Mean of each {step} × {step} block of elevation cells")
    return result


def run_build(identifiers):
    def progress(message, step, total):
        with build_lock:
            build_status.update(message=message, step=step, total=total)
    try:
        meta = dataset.build(identifiers, progress)
        dataset.set_current(meta, identifiers)
        with build_lock:
            build_status.clear()
            build_status.update(state="done", key=meta["key"], message="Files loaded.")
    except Exception as error:
        with build_lock:
            build_status.clear()
            build_status.update(state="error", message=str(error))


class Handler(SimpleHTTPRequestHandler):
    timeout = 30

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "dist"), **kwargs)

    def log_request(self, code="-", size="-"):
        # Keep routine traffic off the console so an unattended server cannot
        # stall while writing request logs.
        pass

    def translate_path(self, path):
        path = urlsplit(path).path
        meta = None
        if path in ("/api/dem-source", "/jezero-full.json", "/jezero-full.png"):
            meta = current_meta()
        if path == "/api/dem-source" and meta and meta["elevation"].get("fileId"):
            return str(dataset.resolve(meta["elevation"]["fileId"]))
        if path == "/jezero-full.json" and meta:
            return str(dataset.BUILDS / meta["key"] / "meta.json")
        if path == "/jezero-full.png" and meta and meta["baseImage"]:
            return str(dataset.BUILDS / meta["key"] / meta["baseImage"])
        match = re.fullmatch(r"/builds/([0-9a-f]{16})/([A-Za-z0-9_-]+\.(?:png|json))", path)
        if match:
            return str(dataset.BUILDS / match[1] / match[2])
        return super().translate_path(path)

    def respond(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 65536:
            raise ValueError("Invalid request size.")
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/files":
            return self.respond(200, {"files": dataset.list_files()})
        if path == "/api/dataset":
            with build_lock:
                status = dict(build_status)
            return self.respond(200, {"meta": current_meta(), "build": status})
        if path == "/api/region":
            meta = current_meta()
            if not meta:
                return self.respond(422, {"error": "No data files are loaded.", "code": "insufficient_data"})
            try:
                query = {name: int(values[0]) for name, values in parse_qs(urlsplit(self.path).query).items()}
                return self.respond(200, region(meta, query["x0"], query["y0"], query["x1"], query["y1"],
                                                query.get("size", 160)))
            except (KeyError, ValueError) as error:
                return self.respond(400, {"error": f"Invalid region: {error}"})
        return super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        try:
            if path == "/api/route":
                return self.route()
            if path == "/api/alignment":
                return self.respond(200, dataset.plan(self.read_json()["files"]))
            if path == "/api/dataset":
                identifiers = self.read_json()["files"]
                dataset.plan(identifiers)  # Reject unknown or unreadable selections before starting.
                with build_lock:
                    if build_status.get("state") == "building":
                        return self.respond(409, {"error": "Files are already being loaded."})
                    build_status.clear()
                    build_status.update(state="building", message="Starting", step=0, total=1)
                threading.Thread(target=run_build, args=(identifiers,), daemon=True).start()
                return self.respond(202, {"state": "building"})
            if path == "/api/files/upload":
                return self.upload()
            return self.respond(404, {"error": "Unknown endpoint"})
        except InsufficientData as error:
            routing = (current_meta() or {}).get("routing", {})
            self.respond(422, {"error": str(error), "code": "insufficient_data",
                               "requires": routing.get("requires", []), "missing": routing.get("missing", [])})
        except SearchLimitReached as error:
            self.respond(422, {"error": str(error), "code": "search_limit"})
        except FileNotFoundError:
            self.respond(503, {"error": "Data files unavailable. Load files again in the Data files tab."})
        except (ValueError, TypeError, KeyError) as error:
            self.respond(400, {"error": str(error)})

    def route(self):
        payload = self.read_json()
        start, goal, profile = payload["start"], payload["goal"], payload["profile"]
        if profile not in PROFILES or any(
            not isinstance(point, list) or len(point) != 2 or any(type(n) is not int for n in point)
            for point in (start, goal)
        ):
            raise ValueError("Provide integer grid coordinates and a valid route profile.")
        meta = current_meta()
        data_used = routing_source(meta)
        route = find_route(elevation_grid(meta["key"]), tuple(start), tuple(goal), profile,
                           extended=payload.get("extended") is True)
        self.respond(200, {**route, "dataUsed": data_used})

    def upload(self):
        name = Path(unquote(self.headers.get("X-File-Name", ""))).name
        name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
        if not name.lower().endswith(dataset.EXTENSIONS):
            raise ValueError("Only .tif and .tiff files can be added.")
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= MAX_UPLOAD_BYTES:
            raise ValueError("File is empty or larger than 4 GB.")
        dataset.UPLOADS.mkdir(exist_ok=True)
        target = dataset.UPLOADS / name
        counter = 1
        while target.exists():
            target = dataset.UPLOADS / f"{Path(name).stem}_{counter}{Path(name).suffix}"
            counter += 1
        partial = target.with_name(target.name + ".partial")
        remaining = length
        with partial.open("wb") as out:
            while remaining:
                chunk = self.rfile.read(min(remaining, 1 << 20))
                if not chunk:
                    break
                out.write(chunk)
                remaining -= len(chunk)
        if remaining:
            partial.unlink(missing_ok=True)
            raise ValueError("Upload was interrupted.")
        partial.rename(target)
        info = dataset.inspect(target)
        if not info["readable"]:
            target.unlink()
            raise ValueError(f"{name} could not be read as a GeoTIFF: {info['error']}")
        self.respond(201, info)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    print(f"ARES atlas: http://127.0.0.1:{args.port}/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
