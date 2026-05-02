/** Clock that guarantees monotonically increasing timestamps. */
export class MonotonicClock {
  private lastTimestamp = 0;

  now(): Date {
    const ts = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    return new Date(ts);
  }
}
