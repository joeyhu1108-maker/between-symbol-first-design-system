const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const state = {
  ctx: null,
  master: null,
  drone: null,
  droneGain: null,
  card: null,
  active: false,
  muted: false,
  energy: 0,
  lastPulse: 0,
  base: 220,
};

const $ = id => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function ensureAudio() {
  if (!AudioContextClass) return null;
  if (!state.ctx) {
    state.ctx = new AudioContextClass();
    state.master = state.ctx.createGain();
    state.master.gain.value = state.muted ? 0 : 0.16;
    state.master.connect(state.ctx.destination);
  }
  state.ctx.resume?.();
  return state.ctx;
}

function stopDrone() {
  if (state.drone) {
    try { state.drone.stop(); } catch {}
    state.drone.disconnect();
  }
  state.drone = null;
  state.droneGain = null;
}

function tone(frequency, when = 0, duration = 0.5, level = 0.04, type = 'sine') {
  const ctx = ensureAudio();
  if (!ctx || !state.master) return;
  const start = Math.max(ctx.currentTime + 0.01, when || ctx.currentTime + 0.01);
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, level), start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(state.master);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

function start(card) {
  const ctx = ensureAudio();
  if (!ctx) return;
  stopDrone();
  state.card = card;
  state.active = true;
  state.energy = 0;
  state.base = 150 + (Number(card?.id || 1) % 12) * 12;

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = card?.mechanic === 'return' ? 'triangle' : 'sine';
  oscillator.frequency.value = state.base;
  gain.gain.value = 0.0001;
  oscillator.connect(gain).connect(state.master);
  oscillator.start();
  state.drone = oscillator;
  state.droneGain = gain;
  tone(state.base * 2, ctx.currentTime + 0.05, 0.8, 0.025, 'sine');
}

function stop() {
  stopDrone();
  state.card = null;
  state.active = false;
  state.energy = 0;
}

function nutrient(event) {
  const ctx = ensureAudio();
  if (!ctx || !state.active) return;
  state.energy = clamp(state.energy + Number(event.detail?.amount || 0.02) * 1.7, 0, 1);
  if (state.droneGain) {
    const target = 0.006 + state.energy * 0.035;
    state.droneGain.gain.setTargetAtTime(target, ctx.currentTime, 0.12);
  }
  if (ctx.currentTime - state.lastPulse < 0.1) return;
  state.lastPulse = ctx.currentTime;
  const ratio = state.card?.mechanic === 'balance' ? 1.5 : 1 + state.energy * 0.6;
  tone(state.base * ratio, ctx.currentTime + 0.02, 0.18 + state.energy * 0.2, 0.018 + state.energy * 0.018, 'triangle');
}

function release() {
  const ctx = ensureAudio();
  if (!ctx || !state.active) return;
  const now = ctx.currentTime;
  const card = state.card || {};
  if (card.mechanic === 'return' || card.name === '回声') {
    tone(state.base * 1.5, now + 0.02, 0.45, 0.055, 'sine');
    [0.9, 1.8, 2.8, 4.0].forEach((offset, index) => {
      tone(state.base * (1.5 - index * 0.08), now + offset, 0.42, 0.04 - index * 0.007, 'sine');
    });
  } else if (card.mechanic === 'balance') {
    const overfed = state.energy > 0.82;
    tone(state.base * (overfed ? 0.72 : 1.25), now + 0.02, 0.65, 0.045, overfed ? 'sawtooth' : 'sine');
    tone(state.base * (overfed ? 0.76 : 1.5), now + 0.12, 0.8, 0.035, overfed ? 'square' : 'triangle');
  } else {
    tone(state.base * 1.25, now + 0.02, 0.65, 0.05, 'triangle');
    tone(state.base * 1.875, now + 0.18, 1.0, 0.028, 'sine');
  }
  if (card.name === '边界') {
    state.droneGain?.gain.setTargetAtTime(0.0001, now + 0.05, 0.08);
  }
}

function complete() {
  const ctx = ensureAudio();
  if (!ctx || !state.active) return;
  tone(state.base * 1.25, ctx.currentTime + 0.05, 1.2, 0.045, 'sine');
  tone(state.base * 1.5, ctx.currentTime + 0.18, 1.4, 0.035, 'triangle');
}

function toggle() {
  const ctx = ensureAudio();
  if (!ctx || !state.master) return;
  state.muted = !state.muted;
  state.master.gain.setTargetAtTime(state.muted ? 0 : 0.16, ctx.currentTime, 0.04);
  const button = $('audio-toggle');
  if (button) {
    button.textContent = state.muted ? '声音 开' : '声音 关';
    button.setAttribute('aria-pressed', String(!state.muted));
  }
}

window.addEventListener('seed-game-enter', event => start(event.detail?.card));
window.addEventListener('nutrient', nutrient);
window.addEventListener('seed-release', release);
window.addEventListener('seed-game-complete', complete);
window.addEventListener('seed-game-leave', stop);
window.addEventListener('seed-game-restart', () => state.card && start(state.card));
$('audio-toggle')?.addEventListener('click', toggle);

setInterval(() => {
  if (!state.active || !state.droneGain || !state.ctx) return;
  const energy = Number(window.__seedEnergy || state.energy);
  state.droneGain.gain.setTargetAtTime(0.006 + clamp(energy, 0, 1) * 0.035, state.ctx.currentTime, 0.12);
}, 80);
