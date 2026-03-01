#!/usr/bin/env python3
"""PZ B42 Cell Cleaner — deletes map chunk files for selected cells."""
import os, sys, argparse

CELLS = []  # PZCC_INJECT_CELLS
DEFAULT_PATH = "."  # PZCC_INJECT_PATH
CHUNKS_PER_CELL = 32

CELL_PATTERNS = [
    ("chunkdata", "chunkdata_{cx}_{cy}.bin"),
    ("zpop", "zpop_{cx}_{cy}.bin"),
    ("apop", "apop_{cx}_{cy}.bin"),
    ("metagrid", "metacell_{cx}_{cy}.bin"),
]


def collect_files(base):
    files = []
    dirs = set()
    for cx, cy in CELLS:
        for folder, pattern in CELL_PATTERNS:
            files.append(os.path.join(base, folder, pattern.format(cx=cx, cy=cy)))
        chx0 = cx * CHUNKS_PER_CELL
        chy0 = cy * CHUNKS_PER_CELL
        for chx in range(chx0, chx0 + CHUNKS_PER_CELL):
            for chy in range(chy0, chy0 + CHUNKS_PER_CELL):
                files.append(os.path.join(base, "map", str(chx), str(chy) + ".bin"))
                files.append(os.path.join(base, "isoregiondata", f"datachunk_{chx}_{chy}.bin"))
            dirs.add(os.path.join(base, "map", str(chx)))
    return files, dirs


def main():
    p = argparse.ArgumentParser(description="PZ B42 Cell Cleaner")
    p.add_argument("--path", default=DEFAULT_PATH, help="Server save path")
    p.add_argument("--dry-run", action="store_true", help="Show what would be deleted")
    args = p.parse_args()

    if not os.path.isdir(args.path):
        print(f"Error: {args.path} is not a valid directory", file=sys.stderr)
        sys.exit(1)

    files, dirs = collect_files(args.path)
    deleted = 0
    for f in files:
        if os.path.exists(f):
            if args.dry_run:
                print(f"would delete: {f}")
            else:
                os.remove(f)
            deleted += 1
    for d in sorted(dirs, reverse=True):
        if os.path.isdir(d) and not os.listdir(d):
            if args.dry_run:
                print(f"would remove empty dir: {d}")
            else:
                os.rmdir(d)

    action = "Would delete" if args.dry_run else "Deleted"
    print(f"{action} {deleted} files across {len(CELLS)} cells.")


if __name__ == "__main__":
    main()
