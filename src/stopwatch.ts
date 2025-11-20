export class Stopwatch {
  private startTime: number = 0;
  private intervalId: number | null = null;

  start(onTick: (time: string) => void) {
    this.startTime = Date.now();
    this.intervalId = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - this.startTime) / 1000);
      const mins = Math.floor(seconds / 60)
        .toString()
        .padStart(2, '0');
      const secs = (seconds % 60).toString().padStart(2, '0');
      onTick(`${mins}:${secs}`);
    }, 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
