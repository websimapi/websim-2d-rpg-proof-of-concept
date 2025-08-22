/* ...existing code... */
import { UI } from './ui.js';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';

/*
  Simple 2D RPG proof of concept:
  - Pixel-art style scaled canvas
  - Tilemap from map.json
  - Player sprite with 4-directional movement and collision
  - Basic interact action and message log
  - Mobile-friendly dpad controls + keyboard
*/

// bind existing canvas for THREE renderer
const canvas = document.getElementById('game');
const TILE = 16;
const LOGICAL_W = 320;
const LOGICAL_H = 180;
canvas.width = LOGICAL_W;
canvas.height = LOGICAL_H;

// Add a 2D context reference used by legacy draw/debug (prevents ctx undefined errors)
const ctx = canvas.getContext('2d');

// scale CSS canvas to be responsive (handled by CSS width:100%)
let scale = 1;

// game state (keeps many original fields for compatibility)
const state = {
  map: null,
  tilesImage: null,
  playerSpriteImage: null,
  player: {
    x: 5, y: 5, // tile coordinates (float for smooth)
    tx: 5, ty: 5, // target tile (for grid movement)
    moving: false,
    dir: 'down',
    speed: 6, // tiles per second (used to interpolate between tiles)
    hp: 20,
    w: 12, h: 14, // sprite size in px
  },
  keys: {},
  lastTime: 0,
  messages: []
};

// THREE.js essentials
let renderer, scene, camera;
let groundMesh, playerSprite;
let grassTexture;
let tileGroup; // new: group of visible tile meshes
let renderRadius = 10; // new: how many tiles from player to render (visible radius)
let lastTileCenter = {x: null, y: null}; // new: track last integer player tile to avoid unnecessary updates
let mats = {}; // <-- add shared materials container so updateTiles can reference mats

// Load assets (map + images) and then setup three scene
async function loadAssets() {
  const mapResp = await fetch('map.json');
  state.map = await mapResp.json();

  // load raw images
  state.tilesImage = await loadImage('assets/tiles.png');
  state.playerSpriteImage = await loadImage('assets/player.png');

  // create cropped grass texture from tiles.png (first tile)
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = 16; tileCanvas.height = 16;
  const tctx = tileCanvas.getContext('2d');
  tctx.drawImage(state.tilesImage, 0, 0, 16, 16, 0, 0, 16, 16);
  grassTexture = new THREE.CanvasTexture(tileCanvas);
  grassTexture.magFilter = THREE.NearestFilter;
  grassTexture.minFilter = THREE.NearestMipMapNearestFilter;
  grassTexture.wrapS = THREE.RepeatWrapping;
  grassTexture.wrapT = THREE.RepeatWrapping;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.src = src;
    i.onload = () => res(i);
    i.onerror = rej;
  });
}

/* Initialize THREE scene */
function setupScene() {
  // renderer (try WebGL, otherwise fall back to 2D canvas rendering)
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    renderer.setPixelRatio(1);
    renderer.setSize(LOGICAL_W, LOGICAL_H, false);
    renderer.setClearColor(0xdce9f8, 1);
  } catch (err) {
    console.warn('WebGL unavailable, falling back to 2D canvas rendering.', err);
    renderer = null;
  }
 
  scene = new THREE.Scene();

  // camera: orthographic to keep crisp pixel look, but tilted for tabletop feel
  const aspect = LOGICAL_W / LOGICAL_H;
  const frustumSize = 200; // arbitrary world units to map to tiles comfortably
  camera = new THREE.OrthographicCamera(
    frustumSize * aspect / -2, frustumSize * aspect / 2,
    frustumSize / 2, frustumSize / -2,
    0.1, 1000
  );
  camera.position.set(0, 400, 0);
  camera.up.set(0, 0, -1); // keep "north" oriented up on screen
  camera.lookAt(0, 0, 0);

  // lighting (subtle)
  const amb = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(100, 200, 100);
  scene.add(dir);

  // ground: create a plane textured with repeated grass tile.
  const planeSize = Math.max(state.map.width, state.map.height) * TILE * 0.75;
  const geom = new THREE.PlaneGeometry(planeSize, planeSize);
  grassTexture.repeat.set(planeSize / TILE, planeSize / TILE);
  const mat = new THREE.MeshLambertMaterial({ map: grassTexture });
  groundMesh = new THREE.Mesh(geom, mat);
  groundMesh.rotation.x = -Math.PI / 2; // lay flat
  // push the large ground slightly down to avoid z-fighting with tileGroup
  groundMesh.position.y = -0.12;
  scene.add(groundMesh);

  // --- replace large static ground with an infinite-ish tiled group: create small tile meshes around player ---
  tileGroup = new THREE.Group();
  // create small box tiles so the world reads with depth (voxel / tabletop tiles)
  const tileGeom = new THREE.BoxGeometry(TILE * 0.98, 4, TILE * 0.98);
  // materials for different map tile types: grass (1), sparkle/item (2), chest (3), wall (4)
  const matGrass = new THREE.MeshLambertMaterial({ map: grassTexture });
  const matItem = new THREE.MeshLambertMaterial({ color: 0xffee88, map: grassTexture, transparent: true, opacity: 0.98 });
  const matChest = new THREE.MeshLambertMaterial({ color: 0xc48a3f });
  const matWall  = new THREE.MeshLambertMaterial({ color: 0x8b8b8b });
  mats = {1: matGrass, 2: matItem, 3: matChest, 4: matWall};
  for (let jy = -renderRadius; jy <= renderRadius; jy++) {
    for (let ix = -renderRadius; ix <= renderRadius; ix++) {
      const m = new THREE.Mesh(tileGeom, matGrass);
      // rotate so top faces up and center lines up with world units
      m.position.y = 2; // half the box height so top sits at y=4
      m.receiveShadow = false;
      tileGroup.add(m);
    }
  }
  scene.add(tileGroup);

  // add a grid helper for clear 3D grid visualization
  const gridSize = (renderRadius * 2 + 1) * TILE;
  const grid = new THREE.GridHelper(gridSize, (renderRadius * 2 + 1), 0x222222, 0x353535);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.09; // sit just above tiles for visibility
  grid.material.transparent = true;
  grid.material.opacity = 0.45;
  scene.add(grid);

  // player: create a billboarded sprite using the player image drawn to a canvas texture
  const pcanvas = document.createElement('canvas');
  pcanvas.width = state.player.w;
  pcanvas.height = state.player.h;
  const pctx = pcanvas.getContext('2d');
  pctx.drawImage(state.playerSpriteImage, 0, 0, state.player.w, state.player.h);
  const playerTex = new THREE.CanvasTexture(pcanvas);
  playerTex.magFilter = THREE.NearestFilter;
  playerTex.minFilter = THREE.NearestFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: playerTex, transparent: true });
  playerSprite = new THREE.Sprite(spriteMat);
  // scale sprite to sit nicely in a tile: world unit mapping: TILE px -> 1 unit
  const spriteScale = TILE * 0.9;
  playerSprite.scale.set(spriteScale, spriteScale * (state.player.h / state.player.w), 1);
  scene.add(playerSprite);

  // place initial positions
  updatePlayerWorldPosition(true);
  updateTiles(); // new: populate tileGroup positions initially
}

// Input handling: start grid move when a direction pressed (discrete)
function setupInput() {
  window.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
    const k = e.key.toLowerCase();
    state.keys[k] = true;
    if (['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes(k)) {
      tryStartMoveFromInput();
    }
    if (e.key === 'Escape') toggleMenu(true);
  });
  window.addEventListener('keyup', e => state.keys[e.key.toLowerCase()] = false);

  // Buttons
  document.querySelectorAll('.dir').forEach(btn=>{
    btn.addEventListener('pointerdown', e=> {
      const dir = btn.dataset.dir;
      state.keys[dir] = true;
      tryStartMoveFromInput();
    });
    btn.addEventListener('pointerup', e=> {
      const dir = btn.dataset.dir;
      state.keys[dir] = false;
    });
    btn.addEventListener('pointercancel', e=>{
      const dir = btn.dataset.dir;
      state.keys[dir] = false;
    });
  });

  document.getElementById('action-btn').addEventListener('click', onAction);
  document.getElementById('menu-btn').addEventListener('click', ()=> toggleMenu(false));
  document.getElementById('close-menu').addEventListener('click', ()=> toggleMenu(true));
  document.getElementById('btn-inventory').addEventListener('click', ()=> pushMessage('Inventory is empty.'));
  document.getElementById('btn-save').addEventListener('click', ()=> pushMessage('Game saved (demo).'));
}

function toggleMenu(close = false) {
  const menu = document.getElementById('menu');
  menu.classList.toggle('hidden', !close ? false : true);
}

// Start a tile-move if player is not already moving
function tryStartMoveFromInput() {
  const p = state.player;
  if (p.moving) return;
  const up = state.keys['arrowup'] || state.keys['w'] || state.keys['up'];
  const down = state.keys['arrowdown'] || state.keys['s'] || state.keys['down'];
  const left = state.keys['arrowleft'] || state.keys['a'] || state.keys['left'];
  const right = state.keys['arrowright'] || state.keys['d'] || state.keys['right'];

  let dx = 0, dy = 0;
  if (up) { dy = -1; p.dir = 'up'; }
  else if (down) { dy = 1; p.dir = 'down'; }
  else if (left) { dx = -1; p.dir = 'left'; }
  else if (right) { dx = 1; p.dir = 'right'; }

  if (dx !== 0 || dy !== 0) {
    const nx = wrapCoord(Math.round(p.x) + dx, state.map.width);
    const ny = wrapCoord(Math.round(p.y) + dy, state.map.height);
    if (isWalkable(nx, ny)) {
      p.tx = nx;
      p.ty = ny;
      p.moving = true;
    } else {
      // facing but blocked
      pushMessage('Blocked.');
    }
  }
}

/* Add: simple interact handler used by the action button */
function onAction() {
  const p = state.player;
  // direction vector for tile in front
  let dx = 0, dy = 0;
  if (p.dir === 'up') dy = -1;
  else if (p.dir === 'down') dy = 1;
  else if (p.dir === 'left') dx = -1;
  else if (p.dir === 'right') dx = 1;

  const tx = wrapCoord(Math.round(p.x) + dx, state.map.width);
  const ty = wrapCoord(Math.round(p.y) + dy, state.map.height);
  const tile = getTile(tx, ty);

  if (tile === 2) {
    pushMessage('You see a small sparkle on the ground.');
  } else if (tile === 3) {
    pushMessage('There is a chest here. It\'s empty (demo).');
  } else if (tile === 4) {
    pushMessage('A wall blocks the way.');
  } else {
    pushMessage('Nothing of interest.');
  }
}

// map helpers updated for wrapping (toroidal)
function wrapCoord(v, max) {
  // ensure positive modulo
  return ((v % max) + max) % max;
}

/* Add: compute shortest signed delta between two coords on a torus */
function shortestDelta(curr, target, max) {
  let d = target - curr;
  if (Math.abs(d) > max / 2) {
    if (d > 0) d -= max;
    else d += max;
  }
  return d;
}

function getTile(x,y) {
  if (!state.map) return 0;
  // wrap coordinates to create infinite world
  const wx = wrapCoord(x, state.map.width);
  const wy = wrapCoord(y, state.map.height);
  return state.map.layers[0].data[wy * state.map.width + wx];
}

function isWalkable(x,y) {
  const tile = getTile(x,y);
  if (tile === 4) return false;
  if (tile === 0) return false;
  return true;
}

// update: interpolate towards target tile (grid movement)
function update(dt) {
  const p = state.player;
  if (p.moving) {
    // move toward target tile using shortest wrapped path
    const dx = shortestDelta(p.x, p.tx, state.map.width);
    const dy = shortestDelta(p.y, p.ty, state.map.height);
    const dist = Math.hypot(dx, dy);
    const move = p.speed * dt;
    if (dist <= move) {
      // snap to target and ensure position is wrapped into map bounds
      p.x = wrapCoord(p.tx, state.map.width);
      p.y = wrapCoord(p.ty, state.map.height);
      p.moving = false;
    } else {
      // normalize and step (preserves wrap-aware shortest path)
      p.x += (dx / dist) * move;
      p.y += (dy / dist) * move;
      // keep p position within a reasonable range by wrapping after moving
      p.x = wrapCoord(p.x, state.map.width);
      p.y = wrapCoord(p.y, state.map.height);
    }
    updatePlayerWorldPosition();
  } else {
    // not moving: allow starting moves via continuous key press (keeps mobile friendly)
    if (state.keys['up'] || state.keys['w'] || state.keys['arrowup'] ||
        state.keys['down'] || state.keys['s'] || state.keys['arrowdown'] ||
        state.keys['left'] || state.keys['a'] || state.keys['arrowleft'] ||
        state.keys['right'] || state.keys['d'] || state.keys['arrowright']) {
      tryStartMoveFromInput();
    }
  }
}

/* Place player sprite in world coordinates and nudge camera to follow (wrap aware) */
function updatePlayerWorldPosition(forceCenter=false) {
  // Map tile coordinates to world units (1 tile -> TILE units)
  const worldX = (state.player.x - state.map.width / 2) * TILE;
  const worldZ = (state.player.y - state.map.height / 2) * TILE;
  // raise sprite a bit above tiles so it renders cleanly
  playerSprite.position.set(worldX, TILE * 0.6, worldZ);

  // update tiles only when player crosses an integer tile (or forced)
  const centerTileX = Math.round(state.player.x);
  const centerTileY = Math.round(state.player.y);
  if (forceCenter || centerTileX !== lastTileCenter.x || centerTileY !== lastTileCenter.y) {
    lastTileCenter.x = centerTileX;
    lastTileCenter.y = centerTileY;
    updateTiles();
  }

  // make sprite face camera by default (Three Sprites are camera-facing)
  // Position camera to follow player smoothly
  const camTargetX = worldX;
  const camTargetZ = worldZ;
  // Keep the camera height fixed and follow X/Z smoothly for a stable top-down view
  camera.position.x += (camTargetX - camera.position.x) * 0.18;
  camera.position.z += (camTargetZ - camera.position.z) * 0.18;
  camera.lookAt(camTargetX, 0, camTargetZ);
}

/* Render function */
function render() {
  if (renderer) {
    renderer.render(scene, camera);
  } else {
    // fallback: draw using existing 2D canvas draw() function
    draw();
  }
}

// draw: render wrapping tiles for infinite feel and draw subtle grid
function draw() {
  // clear
  ctx.clearRect(0,0,LOGICAL_W,LOGICAL_H);

  // compute camera but we only need player's screen position
  const p = state.player;
  const worldPxX = p.x * TILE;
  const worldPxY = p.y * TILE;
  const camX = Math.round(worldPxX - LOGICAL_W/2 + TILE/2);
  const camY = Math.round(worldPxY - LOGICAL_H/2 + TILE/2);

  // draw visible tiles grid and coordinates (wrapped map coords)
  const firstTileX = Math.floor(camX / TILE);
  const firstTileY = Math.floor(camY / TILE);
  const tilesX = Math.ceil(LOGICAL_W / TILE) + 1;
  const tilesY = Math.ceil(LOGICAL_H / TILE) + 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  ctx.font = '8px "Noto Sans", sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tileWorldX = (firstTileX + tx) * TILE;
      const tileWorldY = (firstTileY + ty) * TILE;
      const screenX = Math.round(tileWorldX - camX);
      const screenY = Math.round(tileWorldY - camY);
      // background slight fill for tile
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(screenX, screenY, TILE, TILE);
      // tile border
      ctx.strokeRect(screenX + 0.5, screenY + 0.5, TILE - 1, TILE - 1);
      // wrapped coords
      const mapX = wrapCoord(firstTileX + tx, state.map.width);
      const mapY = wrapCoord(firstTileY + ty, state.map.height);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(`${mapX},${mapY}`, screenX + 4, screenY + TILE - 6);
    }
  }

  // compute player's screen position (center of tile)
  const playerScreenX = Math.round(p.x * TILE - camX + TILE/2);
  const playerScreenY = Math.round(p.y * TILE - camY + TILE/2);

  // draw player blob sprite (single-frame image)
  if (state.playerSpriteImage) {
    // native sprite size
    const nativeW = p.w; // 12
    const nativeH = p.h; // 14
    // fit sprite inside tile with slight padding, preserve aspect ratio
    const padding = 0.1; // 10% padding
    const maxSize = TILE * (1 - padding * 2);
    const scaleFit = maxSize / Math.max(nativeW, nativeH);
    const drawW = Math.round(nativeW * scaleFit);
    const drawH = Math.round(nativeH * scaleFit);
    ctx.drawImage(state.playerSpriteImage, playerScreenX - drawW / 2, playerScreenY - drawH / 2, drawW, drawH);
  } else {
    // draw a single blue circle at player's screen position
    ctx.fillStyle = '#2b7bff';
    ctx.beginPath();
    ctx.arc(playerScreenX, playerScreenY, Math.max(4, TILE/2 - 2), 0, Math.PI*2);
    ctx.fill();
  }

  // minimal debug overlay
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.font = '8px sans-serif';
  ctx.fillText(`x:${p.x.toFixed(2)} y:${p.y.toFixed(2)}`, 6, LOGICAL_H - 6);
}

function pushMessage(text) {
  state.messages.unshift({text, t: Date.now()});
  if (state.messages.length > 4) state.messages.pop();
  UI.showMessage(text);
  document.getElementById('hp-val').textContent = state.player.hp;
}

// new: reposition tileGroup children to form a grid centered on the player's integer tile.
// This gives a toroidal/wrapping effect by computing wrapped map coords and translating tiles accordingly.
function updateTiles() {
  if (!tileGroup || !state.map) return;
  const centerX = Math.round(state.player.x);
  const centerY = Math.round(state.player.y);
  let i = 0;
  for (let dy = -renderRadius; dy <= renderRadius; dy++) {
    for (let dx = -renderRadius; dx <= renderRadius; dx++) {
      const mapX = wrapCoord(centerX + dx, state.map.width);
      const mapY = wrapCoord(centerY + dy, state.map.height);
      const mesh = tileGroup.children[i++];
      // world position accounts for map origin in center (1 tile -> TILE units)
      const wx = (centerX + dx - state.map.width / 2) * TILE;
      const wz = (centerY + dy - state.map.height / 2) * TILE;
      mesh.position.set(wx, 2, wz); // y=2 so top surface is visible (box height = 4)
      // pick material based on tile type (map layer values)
      const tileVal = getTile(mapX, mapY) || 1;
      // choose matching material; walls get taller visual
      if (tileVal === 4) {
        // increase wall height by scaling Y
        mesh.scale.y = 2.5;
        mesh.material = mats[4];
      } else {
        mesh.scale.y = 1;
        mesh.material = mats[tileVal] || mats[1];
      }
      mesh.visible = true;
    }
  }
}

/* Main loop */
function loop(ts) {
  if (!state.lastTime) state.lastTime = ts;
  const dt = Math.min(0.05, (ts - state.lastTime) / 1000); // clamp dt
  state.lastTime = ts;

  update(dt);
  // if using WebGL renderer render 3D scene; otherwise draw 2D canvas + overlay
  render();

  requestAnimationFrame(loop);
}

// init
async function init() {
  await loadAssets();
  setupScene();
  setupInput();
  UI.init(state);

  pushMessage('Welcome! Use the D-pad or arrow keys to move.');
  requestAnimationFrame(loop);
}

init();