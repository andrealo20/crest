/*
 * Alarm sounds via WebAudio, no audio files needed. Classic alarm patterns:
 * each pattern is a short phrase repeated up to the chosen duration.
 */
export type AlarmSound = "chime" | "bell" | "digital" | "radar" | "marimba" | "soft";
/** Seconds; 0 = once, -1 = until stopped (max. 2 minutes). */
export type AlarmDuration = 0 | 5 | 15 | 30 | -1;

export const alarmSounds: { value: AlarmSound; label: string }[] = [
  { value: "chime", label: "Gong" },
  { value: "bell", label: "Glocke" },
  { value: "digital", label: "Digitalwecker" },
  { value: "radar", label: "Radar" },
  { value: "marimba", label: "Marimba" },
  { value: "soft", label: "Sanft" },
];

interface Note {
  freq: number;
  at: number;
  /** Decay time in s. */
  decay: number;
  type?: OscillatorType;
  /** Overtones (multiples + relative volume) for a bell sound. */
  partials?: [number, number][];
  gain?: number;
  /** Glides to this frequency, exponentially over `glide` s (default: the whole decay): a drop, a zap, a chirp. */
  to?: number;
  glide?: number;
  /** Rise time in s; 8 ms unless a pop or a knock needs it sharper. */
  attack?: number;
  /** Filtered noise instead of a tone, `freq` being the filter's frequency: a pop, a knock. */
  noise?: BiquadFilterType;
  /** The noise filter's Q. */
  q?: number;
}

/** One phrase per sound; `length` = gap until it repeats. */
const patterns: Record<AlarmSound, { notes: Note[]; length: number }> = {
  chime: {
    notes: [
      { freq: 880, at: 0, decay: 1.4 },
      { freq: 1318.5, at: 0.16, decay: 1.4 },
    ],
    length: 1.8,
  },
  bell: {
    notes: [{ freq: 660, at: 0, decay: 2.4, partials: [[2, 0.5], [3, 0.25], [4.2, 0.18], [5.4, 0.1]] }],
    length: 1.6,
  },
  digital: {
    notes: [0, 0.14, 0.28, 0.42].map((at) => ({ freq: 2048, at, decay: 0.09, type: "square" as const, gain: 0.35 })),
    length: 1.0,
  },
  radar: {
    notes: [0, 0.12, 0.24, 0.36].map((at, i) => ({ freq: 1046.5 * (1 + i * 0.06), at, decay: 0.16, type: "triangle" as const, gain: 0.8 })),
    length: 1.1,
  },
  marimba: {
    notes: [
      { freq: 523.25, at: 0, decay: 0.5, partials: [[4, 0.15]] },
      { freq: 659.25, at: 0.15, decay: 0.5, partials: [[4, 0.15]] },
      { freq: 783.99, at: 0.3, decay: 0.5, partials: [[4, 0.15]] },
      { freq: 1046.5, at: 0.45, decay: 0.8, partials: [[4, 0.15]] },
    ],
    length: 1.5,
  },
  soft: {
    notes: [
      { freq: 587.33, at: 0, decay: 1.8, gain: 0.7 },
      { freq: 880, at: 0.5, decay: 2.2, gain: 0.55 },
    ],
    length: 2.8,
  },
};

/** Sounds for notices in the closed notch (issue #31): one short phrase each, over within 0.35 s. */
export type NoticeSound = "ding" | "click" | "tones" | "down" | "trill" | "droplet" | "balloon" | "knock" | "chirp" | "zap";

export const noticeSounds: { value: NoticeSound; label: string }[] = [
  { value: "ding", label: "Ding" },
  { value: "click", label: "Tick" },
  { value: "tones", label: "Zwei Töne" },
  { value: "down", label: "Abwärts" },
  { value: "trill", label: "Triller" },
  { value: "droplet", label: "Tropfen" },
  { value: "balloon", label: "Ballon" },
  { value: "knock", label: "Klopfen" },
  { value: "chirp", label: "Zirpen" },
  { value: "zap", label: "Laser" },
];

/** One knock on wood: a falling thud and a short tick of noise. */
const knockAt = (at: number): Note[] => [
  { freq: 820, to: 560, glide: 0.03, at, decay: 0.06, attack: 0.001 },
  { freq: 2400, noise: "bandpass", q: 2.5, at, decay: 0.025, attack: 0.001, gain: 1.6 },
];

const noticePatterns: Record<NoticeSound, Note[]> = {
  /** One bright bell tone. */
  ding: [{ freq: 1567.98, at: 0, decay: 0.35, partials: [[2, 0.22], [3, 0.08]], gain: 0.9 }],
  /** A tick with a little body below it. */
  click: [{ freq: 2093, at: 0, decay: 0.045, type: "triangle", partials: [[0.5, 0.5]] }],
  /** Two notes up a fifth. */
  tones: [
    { freq: 1046.5, at: 0, decay: 0.13, gain: 0.85 },
    { freq: 1567.98, at: 0.085, decay: 0.22, gain: 0.85 },
  ],
  /** Two notes falling. */
  down: [
    { freq: 1760, at: 0, decay: 0.07, gain: 0.75 },
    { freq: 1174.66, at: 0.055, decay: 0.16, gain: 0.85 },
  ],
  /** Three quick notes up a chord. */
  trill: [
    { freq: 1318.51, at: 0, decay: 0.07, gain: 0.7 },
    { freq: 1567.98, at: 0.05, decay: 0.07, gain: 0.7 },
    { freq: 2093, at: 0.1, decay: 0.16, gain: 0.7 },
  ],
  /** A drop falling into water: one quick rising plink. */
  droplet: [{ freq: 650, to: 1850, glide: 0.05, at: 0, decay: 0.13, attack: 0.002 }],
  /** A balloon popping: a sharp burst of noise over a low thump. */
  balloon: [
    { freq: 1800, noise: "bandpass", q: 0.7, at: 0, decay: 0.07, attack: 0.001, gain: 0.7 },
    { freq: 4000, noise: "highpass", at: 0, decay: 0.025, attack: 0.001, gain: 0.4 },
    { freq: 170, to: 70, at: 0, decay: 0.09, attack: 0.001, gain: 0.7 },
  ],
  /** Two knocks on wood. */
  knock: [...knockAt(0), ...knockAt(0.13)],
  /** A bird's two quick chirps. */
  chirp: [
    { freq: 2200, to: 3600, glide: 0.05, at: 0, decay: 0.07, attack: 0.004, gain: 0.8 },
    { freq: 2400, to: 3900, glide: 0.05, at: 0.09, decay: 0.08, attack: 0.004, gain: 0.8 },
  ],
  /** A short laser zap, falling fast. */
  zap: [{ freq: 1900, to: 220, glide: 0.17, at: 0, decay: 0.2, attack: 0.002, type: "triangle", gain: 0.8 }],
};

const MAX_RING_S = 120;
/** A sound file of the user's own plays at most this long; a song picked by mistake fades out here. */
const NOTICE_FILE_MAX_S = 5;
let ctx: AudioContext | null = null;
let stopCurrent: (() => void) | null = null;
/** Notice sounds still sounding: the context rests only once they and the alarm are done. */
let noticesPlaying = 0;

// An idle running context keeps WebView2's output stream open on the device.
function settle() {
  if (stopCurrent === null && noticesPlaying === 0) void ctx?.suspend();
}

/** A second of white noise for noise notes, made once per context. */
let noiseBuffer: AudioBuffer | null = null;
function whiteNoise(c: AudioContext): AudioBuffer {
  if (noiseBuffer?.sampleRate === c.sampleRate) return noiseBuffer;
  const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = b.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return (noiseBuffer = b);
}

/** One note (a tone with its partials, or filtered noise) into `out` at time `t`; the sources are returned so an alarm can stop them. */
function voice(c: AudioContext, out: AudioNode, n: Note, t: number): AudioScheduledSourceNode[] {
  const envelope = (rel: number) => {
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25 * (n.gain ?? 1) * rel, t + (n.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + n.decay);
    g.connect(out);
    return g;
  };
  // A partial glides by the same ratio as its fundamental.
  const glide = (p: AudioParam, from: number) => {
    p.setValueAtTime(from, t);
    if (n.to) p.exponentialRampToValueAtTime((n.to * from) / n.freq, t + (n.glide ?? n.decay));
  };
  const play = (src: AudioScheduledSourceNode) => {
    src.start(t);
    src.stop(t + n.decay + 0.05);
    return src;
  };
  if (n.noise) {
    const src = c.createBufferSource();
    src.buffer = whiteNoise(c);
    const filter = c.createBiquadFilter();
    filter.type = n.noise;
    filter.Q.value = n.q ?? 1;
    glide(filter.frequency, n.freq);
    src.connect(filter).connect(envelope(1));
    return [play(src)];
  }
  return ([[1, 1], ...(n.partials ?? [])] as [number, number][]).map(([mult, rel]) => {
    const osc = c.createOscillator();
    osc.type = n.type ?? "sine";
    glide(osc.frequency, n.freq * mult);
    osc.connect(envelope(rel));
    return play(osc);
  });
}

/**
 * A notice's sound, once. It plays over a ringing alarm instead of stopping it. An AudioBuffer is the user's own file
 * (decodeSound), cut after NOTICE_FILE_MAX_S.
 */
export function playNotice(sound: NoticeSound | AudioBuffer) {
  ctx ??= new AudioContext();
  const c = ctx;
  void c.resume();
  const out = c.createGain();
  out.connect(c.destination);
  const start = c.currentTime + 0.02;
  let length: number;
  if (sound instanceof AudioBuffer) {
    length = Math.min(sound.duration, NOTICE_FILE_MAX_S);
    out.gain.setValueAtTime(0.8, start);
    // A file cut short fades out instead of clicking off.
    if (sound.duration > NOTICE_FILE_MAX_S) out.gain.setTargetAtTime(0, start + length - 0.2, 0.05);
    const src = c.createBufferSource();
    src.buffer = sound;
    src.connect(out);
    src.start(start);
    src.stop(start + length);
  } else {
    // Peaks near -10 dBFS: heard once, next to Windows' own sounds, which are louder than an alarm's single voice.
    out.gain.value = 1.4;
    const notes = noticePatterns[sound];
    notes.forEach((n) => voice(c, out, n, start + n.at));
    length = Math.max(...notes.map((n) => n.at + n.decay));
  }
  noticesPlaying++;
  window.setTimeout(() => {
    out.disconnect();
    noticesPlaying--;
    settle();
  }, (length + 0.3) * 1000);
}

/** A sound file's bytes, decoded once for playNotice; rejects what the page cannot play. */
export function decodeSound(bytes: ArrayBuffer): Promise<AudioBuffer> {
  ctx ??= new AudioContext();
  return ctx.decodeAudioData(bytes);
}

/** Plays the alarm and returns a stop function. A new alarm stops the old one. */
export function playAlarm(sound: AlarmSound, volume: number, duration: AlarmDuration): () => void {
  stopCurrent?.();
  ctx ??= new AudioContext();
  const c = ctx;
  void c.resume();
  const master = c.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume)) * 0.5;
  master.connect(c.destination);

  const { notes, length } = patterns[sound];
  const total = duration === 0 ? length : duration === -1 ? MAX_RING_S : duration;
  const repeats = Math.max(1, Math.floor(total / length));
  const start = c.currentTime + 0.02;
  const nodes: AudioScheduledSourceNode[] = [];

  for (let r = 0; r < repeats; r++) {
    for (const n of notes) nodes.push(...voice(c, master, n, start + r * length + n.at));
  }

  const stop = () => {
    // Fade out softly instead of cutting off.
    master.gain.cancelScheduledValues(c.currentTime);
    master.gain.setTargetAtTime(0, c.currentTime, 0.05);
    window.setTimeout(() => {
      nodes.forEach((o) => {
        try {
          o.stop();
        } catch {
          // Already stopped.
        }
      });
      master.disconnect();
      settle();
    }, 300);
    if (stopCurrent === stop) stopCurrent = null;
  };
  stopCurrent = stop;
  window.setTimeout(() => {
    if (stopCurrent !== stop) return;
    stopCurrent = null;
    settle();
  }, (repeats * length + 2) * 1000);
  return stop;
}

/** Is an alarm playing right now? */
export function alarmRinging(): boolean {
  return stopCurrent !== null;
}

export function stopAlarm() {
  stopCurrent?.();
}
