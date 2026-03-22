import { Logger } from "./logger.js";

export interface PerformanceMetrics {
  operation: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private readonly logger: Logger;
  private readonly enabled: boolean;
  private metrics: PerformanceMetrics[] = [];
  private readonly maxMetrics: number;

  private constructor(enabled: boolean = true, maxMetrics: number = 1000) {
    this.logger = Logger.getInstance();
    this.enabled = enabled;
    this.maxMetrics = maxMetrics;
  }

  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  public static initialize(enabled: boolean = true, maxMetrics: number = 1000): void {
    PerformanceMonitor.instance = new PerformanceMonitor(enabled, maxMetrics);
  }

  public startOperation(operation: string, metadata?: Record<string, unknown>): string {
    if (!this.enabled) {
      return "";
    }

    const operationId = `${operation}___${Date.now()}___${Math.random().toString(36).substr(2, 9)}`;
    const metric: PerformanceMetrics = {
      operation,
      startTime: Date.now(),
      endTime: 0,
      durationMs: 0,
      success: false,
      metadata
    };
    this.metrics.push(metric);

    this.logger.debug("performance", `Started operation: ${operation}`, { operationId });
    return operationId;
  }

  public endOperation(operationId: string, success: boolean = true): void {
     if (!this.enabled || !operationId) {
       return;
     }
 
     const parts = operationId.split('___');
     if (parts.length < 3) {
       this.logger.warn("performance", `Invalid operationId format: ${operationId}`);
       return;
     }
 
     const op = parts[0];
     const startTimeStr = parts[1];
     if (op === undefined || startTimeStr === undefined) {
       this.logger.warn("performance", `Invalid operationId format: ${operationId}`);
       return;
     }
     const startTime = parseInt(startTimeStr, 10);
     if (isNaN(startTime)) {
       this.logger.warn("performance", `Invalid startTime in operationId: ${operationId}`);
       return;
     }
 
     const index = this.metrics.findIndex(m => 
       m && m.operation === op && m.startTime === startTime
     );
 
     if (index === -1) {
       // Fallback: try to find by operation name prefix (less precise but better than nothing)
       const matchingMetrics = this.metrics
         .filter(m => m && m.operation === op && m.endTime === 0)
         .sort((a, b) => b && a ? (b.startTime - a.startTime) : 0); // Most recent first
 
       if (matchingMetrics.length > 0) {
         const metric = matchingMetrics[0];
         if (metric) {
           metric.endTime = Date.now();
           metric.durationMs = metric.endTime - metric.startTime;
           metric.success = success;
 
           this.logger.debug("performance", `Ended operation: ${metric.operation}`, {
             durationMs: metric.durationMs,
             success
           });
 
           this.enforceMaxMetrics();
           return;
         }
       }
       
       this.logger.warn("performance", `Could not find operation to end: ${operationId}`);
       return;
     }
 
     const metric = this.metrics[index];
     if (metric) {
       metric.endTime = Date.now();
       metric.durationMs = metric.endTime - metric.startTime;
       metric.success = success;
 
       this.logger.debug("performance", `Ended operation: ${metric.operation}`, {
         durationMs: metric.durationMs,
         success
       });
     }
 
     this.enforceMaxMetrics();
   }

  private enforceMaxMetrics(): void {
    if (this.metrics.length > this.maxMetrics) {
      // Remove oldest metrics
      const excess = this.metrics.length - this.maxMetrics;
      this.metrics.splice(0, excess);
    }
  }

  public getMetrics(): PerformanceMetrics[] {
    return [...this.metrics]; // Return a copy
  }

  public getMetricsByOperation(operation: string): PerformanceMetrics[] {
    return this.metrics
      .filter(m => m && m.operation === operation)
      .sort((a, b) => b && a ? (b.startTime - a.startTime) : 0); // Most recent first
  }

  public getAverageDuration(operation: string): number {
    const operationMetrics = this.getMetricsByOperation(operation);
    if (!operationMetrics || operationMetrics.length === 0) {
      return 0;
    }

    const total = operationMetrics.reduce((sum, m) => sum + (m?.durationMs || 0), 0);
    return Math.round(total / operationMetrics.length);
  }

  public getSuccessRate(operation: string): number {
    const operationMetrics = this.getMetricsByOperation(operation);
    if (!operationMetrics || operationMetrics.length === 0) {
      return 0;
    }

    const successful = operationMetrics.filter(m => m && m.success).length;
    return Math.round((successful / operationMetrics.length) * 100);
  }

  public clearMetrics(): void {
    this.metrics = [];
    this.logger.info("performance", "All performance metrics cleared");
  }

  public getSummary(): Record<string, unknown> {
    const operations = [...new Set(this.metrics
      .filter(m => m !== null && m !== undefined)
      .map(m => m?.operation)
      .filter((op): op is string => op !== null && op !== undefined))];
    const summary: Record<string, unknown> = {};

    for (const operation of operations) {
      const metrics = this.getMetricsByOperation(operation);
      summary[operation] = {
        count: metrics.length,
        avgDurationMs: this.getAverageDuration(operation),
        successRate: this.getSuccessRate(operation),
        latest: metrics.length > 0 ? metrics[0] : null
      };
    }

    return summary;
  }
}

// Helper function to automatically measure operation performance
export function measurePerformance<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const monitor = PerformanceMonitor.getInstance();
  const operationId = monitor.startOperation(operation, metadata);
  
  return fn().then(
    result => {
      monitor.endOperation(operationId, true);
      return result;
    },
    error => {
      monitor.endOperation(operationId, false);
      throw error;
    }
  );
}