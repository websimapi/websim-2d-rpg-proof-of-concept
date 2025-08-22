/* ...existing code... */
import { UI } from './ui.js';

/*
  Simple 2D RPG proof of concept:
  - Pixel-art style scaled canvas
  - Tilemap from map.json
  - Player sprite with 4-directional movement and collision
  - Basic interact action and message log
  - Mobile-friendly dpad controls + keyboard
*/

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Logical resolution (keeps pixel feel)
const LOGICAL_W = 320;
const LOGICAL_H = 180;
canvas.width = LOGICAL_W;
canvas.height = LOGICAL_H;

// scale CSS canvas to be responsive (handled by CSS width:100%)
let scale = 1;

const TILE = 16;
const VIEWPORT_TILES_X = LOGICAL_W / TILE; // 20
const VIEWPORT_TILES_Y = LOGICAL_H / TILE; // 11.25 -> we'll floor when drawing

// game state
const state = {
  map: null,
  tilesImage: null,
  playerSprite: null,
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

// load assets
async function loadAssets() {
  const mapResp = await fetch('map.json');
  state.map = await mapResp.json();

  state.tilesImage = await loadImage('assets/tiles.png');
  state.playerSprite = await loadImage('assets/player.png');
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.src = src;
    i.onload = () => res(i);
    i.onerror = rej;
  });
}

function pushMessage(text) {
  state.messages.unshift({text, t: Date.now()});
  if (state.messages.length > 4) state.messages.pop();
  UI.showMessage(text);
  document.getElementById('hp-val').textContent = state.player.hp;
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
  if (state.playerSprite) {
    // native sprite size
    const nativeW = p.w; // 12
    const nativeH = p.h; // 14
    // fit sprite inside tile with slight padding, preserve aspect ratio
    const padding = 0.1; // 10% padding
    const maxSize = TILE * (1 - padding * 2);
    const scaleFit = maxSize / Math.max(nativeW, nativeH);
    const drawW = Math.round(nativeW * scaleFit);
    const drawH = Math.round(nativeH * scaleFit);
    ctx.drawImage(state.playerSprite, playerScreenX - drawW / 2, playerScreenY - drawH / 2, drawW, drawH);
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

function loop(ts) {
  if (!state.lastTime) state.lastTime = ts;
  const dt = Math.min(0.05, (ts - state.lastTime) / 1000); // clamp dt
  state.lastTime = ts;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

// init
async function init() {
  await loadAssets();
  setupInput();
  UI.init(state);

  pushMessage('Welcome! Use the D-pad or arrow keys to move.');
  requestAnimationFrame(loop);
}

init();