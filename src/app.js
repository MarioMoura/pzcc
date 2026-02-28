(function () {
  'use strict';

  // --- PZ B42 Coordinate Constants ---
  // B42 uses 256-tile cells (32 chunks of 8 tiles each)
  // Confirmed via pzmap2dzi lotheader.py and b42map.com coordinates
  const CELL_SIZE = 256;
  const CELLS_X = 78;
  const CELLS_Y = 63;
  const WORLD_MAX_X = CELLS_X * CELL_SIZE; // 19968
  const WORLD_MAX_Y = CELLS_Y * CELL_SIZE; // 16128

  const CHUNKS_PER_CELL = 32;
  const CHUNK_SIZE = 8;

  // Map image covers the full cell grid, origin at tile (0,0)
  const MAP_ORIGIN = { x: 0, y: 0 };
  const MAP_EXTENT = { x: WORLD_MAX_X, y: WORLD_MAX_Y };

  // --- State ---
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  const camera = { x: WORLD_MAX_X / 2, y: WORLD_MAX_Y / 2, zoom: 0.06 };
  const selections = { keep: new Set(), purge: new Set() };
  let activeMode = 'keep'; // 'keep' or 'purge'

  let mapImage = null;
  let mapLoaded = false;

  const MAP_FILES = {
    medium: 'map_medium.jpg',
    high: 'map_high.jpg',
    full: 'map_full.jpg',
  };

  let isDragging = false;
  let isSelecting = false;
  let selectionStart = null;
  let selectionEnd = null;
  let selectionType = null;
  let lastMouse = { x: 0, y: 0 };
  let worldMouse = { x: 0, y: 0 };
  let spaceHeld = false;

  // --- DOM refs ---
  const btnKeep = document.getElementById('btn-keep');
  const btnPurge = document.getElementById('btn-purge');
  const chkGrid = document.getElementById('chk-grid');
  const chkLabels = document.getElementById('chk-labels');
  const chkCoords = document.getElementById('chk-coords');
  const coordsDisplay = document.getElementById('coords-display');
  const statusBar = document.getElementById('status-bar');

  // --- Coordinate transforms ---
  function worldToScreen(wx, wy) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    return {
      x: cx + (wx - camera.x) * camera.zoom,
      y: cy + (wy - camera.y) * camera.zoom,
    };
  }

  function screenToWorld(sx, sy) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    return {
      x: camera.x + (sx - cx) / camera.zoom,
      y: camera.y + (sy - cy) / camera.zoom,
    };
  }

  function tileToCell(tx, ty) {
    return { cx: Math.floor(tx / CELL_SIZE), cy: Math.floor(ty / CELL_SIZE) };
  }

  function cellKey(cx, cy) {
    return cx + ',' + cy;
  }

  function parseCellKey(key) {
    const parts = key.split(',');
    return { cx: parseInt(parts[0]), cy: parseInt(parts[1]) };
  }

  // --- Map image setup ---
  function loadMap(resolution) {
    var file = MAP_FILES[resolution] || MAP_FILES.medium;
    mapLoaded = false;
    setStatus('Loading ' + file + '...');
    mapImage = new Image();
    mapImage.onload = function () {
      mapLoaded = true;
      render();
      setStatus('Map loaded — ' + mapImage.width + 'x' + mapImage.height);
    };
    mapImage.onerror = function () {
      setStatus('Failed to load ' + file);
    };
    mapImage.src = file;
  }

  // --- Rendering ---
  function render() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Draw map image
    if (mapLoaded) {
      const tl = worldToScreen(MAP_ORIGIN.x, MAP_ORIGIN.y);
      const br = worldToScreen(MAP_EXTENT.x, MAP_EXTENT.y);
      ctx.drawImage(mapImage, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }

    // Draw selections
    drawSelections();

    // Draw grid
    if (chkGrid.checked) {
      drawGrid();
    }

    // Draw in-progress selection rectangle
    if (isSelecting && selectionStart && selectionEnd) {
      drawSelectionPreview();
    }
  }

  function drawSelections() {
    for (const key of selections.keep) {
      const { cx, cy } = parseCellKey(key);
      drawCellOverlay(cx, cy, 'rgba(76, 175, 80, 0.3)', 'rgba(76, 175, 80, 0.7)');
    }
    for (const key of selections.purge) {
      const { cx, cy } = parseCellKey(key);
      drawCellOverlay(cx, cy, 'rgba(233, 69, 96, 0.3)', 'rgba(233, 69, 96, 0.7)');
    }
  }

  function drawCellOverlay(cx, cy, fill, stroke) {
    const tl = worldToScreen(cx * CELL_SIZE, cy * CELL_SIZE);
    const br = worldToScreen((cx + 1) * CELL_SIZE, (cy + 1) * CELL_SIZE);
    const sw = br.x - tl.x;
    const sh = br.y - tl.y;

    ctx.fillStyle = fill;
    ctx.fillRect(tl.x, tl.y, sw, sh);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(tl.x, tl.y, sw, sh);
  }

  function drawGrid() {
    const showLabels = chkLabels.checked;
    const screenTL = screenToWorld(0, 0);
    const screenBR = screenToWorld(canvas.width, canvas.height);

    const startCX = Math.max(0, Math.floor(screenTL.x / CELL_SIZE));
    const endCX = Math.min(CELLS_X, Math.ceil(screenBR.x / CELL_SIZE));
    const startCY = Math.max(0, Math.floor(screenTL.y / CELL_SIZE));
    const endCY = Math.min(CELLS_Y, Math.ceil(screenBR.y / CELL_SIZE));

    ctx.strokeStyle = 'rgba(200, 210, 220, 0.1)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let cx = startCX; cx <= endCX; cx++) {
      const sx = worldToScreen(cx * CELL_SIZE, 0).x;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height);
    }
    for (let cy = startCY; cy <= endCY; cy++) {
      const sy = worldToScreen(0, cy * CELL_SIZE).y;
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
    }
    ctx.stroke();

    if (showLabels && camera.zoom > 0.02) {
      const fontSize = Math.max(11, Math.min(16, camera.zoom * 250));
      ctx.font = 'bold ' + fontSize + 'px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const pad = 3;
      for (let cx = startCX; cx < endCX; cx++) {
        for (let cy = startCY; cy < endCY; cy++) {
          const center = worldToScreen(
            (cx + 0.5) * CELL_SIZE,
            (cy + 0.5) * CELL_SIZE
          );
          const label = cx + ',' + cy;
          const metrics = ctx.measureText(label);
          const tw = metrics.width;
          const th = fontSize;

          const rx = center.x - tw / 2 - pad;
          const ry = center.y - th / 2 - pad;
          const rw = tw + pad * 2;
          const rh = th + pad * 2;

          ctx.fillStyle = 'rgba(14, 17, 24, 0.7)';
          ctx.beginPath();
          ctx.roundRect(rx, ry, rw, rh, 3);
          ctx.fill();

          ctx.fillStyle = 'rgba(200, 210, 220, 0.9)';
          ctx.fillText(label, center.x, center.y);
        }
      }
    }
  }

  function drawSelectionPreview() {
    const c1 = tileToCell(selectionStart.x, selectionStart.y);
    const c2 = tileToCell(selectionEnd.x, selectionEnd.y);
    const minCX = Math.max(0, Math.min(c1.cx, c2.cx));
    const maxCX = Math.min(CELLS_X - 1, Math.max(c1.cx, c2.cx));
    const minCY = Math.max(0, Math.min(c1.cy, c2.cy));
    const maxCY = Math.min(CELLS_Y - 1, Math.max(c1.cy, c2.cy));

    const color = selectionType === 'keep'
      ? 'rgba(76, 175, 80, 0.2)'
      : 'rgba(233, 69, 96, 0.2)';
    const borderColor = selectionType === 'keep'
      ? 'rgba(76, 175, 80, 0.8)'
      : 'rgba(233, 69, 96, 0.8)';

    const tl = worldToScreen(minCX * CELL_SIZE, minCY * CELL_SIZE);
    const br = worldToScreen((maxCX + 1) * CELL_SIZE, (maxCY + 1) * CELL_SIZE);

    ctx.fillStyle = color;
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.setLineDash([]);
  }

  // --- Resize ---
  function resizeCanvas() {
    const container = document.getElementById('map-container');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    render();
  }

  // --- Input handling ---
  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('mousedown', function (e) {
    const pos = getMousePos(e);

    // Right-click or middle-click: pan
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      isDragging = true;
      lastMouse = pos;
      return;
    }

    if (e.button !== 0) return;

    // Space+left-click: pan
    if (spaceHeld) {
      isDragging = true;
      lastMouse = pos;
      return;
    }

    // Left-click: start selection
    // Ctrl overrides to PURGE, Shift overrides to KEEP, otherwise uses toolbar mode
    isSelecting = true;
    if (e.ctrlKey) {
      selectionType = 'purge';
    } else if (e.shiftKey) {
      selectionType = 'keep';
    } else {
      selectionType = activeMode;
    }
    const world = screenToWorld(pos.x, pos.y);
    selectionStart = world;
    selectionEnd = world;
  });

  canvas.addEventListener('mousemove', function (e) {
    const pos = getMousePos(e);

    // Update world coords display
    const world = screenToWorld(pos.x, pos.y);
    worldMouse = world;
    if (chkCoords.checked) {
      const cell = tileToCell(world.x, world.y);
      coordsDisplay.style.display = 'block';
      coordsDisplay.textContent =
        'Tile: ' + Math.floor(world.x) + ', ' + Math.floor(world.y) +
        '  |  Cell: ' + cell.cx + ', ' + cell.cy;
    }

    if (isSelecting) {
      selectionEnd = screenToWorld(pos.x, pos.y);
      render();
      return;
    }

    if (isDragging) {
      const dx = pos.x - lastMouse.x;
      const dy = pos.y - lastMouse.y;
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
      lastMouse = pos;
      render();
    }
  });

  canvas.addEventListener('mouseup', function (e) {
    if (isSelecting && selectionStart && selectionEnd) {
      // Commit selection
      const c1 = tileToCell(selectionStart.x, selectionStart.y);
      const c2 = tileToCell(selectionEnd.x, selectionEnd.y);
      const minCX = Math.max(0, Math.min(c1.cx, c2.cx));
      const maxCX = Math.min(CELLS_X - 1, Math.max(c1.cx, c2.cx));
      const minCY = Math.max(0, Math.min(c1.cy, c2.cy));
      const maxCY = Math.min(CELLS_Y - 1, Math.max(c1.cy, c2.cy));

      const target = selections[selectionType];
      const opposite = selectionType === 'keep' ? selections.purge : selections.keep;

      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cy = minCY; cy <= maxCY; cy++) {
          const key = cellKey(cx, cy);
          target.add(key);
          opposite.delete(key); // Remove from opposite set
        }
      }

      const count = (maxCX - minCX + 1) * (maxCY - minCY + 1);
      setStatus('Selected ' + count + ' cells as ' + selectionType.toUpperCase());
    }

    isSelecting = false;
    isDragging = false;
    selectionStart = null;
    selectionEnd = null;
    render();
  });

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    const pos = getMousePos(e);
    const worldBefore = screenToWorld(pos.x, pos.y);

    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    camera.zoom = Math.max(0.005, Math.min(2, camera.zoom * factor));

    // Keep the point under cursor stable
    const worldAfter = screenToWorld(pos.x, pos.y);
    camera.x -= worldAfter.x - worldBefore.x;
    camera.y -= worldAfter.y - worldBefore.y;

    render();
  }, { passive: false });

  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  canvas.addEventListener('dblclick', function (e) {
    // Double-click: remove selection at this cell
    const pos = getMousePos(e);
    const world = screenToWorld(pos.x, pos.y);
    const cell = tileToCell(world.x, world.y);
    const key = cellKey(cell.cx, cell.cy);
    if (selections.keep.delete(key) || selections.purge.delete(key)) {
      render();
      setStatus('Removed selection at cell ' + key);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      spaceHeld = true;
      canvas.style.cursor = 'grab';
    }
  });

  document.addEventListener('keyup', function (e) {
    if (e.code === 'Space') {
      spaceHeld = false;
      canvas.style.cursor = '';
    }
  });

  // --- Checkbox events ---
  chkGrid.addEventListener('change', render);
  chkLabels.addEventListener('change', render);
  chkCoords.addEventListener('change', function () {
    if (!chkCoords.checked) coordsDisplay.style.display = 'none';
  });

  // --- Mode buttons ---
  btnKeep.addEventListener('click', function () {
    activeMode = 'keep';
    btnKeep.classList.add('active');
    btnPurge.classList.remove('active');
  });
  btnPurge.addEventListener('click', function () {
    activeMode = 'purge';
    btnPurge.classList.add('active');
    btnKeep.classList.remove('active');
  });

  // --- Clear buttons ---
  document.getElementById('btn-clear-keep').addEventListener('click', function () {
    selections.keep.clear();
    render();
    setStatus('Cleared KEEP selections');
  });
  document.getElementById('btn-clear-purge').addEventListener('click', function () {
    selections.purge.clear();
    render();
    setStatus('Cleared PURGE selections');
  });
  document.getElementById('btn-clear-all').addEventListener('click', function () {
    selections.keep.clear();
    selections.purge.clear();
    render();
    setStatus('Cleared all selections');
  });
  document.getElementById('btn-purge-all').addEventListener('click', function () {
    for (let cx = 0; cx < CELLS_X; cx++) {
      for (let cy = 0; cy < CELLS_Y; cy++) {
        const key = cellKey(cx, cy);
        if (!selections.keep.has(key)) {
          selections.purge.add(key);
        }
      }
    }
    render();
    setStatus('Marked ' + selections.purge.size + ' cells as purge');
  });

  // --- Script Generation ---
  document.getElementById('btn-export').addEventListener('click', function () {
    const format = document.getElementById('sel-format').value;
    const basePath = document.getElementById('txt-path').value.trim() || '.';

    const cellsToDelete = getCellsToDelete();
    if (cellsToDelete.length === 0) {
      setStatus('Nothing to export — select some cells first');
      return;
    }

    let script, filename;
    switch (format) {
      case 'bash':
        script = generateBash(cellsToDelete, basePath);
        filename = 'pz-cleanup.sh';
        break;
      case 'powershell':
        script = generatePowershell(cellsToDelete, basePath);
        filename = 'pz-cleanup.ps1';
        break;
      case 'ftp':
        script = generateFTP(cellsToDelete, basePath);
        filename = 'pz-cleanup-ftp.txt';
        break;
    }

    downloadFile(filename, script, 'text/plain');
    setStatus('Exported ' + cellsToDelete.length + ' cells — ' + filename);
  });

  document.getElementById('btn-copy-cells').addEventListener('click', function () {
    var cells = getCellsToDelete();
    if (cells.length === 0) {
      setStatus('Nothing to copy — select some cells first');
      return;
    }
    var coords = cells.map(function (c) { return c.cx + ',' + c.cy; }).join(' ');
    var basePath = document.getElementById('txt-path').value.trim() || '/path/to/save';
    var cmd = './pzcc.sh --path ' + basePath + ' --purge ' + coords;
    navigator.clipboard.writeText(cmd).then(function () {
      setStatus('Copied command for ' + cells.length + ' cells');
    }, function () {
      setStatus('Copy failed — check browser permissions');
    });
  });

  function getCellsToDelete() {
    return Array.from(selections.purge).map(parseCellKey);
  }

  // --- Script generators ---
  // Actual PZ B42 server save structure:
  //   chunkdata/chunkdata_CX_CY.bin    (cell coords)
  //   zpop/zpop_CX_CY.bin              (cell coords)
  //   apop/apop_CX_CY.bin              (cell coords)
  //   metagrid/metacell_CX_CY.bin      (cell coords)
  //   map/{chunkX}/{chunkY}.bin         (chunk coords, subdirectories)
  //   isoregiondata/datachunk_CHX_CHY.bin (chunk coords)

  function generateBash(cells, basePath) {
    const lines = [
      '#!/bin/bash',
      '# PZ B42 Cell Cleaner — generated ' + new Date().toISOString(),
      '# Cells to delete: ' + cells.length,
      '',
      'BASE="' + basePath + '"',
      '',
    ];

    // Cell-level files
    lines.push('# --- Delete cell-level files ---');
    for (const { cx, cy } of cells) {
      lines.push('rm -f "$BASE/chunkdata/chunkdata_' + cx + '_' + cy + '.bin"');
      lines.push('rm -f "$BASE/zpop/zpop_' + cx + '_' + cy + '.bin"');
      lines.push('rm -f "$BASE/apop/apop_' + cx + '_' + cy + '.bin"');
      lines.push('rm -f "$BASE/metagrid/metacell_' + cx + '_' + cy + '.bin"');
    }
    lines.push('');

    // Chunk-level files (32x32 chunks per cell in B42)
    lines.push('# --- Delete chunk-level files ---');
    for (const { cx, cy } of cells) {
      const chxStart = cx * CHUNKS_PER_CELL;
      const chyStart = cy * CHUNKS_PER_CELL;
      const chxEnd = chxStart + CHUNKS_PER_CELL - 1;
      const chyEnd = chyStart + CHUNKS_PER_CELL - 1;
      lines.push('# Cell ' + cx + ',' + cy);
      lines.push('for chx in $(seq ' + chxStart + ' ' + chxEnd + '); do');
      lines.push('  for chy in $(seq ' + chyStart + ' ' + chyEnd + '); do');
      lines.push('    rm -f "$BASE/map/${chx}/${chy}.bin"');
      lines.push('    rm -f "$BASE/isoregiondata/datachunk_${chx}_${chy}.bin"');
      lines.push('  done');
      lines.push('  # Remove chunk directory if empty');
      lines.push('  rmdir "$BASE/map/${chx}" 2>/dev/null');
      lines.push('done');
    }
    lines.push('');
    lines.push('echo "Cleanup complete."');

    return lines.join('\n');
  }

  function generatePowershell(cells, basePath) {
    const lines = [
      '# PZ B42 Cell Cleaner — generated ' + new Date().toISOString(),
      '# Cells to delete: ' + cells.length,
      '',
      '$Base = "' + basePath.replace(/\//g, '\\') + '"',
      '',
    ];

    // Cell-level files
    lines.push('# --- Delete cell-level files ---');
    for (const { cx, cy } of cells) {
      lines.push('Remove-Item -Path "$Base\\chunkdata\\chunkdata_' + cx + '_' + cy + '.bin" -ErrorAction SilentlyContinue');
      lines.push('Remove-Item -Path "$Base\\zpop\\zpop_' + cx + '_' + cy + '.bin" -ErrorAction SilentlyContinue');
      lines.push('Remove-Item -Path "$Base\\apop\\apop_' + cx + '_' + cy + '.bin" -ErrorAction SilentlyContinue');
      lines.push('Remove-Item -Path "$Base\\metagrid\\metacell_' + cx + '_' + cy + '.bin" -ErrorAction SilentlyContinue');
    }
    lines.push('');

    // Chunk-level files
    lines.push('# --- Delete chunk-level files ---');
    for (const { cx, cy } of cells) {
      const chxStart = cx * CHUNKS_PER_CELL;
      const chyStart = cy * CHUNKS_PER_CELL;
      const chxEnd = chxStart + CHUNKS_PER_CELL - 1;
      const chyEnd = chyStart + CHUNKS_PER_CELL - 1;
      lines.push('# Cell ' + cx + ',' + cy);
      lines.push(chxStart + '..' + chxEnd + ' | ForEach-Object {');
      lines.push('  $chx = $_');
      lines.push('  ' + chyStart + '..' + chyEnd + ' | ForEach-Object {');
      lines.push('    Remove-Item -Path "$Base\\map\\$chx\\$_.bin" -ErrorAction SilentlyContinue');
      lines.push('    Remove-Item -Path "$Base\\isoregiondata\\datachunk_${chx}_${_}.bin" -ErrorAction SilentlyContinue');
      lines.push('  }');
      lines.push('}');
    }
    lines.push('');
    lines.push('Write-Host "Cleanup complete."');

    return lines.join('\r\n');
  }

  function generateFTP(cells, basePath) {
    const lines = [
      '# PZ B42 Cell Cleaner — FTP commands',
      '# Generated ' + new Date().toISOString(),
      '# Cells to delete: ' + cells.length,
      '# Paste these commands into your FTP client',
      '',
    ];

    if (basePath && basePath !== '.') {
      lines.push('cd ' + basePath);
      lines.push('');
    }

    // Cell-level files
    lines.push('# --- Delete cell-level files ---');
    for (const { cx, cy } of cells) {
      lines.push('delete chunkdata/chunkdata_' + cx + '_' + cy + '.bin');
      lines.push('delete zpop/zpop_' + cx + '_' + cy + '.bin');
      lines.push('delete apop/apop_' + cx + '_' + cy + '.bin');
      lines.push('delete metagrid/metacell_' + cx + '_' + cy + '.bin');
    }
    lines.push('');

    // Chunk-level files
    lines.push('# --- Delete chunk-level files ---');
    for (const { cx, cy } of cells) {
      const chxStart = cx * CHUNKS_PER_CELL;
      const chyStart = cy * CHUNKS_PER_CELL;
      for (let chx = chxStart; chx < chxStart + CHUNKS_PER_CELL; chx++) {
        for (let chy = chyStart; chy < chyStart + CHUNKS_PER_CELL; chy++) {
          lines.push('delete map/' + chx + '/' + chy + '.bin');
          lines.push('delete isoregiondata/datachunk_' + chx + '_' + chy + '.bin');
        }
      }
    }

    return lines.join('\n');
  }

  // --- Helpers ---
  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function setStatus(msg) {
    statusBar.textContent = msg;
  }

  // --- Map resolution selector ---
  var selMapRes = document.getElementById('sel-map-res');
  selMapRes.addEventListener('change', function () {
    loadMap(selMapRes.value);
  });

  // --- Init ---
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  loadMap(selMapRes.value);
  setStatus('Drag to select cells, right-drag to pan');
})();
