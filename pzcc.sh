#!/bin/bash
# PZ B42 Cell Cleaner — standalone cleanup script
# https://pzcc.mariomoura.com
#
# Usage:
#   pzcc.sh --path /server/Zomboid/Saves/Sandbox/myworld --purge 6,57 8,60 12,55
#   pzcc.sh --path /server/saves --purge 6,57 --dry-run
#
# B42 constants: 32 chunks per cell, 8 tiles per chunk, 256 tiles per cell

set -euo pipefail

CHUNKS_PER_CELL=32
DRY_RUN=0
BASE_PATH=""
CELLS=()

usage() {
  cat <<'EOF'
pzcc.sh — PZ B42 Cell Cleaner

Usage:
  pzcc.sh --path <save_dir> --purge <cx,cy> [<cx,cy> ...] [--dry-run]

Options:
  --path <dir>       Path to the PZ server save directory
  --purge <cx,cy>    Cell coordinate to purge (can be repeated)
  --dry-run          Show what would be deleted without deleting anything
  -h, --help         Show this help

Examples:
  pzcc.sh --path /server/Zomboid/Saves/Sandbox/myworld --purge 6,57 8,60
  pzcc.sh --path /data/saves --purge 6,57 --dry-run
EOF
  exit 0
}

die() { echo "error: $1" >&2; exit 1; }

# --- Parse arguments ---

[[ $# -eq 0 ]] && usage

while [[ $# -gt 0 ]]; do
  case "$1" in
    --path)
      [[ -z "${2:-}" ]] && die "--path requires a directory"
      BASE_PATH="$2"; shift 2 ;;
    --purge)
      shift
      while [[ $# -gt 0 && "$1" != --* ]]; do
        [[ "$1" =~ ^[0-9]+,[0-9]+$ ]] || die "invalid cell coordinate: $1 (expected cx,cy)"
        CELLS+=("$1"); shift
      done ;;
    --dry-run)
      DRY_RUN=1; shift ;;
    -h|--help)
      usage ;;
    *)
      die "unknown option: $1" ;;
  esac
done

[[ -z "$BASE_PATH" ]] && die "--path is required"
[[ ${#CELLS[@]} -eq 0 ]] && die "no cells to purge (use --purge cx,cy)"

# --- Helpers ---

deleted=0
failed=0

remove() {
  local file="$1"
  if [[ $DRY_RUN -eq 1 ]]; then
    if [[ -e "$file" ]]; then
      echo "[dry-run] rm $file"
      deleted=$((deleted + 1))
    fi
  else
    if [[ -e "$file" ]]; then
      if rm -f "$file"; then
        deleted=$((deleted + 1))
      else
        failed=$((failed + 1))
      fi
    fi
  fi
}

remove_dir_if_empty() {
  local dir="$1"
  if [[ $DRY_RUN -eq 1 ]]; then
    [[ -d "$dir" ]] && [ -z "$(ls -A "$dir" 2>/dev/null)" ] && echo "[dry-run] rmdir $dir" || true
  else
    [[ -d "$dir" ]] && rmdir "$dir" 2>/dev/null || true
  fi
}

# --- Validate base path ---

[[ -d "$BASE_PATH" ]] || die "directory not found: $BASE_PATH"

# --- Run cleanup ---

if [[ $DRY_RUN -eq 1 ]]; then
  echo "=== DRY RUN — no files will be deleted ==="
  echo ""
fi

echo "Base path: $BASE_PATH"
echo "Cells to purge: ${CELLS[*]}"
echo ""

for cell in "${CELLS[@]}"; do
  cx="${cell%,*}"
  cy="${cell#*,}"

  echo "--- Cell $cx,$cy ---"

  # Cell-level files
  remove "$BASE_PATH/chunkdata/chunkdata_${cx}_${cy}.bin"
  remove "$BASE_PATH/zpop/zpop_${cx}_${cy}.bin"
  remove "$BASE_PATH/apop/apop_${cx}_${cy}.bin"
  remove "$BASE_PATH/metagrid/metacell_${cx}_${cy}.bin"

  # Chunk-level files (32x32 per cell)
  chx_start=$((cx * CHUNKS_PER_CELL))
  chy_start=$((cy * CHUNKS_PER_CELL))
  chx_end=$((chx_start + CHUNKS_PER_CELL - 1))
  chy_end=$((chy_start + CHUNKS_PER_CELL - 1))

  for ((chx = chx_start; chx <= chx_end; chx++)); do
    for ((chy = chy_start; chy <= chy_end; chy++)); do
      remove "$BASE_PATH/map/${chx}/${chy}.bin"
      remove "$BASE_PATH/isoregiondata/datachunk_${chx}_${chy}.bin"
    done
    remove_dir_if_empty "$BASE_PATH/map/${chx}"
  done
done

echo ""
if [[ $DRY_RUN -eq 1 ]]; then
  echo "Would delete $deleted files. Run without --dry-run to execute."
else
  echo "Done. Deleted $deleted files."
  [[ $failed -gt 0 ]] && echo "Warning: $failed files failed to delete." || true
fi
