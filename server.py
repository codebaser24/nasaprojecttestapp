"""Serve the atlas and compute slope-constrained routes over a DEM grid."""
from functools import lru_cache
from array import array
from heapq import heappop, heappush
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from math import atan2, degrees, hypot, isfinite
import mmap
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROFILES = {"balanced": (18, 2), "low-exposure": (10, 6), "shortest": (22, 0)}


@lru_cache(maxsize=1)
def terrain():
    return json.loads((ROOT / "terrain.json").read_text())


@lru_cache(maxsize=1)
def full_metadata():
    return json.loads((ROOT / "dist" / "jezero-full.json").read_text())


@lru_cache(maxsize=1)
def full_terrain():
    
    metadata = full_metadata()
    
    
    with (ROOT / "jezero-full.f32").open("rb") as source:
        data = mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ)
    if len(data) != metadata["width"] * metadata["height"] * 4:
        data.close()
        raise ValueError("Full DEM elevation file has an unexpected size.")
    return {**metadata, "elevation": memoryview(data).cast("f")}


@lru_cache(maxsize=1)
def geology():
    """Memory-map the unit IDs produced by recover_geology_ids.py."""
    metadata = json.loads((ROOT / "dist" / "jezero-geology.json").read_text(encoding="utf-8"))
    width = metadata["dem"]["width"]
    height = metadata["dem"]["height"]
    with (ROOT / "dist" / "jezero-geology-ids.bin").open("rb") as source:
        labels = mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ)
    if len(labels) != width * height:
        labels.close()
        raise ValueError("Geological classification grid has an unexpected size.")
    dem = full_metadata()
    if (width, height) != (dem["width"], dem["height"]):
        labels.close()
        raise ValueError("Geology and full DEM dimensions do not match.")
    return {
        "width": width,
        "height": height,
        "labels": labels,
        "units": {unit["id"]: unit for unit in metadata["units"]},
    }


@lru_cache(maxsize=1)
def crop_alignment_verified():
    """Check that crop pixel values correspond to the expected full DEM pixels."""
    crop = terrain()
    full = full_terrain()
    ox, oy = full["cropOrigin"]
    cw, ch = crop["width"], crop["height"]
    fw, fh = full["width"], full["height"]
    if not (0 <= ox and 0 <= oy and ox + cw <= fw and oy + ch <= fh):
        return False
    if (crop["dx"], crop["dy"]) != (full["dx"], full["dy"]):
        return False
    for x, y in ((0, 0), (cw // 2, ch // 2), (cw - 1, ch - 1)):
        a = crop["elevation"][y * cw + x]
        b = full["elevation"][(y + oy) * fw + x + ox]
        if a is None:
            if isfinite(b):
                return False
        elif not isfinite(b) or abs(a - b) > 0.1:
            return False
    return True


class SearchLimitReached(ValueError):
    pass


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
            return dict(path=path, distanceM=round(sum(run for run, _ in steps)),
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


def analyze_route_geology(path, grid, coverage):
    """Estimate distance per mapped geological unit along A* path segments."""
    geo = geology()
    if coverage == "crop" and not crop_alignment_verified():
        raise ValueError("Cropped DEM and full DEM are not aligned; geology cannot be assigned safely.")

    ox, oy = full_metadata()["cropOrigin"] if coverage == "crop" else (0, 0)
    width, height = geo["width"], geo["height"]
    labels = geo["labels"]

    def unit_at(point):
        x, y = point[0] + ox, point[1] + oy
        if not (0 <= x < width and 0 <= y < height):
            raise ValueError("Route point falls outside the geological grid.")
        return labels[y * width + x]

    if not path:
        raise ValueError("Cannot analyze an empty route.")

    distances = {}
    transitions = []
    dx, dy = grid["dx"], grid["dy"]
    for start, end in zip(path, path[1:]):
        a, b = unit_at(start), unit_at(end)
        length = hypot((end[0] - start[0]) * dx, (end[1] - start[1]) * dy)
        if a == b:
            distances[a] = distances.get(a, 0.0) + length
        else:
            distances[a] = distances.get(a, 0.0) + length / 2
            distances[b] = distances.get(b, 0.0) + length / 2
            transitions.append({
                "from": geo["units"][a]["symbol"] if a else "Unmapped",
                "to": geo["units"][b]["symbol"] if b else "Unmapped",
                "at": list(end),
            })

    mapped = sum(value for unit_id, value in distances.items() if unit_id != 0)
    unmapped = distances.get(0, 0.0)
    total = mapped + unmapped
    units = []
    for unit_id, distance in sorted(distances.items(), key=lambda pair: pair[1], reverse=True):
        if unit_id == 0:
            continue
        unit = geo["units"][unit_id]
        units.append({
            "id": unit_id,
            "symbol": unit["symbol"],
            "name": unit["names"][0],
            "distanceM": round(distance, 1),
            "percentage": round(100 * distance / total, 1) if total else 0,
        })
    return {
        "mappedDistanceM": round(mapped, 1),
        "unmappedDistanceM": round(unmapped, 1),
        "mappedPercentage": round(100 * mapped / total, 1) if total else 0,
        "units": units,
        "transitions": transitions,
        "method": "Endpoint unit IDs; split boundary-crossing segments equally (20 m raster approximation)",
    }


class Handler(SimpleHTTPRequestHandler):
    timeout = 15

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "dist"), **kwargs)

    def log_request(self, code="-", size="-"):
        # Keep routine traffic off the console so an unattended server cannot
        # stall while writing request logs.
        pass

    def translate_path(self, path):
        if path == "/api/dem-source":
            return str(ROOT / "M20_JezeroCrater_CTXDEM_20m.tif")
        return super().translate_path(path)

    def respond(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/api/terrain":
            return super().do_GET()
        try:
            self.respond(200, terrain())
        except FileNotFoundError:
            self.respond(503, {"error": "DEM unavailable. Run the preparation command in the README."})

    def do_POST(self):
        if self.path != "/api/route":
            return self.respond(404, {"error": "Unknown endpoint"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                raise ValueError("Invalid request size.")
            payload = json.loads(self.rfile.read(length))
            start, goal, profile = payload["start"], payload["goal"], payload["profile"]
            if profile not in PROFILES or any(
                not isinstance(point, list) or len(point) != 2 or any(type(n) is not int for n in point)
                for point in (start, goal)
            ):
                raise ValueError("Provide integer grid coordinates and a valid route profile.")
            coverage = payload.get("coverage", "crop")
            if coverage not in ("crop", "full"):
                raise ValueError("Invalid DEM coverage.")
            grid = full_terrain() if coverage == "full" else terrain()
            route = find_route(grid, tuple(start), tuple(goal), profile,
                               extended=coverage == "full" and payload.get("extended") is True)
            try:
                route["geology"] = analyze_route_geology(route["path"], grid, coverage)
            except (FileNotFoundError, ValueError, KeyError) as error:
                # A missing/misaligned geology layer must not break rover routing.
                route["geology"] = {"available": False, "reason": str(error)}
            self.respond(200, route)
        except SearchLimitReached as error:
            self.respond(422, {"error": str(error), "code": "search_limit"})
        except FileNotFoundError:
            self.respond(503, {"error": "DEM unavailable."})
        except (ValueError, TypeError, KeyError) as error:
            self.respond(400, {"error": str(error)})


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    print(f"ARES atlas: http://127.0.0.1:{args.port}/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
