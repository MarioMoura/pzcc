#!/usr/bin/env python3
"""
Fetch the full-resolution top-down map from b42map.com and stitch it into a single image.

Usage:
    python fetch_map.py [options]

The script downloads DZI tiles from b42map.com's top-down map view,
then stitches them into a single JPEG image.

Requires: Pillow (pip install Pillow)
"""

import argparse
import io
import json
import os
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import urlopen, Request

try:
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None  # Allow large images
except ImportError:
    print("Error: Pillow is required. Install with: pip install Pillow")
    sys.exit(1)


BASE_URL = "https://b42map.com/map_data/base_top"
USER_AGENT = "pzcc-map-scraper/1.0"


def fetch_url(url):
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=30) as resp:
        return resp.read()


def fetch_dzi_info():
    """Fetch and parse the DZI descriptor and map_info.json."""
    print("Fetching DZI metadata...")

    dzi_xml = fetch_url(f"{BASE_URL}/layer0.dzi").decode()
    root = ET.fromstring(dzi_xml)
    ns = {"dz": "http://schemas.microsoft.com/deepzoom/2008"}
    size = root.find("dz:Size", ns)
    dzi = {
        "width": int(size.get("Width")),
        "height": int(size.get("Height")),
        "tile_size": int(root.get("TileSize")),
        "format": root.get("Format"),
    }

    map_info = json.loads(fetch_url(f"{BASE_URL}/map_info.json").decode())

    return dzi, map_info


def compute_pyramid(w, h):
    """Build the DZI pyramid (level 0 = smallest)."""
    pyramid = [(w, h)]
    while pyramid[-1] != (1, 1):
        x, y = pyramid[-1]
        pyramid.append(((x + 1) // 2, (y + 1) // 2))
    pyramid.reverse()
    return pyramid


def get_tiles_needed(cell_rects):
    """Get set of (col, row) tiles that contain map data."""
    tiles = set()
    for rect in cell_rects:
        rx, ry, rw, rh = rect
        for cx in range(rx, rx + rw):
            for cy in range(ry, ry + rh):
                tiles.add((cx, cy))
    return tiles


def fetch_tile(col, row, level, fmt, tile_dir):
    """Download a single tile, returns (col, row, success)."""
    path = os.path.join(tile_dir, f"{col}_{row}.{fmt}")
    if os.path.exists(path) and os.path.getsize(path) > 100:
        return (col, row, True)

    url = f"{BASE_URL}/layer0_files/{level}/{col}_{row}.{fmt}"
    try:
        data = fetch_url(url)
        with open(path, "wb") as f:
            f.write(data)
        return (col, row, True)
    except Exception:
        return (col, row, False)


def stitch_tiles(tile_dir, fmt, cols, rows, tile_size, output_path, quality):
    """Stitch downloaded tiles into a single image."""
    print(f"Stitching {cols}x{rows} grid ({cols * tile_size}x{rows * tile_size}px)...")

    out = Image.new("RGB", (cols * tile_size, rows * tile_size), (0, 0, 0))
    count = 0

    for fname in os.listdir(tile_dir):
        if not fname.endswith(f".{fmt}"):
            continue
        parts = fname.replace(f".{fmt}", "").split("_")
        cx, cy = int(parts[0]), int(parts[1])
        tile = Image.open(os.path.join(tile_dir, fname))
        out.paste(tile, (cx * tile_size, cy * tile_size))
        count += 1

    print(f"Pasted {count} tiles")
    print(f"Saving to {output_path} (quality={quality})...")
    out.save(output_path, quality=quality)
    size_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"Done! {size_mb:.1f}MB")
    return out


def main():
    parser = argparse.ArgumentParser(description="Fetch PZ B42 top-down map from b42map.com")
    parser.add_argument("-o", "--output", default="../src/map.jpg",
                        help="Output image path (default: ../map.jpg)")
    parser.add_argument("-q", "--quality", type=int, default=95,
                        help="JPEG quality 1-100 (default: 95)")
    parser.add_argument("-w", "--workers", type=int, default=20,
                        help="Parallel download workers (default: 20)")
    parser.add_argument("--tile-dir", default="/tmp/pz_tiles",
                        help="Directory for cached tiles (default: /tmp/pz_tiles)")
    parser.add_argument("--level", type=int, default=None,
                        help="DZI level to fetch (default: highest available)")
    args = parser.parse_args()

    # Resolve relative output path
    if not os.path.isabs(args.output):
        args.output = os.path.join(os.path.dirname(__file__), args.output)

    dzi, map_info = fetch_dzi_info()
    print(f"  Image: {dzi['width']}x{dzi['height']}px, "
          f"tile_size={dzi['tile_size']}, format={dzi['format']}")
    print(f"  Cell rects: {map_info['cell_rects']}")

    pyramid = compute_pyramid(dzi["width"], dzi["height"])
    max_level = len(pyramid) - 1

    level = args.level if args.level is not None else max_level
    level_w, level_h = pyramid[level]
    tile_cols = (level_w + dzi["tile_size"] - 1) // dzi["tile_size"]
    tile_rows = (level_h + dzi["tile_size"] - 1) // dzi["tile_size"]
    print(f"  Level {level}: {level_w}x{level_h}px = {tile_cols}x{tile_rows} tiles")

    # At full resolution, tiles map 1:1 to cells. At lower levels, fetch all.
    if level == max_level:
        tiles_needed = get_tiles_needed(map_info["cell_rects"])
    else:
        tiles_needed = {(c, r) for c in range(tile_cols) for r in range(tile_rows)}

    print(f"  Tiles to fetch: {len(tiles_needed)}")

    tile_dir = os.path.join(args.tile_dir, f"level_{level}")
    os.makedirs(tile_dir, exist_ok=True)

    # Download
    downloaded = 0
    failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(fetch_tile, cx, cy, level, dzi["format"], tile_dir): (cx, cy)
            for cx, cy in tiles_needed
        }
        for f in as_completed(futures):
            _, _, ok = f.result()
            if ok:
                downloaded += 1
            else:
                failed += 1
            total = downloaded + failed
            if total % 500 == 0 or total == len(tiles_needed):
                print(f"  Progress: {total}/{len(tiles_needed)} "
                      f"({failed} failed)")

    if failed:
        print(f"Warning: {failed} tiles failed to download")

    # Stitch
    stitch_tiles(tile_dir, dzi["format"], tile_cols, tile_rows,
                 dzi["tile_size"], args.output, args.quality)


if __name__ == "__main__":
    main()
