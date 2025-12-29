/**
 * Memory Monitor
 *
 * Proactive memory monitoring with warnings and automatic actions
 */

/**
 * Memory usage snapshot
 */
export interface MemorySnapshot {
  timestamp: Date;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  arrayBuffers: number;
}

/**
 * Memory monitor configuration
 */
export interface MemoryMonitorConfig {
  /** Warning threshold as percentage of heap limit (default: 80%) */
  warningThresholdPercent: number;
  /** Critical threshold as percentage of heap limit (default: 90%) */
  criticalThresholdPercent: number;
  /** Check interval in milliseconds (default: 5000) */
  checkIntervalMs: number;
  /** Enable automatic garbage collection hints (default: true) */
  enableGcHints: boolean;
  /** Enable automatic streaming mode when memory is high (default: true) */
  enableAutoStreaming: boolean;
  /** Callback for memory warnings */
  onWarning?: (snapshot: MemorySnapshot, level: 'warning' | 'critical') => void;
}

/**
 * Default memory monitor configuration
 */
const DEFAULT_CONFIG: MemoryMonitorConfig = {
  warningThresholdPercent: 80,
  criticalThresholdPercent: 90,
  checkIntervalMs: 5000,
  enableGcHints: true,
  enableAutoStreaming: true,
};

/**
 * Memory monitor for migration process
 */
export class MemoryMonitor {
  private config: MemoryMonitorConfig;
  private interval: NodeJS.Timeout | null = null;
  private snapshots: MemorySnapshot[] = [];
  private maxSnapshots = 100;
  private heapLimit: number;
  private warningEmitted = false;
  private criticalEmitted = false;

  constructor(config: Partial<MemoryMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Get heap limit (V8)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const v8 = require('v8');
    const heapStats = v8.getHeapStatistics();
    this.heapLimit = heapStats.heap_size_limit;
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.interval) return;

    this.interval = setInterval(() => {
      this.checkMemory();
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Get current memory snapshot
   */
  getCurrentSnapshot(): MemorySnapshot {
    const usage = process.memoryUsage();
    return {
      timestamp: new Date(),
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss,
      arrayBuffers: usage.arrayBuffers,
    };
  }

  /**
   * Check memory and emit warnings if needed
   */
  private checkMemory(): void {
    const snapshot = this.getCurrentSnapshot();
    this.snapshots.push(snapshot);

    // Trim old snapshots
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    const heapUsedPercent = (snapshot.heapUsed / this.heapLimit) * 100;

    // Check critical threshold
    if (heapUsedPercent >= this.config.criticalThresholdPercent) {
      if (!this.criticalEmitted) {
        console.error(
          `CRITICAL: Memory usage at ${heapUsedPercent.toFixed(1)}% (${this.formatBytes(snapshot.heapUsed)} / ${this.formatBytes(this.heapLimit)})`
        );

        if (this.config.onWarning) {
          this.config.onWarning(snapshot, 'critical');
        }

        // Force GC if available
        if (this.config.enableGcHints && global.gc) {
          console.log('Triggering garbage collection...');
          global.gc();
        }

        this.criticalEmitted = true;
      }
    } else if (heapUsedPercent >= this.config.warningThresholdPercent) {
      if (!this.warningEmitted) {
        console.warn(
          `WARNING: Memory usage at ${heapUsedPercent.toFixed(1)}% (${this.formatBytes(snapshot.heapUsed)} / ${this.formatBytes(this.heapLimit)})`
        );

        if (this.config.onWarning) {
          this.config.onWarning(snapshot, 'warning');
        }

        // Hint GC if available
        if (this.config.enableGcHints && global.gc) {
          global.gc();
        }

        this.warningEmitted = true;
      }
    } else {
      // Reset flags when memory drops
      this.warningEmitted = false;
      this.criticalEmitted = false;
    }
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    current: MemorySnapshot;
    peak: MemorySnapshot;
    average: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
    heapLimit: number;
    currentPercent: number;
  } {
    const current = this.getCurrentSnapshot();

    let peak = this.snapshots[0] || current;
    let totalHeapUsed = 0;
    let totalHeapTotal = 0;
    let totalRss = 0;

    for (const snapshot of this.snapshots) {
      if (snapshot.heapUsed > peak.heapUsed) {
        peak = snapshot;
      }
      totalHeapUsed += snapshot.heapUsed;
      totalHeapTotal += snapshot.heapTotal;
      totalRss += snapshot.rss;
    }

    const count = this.snapshots.length || 1;

    return {
      current,
      peak,
      average: {
        heapUsed: totalHeapUsed / count,
        heapTotal: totalHeapTotal / count,
        rss: totalRss / count,
      },
      heapLimit: this.heapLimit,
      currentPercent: (current.heapUsed / this.heapLimit) * 100,
    };
  }

  /**
   * Check if memory is high
   */
  isMemoryHigh(): boolean {
    const snapshot = this.getCurrentSnapshot();
    const percent = (snapshot.heapUsed / this.heapLimit) * 100;
    return percent >= this.config.warningThresholdPercent;
  }

  /**
   * Check if memory is critical
   */
  isMemoryCritical(): boolean {
    const snapshot = this.getCurrentSnapshot();
    const percent = (snapshot.heapUsed / this.heapLimit) * 100;
    return percent >= this.config.criticalThresholdPercent;
  }

  /**
   * Format bytes for display
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  /**
   * Get memory growth rate (MB per second)
   */
  getMemoryGrowthRate(): number {
    if (this.snapshots.length < 2) return 0;

    const recent = this.snapshots.slice(-10); // Last 10 snapshots
    const first = recent[0];
    const last = recent[recent.length - 1];

    const timeDiff =
      (last.timestamp.getTime() - first.timestamp.getTime()) / 1000; // seconds
    const memoryDiff = (last.heapUsed - first.heapUsed) / 1024 / 1024; // MB

    return timeDiff > 0 ? memoryDiff / timeDiff : 0;
  }

  /**
   * Predict when memory will hit critical threshold
   */
  predictMemoryExhaustion(): Date | null {
    const growthRate = this.getMemoryGrowthRate();

    if (growthRate <= 0) return null; // Memory is stable or decreasing

    const current = this.getCurrentSnapshot();
    const remainingMb = (this.heapLimit - current.heapUsed) / 1024 / 1024;
    const secondsUntilFull = remainingMb / growthRate;

    if (secondsUntilFull < 0 || !isFinite(secondsUntilFull)) return null;

    return new Date(Date.now() + secondsUntilFull * 1000);
  }
}
