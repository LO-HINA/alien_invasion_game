// 全部音效用 WebAudio 实时合成，不依赖音频文件

const BASS = [55, 55, 110, 55, 65.41, 65.41, 130.81, 65.41, 49, 49, 98, 49, 58.27, 58.27, 116.54, 73.42];
const ARP = [440, 523.25, 659.25, 880, 392, 523.25, 587.33, 783.99];
const STEP_SEC = 60 / 132 / 2;

class AudioEngine {
  private ctx?: AudioContext;
  private master?: GainNode;
  private musicGain?: GainNode;
  private noiseBuf?: AudioBuffer;
  private musicTimer?: number;
  private nextStepTime = 0;
  private step = 0;
  musicOn = true;

  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(ctx.destination);
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0, out?: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(out ?? this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, cutoff: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(60, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  shoot(): void { this.tone(1200, 0.05, 'square', 0.025, 500); }
  hit(): void { this.tone(300, 0.04, 'square', 0.04, 150); }
  explode(big = false): void {
    this.noise(big ? 0.9 : 0.35, big ? 0.55 : 0.25, big ? 900 : 2200);
    this.tone(big ? 110 : 180, big ? 0.7 : 0.25, 'sawtooth', big ? 0.2 : 0.08, 35);
  }
  hurt(): void { this.tone(180, 0.3, 'square', 0.18, 50); }
  shield(): void { this.tone(900, 0.15, 'sine', 0.15, 300); }
  powerUp(): void {
    this.tone(523.25, 0.1, 'triangle', 0.2);
    this.tone(659.25, 0.1, 'triangle', 0.2, undefined, 0.08);
    this.tone(1046.5, 0.18, 'triangle', 0.2, undefined, 0.16);
  }
  bomb(): void {
    this.noise(1.4, 0.7, 500);
    this.tone(80, 1.2, 'sine', 0.5, 25);
  }
  alarm(): void {
    for (let i = 0; i < 3; i++) this.tone(440, 0.3, 'sawtooth', 0.12, 220, i * 0.45);
  }
  select(): void { this.tone(660, 0.08, 'square', 0.08, 990); }
  levelUp(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.18, undefined, i * 0.07));
  }
  zap(): void {
    this.noise(0.12, 0.12, 6000);
    this.tone(1800, 0.1, 'sawtooth', 0.05, 400);
  }
  missile(): void { this.tone(260, 0.12, 'triangle', 0.05, 520); }
  /** 捡经验晶体：又轻又短，连着捡也不会吵 */
  pickup(): void { this.tone(1500, 0.05, 'triangle', 0.05, 2200); }
  /** 擦弹：又高又细的一下，贴着弹幕飞时一秒响十几次也不烦 */
  graze(): void { this.tone(2400, 0.03, 'sine', 0.035, 3400); }
  dash(): void {
    this.noise(0.22, 0.14, 3200);
    this.tone(880, 0.18, 'sawtooth', 0.06, 180);
  }

  startMusic(): void {
    if (!this.ctx || this.musicTimer !== undefined || !this.musicOn) return;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 50);
  }

  stopMusic(): void {
    if (this.musicTimer !== undefined) window.clearInterval(this.musicTimer);
    this.musicTimer = undefined;
  }

  toggleMusic(): boolean {
    this.musicOn = !this.musicOn;
    if (this.musicOn) this.startMusic();
    else this.stopMusic();
    return this.musicOn;
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    while (this.nextStepTime < ctx.currentTime + 0.2) {
      const delay = this.nextStepTime - ctx.currentTime;
      const s = this.step % 16;
      this.tone(BASS[s], STEP_SEC * 0.9, 'sawtooth', 0.12, undefined, delay, this.musicGain);
      if (s % 2 === 0) this.tone(ARP[(this.step / 2) % ARP.length], STEP_SEC * 0.6, 'square', 0.03, undefined, delay, this.musicGain);
      if (s % 4 === 0) this.tone(150, 0.12, 'sine', 0.35, 40, delay, this.musicGain);
      this.nextStepTime += STEP_SEC;
      this.step++;
    }
  }
}

export const audio = new AudioEngine();
