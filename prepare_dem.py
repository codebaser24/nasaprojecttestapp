"""Extract a native-resolution Jezero window from the published CTX GeoTIFF."""
import json
from pathlib import Path
import sys

import rasterio
from numpy.ma import getmaskarray
from rasterio.warp import transform
from rasterio.windows import Window

source = Path(sys.argv[1])
with rasterio.open(source) as dem:
    # Transform using the raster's own Mars geographic CRS.
    geographic = "+proj=longlat +a=3396190 +b=3376200 +no_defs"
    xs, ys = transform(geographic, dem.crs, [77.40], [18.47])
    row, col = dem.index(xs[0], ys[0])
    window = Window(col - 120, row - 84, 240, 168)
    if window.col_off < 0 or window.row_off < 0 or window.col_off + 240 > dem.width or window.row_off + 168 > dem.height:
        raise ValueError("Jezero window lies outside this source raster")
    samples = dem.read(1, window=window, masked=True)
    elevation = [
        None if masked else round(float(value), 2)
        for value, masked in zip(samples.data.flat, getmaskarray(samples).flat)
    ]
    if not any(value is not None for value in elevation):
        raise ValueError("DEM window contains no valid elevations")
    grid = dict(width=240, height=168, dx=abs(dem.transform.a), dy=abs(dem.transform.e),
                elevation=elevation, transform=list(dem.window_transform(window))[:6],
                crs=dem.crs.to_wkt(), source="USGS Mars 2020 CTX Science Investigation DEM")
    Path(__file__).with_name("terrain.json").write_text(json.dumps(grid, allow_nan=False))
