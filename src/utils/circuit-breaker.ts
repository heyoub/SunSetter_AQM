/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by detecting when a service is failing
 * and temporarily blocking requests to it. Provides:
 * - Three states: CLOSED (normal), OPEN (blocking), HALF_OPEN (testing)
 * - Configurable failure thresholds and timeouts
 * - Automatic recovery testing
 * - Event hooks for monitoring
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Circuit breaker states
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold: number;
  /** Time in ms before attempting to close the circuit (default: 30000) */
  resetTimeout: number;
  /** Number of successful calls needed to close circuit from half-open (default: 3) */
  successThreshold: number;
  /** Time window in ms for counting failures (default: 60000) */
  failureWindow: number;
  /** Optional name for logging */
  name?: string;
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 3,
  failureWindow: 60000,
  name: 'default',
};

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  totalCalls: number;
  rejectedCalls: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  openedAt: Date | null;
}

/**
 * Circuit breaker event types
 */
export type CircuitBreakerEvent =
  | 'stateChange'
  | 'failure'
  | 'success'
  | 'rejected'
  | 'halfOpenTest';

/**
 * Circuit breaker event handler
 */
export type CircuitBreakerEventHandler = (
  event: CircuitBreakerEvent,
  data: {
    state: CircuitState;
    previousState?: CircuitState;
    error?: Error;
    stats: CircuitBreakerStats;
  }
) => void;

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  public readonly circuitName: string;
  public readonly openedAt: Date;
  public readonly resetAt: Date;

  constructor(name: string, openedAt: Date, resetTimeout: number) {
    super(
      `Circuit breaker "${name}" is open. Retry after ${Math.ceil(resetTimeout / 1000)}s`
    );
    this.name = 'CircuitOpenError';
    this.circuitName = name;
    this.openedAt = openedAt;
    this.resetAt = new Date(openedAt.getTime() + resetTimeout);
  }
}

// ============================================================================
// Circuit Breaker Class
// ============================================================================

/**
 * Circuit Breaker implementation for resilient API calls
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({ name: 'convex-api' });
 *
 * // Wrap API calls
 * try {
 *   const result = await breaker.execute(() => convexClient.insert(table, doc));
 * } catch (error) {
 *   if (error instanceof CircuitOpenError) {
 *     // Circuit is open, handle gracefully
 *   }
 * }
 * ```
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private totalCalls = 0;
  private rejectedCalls = 0;
  private failureTimestamps: number[] = [];
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private openedAt: Date | null = null;
  private resetTimer: NodeJS.Timeout | null = null;
  private eventHandlers: CircuitBreakerEventHandler[] = [];

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  // ==================== PUBLIC API ====================

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    // Check if circuit is open
    if (this.state === 'OPEN') {
      this.rejectedCalls++;
      this.emit('rejected', {
        error: new CircuitOpenError(
          this.config.name || 'default',
          this.openedAt!,
          this.config.resetTimeout
        ),
      });
      throw new CircuitOpenError(
        this.config.name || 'default',
        this.openedAt!,
        this.config.resetTimeout
      );
    }

    // In half-open state, only allow limited calls
    if (this.state === 'HALF_OPEN') {
      this.emit('halfOpenTest', {});
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  /**
   * Register an event handler
   */
  onEvent(handler: CircuitBreakerEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failureCount,
      successes: this.successCount,
      totalCalls: this.totalCalls,
      rejectedCalls: this.rejectedCalls,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      openedAt: this.openedAt,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.clearResetTimer();
    this.failureCount = 0;
    this.successCount = 0;
    this.failureTimestamps = [];
    this.openedAt = null;
    this.transitionTo('CLOSED');
  }

  /**
   * Force the circuit open (for testing or manual intervention)
   */
  forceOpen(): void {
    this.clearResetTimer();
    this.openedAt = new Date();
    this.transitionTo('OPEN');
    this.scheduleReset();
  }

  /**
   * Check if circuit is allowing requests
   */
  isAvailable(): boolean {
    return this.state !== 'OPEN';
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.clearResetTimer();
    this.eventHandlers = [];
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Handle successful call
   */
  private onSuccess(): void {
    this.lastSuccessTime = new Date();
    this.successCount++;

    if (this.state === 'HALF_OPEN') {
      // In half-open state, need consecutive successes to close
      if (this.successCount >= this.config.successThreshold) {
        this.reset();
        this.emit('success', {});
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success (sliding window behavior)
      this.pruneOldFailures();
      this.emit('success', {});
    }
  }

  /**
   * Handle failed call
   */
  private onFailure(error: Error): void {
    this.lastFailureTime = new Date();
    this.failureCount++;
    this.failureTimestamps.push(Date.now());

    this.emit('failure', { error });

    // Prune old failures outside the window
    this.pruneOldFailures();

    if (this.state === 'HALF_OPEN') {
      // Any failure in half-open state reopens the circuit
      this.openCircuit();
    } else if (this.state === 'CLOSED') {
      // Check if we've exceeded the threshold
      if (this.failureTimestamps.length >= this.config.failureThreshold) {
        this.openCircuit();
      }
    }
  }

  /**
   * Open the circuit
   */
  private openCircuit(): void {
    this.clearResetTimer();
    this.openedAt = new Date();
    this.transitionTo('OPEN');
    this.scheduleReset();
  }

  /**
   * Schedule transition to half-open state
   */
  private scheduleReset(): void {
    this.resetTimer = setTimeout(() => {
      this.transitionTo('HALF_OPEN');
      this.successCount = 0; // Reset success counter for half-open test
    }, this.config.resetTimeout);
  }

  /**
   * Clear the reset timer
   */
  private clearResetTimer(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }

  /**
   * Prune failures outside the time window
   */
  private pruneOldFailures(): void {
    const cutoff = Date.now() - this.config.failureWindow;
    this.failureTimestamps = this.failureTimestamps.filter((ts) => ts > cutoff);
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      const previousState = this.state;
      this.state = newState;
      this.emit('stateChange', { previousState });
    }
  }

  /**
   * Emit an event to all handlers
   */
  private emit(
    event: CircuitBreakerEvent,
    data: Partial<Parameters<CircuitBreakerEventHandler>[1]>
  ): void {
    const fullData = {
      state: this.state,
      stats: this.getStats(),
      ...data,
    };

    for (const handler of this.eventHandlers) {
      try {
        handler(event, fullData as Parameters<CircuitBreakerEventHandler>[1]);
      } catch {
        // Don't let handler errors affect the circuit breaker
      }
    }
  }
}

// ============================================================================
// Circuit Breaker Registry
// ============================================================================

/**
 * Registry for managing multiple circuit breakers
 */
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private defaultConfig: Partial<CircuitBreakerConfig>;

  constructor(defaultConfig: Partial<CircuitBreakerConfig> = {}) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * Get or create a circuit breaker by name
   */
  get(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(
        name,
        new CircuitBreaker({
          ...this.defaultConfig,
          ...config,
          name,
        })
      );
    }
    return this.breakers.get(name)!;
  }

  /**
   * Get all circuit breakers
   */
  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  /**
   * Get statistics for all breakers
   */
  getAllStats(): Map<string, CircuitBreakerStats> {
    const stats = new Map<string, CircuitBreakerStats>();
    for (const [name, breaker] of this.breakers) {
      stats.set(name, breaker.getStats());
    }
    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Destroy all circuit breakers
   */
  destroyAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.destroy();
    }
    this.breakers.clear();
  }

  /**
   * Check if any circuit is open
   */
  hasOpenCircuit(): boolean {
    for (const breaker of this.breakers.values()) {
      if (breaker.getState() === 'OPEN') {
        return true;
      }
    }
    return false;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a circuit breaker for Convex API calls
 */
export function createConvexCircuitBreaker(
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  return new CircuitBreaker({
    name: 'convex-api',
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 2,
    failureWindow: 60000,
    ...config,
  });
}

/**
 * Create a circuit breaker for database connections
 */
export function createDatabaseCircuitBreaker(
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  return new CircuitBreaker({
    name: 'database',
    failureThreshold: 3,
    resetTimeout: 10000,
    successThreshold: 1,
    failureWindow: 30000,
    ...config,
  });
}

/**
 * Global circuit breaker registry
 */
export const circuitBreakers = new CircuitBreakerRegistry({
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
  failureWindow: 60000,
});
