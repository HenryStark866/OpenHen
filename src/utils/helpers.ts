/**
 * Utility helper functions for the OpenHen bot
 */

export class StringHelpers {
  /**
   * Truncates a string to the specified length and adds ellipsis if needed
   */
  public static truncate(str: string, maxLength: number): string {
    if (!str || str.length <= maxLength) {
      return str;
    }
    return str.slice(0, maxLength - 3) + "...";
  }

  /**
   * Capitalizes the first letter of a string
   */
  public static capitalize(str: string): string {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Checks if a string is empty or contains only whitespace
   */
  public static isEmptyOrWhitespace(str: string): boolean {
    return !str || str.trim().length === 0;
  }

  /**
   * Extracts URLs from a string
   */
  public static extractUrls(str: string): string[] {
    const urlPattern = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g;
    return str.match(urlPattern) || [];
  }

  /**
   * Formats a number with commas as thousands separators
   */
  public static formatNumber(num: number): string {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
}

export class ObjectHelpers {
  /**
   * Deep clones an object
   */
  public static deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T;
  }

  /**
   * Merges two objects deeply
   */
  public static deepMerge(target: any, source: any): any {
    const output = ObjectHelpers.deepClone(target);
    
    if (ObjectHelpers.isObject(target) && ObjectHelpers.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (ObjectHelpers.isObject(source[key])) {
          if (!(key in output) || !ObjectHelpers.isObject(output[key])) {
            output[key] = {};
          }
          output[key] = ObjectHelpers.deepMerge(output[key], source[key]);
        } else {
          output[key] = source[key];
        }
      });
    }
    
    return output;
  }

  /**
   * Gets a nested property value safely
   */
  public static get(obj: any, path: string, defaultValue?: any): any {
    if (!obj || typeof obj !== 'object') {
      return defaultValue;
    }
    
    const pathParts = path.split('.');
    let current: any = obj;
    
    for (const part of pathParts) {
      if (current === null || current === undefined) {
        return defaultValue;
      }
      current = current[part];
    }
    
    return current === undefined ? defaultValue : current;
  }

  /**
   * Type guard to check if a value is an object
   */
  public static isObject(item: any): boolean {
    return item !== null && typeof item === 'object' && !Array.isArray(item);
  }
}

export class AsyncHelpers {
  /**
   * Waits for a specified number of milliseconds
   */
  public static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Runs a function with retries
   */
  public static retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    delayMs: number = 1000,
    shouldRetry: (error: unknown) => boolean = () => true
  ): Promise<T> {
    return fn().catch(error => {
      if (maxAttempts <= 1 || !shouldRetry(error)) {
        throw error;
      }
      return AsyncHelpers.delay(delayMs).then(() => 
        AsyncHelpers.retry(fn, maxAttempts - 1, delayMs, shouldRetry)
      );
    });
  }

  /**
   * Executes multiple promises concurrently with a limit
   */
  public static batch<T>(
    items: T[],
    processor: (item: T) => Promise<any>,
    batchSize: number = 5
  ): Promise<any[]> {
    const results: any[] = [];
    
    const processBatch = async (start: number) => {
      const end = Math.min(start + batchSize, items.length);
      const batchPromises = items.slice(start, end).map(processor);
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      if (end < items.length) {
        return processBatch(end);
      }
      return results;
    };
    
    return processBatch(0);
  }
}

/**
 * Type guard to check if a value is an object
 */
function isObject(item: any): boolean {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}