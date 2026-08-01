/**
 * All audio is synthesised at runtime with the Web Audio API.
 *
 * A spray can is basically filtered white noise, a footstep is a short noise
 * burst, and a siren is two oscillators — so shipping zero audio files costs us
 * nothing in feel and keeps the build free of licensed assets.
 */
export class SoundBank {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private sprayNoise: AudioBufferSourceNode | null = null;
  private sprayGain: GainNode | null = null;
  private sprayFilter: BiquadFilterNode | null = null;

  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenLfo: OscillatorNode | null = null;

  private volume = 0.7;
  private lastFootstep = 0;

  /** Web Audio needs a user gesture; call this from the menu's play button. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.value = this.volume;
  }

  // ---------------------------------------------------------------- spraying

  /** Starts the continuous hiss. Safe to call repeatedly. */
  startSpray(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer || this.sprayNoise) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 3400;
    filter.Q.value = 0.7;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.16, this.ctx.currentTime + 0.05);

    source.connect(filter).connect(gain).connect(this.master);
    source.start();

    this.sprayNoise = source;
    this.sprayGain = gain;
    this.sprayFilter = filter;
  }

  /** Pressure and cap width shape the hiss while the trigger is held. */
  updateSpray(pressure: number, capWidth: number): void {
    if (!this.ctx || !this.sprayGain || !this.sprayFilter) return;
    const now = this.ctx.currentTime;
    this.sprayFilter.frequency.setTargetAtTime(1800 + pressure * 3200 - capWidth * 400, now, 0.05);
    this.sprayGain.gain.setTargetAtTime(0.06 + pressure * 0.14 + capWidth * 0.03, now, 0.05);
  }

  stopSpray(): void {
    if (!this.ctx || !this.sprayNoise || !this.sprayGain) return;
    const now = this.ctx.currentTime;
    this.sprayGain.gain.cancelScheduledValues(now);
    this.sprayGain.gain.setTargetAtTime(0, now, 0.03);
    const source = this.sprayNoise;
    window.setTimeout(() => {
      try {
        source.stop();
        source.disconnect();
      } catch {
        /* already stopped */
      }
    }, 160);
    this.sprayNoise = null;
    this.sprayGain = null;
    this.sprayFilter = null;
  }

  /** The ball-bearing rattle. Six irregular clicks. */
  rattle(): void {
    if (!this.ctx || !this.master) return;
    const start = this.ctx.currentTime;
    for (let i = 0; i < 6; i += 1) {
      this.click(start + i * (0.07 + Math.random() * 0.05), 1400 + Math.random() * 1800, 0.09, 0.03);
    }
  }

  // ------------------------------------------------------------------- world

  footstep(running: boolean, crouching: boolean): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const interval = running ? 0.29 : crouching ? 0.72 : 0.47;
    if (now - this.lastFootstep < interval) return;
    this.lastFootstep = now;

    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 480 + Math.random() * 620;
    filter.Q.value = 1.4;
    const gain = this.ctx.createGain();
    const level = crouching ? 0.035 : running ? 0.16 : 0.09;
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.13);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.16);
  }

  cameraShutter(): void {
    this.click(undefined, 2600, 0.16, 0.02);
    this.click((this.ctx?.currentTime ?? 0) + 0.07, 1500, 0.12, 0.03);
  }

  pickup(): void {
    this.tone(660, 0.09, "triangle", 0.12);
    this.tone(990, 0.12, "triangle", 0.1, 0.08);
  }

  success(): void {
    this.tone(523, 0.12, "sawtooth", 0.07);
    this.tone(659, 0.12, "sawtooth", 0.07, 0.1);
    this.tone(784, 0.22, "sawtooth", 0.08, 0.2);
  }

  failure(): void {
    this.tone(220, 0.3, "square", 0.09);
    this.tone(150, 0.4, "square", 0.08, 0.12);
  }

  whistle(): void {
    this.tone(1900, 0.18, "sine", 0.1);
    this.tone(2300, 0.22, "sine", 0.1, 0.14);
  }

  // ------------------------------------------------------------------ sirens

  /** Starts the two-tone siren loop; `intensity` scales volume with heat. */
  startSiren(intensity: number): void {
    if (!this.ctx || !this.master) return;
    if (this.sirenGain) {
      this.sirenGain.gain.setTargetAtTime(0.035 + intensity * 0.05, this.ctx.currentTime, 0.4);
      return;
    }
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 640;

    const lfo = this.ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 1.1;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 150;
    lfo.connect(lfoGain).connect(osc.frequency);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1600;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.035 + intensity * 0.05, this.ctx.currentTime, 0.5);

    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    lfo.start();

    this.sirenOsc = osc;
    this.sirenGain = gain;
    this.sirenLfo = lfo;
  }

  stopSiren(): void {
    if (!this.ctx || !this.sirenGain || !this.sirenOsc) return;
    const now = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(0, now, 0.3);
    const osc = this.sirenOsc;
    const lfo = this.sirenLfo;
    window.setTimeout(() => {
      try {
        osc.stop();
        osc.disconnect();
        lfo?.stop();
        lfo?.disconnect();
      } catch {
        /* already stopped */
      }
    }, 900);
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenLfo = null;
  }

  dispose(): void {
    this.stopSpray();
    this.stopSiren();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  // ----------------------------------------------------------------- private

  private makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private click(at: number | undefined, frequency: number, level: number, duration: number): void {
    if (!this.ctx || !this.master) return;
    const start = at ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(frequency, start);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.4, start + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(level, start);
    gain.gain.exponentialRampToValueAtTime(0.0005, start + duration);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    level: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master) return;
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0005, start + duration);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }
}
