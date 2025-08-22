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
    dir: 'down',
    speed: 3, // tiles per second
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

// Input handling
function setupInput() {
  window.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
    state.keys[e.key.toLowerCase()] = true;
    if (e.key === 'Escape') toggleMenu(true);
  });
  window.addEventListener('keyup', e => state.keys[e.key.toLowerCase()] = false);

  // Buttons
  document.querySelectorAll('.dir').forEach(btn=>{
    btn.addEventListener('pointerdown', e=> {
      const dir = btn.dataset.dir;
      state.keys[dir] = true;
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

// interaction
function onAction() {
  const p = state.player;
  const tx = Math.round(p.x + (p.dir === 'right' ? 1 : p.dir === 'left' ? -1 : 0));
  const ty = Math.round(p.y + (p.dir === 'down' ? 1 : p.dir === 'up' ? -1 : 0));
  const tile = getTile(tx, ty);
  if (tile === 2) {
    pushMessage('You found a shiny rock!');
  } else if (tile === 3) {
    pushMessage('A closed chest. (locked)');
  } else {
    pushMessage('There is nothing here.');
  }
}

// map helpers
function getTile(x,y) {
  if (!state.map) return 0;
  if (y < 0 || y >= state.map.height || x < 0 || x >= state.map.width) return 0;
  return state.map.layers[0].data[y * state.map.width + x];
}

function isWalkable(x,y) {
  const tile = getTile(x,y);
  // Treat 1 as ground (walkable), 0 as out-of-bounds/empty, 4 as wall (non-walkable)
  if (tile === 4) return false;
  if (tile === 0) return false;
  return true;
}

// game loop
function update(dt) {
  const p = state.player;
  // interpret inputs (keyboard arrows + wasd)
  const up = state.keys['arrowup'] || state.keys['w'] || state.keys['up'];
  const down = state.keys['arrowdown'] || state.keys['s'] || state.keys['down'];
  const left = state.keys['arrowleft'] || state.keys['a'] || state.keys['left'];
  const right = state.keys['arrowright'] || state.keys['d'] || state.keys['right'];

  let dx = 0, dy = 0;
  if (up) { dy = -1; p.dir = 'up'; }
  if (down) { dy = 1; p.dir = 'down'; }
  if (left) { dx = -1; p.dir = 'left'; }
  if (right) { dx = 1; p.dir = 'right'; }
  // normalize diagonal
  if (dx !== 0 && dy !== 0) {
    dx *= Math.SQRT1_2;
    dy *= Math.SQRT1_2;
  }

  const move = p.speed * dt;
  const newX = p.x + dx * move;
  const newY = p.y + dy * move;

  // Collision: simple tile-based collision using rounded position
  if (isWalkable(Math.round(newX), Math.round(p.y))) {
    p.x = newX;
  }
  if (isWalkable(Math.round(p.x), Math.round(newY))) {
    p.y = newY;
  }
}

function draw() {
  // clear
  ctx.clearRect(0,0,LOGICAL_W,LOGICAL_H);

  // center camera on player
  const camX = Math.round(state.player.x * TILE - LOGICAL_W/2 + TILE/2);
  const camY = Math.round(state.player.y * TILE - LOGICAL_H/2 + TILE/2);

  // draw tiles
  const map = state.map;
  if (map && state.tilesImage) {
    const cols = map.width;
    const rows = map.height;
    for (let y=0;y<rows;y++){
      for (let x=0;x<cols;x++){
        const t = map.layers[0].data[y*cols + x];
        // draw only tiles visible in viewport for perf
        const sx = x * TILE - camX;
        const sy = y * TILE - camY;
        if (sx + TILE < 0 || sy + TILE < 0 || sx > LOGICAL_W || sy > LOGICAL_H) continue;

        // simple tileset layout: tile id -> position in tiles.png
        // We'll map ids:
        // 1: grass, 2: item-ground (grass), 3: chest, 4: wall
        let tx = 0, ty = 0;
        if (t === 1) { tx = 0; ty = 0; } // grass
        else if (t === 2) { tx = 1; ty = 0; } // grass with item
        else if (t === 3) { tx = 2; ty = 0; } // chest
        else if (t === 4) { tx = 3; ty = 0; } // wall
        else { tx = 0; ty = 0; }

        ctx.drawImage(state.tilesImage, tx * TILE, ty * TILE, TILE, TILE, Math.round(sx), Math.round(sy), TILE, TILE);
      }
    }
  }

  // draw player
  const p = state.player;
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

  // debug overlay (minimal)
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.font = '8px sans-serif';
  ctx.fillText(`x:${state.player.x.toFixed(2)} y:${state.player.y.toFixed(2)}`, 6, LOGICAL_H - 6);
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
/* ...existing code... */

