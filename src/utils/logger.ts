import { LogLevel } from "./types.js";

export class Logger {
  private static instance: Logger;
  private readonly minLevel: LogLevel;
  private readonly enableTimestamps: boolean;

  private constructor(minLevel: LogLevel = LogLevel.INFO, enableTimestamps: boolean = true) {
    this.minLevel = minLevel;
    this.enableTimestamps = enableTimestamps;
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public static initialize(minLevel: LogLevel = LogLevel.INFO, enableTimestamps: boolean = true): void {
    Logger.instance = new Logger(minLevel, enableTimestamps);
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private log(level: LogLevel, component: string, message: string, meta?: Record<string, unknown>): void {
    if (level < this.minLevel) {
      return;
    }

    const timestamp = this.enableTimestamps ? `[${this.formatTimestamp()}] ` : "";
    const levelStr = `[${LogLevel[level]}]`;
    const componentStr = `[${component}]`;
    
    let logMessage = `${timestamp}${levelStr} ${componentStr} ${message}`;
    
    if (meta && Object.keys(meta).length > 0) {
      logMessage += ` ${JSON.stringify(meta)}`;
    }

    // Depending on the level, output to appropriate stream
    if (level >= LogLevel.ERROR) {
      console.error(logMessage);
    } else if (level >= LogLevel.WARN) {
      console.warn(logMessage);
    } else {
      console.log(logMessage);
    }
  }

  public debug(component: string, message: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, component, message, meta);
  }

  public info(component: string, message: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, component, message, meta);
  }

  public warn(component: string, message: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, component, message, meta);
  }

  public error(component: string, message: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, component, message, meta);
  }

  public fatal(component: string, message: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.FATAL, component, message, meta);
  }
}

// Helper function to safely execute async operations with logging
export async function safeExecute<T>(
  component: string,
  operation: string,
  fn: () => Promise<T>,
  fallbackValue?: T
): Promise<T> {
  const logger = Logger.getInstance();
  
  try {
    logger.debug(component, `Starting operation: ${operation}`);
    const startTime = Date.now();
    const result = await fn();
    const duration = Date.now() - startTime;
    
    logger.debug(component, `Completed operation: ${operation}`, {
      durationMs: duration,
      success: true
    });
    
    return result;
  } catch (error) {
    logger.error(component, `Failed operation: ${operation}`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    if (fallbackValue !== undefined) {
      logger.warn(component, `Returning fallback value for failed operation: ${operation}`);
      return fallbackValue;
    }
    
    throw error;
  }
}