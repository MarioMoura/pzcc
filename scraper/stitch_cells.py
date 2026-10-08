#!/usr/bin/env python3
"""
Stitch per-cell map images ({cx}_{cy}.webp) into the map_full/high/medium.jpg files used by the app.

Cell sources: a pzmap2dzi base_top render (html/map_data/base_top/layer0_files/<max level>/,
256px per cell) or the pzfans.com 1024px cell renders.

Usage: stitch_cells.py CELLDIR [-o ../src] [-q 85]
"""
import argparse
import os
import re

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
CELLS_X, CELLS_Y = 78, 63
OUTPUTS = [("map_full.jpg", 256), ("map_high.jpg", 128), ("map_medium.jpg", 64)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("celldir")
    ap.add_argument("-o", "--outdir", default=os.path.join(os.path.dirname(__file__), "../src"))
    ap.add_argument("-q", "--quality", type=int, default=85)
    a = ap.parse_args()

    pattern = re.compile(r"^(\d+)_(\d+)\.(webp|png|jpg)$")
    cells = []
    for f in os.listdir(a.celldir):
        m = pattern.match(f)
        if m:
            cells.append((int(m.group(1)), int(m.group(2)), os.path.join(a.celldir, f)))
    print(f"{len(cells)} cells")

    outs = [(name, px, Image.new("RGB", (CELLS_X * px, CELLS_Y * px))) for name, px in OUTPUTS]
    for i, (cx, cy, path) in enumerate(cells):
        cell = Image.open(path).convert("RGB")
        for _, px, img in outs:
            img.paste(cell.resize((px, px), Image.LANCZOS), (cx * px, cy * px))
        if i % 500 == 0:
            print(f"  {i}/{len(cells)}", flush=True)

    for name, _, img in outs:
        path = os.path.join(a.outdir, name)
        img.save(path, quality=a.quality)
        print(f"{path}: {img.size[0]}x{img.size[1]}, {os.path.getsize(path) / 1024 / 1024:.1f}MB")


if __name__ == "__main__":
    main()
