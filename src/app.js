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
  const selectionBar = document.getElementById('selection-bar');
  const selectionSummary = document.getElementById('selection-summary');

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

    const startCX = Math.floor(screenTL.x / CELL_SIZE);
    const endCX = Math.ceil(screenBR.x / CELL_SIZE);
    const startCY = Math.floor(screenTL.y / CELL_SIZE);
    const endCY = Math.ceil(screenBR.y / CELL_SIZE);

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
    const minCX = Math.min(c1.cx, c2.cx);
    const maxCX = Math.max(c1.cx, c2.cx);
    const minCY = Math.min(c1.cy, c2.cy);
    const maxCY = Math.max(c1.cy, c2.cy);

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
      const minCX = Math.min(c1.cx, c2.cx);
      const maxCX = Math.max(c1.cx, c2.cx);
      const minCY = Math.min(c1.cy, c2.cy);
      const maxCY = Math.max(c1.cy, c2.cy);

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
      updateSelectionBar();
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
      updateSelectionBar();
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
    updateSelectionBar();
  });
  document.getElementById('btn-clear-purge').addEventListener('click', function () {
    selections.purge.clear();
    render();
    setStatus('Cleared PURGE selections');
    updateSelectionBar();
  });
  document.getElementById('btn-clear-all').addEventListener('click', function () {
    selections.keep.clear();
    selections.purge.clear();
    render();
    setStatus('Cleared all selections');
    updateSelectionBar();
  });
  document.getElementById('btn-invert').addEventListener('click', function () {
    var oldKeep = new Set(selections.keep);
    selections.keep = new Set(selections.purge);
    selections.purge = oldKeep;
    render();
    setStatus('Inverted — ' + selections.keep.size + ' keep, ' + selections.purge.size + ' purge');
    updateSelectionBar();
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
    updateSelectionBar();
  });

  // --- Presets ---
  var PRESETS = [
    { id: 'rosewood', label: 'Rosewood', cells: [
      [31,43],
      [29,44],[30,44],[31,44],[32,44],[33,44],
      [29,45],[30,45],[31,45],[32,45],[33,45],
      [29,46],[30,46],[31,46],[32,46],[33,46],
      [29,47],[30,47],[31,47],[32,47],[33,47],
      [30,48],[31,48],[32,48],
    ]},
    { id: 'louisville', label: 'Louisville', cells: [
      // Main block 46-54 x 4-13
      [46,4],[47,4],[48,4],[49,4],[50,4],[51,4],[52,4],[53,4],[54,4],
      [46,5],[47,5],[48,5],[49,5],[50,5],[51,5],[52,5],[53,5],[54,5],
      [46,6],[47,6],[48,6],[49,6],[50,6],[51,6],[52,6],[53,6],[54,6],
      [46,7],[47,7],[48,7],[49,7],[50,7],[51,7],[52,7],[53,7],[54,7],
      [46,8],[47,8],[48,8],[49,8],[50,8],[51,8],[52,8],[53,8],[54,8],[55,8],
      [46,9],[47,9],[48,9],[49,9],[50,9],[51,9],[52,9],[53,9],[54,9],[55,9],[58,9],[59,9],[60,9],[61,9],
      [46,10],[47,10],[48,10],[49,10],[50,10],[51,10],[52,10],[53,10],[54,10],[55,10],[58,10],[59,10],[60,10],[61,10],
      [46,11],[47,11],[48,11],[49,11],[50,11],[51,11],[52,11],[53,11],[54,11],[55,11],[56,11],[57,11],[58,11],[59,11],[60,11],[61,11],
      [46,12],[47,12],[48,12],[49,12],[50,12],[51,12],[52,12],[53,12],[54,12],[55,12],[56,12],[57,12],[58,12],[59,12],[60,12],[61,12],
      [46,13],[47,13],[48,13],[49,13],[50,13],[51,13],[52,13],[53,13],[54,13],[55,13],[56,13],[57,13],[58,13],[59,13],[60,13],[61,13],
      // South extensions
      [47,14],[48,14],[49,14],[50,14],
      [47,15],[48,15],[49,15],[50,15],
      [48,16],[49,16],[50,16],
      [48,17],[49,17],[50,17],
    ]},
    { id: 'riverside', label: 'Riverside', cells: [
      [22,20],[23,20],[24,20],[25,20],[26,20],
      [22,21],[23,21],[24,21],[25,21],[26,21],
    ]},
    { id: 'west_point', label: 'West Point', cells: [
      [42,25],[43,25],[44,25],[45,25],[46,25],[47,25],
      [42,26],[43,26],[44,26],[45,26],[46,26],[47,26],
      [42,27],[43,27],[44,27],[45,27],[46,27],[47,27],
      [42,28],[43,28],[44,28],[45,28],[46,28],[47,28],
    ]},
    { id: 'muldraugh', label: 'Muldraugh', cells: [
      [41,35],[42,35],
      [40,36],[41,36],[42,36],
      [39,37],[40,37],[41,37],[42,37],
      [41,38],[42,38],
      [40,39],[41,39],[42,39],
      [41,40],[42,40],
      [41,41],[42,41],

    ]},
    { id: 'fallas_lake', label: 'Fallas Lake', cells: [
      [27,31],[28,31],[29,31],
      [27,32],[28,32],[29,32],
      [27,33],[28,33],[29,33],
    ]},
    { id: 'irvington', label: 'Irvington', cells: [
      [10,53],[11,53],
      [7,54],[8,54],[9,54],[10,54],[11,54],
      [6,55],[7,55],[8,55],[9,55],[10,55],[11,55],[12,55],
      [6,56],[7,56],[8,56],[9,56],[10,56],[11,56],[12,56],[13,56],[14,56],[15,56],
      [6,57],[7,57],[8,57],[9,57],[10,57],[11,57],[12,57],[13,57],[14,57],[15,57],
      [6,58],[7,58],[8,58],[9,58],[10,58],[11,58],[12,58],[13,58],[14,58],[15,58],
    ]},
    { id: 'ekron', label: 'Ekron', cells: [
      [0,37],[0,38],
      [1,36],[1,37],[1,38],[1,39],
      [2,36],[2,37],[2,38],[2,39],
      [3,36],[3,37],[3,38],[3,39],
      [4,37],[4,38],
    ]},
    { id: 'brandenburg', label: 'Brandenburg', cells: [
      [4,21],[5,21],[6,21],[7,21],[8,21],[9,21],[10,21],[11,21],
      [4,22],[5,22],[6,22],[7,22],[8,22],[9,22],[10,22],[11,22],
      [4,23],[5,23],[6,23],[7,23],[8,23],[9,23],[10,23],[11,23],
      [4,24],[5,24],[6,24],[7,24],[8,24],[9,24],[10,24],[11,24],
      [4,25],[5,25],[6,25],[7,25],[8,25],[9,25],[10,25],[11,25],
      [4,26],[5,26],[6,26],[7,26],[8,26],[9,26],[10,26],[11,26],
    ]},
    { id: 'march_ridge', label: 'March Ridge', cells: [
      [40,48],
      [38,49],[39,49],[40,49],
      [38,50],[39,50],[40,50],
      [38,51],[39,51],[40,51],
    ]},
  ];

  var MOD_PRESETS = [
    { id: 'rv_interiors', label: 'RV Interiors', cells: [
      [75,40],[75,41],[75,42],[75,43],[75,44],
      [76,40],[76,41],[76,42],[76,43],[76,44],
      [77,40],[77,41],[77,42],[77,43],[77,44],
      [78,40],[78,41],[78,42],[78,43],[78,44],
      [79,40],[79,41],[79,42],[79,43],[79,44],
      [80,40],[80,41],[80,42],[80,43],[80,44],
      [81,40],[81,41],[81,42],[81,43],[81,44],
      [82,40],[82,41],[82,42],[82,43],[82,44],
    ]},
  ];

  var presetContainer = document.getElementById('preset-buttons');
  PRESETS.forEach(function (preset) {
    var btn = document.createElement('button');
    btn.textContent = preset.label;
    btn.dataset.preset = preset.id;
    btn.addEventListener('click', function () {
      var keys = preset.cells.map(function (c) { return cellKey(c[0], c[1]); });
      // Check if all cells are already in the active mode — if so, remove them (toggle off)
      var target = selections[activeMode];
      var opposite = activeMode === 'keep' ? selections.purge : selections.keep;
      var allSelected = keys.every(function (k) { return target.has(k); });

      if (allSelected) {
        keys.forEach(function (k) { target.delete(k); });
        render();
        setStatus('Removed ' + preset.label + ' from ' + activeMode.toUpperCase());
      } else {
        keys.forEach(function (k) { target.add(k); opposite.delete(k); });
        render();
        setStatus('Applied ' + preset.label + ' — ' + keys.length + ' cells as ' + activeMode.toUpperCase());
      }
      updateSelectionBar();
    });
    presetContainer.appendChild(btn);
  });

  var modPresetContainer = document.getElementById('mod-preset-buttons');
  MOD_PRESETS.forEach(function (preset) {
    var btn = document.createElement('button');
    btn.textContent = preset.label;
    btn.dataset.preset = preset.id;
    btn.addEventListener('click', function () {
      var keys = preset.cells.map(function (c) { return cellKey(c[0], c[1]); });
      var target = selections[activeMode];
      var opposite = activeMode === 'keep' ? selections.purge : selections.keep;
      var allSelected = keys.every(function (k) { return target.has(k); });

      if (allSelected) {
        keys.forEach(function (k) { target.delete(k); });
        render();
        setStatus('Removed ' + preset.label + ' from ' + activeMode.toUpperCase());
      } else {
        keys.forEach(function (k) { target.add(k); opposite.delete(k); });
        render();
        setStatus('Applied ' + preset.label + ' — ' + keys.length + ' cells as ' + activeMode.toUpperCase());
      }
      updateSelectionBar();
    });
    modPresetContainer.appendChild(btn);
  });

  // --- Script Generation ---
  document.getElementById('btn-export').addEventListener('click', async function () {
    const format = document.getElementById('sel-format').value;
    const basePath = document.getElementById('txt-path').value.trim() || '.';

    const cellsToDelete = getCellsToDelete();
    if (cellsToDelete.length === 0) {
      setStatus('Nothing to export — select some cells first');
      return;
    }

    let script, filename;
    switch (format) {
      case 'python':
        script = await generatePython(cellsToDelete, basePath);
        filename = 'pz-cleanup.py';
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

  async function generatePython(cells, basePath) {
    const response = await fetch('pz-cleanup.py');
    let template = await response.text();

    const cellsList = cells.map(function (c) { return '    (' + c.cx + ', ' + c.cy + ')'; }).join(',\n');
    template = template.replace(
      /^CELLS = \[\]  # PZCC_INJECT_CELLS$/m,
      'CELLS = [\n' + cellsList + ',\n]'
    );
    template = template.replace(
      /^DEFAULT_PATH = "."  # PZCC_INJECT_PATH$/m,
      'DEFAULT_PATH = ' + JSON.stringify(basePath)
    );

    return template;
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

  function updateSelectionBar() {
    var keepCount = selections.keep.size;
    var purgeCount = selections.purge.size;
    if (keepCount === 0 && purgeCount === 0) {
      selectionBar.hidden = true;
      return;
    }
    var parts = [];
    if (keepCount > 0) parts.push(keepCount + ' keep');
    if (purgeCount > 0) parts.push(purgeCount + ' purge');
    selectionSummary.textContent = parts.join(' \u00b7 ');
    selectionBar.hidden = false;
  }

  document.getElementById('btn-copy-keep').addEventListener('click', function () {
    if (selections.keep.size === 0) {
      setStatus('Nothing to copy — no keep cells selected');
      return;
    }
    var coords = Array.from(selections.keep).map(function (k) {
      var c = parseCellKey(k);
      return c.cx + '_' + c.cy;
    }).join('\n');
    navigator.clipboard.writeText(coords).then(function () {
      setStatus('Copied ' + selections.keep.size + ' keep cell coordinates');
    }, function () {
      setStatus('Copy failed — check browser permissions');
    });
  });

  document.getElementById('btn-copy-purge-sel').addEventListener('click', function () {
    if (selections.purge.size === 0) {
      setStatus('Nothing to copy — no purge cells selected');
      return;
    }
    var coords = Array.from(selections.purge).map(function (k) {
      var c = parseCellKey(k);
      return c.cx + '_' + c.cy;
    }).join('\n');
    navigator.clipboard.writeText(coords).then(function () {
      setStatus('Copied ' + selections.purge.size + ' purge cell coordinates');
    }, function () {
      setStatus('Copy failed — check browser permissions');
    });
  });

  // --- Map resolution selector ---
  var selMapRes = document.getElementById('sel-map-res');
  selMapRes.addEventListener('change', function () {
    loadMap(selMapRes.value);
  });

  // --- Walkthrough ---
  var walkthroughSteps = [
    {
      target: '.btn-group',
      title: 'Selection Mode',
      text: 'Choose KEEP to mark cells you want to preserve, or PURGE to mark cells for deletion.',
    },
    {
      target: '#map-container',
      title: 'Map Interaction',
      text: 'Drag to select cells. Hold Shift to keep or Ctrl to purge while clicking or dragging. Right-drag or Space+drag to pan. Scroll to zoom. Double-click to deselect.',
    },
    {
      target: '#section-export',
      title: 'Export Script',
      text: 'Generate a ready-to-run cleanup script with all delete commands baked in. Pick a format, set your server save path, and export.',
    },
    {
      target: '#section-pzcc-utility',
      title: 'PZCC Utility',
      text: 'Prefer the command line? Copy cell coordinates to your clipboard with "Copy pzcc cmd", then download pzcc.sh — a reusable shell script you feed those coords to instead of generating a one-off export.',
    },
  ];

  var wtEl = document.getElementById('walkthrough');
  var wtSpotlight = wtEl.querySelector('.walkthrough__spotlight');
  var wtCard = wtEl.querySelector('.walkthrough__card');
  var wtStep = wtEl.querySelector('.walkthrough__step');
  var wtTitle = wtEl.querySelector('.walkthrough__title');
  var wtText = wtEl.querySelector('.walkthrough__text');
  var wtNext = wtEl.querySelector('.walkthrough__next');
  var wtSkip = wtEl.querySelector('.walkthrough__skip');
  var wtCurrent = 0;

  function getStepBounds(step) {
    var el = document.querySelector(step.target);
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    var rect = el.getBoundingClientRect();
    if (step.targetEnd) {
      var el2 = document.querySelector(step.targetEnd);
      if (el2) {
        var rect2 = el2.getBoundingClientRect();
        return {
          top: Math.min(rect.top, rect2.top),
          left: Math.min(rect.left, rect2.left),
          right: Math.max(rect.right, rect2.right),
          bottom: Math.max(rect.bottom, rect2.bottom),
          width: Math.max(rect.right, rect2.right) - Math.min(rect.left, rect2.left),
          height: Math.max(rect.bottom, rect2.bottom) - Math.min(rect.top, rect2.top),
        };
      }
    }
    return rect;
  }

  function positionStep(index) {
    var step = walkthroughSteps[index];
    var bounds = getStepBounds(step);
    if (!bounds) return;

    var pad = 6;
    wtSpotlight.style.top = (bounds.top - pad) + 'px';
    wtSpotlight.style.left = (bounds.left - pad) + 'px';
    wtSpotlight.style.width = (bounds.width + pad * 2) + 'px';
    wtSpotlight.style.height = (bounds.height + pad * 2) + 'px';

    wtStep.textContent = (index + 1) + ' / ' + walkthroughSteps.length;
    wtTitle.textContent = step.title;
    wtText.textContent = step.text;
    wtNext.textContent = index === walkthroughSteps.length - 1 ? 'Got it' : 'Next';

    // Position card next to spotlight
    var cardW = 320;
    var cardH = wtCard.offsetHeight || 180;
    var gap = 14;

    // Prefer right of spotlight; fall back to below
    var cx = bounds.right + gap;
    var cy = bounds.top;

    if (cx + cardW > window.innerWidth - 12) {
      cx = bounds.left - cardW - gap;
    }
    if (cx < 12) {
      cx = bounds.left;
      cy = bounds.bottom + gap;
    }
    if (cy + cardH > window.innerHeight - 12) {
      cy = window.innerHeight - cardH - 12;
    }
    if (cy < 12) cy = 12;

    wtCard.style.left = cx + 'px';
    wtCard.style.top = cy + 'px';
  }

  function showWalkthrough() {
    wtCurrent = 0;
    wtEl.hidden = false;
    wtCard.classList.remove('fade-out');
    positionStep(0);
  }

  function hideWalkthrough() {
    wtEl.hidden = true;
    localStorage.setItem('pzcc-walkthrough-seen', '1');
  }

  wtNext.addEventListener('click', function () {
    if (wtCurrent >= walkthroughSteps.length - 1) {
      hideWalkthrough();
      return;
    }
    wtCard.classList.add('fade-out');
    setTimeout(function () {
      wtCurrent++;
      positionStep(wtCurrent);
      wtCard.classList.remove('fade-out');
    }, 180);
  });

  wtSkip.addEventListener('click', hideWalkthrough);

  wtEl.querySelector('.walkthrough__backdrop').addEventListener('click', hideWalkthrough);

  document.getElementById('btn-help').addEventListener('click', showWalkthrough);

  window.addEventListener('resize', function () {
    if (!wtEl.hidden) positionStep(wtCurrent);
  });

  // --- Init ---
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  loadMap(selMapRes.value);
  setStatus('Drag to select cells, right-drag to pan');

  // Auto-show walkthrough on first visit, after map loads
  if (!localStorage.getItem('pzcc-walkthrough-seen')) {
    var origOnload = mapImage.onload;
    mapImage.onload = function () {
      origOnload.call(this);
      setTimeout(showWalkthrough, 400);
    };
  }
})();
