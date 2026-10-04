import { formatDuration } from './format';

export class Stopwatch {
  private startTime: number = 0;
  private intervalId: number | null = null;
  private pausedAt: number = 0;
  private pausedTotal: number = 0;
  private paused = false;

  start(onTick: (time: string) => void) {
    this.startTime = Date.now();
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.paused = false;
    this.intervalId = window.setInterval(() => {
      if (this.paused) return;
      onTick(formatDuration(this.elapsed()));
    }, 1000);
  }

  /**
   * Freeze the clock. Paused time is excluded from the reading, so a recording
   * that is paused mid-way reports only the time actually captured.
   */
  pause() {
    if (this.paused || !this.intervalId) return;
    this.paused = true;
    this.pausedAt = Date.now();
  }

  resume() {
    if (!this.paused) return;
    this.pausedTotal += Date.now() - this.pausedAt;
    this.pausedAt = 0;
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Milliseconds actually captured so far, excluding any paused time. */
  elapsed(): number {
    if (!this.startTime) return 0;
    const end = this.paused ? this.pausedAt : Date.now();
    return end - this.startTime - this.pausedTotal;
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.paused = false;
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.startTime = 0;
  }
}
