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
  const populatedCells = new Set();
  const populatedChunks = new Set(); // chunk-level granularity from map/ scan
  let activeMode = 'keep'; // 'keep' or 'purge'
  let saveDirHandle = null; // Set when loaded via showDirectoryPicker with readwrite
  let mapMeta = null; // Parsed map_meta.bin data

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
  const btnLoadSave = document.getElementById('btn-load-save');
  const loadSaveStatus = document.getElementById('load-save-status');
  const chkLegend = document.getElementById('chk-legend');
  const mapLegend = document.getElementById('map-legend');
  const btnDeletePurged = document.getElementById('btn-delete-purged');

  // --- Map legend layer toggles ---
  var layerVisible = {};
  mapLegend.addEventListener('click', function (e) {
    var item = e.target.closest('.map-legend-item[data-layer]');
    if (!item) return;
    var layer = item.dataset.layer;
    var isOff = item.classList.toggle('off');
    layerVisible[layer] = !isOff;
    // Sync sidebar checkboxes for world data layers
    var chkMap = {
      'safehouses': 'chk-safehouses',
      'npvp-zones': 'chk-npvp-zones',
      'desig-zones': 'chk-desig-zones',
    };
    if (chkMap[layer]) {
      var chk = document.getElementById(chkMap[layer]);
      if (chk) chk.checked = !isOff;
    }
    render();
  });
  function isLayerVisible(layer) {
    return layerVisible[layer] !== false;
  }

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

  function getSafehouseCellKeys() {
    var keys = new Set();
    if (!mapMeta) return keys;
    for (var sh of mapMeta.safehouses) {
      var c1 = tileToCell(sh.x, sh.y);
      var c2 = tileToCell(sh.x + sh.w - 1, sh.y + sh.h - 1);
      for (var cx = c1.cx; cx <= c2.cx; cx++) {
        for (var cy = c1.cy; cy <= c2.cy; cy++) {
          keys.add(cellKey(cx, cy));
        }
      }
    }
    return keys;
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

    // Draw populated cells (under selections)
    if (isLayerVisible('populated')) drawPopulated();

    // Draw map_meta overlays (under selections)
    drawMapMetaOverlays();

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

  function drawPopulated() {
    if (populatedChunks.size > 0) {
      var chunkScreenSize = CHUNK_SIZE * camera.zoom;
      ctx.fillStyle = 'rgba(255, 193, 7, 0.2)';

      if (chunkScreenSize < 3) {
        // Zoomed out: draw at cell level from populatedCells for performance
        for (var ckey of populatedCells) {
          var cp = parseCellKey(ckey);
          drawCellOverlay(cp.cx, cp.cy, 'rgba(255, 193, 7, 0.2)', 'rgba(255, 193, 7, 0.5)');
        }
      } else {
        // Zoomed in: draw individual chunks
        var screenTL = screenToWorld(0, 0);
        var screenBR = screenToWorld(canvas.width, canvas.height);
        var minChX = Math.floor(screenTL.x / CHUNK_SIZE);
        var maxChX = Math.ceil(screenBR.x / CHUNK_SIZE);
        var minChY = Math.floor(screenTL.y / CHUNK_SIZE);
        var maxChY = Math.ceil(screenBR.y / CHUNK_SIZE);

        for (var key of populatedChunks) {
          var sep = key.indexOf(',');
          var chx = parseInt(key.substring(0, sep));
          var chy = parseInt(key.substring(sep + 1));
          if (chx < minChX || chx > maxChX || chy < minChY || chy > maxChY) continue;
          var tl = worldToScreen(chx * CHUNK_SIZE, chy * CHUNK_SIZE);
          var br = worldToScreen((chx + 1) * CHUNK_SIZE, (chy + 1) * CHUNK_SIZE);
          ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        }
      }
    } else {
      // Cell-level fallback (file input path)
      for (const key of populatedCells) {
        const { cx, cy } = parseCellKey(key);
        drawCellOverlay(cx, cy, 'rgba(255, 193, 7, 0.2)', 'rgba(255, 193, 7, 0.5)');
      }
    }
  }

  function drawMapMetaOverlays() {
    if (!mapMeta) return;
    // Safehouses — blue
    if (isLayerVisible('safehouses')) {
      for (var i = 0; i < mapMeta.safehouses.length; i++) {
        var sh = mapMeta.safehouses[i];
        var tl = worldToScreen(sh.x, sh.y);
        var br = worldToScreen(sh.x + sh.w, sh.y + sh.h);
        var sw = br.x - tl.x;
        var sH = br.y - tl.y;
        if (sw < 2 && sH < 2) continue;
        ctx.fillStyle = 'rgba(100, 180, 255, 0.25)';
        ctx.fillRect(tl.x, tl.y, sw, sH);
        ctx.strokeStyle = 'rgba(100, 180, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.strokeRect(tl.x, tl.y, sw, sH);
        if (sw > 60) {
          var label = sh.owner || sh.title || '';
          if (label) {
            ctx.font = 'bold 11px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(100, 180, 255, 0.9)';
            ctx.fillText(label, tl.x + sw / 2, tl.y + sH / 2, sw - 8);
          }
        }
      }
    }

    // Non-PvP zones — green
    if (isLayerVisible('npvp-zones')) {
      for (var i = 0; i < mapMeta.nonPvpZones.length; i++) {
        var z = mapMeta.nonPvpZones[i];
        var tl = worldToScreen(z.x, z.y);
        var br = worldToScreen(z.x2, z.y2);
        var sw = br.x - tl.x;
        var sH = br.y - tl.y;
        if (sw < 2 && sH < 2) continue;
        ctx.fillStyle = 'rgba(180, 120, 255, 0.15)';
        ctx.fillRect(tl.x, tl.y, sw, sH);
        ctx.strokeStyle = 'rgba(180, 120, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(tl.x, tl.y, sw, sH);
      }
    }

    // Designation zones — orange
    if (isLayerVisible('desig-zones')) {
      for (var i = 0; i < mapMeta.designationZones.length; i++) {
        var d = mapMeta.designationZones[i];
        var tl = worldToScreen(d.x, d.y);
        var br = worldToScreen(d.x + d.w, d.y + d.h);
        var sw = br.x - tl.x;
        var sH = br.y - tl.y;
        if (sw < 2 && sH < 2) continue;
        ctx.fillStyle = 'rgba(255, 160, 50, 0.15)';
        ctx.fillRect(tl.x, tl.y, sw, sH);
        ctx.strokeStyle = 'rgba(255, 160, 50, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(tl.x, tl.y, sw, sH);
        if (sw > 50) {
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(255, 160, 50, 0.85)';
          ctx.fillText(d.type || d.name || '', tl.x + sw / 2, tl.y + sH / 2, sw - 6);
        }
      }
    }

    // Stashes — three individually toggleable categories
    var stashMarkers = [];
    if (isLayerVisible('stash-spawned')) {
      for (var i = 0; i < mapMeta.stashes.mapsRead.length; i++) {
        var name = mapMeta.stashes.mapsRead[i];
        var def = typeof STASH_DEFS !== 'undefined' && STASH_DEFS[name];
        if (def) stashMarkers.push({ name: name, x: def[0], y: def[1], status: 'spawned' });
      }
    }
    if (isLayerVisible('stash-pending')) {
      for (var i = 0; i < mapMeta.stashes.buildingsToDo.length; i++) {
        var st = mapMeta.stashes.buildingsToDo[i];
        stashMarkers.push({ name: st.name, x: st.x, y: st.y, status: 'pending' });
      }
    }
    if (isLayerVisible('stash-available')) {
      for (var i = 0; i < mapMeta.stashes.possible.length; i++) {
        var st = mapMeta.stashes.possible[i];
        stashMarkers.push({ name: st.name, x: st.x, y: st.y, status: 'available' });
      }
    }
    for (var i = 0; i < stashMarkers.length; i++) {
      var sm = stashMarkers[i];
      var pt = worldToScreen(sm.x, sm.y);
      var size = Math.max(3, Math.min(6, camera.zoom * 80));
      if (size < 2) continue;
      var fill, stroke;
      if (sm.status === 'spawned') {
        fill = 'rgba(200, 220, 50, 0.7)'; stroke = 'rgba(200, 220, 50, 1.0)';
      } else if (sm.status === 'pending') {
        fill = 'rgba(255, 180, 50, 0.6)'; stroke = 'rgba(255, 180, 50, 0.9)';
      } else {
        fill = 'rgba(200, 220, 50, 0.2)'; stroke = 'rgba(200, 220, 50, 0.4)';
      }
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - size);
      ctx.lineTo(pt.x + size, pt.y);
      ctx.lineTo(pt.x, pt.y + size);
      ctx.lineTo(pt.x - size, pt.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (size > 5 && sm.name) {
        var labelW = camera.zoom * sm.name.length * 6;
        if (labelW > 40) {
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = stroke;
          ctx.fillText(sm.name, pt.x + size + 4, pt.y);
        }
      }
    }
  }

  function drawSelections() {
    if (isLayerVisible('keep')) {
      for (const key of selections.keep) {
        const { cx, cy } = parseCellKey(key);
        drawCellOverlay(cx, cy, 'rgba(76, 175, 80, 0.3)', 'rgba(76, 175, 80, 0.7)');
      }
    }
    if (isLayerVisible('purge')) {
      for (const key of selections.purge) {
        const { cx, cy } = parseCellKey(key);
        drawCellOverlay(cx, cy, 'rgba(233, 69, 96, 0.3)', 'rgba(233, 69, 96, 0.7)');
      }
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
      const lockSH = selectionType === 'purge' && document.getElementById('chk-lock-safehouses').checked;
      const lockedKeys = lockSH ? getSafehouseCellKeys() : null;
      let skipped = 0;

      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cy = minCY; cy <= maxCY; cy++) {
          const key = cellKey(cx, cy);
          if (lockedKeys && lockedKeys.has(key)) { skipped++; continue; }
          target.add(key);
          opposite.delete(key); // Remove from opposite set
        }
      }

      const count = (maxCX - minCX + 1) * (maxCY - minCY + 1) - skipped;
      setStatus('Selected ' + count + ' cells as ' + selectionType.toUpperCase() + (skipped ? ' (' + skipped + ' safehouse cells locked)' : ''));
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
    const lockSH = document.getElementById('chk-lock-safehouses').checked;
    const lockedKeys = lockSH ? getSafehouseCellKeys() : null;
    for (let cx = 0; cx < CELLS_X; cx++) {
      for (let cy = 0; cy < CELLS_Y; cy++) {
        const key = cellKey(cx, cy);
        if (!selections.keep.has(key) && !(lockedKeys && lockedKeys.has(key))) {
          selections.purge.add(key);
        }
      }
    }
    render();
    setStatus('Marked ' + selections.purge.size + ' cells as purge' + (lockedKeys ? ' (' + lockedKeys.size + ' safehouse cells locked)' : ''));
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
      updateDeleteButton();
      return;
    }
    var parts = [];
    if (keepCount > 0) parts.push(keepCount + ' keep');
    if (purgeCount > 0) parts.push(purgeCount + ' purge');
    selectionSummary.textContent = parts.join(' \u00b7 ');
    selectionBar.hidden = false;
    updateDeleteButton();
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

  // --- Load save directory ---
  // Requires File System Access API (Chromium-based browsers only).

  function applyPopulatedCells() {
    var msg = populatedCells.size + ' populated cells';
    if (populatedChunks.size > 0) msg += ' (' + populatedChunks.size + ' chunks)';
    msg += ' found';
    loadSaveStatus.textContent = msg;
    setStatus('Loaded ' + msg + ' from save');
    chkLegend.checked = true;
    mapLegend.hidden = false;
    render();
  }

  // --- map_meta.bin parser ---
  function readString(dv, offset) {
    var len = dv.getInt16(offset);
    offset += 2;
    if (len <= 0) return { value: '', newOffset: offset };
    var bytes = new Uint8Array(dv.buffer, dv.byteOffset + offset, len);
    var value = new TextDecoder('utf-8').decode(bytes);
    return { value: value, newOffset: offset + len };
  }

  function parseMapMeta(buffer) {
    var dv = new DataView(buffer);
    var off = 0;

    // Header: 4 magic bytes + worldVersion + bounds
    off += 4; // skip magic
    var worldVersion = dv.getInt32(off); off += 4;
    var x1 = dv.getInt32(off); off += 4;
    var y1 = dv.getInt32(off); off += 4;
    var x2 = dv.getInt32(off); off += 4;
    var y2 = dv.getInt32(off); off += 4;

    // Per-cell rooms & buildings — read and skip
    for (var cx = x1; cx <= x2; cx++) {
      for (var cy = y1; cy <= y2; cy++) {
        // Rooms
        var numRooms = dv.getInt32(off); off += 4;
        off += numRooms * 10; // 8 (int64 metaID) + 2 (int16 flags)

        // Buildings
        var numBuildings = dv.getInt32(off); off += 4;
        var buildingSize = worldVersion >= 201 ? 23 : 19;
        off += numBuildings * buildingSize;
      }
    }

    // Safehouses
    var nSafehouse = dv.getInt32(off); off += 4;
    var safehouses = [];
    for (var si = 0; si < nSafehouse; si++) {
      var sh = {};
      sh.x = dv.getInt32(off); off += 4;
      sh.y = dv.getInt32(off); off += 4;
      sh.w = dv.getInt32(off); off += 4;
      sh.h = dv.getInt32(off); off += 4;
      var s = readString(dv, off); sh.owner = s.value; off = s.newOffset;
      if (worldVersion >= 216) {
        sh.hitPoints = dv.getInt32(off); off += 4;
      }
      var playersCount = dv.getInt32(off); off += 4;
      sh.players = [];
      for (var pi = 0; pi < playersCount; pi++) {
        s = readString(dv, off); sh.players.push(s.value); off = s.newOffset;
      }
      off += 8; // lastVisited (int64)
      s = readString(dv, off); sh.title = s.value; off = s.newOffset;
      if (worldVersion >= 223) {
        off += 8; // datetimeCreated (int64)
        s = readString(dv, off); sh.location = s.value; off = s.newOffset;
      }
      var respawnCount = dv.getInt32(off); off += 4;
      for (var ri = 0; ri < respawnCount; ri++) {
        s = readString(dv, off); off = s.newOffset;
      }
      safehouses.push(sh);
    }

    // Non-PvP Zones
    var nZones = dv.getInt32(off); off += 4;
    var nonPvpZones = [];
    for (var zi = 0; zi < nZones; zi++) {
      var z = {};
      z.x = dv.getInt32(off); off += 4;
      z.y = dv.getInt32(off); off += 4;
      z.x2 = dv.getInt32(off); off += 4;
      z.y2 = dv.getInt32(off); off += 4;
      off += 4; // size
      var s = readString(dv, off); z.title = s.value; off = s.newOffset;
      nonPvpZones.push(z);
    }

    // Factions
    var nFactions = dv.getInt32(off); off += 4;
    var factions = [];
    for (var fi = 0; fi < nFactions; fi++) {
      var f = {};
      var s = readString(dv, off); f.name = s.value; off = s.newOffset;
      s = readString(dv, off); f.owner = s.value; off = s.newOffset;
      var playerSize = dv.getInt32(off); off += 4;
      var hasTag = dv.getUint8(off); off += 1;
      if (hasTag) {
        s = readString(dv, off); f.tag = s.value; off = s.newOffset;
        f.tagColor = {
          r: dv.getFloat32(off), g: dv.getFloat32(off + 4), b: dv.getFloat32(off + 8)
        };
        off += 12;
      }
      f.players = [];
      for (var pi = 0; pi < playerSize; pi++) {
        s = readString(dv, off); f.players.push(s.value); off = s.newOffset;
      }
      factions.push(f);
    }

    // Designation Zones
    var nDZones = dv.getInt32(off); off += 4;
    var designationZones = [];
    for (var di = 0; di < nDZones; di++) {
      var d = {};
      d.id = dv.getFloat64(off); off += 8;
      d.x = dv.getInt32(off); off += 4;
      d.y = dv.getInt32(off); off += 4;
      d.z = dv.getInt32(off); off += 4;
      d.h = dv.getInt32(off); off += 4;
      d.w = dv.getInt32(off); off += 4;
      var s = readString(dv, off); d.type = s.value; off = s.newOffset;
      s = readString(dv, off); d.name = s.value; off = s.newOffset;
      off += 4; // hourLastSeen
      designationZones.push(d);
    }

    // Stash System — try to read, but tolerate EOF
    var stashes = { possible: [], buildingsToDo: [], mapsRead: [] };
    var uniqueRDS = 0;
    try {
      // Multiplayer saves may have an extra int32 position here — detect by trying
      var nPossible = dv.getInt32(off); off += 4;
      // Sanity check: if nPossible is absurdly large, it might be the MP skip offset
      if (nPossible > 100000) {
        // Likely the MP skip int32 — re-read
        nPossible = dv.getInt32(off); off += 4;
      }
      for (var i = 0; i < nPossible; i++) {
        var s = readString(dv, off); off = s.newOffset;
        var bx = dv.getInt32(off); off += 4;
        var by = dv.getInt32(off); off += 4;
        stashes.possible.push({ name: s.value, x: bx, y: by });
      }
      var nBuildingsToDo = dv.getInt32(off); off += 4;
      for (var i = 0; i < nBuildingsToDo; i++) {
        var s = readString(dv, off); off = s.newOffset;
        var bx = dv.getInt32(off); off += 4;
        var by = dv.getInt32(off); off += 4;
        stashes.buildingsToDo.push({ name: s.value, x: bx, y: by });
      }
      var nMapsRead = dv.getInt32(off); off += 4;
      for (var i = 0; i < nMapsRead; i++) {
        var s = readString(dv, off); off = s.newOffset;
        stashes.mapsRead.push(s.value);
      }

      // Unique RDS
      var nRDS = dv.getInt32(off); off += 4;
      uniqueRDS = nRDS;
      for (var i = 0; i < nRDS; i++) {
        var s = readString(dv, off); off = s.newOffset;
      }
    } catch (e) {
      // EOF or parse error in stash section — ignore, we have the important data
    }

    return {
      worldVersion: worldVersion,
      bounds: { x1: x1, y1: y1, x2: x2, y2: y2 },
      safehouses: safehouses,
      nonPvpZones: nonPvpZones,
      factions: factions,
      designationZones: designationZones,
      stashes: stashes,
      uniqueRDS: uniqueRDS,
    };
  }

  async function loadViaDirectoryPicker() {
    var dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

    // Try to find the chunkdata subdirectory
    var chunkdataHandle;
    try {
      chunkdataHandle = await dirHandle.getDirectoryHandle('chunkdata');
    } catch (e) {
      loadSaveStatus.textContent = 'No chunkdata/ folder found';
      return;
    }

    saveDirHandle = dirHandle;
    populatedCells.clear();
    populatedChunks.clear();
    var pattern = /^chunkdata_(-?\d+)_(-?\d+)\.bin$/;

    // Scan chunkdata/ for cell-level data
    for await (var entry of chunkdataHandle.values()) {
      if (entry.kind !== 'file') continue;
      var match = entry.name.match(pattern);
      if (match) {
        populatedCells.add(cellKey(parseInt(match[1]), parseInt(match[2])));
      }
    }

    // Scan map/ for chunk-level granularity
    var loadingModal = document.getElementById('loading-modal');
    var loadingBarFill = document.getElementById('loading-bar-fill');
    var loadingText = document.getElementById('loading-modal-text');
    loadingModal.classList.add('visible');
    loadingBarFill.style.width = '0%';
    loadingText.textContent = 'Reading chunkdata...';
    btnLoadSave.disabled = true;

    try {
      var mapHandle = await dirHandle.getDirectoryHandle('map');
      loadingText.textContent = 'Collecting map directories...';
      await new Promise(function (r) { setTimeout(r, 0); });

      var chxDirs = [];
      for await (var chxDir of mapHandle.values()) {
        if (chxDir.kind === 'directory' && /^-?\d+$/.test(chxDir.name)) {
          chxDirs.push(chxDir);
        }
      }
      for (var di = 0; di < chxDirs.length; di++) {
        var chx = parseInt(chxDirs[di].name);
        for await (var chyFile of chxDirs[di].values()) {
          if (chyFile.kind !== 'file') continue;
          var chyMatch = chyFile.name.match(/^(-?\d+)\.bin$/);
          if (chyMatch) {
            var chy = parseInt(chyMatch[1]);
            populatedChunks.add(chx + ',' + chy);
            populatedCells.add(cellKey(Math.floor(chx / CHUNKS_PER_CELL), Math.floor(chy / CHUNKS_PER_CELL)));
          }
        }
        if (di % 10 === 0) {
          var pct = Math.round((di / chxDirs.length) * 100);
          loadingBarFill.style.width = pct + '%';
          loadingText.textContent = 'Scanning chunks... ' + pct + '% (' + populatedChunks.size + ' chunks)';
          await new Promise(function (r) { setTimeout(r, 0); });
        }
      }
    } catch (e) {
      // map/ directory doesn't exist, chunk view not available
    }
    // Parse map_meta.bin
    loadingBarFill.style.width = '95%';
    loadingText.textContent = 'Parsing map_meta.bin...';
    await new Promise(function (r) { setTimeout(r, 0); });
    try {
      var metaHandle = await dirHandle.getFileHandle('map_meta.bin');
      var metaFile = await metaHandle.getFile();
      var metaBuffer = await metaFile.arrayBuffer();
      mapMeta = parseMapMeta(metaBuffer);
      console.log('map_meta.bin parsed:', mapMeta);
    } catch (e) {
      // map_meta.bin not found or parse error — leave mapMeta null
      mapMeta = null;
    }

    loadingBarFill.style.width = '100%';
    btnLoadSave.disabled = false;
    loadingModal.classList.remove('visible');

    applyPopulatedCells();
    updateWorldDataSection();
    updateDeleteButton();
  }

  btnLoadSave.addEventListener('click', async function () {
    try {
      await loadViaDirectoryPicker();
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.warn('showDirectoryPicker failed:', e);
        loadSaveStatus.textContent = 'Failed to open directory picker';
      }
    }
  });

  // --- Delete purged cells ---
  function updateDeleteButton() {
    btnDeletePurged.disabled = !saveDirHandle || selections.purge.size === 0;
  }

  async function removeFile(dirHandle, path) {
    var parts = path.split('/');
    var current = dirHandle;
    for (var i = 0; i < parts.length - 1; i++) {
      try {
        current = await current.getDirectoryHandle(parts[i]);
      } catch (e) {
        return; // directory doesn't exist, skip
      }
    }
    try {
      await current.removeEntry(parts[parts.length - 1]);
    } catch (e) {
      // file doesn't exist, skip
    }
  }

  async function deletePurgedCells() {
    var cellList = Array.from(selections.purge).map(parseCellKey);
    if (cellList.length === 0) return;
    if (!confirm('Delete ' + cellList.length + ' cells from disk? This cannot be undone.')) return;

    var total = cellList.length;
    for (var i = 0; i < cellList.length; i++) {
      var cx = cellList[i].cx;
      var cy = cellList[i].cy;
      setStatus('Deleting cell ' + (i + 1) + '/' + total + ' (' + cx + ',' + cy + ')...');

      // Cell-level files
      await removeFile(saveDirHandle, 'chunkdata/chunkdata_' + cx + '_' + cy + '.bin');
      await removeFile(saveDirHandle, 'zpop/zpop_' + cx + '_' + cy + '.bin');
      await removeFile(saveDirHandle, 'apop/apop_' + cx + '_' + cy + '.bin');
      await removeFile(saveDirHandle, 'metagrid/metacell_' + cx + '_' + cy + '.bin');

      // Chunk-level files: map/{chunkX}/{chunkY}.bin and isoregiondata/datachunk_CHX_CHY.bin
      var chxStart = cx * CHUNKS_PER_CELL;
      var chyStart = cy * CHUNKS_PER_CELL;
      for (var chx = chxStart; chx < chxStart + CHUNKS_PER_CELL; chx++) {
        for (var chy = chyStart; chy < chyStart + CHUNKS_PER_CELL; chy++) {
          await removeFile(saveDirHandle, 'map/' + chx + '/' + chy + '.bin');
          await removeFile(saveDirHandle, 'isoregiondata/datachunk_' + chx + '_' + chy + '.bin');
        }
      }

      var key = cellKey(cx, cy);
      populatedCells.delete(key);
      selections.purge.delete(key);
      // Remove chunk entries for this cell
      for (var rchx = chxStart; rchx < chxStart + CHUNKS_PER_CELL; rchx++) {
        for (var rchy = chyStart; rchy < chyStart + CHUNKS_PER_CELL; rchy++) {
          populatedChunks.delete(rchx + ',' + rchy);
        }
      }
    }

    updateDeleteButton();
    updateSelectionBar();
    render();
    setStatus('Deleted ' + total + ' cells from disk');
  }

  btnDeletePurged.addEventListener('click', deletePurgedCells);

  // --- World Data section ---
  function updateWorldDataSection() {
    var section = document.getElementById('section-world-data');
    var summary = document.getElementById('world-data-summary');
    if (!mapMeta) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    summary.textContent = '';

    // Counts
    var counts = [];
    if (mapMeta.safehouses.length > 0) counts.push(mapMeta.safehouses.length + ' safehouse' + (mapMeta.safehouses.length !== 1 ? 's' : ''));
    if (mapMeta.nonPvpZones.length > 0) counts.push(mapMeta.nonPvpZones.length + ' non-PvP zone' + (mapMeta.nonPvpZones.length !== 1 ? 's' : ''));
    if (mapMeta.designationZones.length > 0) counts.push(mapMeta.designationZones.length + ' designation zone' + (mapMeta.designationZones.length !== 1 ? 's' : ''));
    if (mapMeta.factions.length > 0) counts.push(mapMeta.factions.length + ' faction' + (mapMeta.factions.length !== 1 ? 's' : ''));
    if (counts.length > 0) {
      var p = document.createElement('p');
      p.className = 'world-data-counts';
      p.textContent = counts.join(' \u00b7 ');
      summary.appendChild(p);
    }
    var pv = document.createElement('p');
    pv.className = 'world-data-counts';
    pv.textContent = 'World v' + mapMeta.worldVersion;
    summary.appendChild(pv);

    // Safehouses list
    if (mapMeta.safehouses.length > 0) {
      var group = document.createElement('div');
      group.className = 'world-data-group';
      var label = document.createElement('span');
      label.className = 'world-data-label';
      label.textContent = 'Safehouses';
      group.appendChild(label);
      for (var i = 0; i < mapMeta.safehouses.length; i++) {
        var sh = mapMeta.safehouses[i];
        var info = sh.owner || 'unknown';
        if (sh.title) info += ' \u2014 ' + sh.title;
        info += ' (' + sh.players.length + ' player' + (sh.players.length !== 1 ? 's' : '') + ')';
        var entry = document.createElement('div');
        entry.className = 'world-data-entry';
        entry.textContent = info;
        group.appendChild(entry);
      }
      summary.appendChild(group);
    }

    // Factions list
    if (mapMeta.factions.length > 0) {
      var group = document.createElement('div');
      group.className = 'world-data-group';
      var label = document.createElement('span');
      label.className = 'world-data-label';
      label.textContent = 'Factions';
      group.appendChild(label);
      for (var i = 0; i < mapMeta.factions.length; i++) {
        var f = mapMeta.factions[i];
        var entry = document.createElement('div');
        entry.className = 'world-data-entry';
        if (f.tagColor) {
          var swatch = document.createElement('span');
          swatch.className = 'faction-swatch';
          var r = Math.round(f.tagColor.r * 255);
          var g = Math.round(f.tagColor.g * 255);
          var b = Math.round(f.tagColor.b * 255);
          swatch.style.background = 'rgb(' + r + ',' + g + ',' + b + ')';
          entry.appendChild(swatch);
        }
        var text = f.name + ' \u2014 ' + f.owner;
        if (f.tag) text += ' [' + f.tag + ']';
        text += ' (' + f.players.length + ' member' + (f.players.length !== 1 ? 's' : '') + ')';
        entry.appendChild(document.createTextNode(text));
        group.appendChild(entry);
      }
      summary.appendChild(group);
    }

    // Stash summary
    if (mapMeta.stashes.possible.length > 0 || mapMeta.stashes.buildingsToDo.length > 0 || mapMeta.stashes.mapsRead.length > 0) {
      var group = document.createElement('div');
      group.className = 'world-data-group';
      var label = document.createElement('span');
      label.className = 'world-data-label';
      label.textContent = 'Stashes';
      group.appendChild(label);
      var entry = document.createElement('div');
      entry.className = 'world-data-entry';
      entry.textContent = mapMeta.stashes.mapsRead.length + ' spawned \u00b7 ' + mapMeta.stashes.buildingsToDo.length + ' pending \u00b7 ' + mapMeta.stashes.possible.length + ' available';
      group.appendChild(entry);
      summary.appendChild(group);
    }
  }

  // Wire up world data checkboxes — sync legend items
  var chkToLayer = {
    'chk-safehouses': 'safehouses',
    'chk-npvp-zones': 'npvp-zones',
    'chk-desig-zones': 'desig-zones',
    'chk-stashes': ['stash-spawned', 'stash-pending', 'stash-available'],
  };
  document.addEventListener('change', function (e) {
    var layers = chkToLayer[e.target.id];
    if (!layers) return;
    if (!Array.isArray(layers)) layers = [layers];
    for (var i = 0; i < layers.length; i++) {
      layerVisible[layers[i]] = e.target.checked;
      var legendItem = mapLegend.querySelector('[data-layer="' + layers[i] + '"]');
      if (legendItem) legendItem.classList.toggle('off', !e.target.checked);
    }
    render();
  });

  // --- Legend toggle ---
  chkLegend.addEventListener('change', function () {
    mapLegend.hidden = !chkLegend.checked;
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
  var loadSaveHint = document.getElementById('load-save-hint');
  if (window.showDirectoryPicker) {
    loadSaveHint.textContent = 'Select the ';
    var strong1 = document.createElement('strong');
    strong1.textContent = 'save directory';
    loadSaveHint.appendChild(strong1);
    loadSaveHint.appendChild(document.createTextNode(' to enable scanning and direct deletion'));
  } else {
    btnLoadSave.disabled = true;
    loadSaveHint.textContent = 'Requires a Chromium-based browser (Chrome, Edge, Brave)';
    loadSaveHint.classList.add('hint--warn');
  }

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
