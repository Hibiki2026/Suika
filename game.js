"use strict";

const { Engine, Bodies, Body, Composite, Events } = Matter;
const engine = Engine.create({ positionIterations: 10, velocityIterations: 8 });
const byId = id => document.getElementById(id);
const game = byId("game");
const canvas = byId("physicsCanvas");
const ctx = canvas.getContext("2d");
const mode = byId("mode");
const saveInput = byId("saveInput");
const message = byId("message");
const dropButton = byId("dropFruit");
const obstacles = [...document.querySelectorAll(".panel, #controls button")];

const WIDTH = 420;
const HEIGHT = 500;
const CENTER = WIDTH / 2;
const RIM = 35;
const FLOOR = HEIGHT - 25;
const SPAWN = RIM - 20;
const WALL = 12;
const STEP = 1000 / 60;
const DROP_DELAY = 350;
const ESCAPE_DELAY = 150;
const FRUITS = ["🍒", "🍓", "🍇", "🍊", "🍋", "🍑", "🍍", "🥥", "🍈", "🍉"];
const RADII = [14, 18, 33, 28, 34, 41, 63.7, 59, 70, 164];
const NORMAL = { restitution: .03, friction: .14, frictionStatic: .5, frictionAir: .018 };
const SLIPPERY = { restitution: .2, friction: .001, frictionStatic: .001, frictionAir: .0001 };
const bowlPath = [];

for (let index = 0; index <= 12; index++) {
  const progress = index / 12;
  const inset = 50 * progress ** 1.65;
  bowlPath.push({ x: CENTER - 175 + inset, y: RIM + (FLOOR - RIM) * progress });
}
bowlPath.push(...bowlPath.slice().reverse().map(point => ({ x: WIDTH - point.x, y: point.y })));

const walls = bowlPath.slice(1).map((end, index) => {
  const start = bowlPath[index];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Bodies.rectangle((start.x + end.x) / 2, (start.y + end.y) / 2,
    Math.hypot(dx, dy) + WALL, WALL,
    { isStatic: true, angle: Math.atan2(dy, dx), friction: .8, restitution: .05 });
});
Composite.add(engine.world, walls);

const fruits = new Set();
const obstacleBodies = Composite.create();
Composite.add(engine.world, obstacleBodies);
const pendingMerges = [];
let score = 0;
let best = readCounter("suikaBest");
let plays = readCounter("suikaPlays");
let counted = false;
let currentLevel = randomLevel();
let nextLevel = randomLevel();
let currentX = CENTER;
let cooldown = 0;
let gameOver = false;
let issuedCode = "";
let layoutDirty = true;
let projectionDirty = true;
let projection;
let lastFrame;
let accumulator = 0;

function readCounter(key) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function saveCounters() {
  try {
    localStorage.setItem("suikaBest", String(Math.max(best, readCounter("suikaBest"))));
    localStorage.setItem("suikaPlays", String(Math.max(plays, readCounter("suikaPlays"))));
  } catch {
    // Play and save-code export are still available with storage disabled.
  }
}

function updateStats() {
  byId("score").textContent = score;
  byId("best").textContent = best;
  byId("plays").textContent = plays;
  byId("next").textContent = FRUITS[nextLevel];
}

function randomLevel() {
  return Math.floor(Math.random() * 5);
}

function material() {
  return mode.value === "slippery" ? SLIPPERY : NORMAL;
}

function applyMode() {
  for (const fruit of fruits) Object.assign(fruit, material());
}

function addFruit(x, y, level) {
  // Extra sides keep the largest fruit's drawn outline and collision shape close.
  const fruit = Bodies.circle(x, y, RADII[level], { ...material(), density: .0015 }, 48);
  fruit.level = level;
  fruit.escapedFor = 0;
  fruits.add(fruit);
  Composite.add(engine.world, fruit);
  return fruit;
}

function removeFruit(fruit) {
  fruits.delete(fruit);
  Composite.remove(engine.world, fruit);
}

function setAim(x) {
  const margin = Math.min(RADII[currentLevel] + WALL / 2, 174);
  currentX = Math.max(35 + margin, Math.min(385 - margin, x));
}

function move(direction) {
  if (!gameOver && cooldown === 0) setAim(currentX + direction * 24);
}

function dropFruit() {
  if (gameOver || cooldown > 0) return;
  addFruit(currentX, SPAWN, currentLevel);
  if (!counted) {
    counted = true;
    plays = Math.max(plays, readCounter("suikaPlays")) + 1;
    saveCounters();
  }
  currentLevel = nextLevel;
  nextLevel = randomLevel();
  currentX = CENTER;
  cooldown = DROP_DELAY;
  dropButton.disabled = true;
  updateStats();
}

Events.on(engine, "collisionStart", event => {
  for (const { bodyA, bodyB } of event.pairs) {
    if (fruits.has(bodyA) && fruits.has(bodyB) &&
        bodyA.level === bodyB.level && bodyA.level < FRUITS.length - 1) {
      pendingMerges.push([bodyA, bodyB]);
    }
  }
});

function mergeFruits() {
  for (const [first, second] of pendingMerges) {
    if (!fruits.has(first) || !fruits.has(second)) continue;
    const level = first.level + 1;
    const x = (first.position.x + second.position.x) / 2;
    const y = (first.position.y + second.position.y) / 2;
    const velocity = {
      x: (first.velocity.x + second.velocity.x) / 2,
      y: (first.velocity.y + second.velocity.y) / 2
    };
    removeFruit(first);
    removeFruit(second);
    Body.setVelocity(addFruit(x, y, level), velocity);
    score += (level + 1) * 10;
  }
  if (pendingMerges.length) {
    best = Math.max(best, score, readCounter("suikaBest"));
    saveCounters();
    updateStats();
    pendingMerges.length = 0;
  }
}

function checkEscaped() {
  for (const fruit of fruits) {
    const { x, y } = fruit.position;
    const radius = RADII[fruit.level];
    const outside = x + radius < -10 || x - radius > WIDTH + 10 || y > FLOOR + WALL + 8;
    fruit.escapedFor = outside ? fruit.escapedFor + STEP : 0;
    if (fruit.escapedFor >= ESCAPE_DELAY) {
      gameOver = true;
      byId("finalScore").textContent = "スコア：" + score;
      message.showModal();
      return;
    }
  }
}

function clearBoard() {
  for (const fruit of fruits) removeFruit(fruit);
  pendingMerges.length = 0;
  gameOver = false;
  cooldown = 0;
  accumulator = 0;
  issuedCode = "";
  dropButton.disabled = false;
  if (message.open) message.close();
}

function restart() {
  clearBoard();
  score = 0;
  counted = false;
  currentLevel = randomLevel();
  nextLevel = randomLevel();
  currentX = CENTER;
  updateStats();
  dropButton.focus({ preventScroll: true });
}

function refreshLayout() {
  if (!projectionDirty && !layoutDirty) return;
  projectionDirty = false;
  const rect = game.getBoundingClientRect();
  const scale = rect.width / WIDTH;
  if (!scale) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  const canvasWidth = Math.round(canvas.clientWidth * pixelRatio);
  const canvasHeight = Math.round(canvas.clientHeight * pixelRatio);
  if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
  if (canvas.height !== canvasHeight) canvas.height = canvasHeight;
  projection = { left: rect.left, top: rect.top, scale, pixelRatio };

  if (!layoutDirty) return;
  layoutDirty = false;
  Composite.clear(obstacleBodies, false);
  for (const element of obstacles) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const body = Bodies.rectangle(
      (box.left + box.width / 2 - rect.left) / scale,
      (box.top + box.height / 2 - rect.top) / scale,
      box.width / scale, box.height / scale,
      { isStatic: true, friction: .7, restitution: .08 }
    );
    Composite.add(obstacleBodies, body);
  }
}

function drawFruit(x, y, level, angle = 0) {
  const radius = RADII[level];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  if (level === FRUITS.length - 1) {
    const gradient = ctx.createRadialGradient(-radius * .35, -radius * .4, 1, 0, 0, radius);
    gradient.addColorStop(0, "#c6ed91");
    gradient.addColorStop(.55, "#59ae50");
    gradient.addColorStop(1, "#226b39");
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = "#236b3a";
    ctx.lineWidth = radius * .07;
    for (let stripe = -2; stripe <= 2; stripe++) {
      ctx.beginPath();
      ctx.ellipse(stripe * radius * .34, 0, radius * .15, radius * 1.1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = "#fff9ee";
    ctx.fill();
    ctx.strokeStyle = "#63805e55";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = radius * 1.5 + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#34443a";
    ctx.fillText(FRUITS[level], 0, 0);
  }
  ctx.restore();
}

function draw() {
  if (!projection) return;
  const { left, top, scale, pixelRatio } = projection;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale * pixelRatio, 0, 0, scale * pixelRatio, left * pixelRatio, top * pixelRatio);
  ctx.beginPath();
  ctx.moveTo(bowlPath[0].x, bowlPath[0].y);
  for (const point of bowlPath.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.fillStyle = "#dce8d2";
  ctx.fill();
  ctx.strokeStyle = "#63805e";
  ctx.lineWidth = WALL;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  if (!gameOver && cooldown === 0) {
    ctx.beginPath();
    ctx.moveTo(currentX, RIM);
    ctx.lineTo(currentX, FLOOR);
    ctx.setLineDash([4, 7]);
    ctx.strokeStyle = "#63805e70";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = .8;
    drawFruit(currentX, SPAWN, currentLevel);
    ctx.globalAlpha = 1;
  }
  for (const fruit of fruits) drawFruit(fruit.position.x, fruit.position.y, fruit.level, fruit.angle);
}

function frame(time) {
  refreshLayout();
  accumulator += Math.min(time - (lastFrame ?? time), STEP * 5);
  lastFrame = time;
  while (!gameOver && accumulator >= STEP) {
    if (cooldown > 0) {
      cooldown = Math.max(0, cooldown - STEP);
      if (cooldown === 0) dropButton.disabled = false;
    }
    Engine.update(engine, STEP);
    mergeFruits();
    checkEscaped();
    accumulator -= STEP;
  }
  if (gameOver) accumulator = 0;
  draw();
  requestAnimationFrame(frame);
}

function notifySave(text, error = false) {
  const status = byId("saveStatus");
  status.toggleAttribute("data-error", error);
  status.textContent = text;
}

function makeSave() {
  const data = {
    score, best, plays, counted, currentLevel, nextLevel, currentX, cooldown,
    mode: mode.value,
    fruits: [...fruits].map(fruit => ({
      x: fruit.position.x, y: fruit.position.y,
      vx: fruit.velocity.x, vy: fruit.velocity.y,
      angle: fruit.angle, spin: fruit.angularVelocity, level: fruit.level,
      escapedFor: fruit.escapedFor
    }))
  };
  issuedCode = "SUIKA6-" + btoa(JSON.stringify(data));
  saveInput.value = issuedCode;
  notifySave("セーブコードを発行しました。");
}

async function copySave() {
  if (!issuedCode) makeSave();
  saveInput.value = issuedCode;
  const code = issuedCode;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    if (saveInput.value !== code) return;
    saveInput.focus({ preventScroll: true });
    saveInput.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      // Manual copying is available from the selected field.
    }
    if (!copied) {
      notifySave("自動コピーできませんでした。選択したコードを手動でコピーしてください。", true);
      return;
    }
  }
  if (saveInput.value === code) notifySave("コピーしました。");
}

function numberIn(value, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max ||
      (integer && !Number.isSafeInteger(value))) throw new Error("Invalid save value");
  return value;
}

function parseSave(code) {
  const legacy = code.startsWith("SUIKA5-");
  if ((!legacy && !code.startsWith("SUIKA6-")) || code.length > 160000) {
    throw new Error("Unknown save format");
  }
  const data = JSON.parse(atob(code.slice(7)));
  if (!Array.isArray(data.fruits) || data.fruits.length > 500 ||
      !["normal", "slippery"].includes(data.mode) ||
      (!legacy && typeof data.counted !== "boolean")) {
    throw new Error("Invalid save data");
  }

  // Older codes stored viewport coordinates without recording the source viewport or scroll offset.
  const rect = game.getBoundingClientRect();
  const offsetX = legacy ? rect.left : 0;
  const offsetY = legacy ? rect.top + window.scrollY : 0;
  const readLevel = value => numberIn(value, 0, FRUITS.length - 1, true);
  const readPosition = value => numberIn(value, -20000, 20000);
  return {
    score: numberIn(data.score, 0, Number.MAX_SAFE_INTEGER - 100, true),
    best: numberIn(data.best, 0, Number.MAX_SAFE_INTEGER - 100, true),
    plays: numberIn(data.plays, 0, Number.MAX_SAFE_INTEGER - 100, true),
    counted: legacy ? data.fruits.length > 0 || data.score > 0 : data.counted,
    currentLevel: readLevel(data.currentLevel),
    nextLevel: readLevel(data.nextLevel),
    currentX: readPosition(data.currentX) - offsetX,
    cooldown: legacy ? 0 : numberIn(data.cooldown, 0, DROP_DELAY),
    mode: data.mode,
    fruits: data.fruits.map(fruit => ({
      x: readPosition(fruit.x) - offsetX,
      y: readPosition(fruit.y) - offsetY,
      vx: numberIn(fruit.vx, -1000, 1000),
      vy: numberIn(fruit.vy, -1000, 1000),
      angle: numberIn(fruit.angle, -1e9, 1e9),
      spin: legacy ? 0 : numberIn(fruit.spin, -1000, 1000),
      escapedFor: legacy ? 0 : numberIn(fruit.escapedFor, 0, ESCAPE_DELAY),
      level: readLevel(fruit.level)
    }))
  };
}

function loadSave() {
  let data;
  try {
    data = parseSave(saveInput.value.trim());
  } catch {
    notifySave("セーブコードが正しくありません。", true);
    return;
  }
  clearBoard();
  score = data.score;
  best = Math.max(best, score, data.best, readCounter("suikaBest"));
  plays = Math.max(plays, data.plays, readCounter("suikaPlays"));
  counted = data.counted;
  currentLevel = data.currentLevel;
  nextLevel = data.nextLevel;
  cooldown = data.cooldown;
  dropButton.disabled = cooldown > 0;
  setAim(data.currentX);
  mode.value = data.mode;
  for (const saved of data.fruits) {
    const fruit = addFruit(saved.x, saved.y, saved.level);
    Body.setVelocity(fruit, { x: saved.vx, y: saved.vy });
    Body.setAngle(fruit, saved.angle);
    Body.setAngularVelocity(fruit, saved.spin);
    fruit.escapedFor = saved.escapedFor;
  }
  saveCounters();
  updateStats();
  notifySave("読み込みました。");
}

byId("moveLeft").addEventListener("click", () => move(-1));
byId("moveRight").addEventListener("click", () => move(1));
dropButton.addEventListener("click", dropFruit);
byId("makeSave").addEventListener("click", makeSave);
byId("copySave").addEventListener("click", copySave);
byId("loadSave").addEventListener("click", loadSave);
byId("restart").addEventListener("click", restart);
mode.addEventListener("change", applyMode);
message.addEventListener("cancel", event => event.preventDefault());

function aimFromPointer(event) {
  const rect = game.getBoundingClientRect();
  setAim((event.clientX - rect.left) * WIDTH / rect.width);
}

game.addEventListener("pointermove", event => {
  if (!gameOver && cooldown === 0) aimFromPointer(event);
});
game.addEventListener("click", event => {
  if (gameOver || cooldown > 0) return;
  aimFromPointer(event);
  dropFruit();
});
window.addEventListener("keydown", event => {
  if (gameOver || event.isComposing || event.altKey || event.ctrlKey ||
      event.metaKey || event.shiftKey ||
      event.target instanceof Element &&
      event.target.closest("input, select, textarea, [contenteditable]")) return;

  switch (event.key) {
    case "ArrowLeft":
      move(-1);
      break;
    case "ArrowRight":
      move(1);
      break;
    case "ArrowDown":
      if (!event.repeat) dropFruit();
      break;
    default:
      return;
  }
  event.preventDefault();
});

const observer = new ResizeObserver(() => { layoutDirty = true; });
for (const element of [game, ...obstacles]) observer.observe(element);
window.addEventListener("resize", () => { layoutDirty = true; });
window.addEventListener("scroll", () => { projectionDirty = true; }, { passive: true });
window.addEventListener("pageshow", () => { layoutDirty = true; });
updateStats();
requestAnimationFrame(frame);
