import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';

/**
 * Pipe to sanitize string inputs by trimming whitespace and removing potentially dangerous characters
 * This is a basic sanitization - for production, consider using a library like DOMPurify for HTML content
 */
@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata): any {
    if (!value || typeof value !== 'object') {
      return this.sanitizeValue(value);
    }

    // Recursively sanitize object properties
    const sanitized: Record<string, any> = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        sanitized[key] = this.sanitizeValue(value[key]);
      }
    }
    return sanitized;
  }

  private sanitizeValue(value: any): any {
    if (typeof value === 'string') {
      // Trim whitespace
      let sanitized = value.trim();
      
      // Remove null bytes and other control characters (except newlines and tabs for text content)
      sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
      
      return sanitized;
    }
    
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }
    
    if (value && typeof value === 'object') {
      const sanitized: Record<string, any> = {};
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          sanitized[key] = this.sanitizeValue(value[key]);
        }
      }
      return sanitized;
    }
    
    return value;
  }
}

