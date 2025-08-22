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
    // move toward target tile
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const dist = Math.hypot(dx, dy);
    const move = p.speed * dt;
    if (dist <= move) {
      // snap to target
      p.x = p.tx;
      p.y = p.ty;
      p.moving = false;
    } else {
      // normalize and step
      p.x += (dx / dist) * move;
      p.y += (dy / dist) * move;
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

  // center camera on player (in world pixels)
  const p = state.player;
  const worldPxX = p.x * TILE;
  const worldPxY = p.y * TILE;
  const camX = Math.round(worldPxX - LOGICAL_W/2 + TILE/2);
  const camY = Math.round(worldPxY - LOGICAL_H/2 + TILE/2);

  // draw tiles: iterate viewport area in tile coords and sample wrapped tiles
  if (state.map && state.tilesImage) {
    const cols = state.map.width;
    const rows = state.map.height;
    // compute tile range that covers viewport with padding
    const startX = Math.floor((camX) / TILE) - 1;
    const startY = Math.floor((camY) / TILE) - 1;
    const endX = Math.ceil((camX + LOGICAL_W) / TILE) + 1;
    const endY = Math.ceil((camY + LOGICAL_H) / TILE) + 1;

    for (let ty = startY; ty < endY; ty++) {
      for (let tx = startX; tx < endX; tx++) {
        const wrappedX = wrapCoord(tx, cols);
        const wrappedY = wrapCoord(ty, rows);
        const t = state.map.layers[0].data[wrappedY*cols + wrappedX];

        const sx = tx * TILE - camX;
        const sy = ty * TILE - camY;

        // skip if completely offscreen
        if (sx + TILE < 0 || sy + TILE < 0 || sx > LOGICAL_W || sy > LOGICAL_H) continue;

        let sxTile = 0;
        if (t === 1) { sxTile = 0; } else if (t === 2) { sxTile = 1; } else if (t === 3) { sxTile = 2; } else if (t === 4) { sxTile = 3; }
        ctx.drawImage(state.tilesImage, sxTile * TILE, 0, TILE, TILE, Math.round(sx), Math.round(sy), TILE, TILE);
      }
    }
  }

  // draw player (unchanged rendering, but use current p position)
  if (state.playerSprite) {
    // player sprite sheet layout: row = direction (down, left, right, up), col = frame (0..2)
    const dirIndex = p.dir === 'down' ? 0 : p.dir === 'left' ? 1 : p.dir === 'right' ? 2 : 3;
    const frame = Math.floor(Date.now()/200) % 3;
    const sx = frame * p.w;
    const sy = dirIndex * p.h;
    const drawX = Math.round(p.x * TILE - camX - p.w/2 + TILE/2);
    const drawY = Math.round(p.y * TILE - camY - p.h + TILE);
    ctx.drawImage(state.playerSprite, sx, sy, p.w, p.h, drawX, drawY, p.w, p.h);
  } else {
    // fallback: simple rectangle
    ctx.fillStyle = '#b0533a';
    ctx.fillRect(Math.round(p.x*TILE - camX - 6), Math.round(p.y*TILE - camY - 10), 12, 14);
  }

  // subtle grid overlay to emphasize gameplay grid
  ctx.strokeStyle = 'rgba(0,0,0,0.04)';
  ctx.lineWidth = 1;
  const firstGridX = - (camX % TILE);
  const firstGridY = - (camY % TILE);
  for (let gx = firstGridX; gx < LOGICAL_W; gx += TILE) {
    ctx.beginPath(); ctx.moveTo(Math.round(gx)+0.5,0); ctx.lineTo(Math.round(gx)+0.5, LOGICAL_H); ctx.stroke();
  }
  for (let gy = firstGridY; gy < LOGICAL_H; gy += TILE) {
    ctx.beginPath(); ctx.moveTo(0, Math.round(gy)+0.5); ctx.lineTo(LOGICAL_W, Math.round(gy)+0.5); ctx.stroke();
  }

  // debug overlay (minimal)
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