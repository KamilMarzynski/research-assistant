/**
 * Clock that guarantees monotonically increasing timestamps.
 * Note: NTP corrections can shift system time backward; this clock
 * only ensures its own sequence never decreases, not wall-clock accuracy.
 */
export class MonotonicClock {
  private lastTimestamp = 0;

  now(): Date {
    const ts = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    return new Date(ts);
  }
}
