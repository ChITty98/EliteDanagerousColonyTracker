/**
 * Co-pilot audio — the chime and the speaking voice.
 *
 * ONE AudioContext for the whole app. Browsers suspend any context not created by a user
 * gesture, so it is resumed on the Sound-toggle click and everything afterwards can play.
 * The Cockpit page and the corner pop-up both come through here so they cannot end up
 * holding two contexts, only one of which has been unlocked.
 *
 * Speech itself is rendered server-side to WAV (Windows SAPI) — the browser's own
 * speechSynthesis cannot be routed through Web Audio, and the filter below is the entire
 * point of the voice. See server/ai/copilotVoice.js for the SSML side.
 */

let audioCtx: AudioContext | null = null;

export function ensureAudio(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}

/** A soft two-note chime so a new line registers without looking over. */
export function playChime(): void {
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      const t = now + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.start(t); o.stop(t + 0.2);
    });
  } catch { /* */ }
}

// ---------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------

// The commander's dialled-in comms treatment. Not a telephone band — the low cut is a hard
// 970 Hz (strips all body) while the high cut stays up at 4600 (keeps the brightness), with
// heavy saturation over it. The result is thin and harsh, like a squawking intercom, rather
// than muffled and distant. Applied ONLY to Wren: she is a person talking into a mic. The
// machines are plugged into the ship, so they play dry.
const LOW_CUT_HZ = 970;
const HIGH_CUT_HZ = 4600;
const PRESENCE_HZ = 1800;
const GRIT = 150;
const SQUELCH = 0.17;

function saturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = amount * 2;
  const n = 4096;
  // Backed by an explicit ArrayBuffer: WaveShaperNode.curve rejects the SharedArrayBuffer-capable
  // Float32Array that the bare constructor is typed as.
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

// A new line interrupts the previous one — two voices talking over each other is worse
// than missing the tail of an old remark.
let current: AudioBufferSourceNode | null = null;
let currentNoise: AudioBufferSourceNode | null = null;

function stopCurrent(): void {
  try { current?.stop(); } catch { /* already ended */ }
  try { currentNoise?.stop(); } catch { /* already ended */ }
  current = null;
  currentNoise = null;
}

function voiceUrl(id: string, persona: string): string {
  const base = `/copilot-voice?id=${encodeURIComponent(id)}&persona=${encodeURIComponent(persona)}`;
  try {
    const t = sessionStorage.getItem('colony-token');
    return t ? `${base}&token=${t}` : base;
  } catch { return base; }
}

/**
 * Speak a line the co-pilot already said, addressed by its id. Silent — never throws — when
 * speech is unavailable (non-Windows server, line aged out of the register, audio not unlocked).
 */
export async function playVoice(id: string, persona: string): Promise<void> {
  if (!id) return;
  const ctx = ensureAudio();
  if (!ctx) return;

  let res: Response;
  try {
    res = await fetch(voiceUrl(id, persona));
  } catch { return; }               // server down or offline — stay quiet
  if (!res.ok) return;              // 404 = nothing to say for that line

  const playbackRate = Number(res.headers.get('X-Voice-Playback-Rate')) || 1;
  const filtered = res.headers.get('X-Voice-Filter') === '1';

  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(await res.arrayBuffer());
  } catch { return; }               // not audio we can play

  if (ctx.state === 'suspended') await ctx.resume();
  stopCurrent();

  const src = ctx.createBufferSource();
  src.buffer = buf;
  // Tape-speed shift: scales pitch and duration together. Tycho is synthesised slow and played
  // fast, which lifts him past SAPI's hard +50% pitch ceiling with the speed landing back at 1.
  src.playbackRate.value = playbackRate;
  current = src;
  src.onended = () => { if (current === src) current = null; };

  if (!filtered) {
    src.connect(ctx.destination);
    src.start();
    return;
  }

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = LOW_CUT_HZ; hp.Q.value = 0.7;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = HIGH_CUT_HZ; lp.Q.value = 0.7;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking'; presence.frequency.value = PRESENCE_HZ; presence.Q.value = 1.1; presence.gain.value = 6;
  const shaper = ctx.createWaveShaper();
  shaper.curve = saturationCurve(GRIT); shaper.oversample = '2x';
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.12;
  const out = ctx.createGain();
  // MEASURED, not guessed. The GRIT=150 waveshaper is effectively a hard limiter: it maps even a
  // quiet input near full scale, adding ~16 dB of makeup on its own. Wren's raw synthesis sits at
  // rms 0.095 and leaves that stage at 0.61, so at the original 1.1 — or even 0.7 — she arrived
  // >12 dB louder than Tycho and K2, who play dry. Parity measures at 0.166; 0.2 leaves her a
  // shade above the machines so she still cuts through, which suits a comms channel.
  // The squelch hiss feeds this same node, so its level tracks the voice and the character holds.
  out.gain.value = 0.2;

  src.connect(hp); hp.connect(lp); lp.connect(presence);
  presence.connect(shaper); shaper.connect(comp); comp.connect(out);
  out.connect(ctx.destination);

  // Carrier hiss for the length of the transmission — an open channel, not a clean file.
  const dur = buf.duration / playbackRate;
  const noiseBuf = ctx.createBuffer(1, Math.max(1, Math.ceil(ctx.sampleRate * dur)), ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * SQUELCH;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  const noiseBand = ctx.createBiquadFilter();
  noiseBand.type = 'bandpass'; noiseBand.frequency.value = 2000; noiseBand.Q.value = 0.6;
  noise.connect(noiseBand); noiseBand.connect(out);
  currentNoise = noise;

  noise.start();
  noise.stop(ctx.currentTime + dur + 0.05);
  src.start();
}
