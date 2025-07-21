import { ValidationError } from '../errors';

/**
 * Validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedValue?: any;
}

/**
 * Validation options
 */
export interface ValidationOptions {
  required?: boolean;
  allowEmpty?: boolean;
  trim?: boolean;
  throwOnError?: boolean;
}

/**
 * String validation options
 */
export interface StringValidationOptions extends ValidationOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  sanitize?: boolean;
}

/**
 * Number validation options
 */
export interface NumberValidationOptions extends ValidationOptions {
  min?: number;
  max?: number;
  integer?: boolean;
}

/**
 * Common Validators
 * Provides input validation and sanitization functions
 */
export class Validators {
  /**
   * Validate a string input
   */
  static validateString(
    value: unknown,
    field: string,
    options: StringValidationOptions = {}
  ): ValidationResult {
    const errors: string[] = [];
    let sanitizedValue = value;

    // Check if value exists
    if (value === null || value === undefined) {
      if (options.required) {
        errors.push(`${field} is required`);
      }
      return { isValid: errors.length === 0, errors, sanitizedValue: '' };
    }

    // Convert to string
    if (typeof value !== 'string') {
      sanitizedValue = String(value);
    } else {
      sanitizedValue = value;
    }

    // Trim whitespace
    if (options.trim !== false) {
      sanitizedValue = (sanitizedValue as string).trim();
    }

    // Check empty string
    if ((sanitizedValue as string).length === 0) {
      if (options.required && !options.allowEmpty) {
        errors.push(`${field} cannot be empty`);
      }
      return { isValid: errors.length === 0, errors, sanitizedValue };
    }

    // Sanitize dangerous characters
    if (options.sanitize !== false) {
      sanitizedValue = this.sanitizeString(sanitizedValue as string);
    }

    // Length validation
    const strValue = sanitizedValue as string;
    if (options.minLength !== undefined && strValue.length < options.minLength) {
      errors.push(`${field} must be at least ${options.minLength} characters long`);
    }
    if (options.maxLength !== undefined && strValue.length > options.maxLength) {
      errors.push(`${field} must be no more than ${options.maxLength} characters long`);
    }

    // Pattern validation
    if (options.pattern && !options.pattern.test(strValue)) {
      errors.push(`${field} format is invalid`);
    }

    const result = { isValid: errors.length === 0, errors, sanitizedValue };

    if (options.throwOnError && !result.isValid) {
      throw new ValidationError(`Validation failed for ${field}`, field, { errors });
    }

    return result;
  }

  /**
   * Validate a number input
   */
  static validateNumber(
    value: unknown,
    field: string,
    options: NumberValidationOptions = {}
  ): ValidationResult {
    const errors: string[] = [];
    let sanitizedValue = value;

    // Check if value exists
    if (value === null || value === undefined) {
      if (options.required) {
        errors.push(`${field} is required`);
      }
      return { isValid: errors.length === 0, errors, sanitizedValue: 0 };
    }

    // Convert to number
    if (typeof value === 'string') {
      sanitizedValue = parseFloat(value.trim());
    } else if (typeof value !== 'number') {
      sanitizedValue = Number(value);
    }

    // Check if valid number
    if (isNaN(sanitizedValue as number)) {
      errors.push(`${field} must be a valid number`);
      return { isValid: false, errors, sanitizedValue };
    }

    const numValue = sanitizedValue as number;

    // Integer validation
    if (options.integer && !Number.isInteger(numValue)) {
      errors.push(`${field} must be an integer`);
    }

    // Range validation
    if (options.min !== undefined && numValue < options.min) {
      errors.push(`${field} must be at least ${options.min}`);
    }
    if (options.max !== undefined && numValue > options.max) {
      errors.push(`${field} must be no more than ${options.max}`);
    }

    const result = { isValid: errors.length === 0, errors, sanitizedValue };

    if (options.throwOnError && !result.isValid) {
      throw new ValidationError(`Validation failed for ${field}`, field, { errors });
    }

    return result;
  }

  /**
   * Validate a boolean input
   */
  static validateBoolean(
    value: unknown,
    field: string,
    options: ValidationOptions = {}
  ): ValidationResult {
    const errors: string[] = [];
    let sanitizedValue = value;

    // Check if value exists
    if (value === null || value === undefined) {
      if (options.required) {
        errors.push(`${field} is required`);
      }
      return { isValid: errors.length === 0, errors, sanitizedValue: false };
    }

    // Convert to boolean
    if (typeof value === 'string') {
      const str = value.toLowerCase().trim();
      if (['true', '1', 'yes', 'on'].includes(str)) {
        sanitizedValue = true;
      } else if (['false', '0', 'no', 'off'].includes(str)) {
        sanitizedValue = false;
      } else {
        errors.push(`${field} must be a valid boolean value`);
      }
    } else if (typeof value === 'number') {
      sanitizedValue = value !== 0;
    } else if (typeof value !== 'boolean') {
      sanitizedValue = Boolean(value);
    }

    const result = { isValid: errors.length === 0, errors, sanitizedValue };

    if (options.throwOnError && !result.isValid) {
      throw new ValidationError(`Validation failed for ${field}`, field, { errors });
    }

    return result;
  }

  /**
   * Validate an email address
   */
  static validateEmail(
    value: unknown,
    field: string = 'email',
    options: StringValidationOptions = {}
  ): ValidationResult {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return this.validateString(value, field, {
      ...options,
      pattern: emailPattern,
      maxLength: options.maxLength || 254
    });
  }

  /**
   * Validate a Discord ID (snowflake)
   */
  static validateDiscordId(
    value: unknown,
    field: string,
    options: StringValidationOptions = {}
  ): ValidationResult {
    const snowflakePattern = /^\d{17,19}$/;
    return this.validateString(value, field, {
      ...options,
      pattern: snowflakePattern,
      sanitize: false
    });
  }

  /**
   * Validate a URL
   */
  static validateUrl(
    value: unknown,
    field: string = 'url',
    options: StringValidationOptions = {}
  ): ValidationResult {
    const result = this.validateString(value, field, options);
    
    if (result.isValid && result.sanitizedValue) {
      try {
        new URL(result.sanitizedValue as string);
      } catch {
        result.isValid = false;
        result.errors.push(`${field} must be a valid URL`);
      }
    }

    if (options.throwOnError && !result.isValid) {
      throw new ValidationError(`Validation failed for ${field}`, field, { errors: result.errors });
    }

    return result;
  }

  /**
   * Validate an array
   */
  static validateArray<T>(
    value: unknown,
    field: string,
    validator: (item: unknown, index: number) => ValidationResult,
    options: ValidationOptions & { minLength?: number; maxLength?: number } = {}
  ): ValidationResult {
    const errors: string[] = [];
    let sanitizedValue = value;

    // Check if value exists
    if (value === null || value === undefined) {
      if (options.required) {
        errors.push(`${field} is required`);
      }
      return { isValid: errors.length === 0, errors, sanitizedValue: [] };
    }

    // Check if it's an array
    if (!Array.isArray(value)) {
      errors.push(`${field} must be an array`);
      return { isValid: false, errors, sanitizedValue };
    }

    // Length validation
    if (options.minLength !== undefined && value.length < options.minLength) {
      errors.push(`${field} must have at least ${options.minLength} items`);
    }
    if (options.maxLength !== undefined && value.length > options.maxLength) {
      errors.push(`${field} must have no more than ${options.maxLength} items`);
    }

    // Validate each item
    const sanitizedArray: T[] = [];
    value.forEach((item, index) => {
      try {
        const itemResult = validator(item, index);
        if (!itemResult.isValid) {
          errors.push(`${field}[${index}]: ${itemResult.errors.join(', ')}`);
        } else {
          sanitizedArray.push(itemResult.sanitizedValue);
        }
      } catch (error) {
        errors.push(`${field}[${index}]: ${error instanceof Error ? error.message : 'Validation error'}`);
      }
    });

    sanitizedValue = sanitizedArray;

    const result = { isValid: errors.length === 0, errors, sanitizedValue };

    if (options.throwOnError && !result.isValid) {
      throw new ValidationError(`Validation failed for ${field}`, field, { errors });
    }

    return result;
  }

  /**
   * Validate an object against a schema
   */
  static validateObject<T extends Record<string, any>>(
    value: unknown,
    field: string,
    schema: Record<string, (val: unknown, fieldName: string) => ValidationResult>,
    options: ValidationOptions = {}
  ): ValidationResult {
    const errors: string[] = [];
    let sanitizedValue = value;

    // Check if value exists
    if (value === null || value === undefined) {
      if (options.required) {
        errors.push(`${field} is required`);
      }
      return { isValid: errors.length === 0, errors, sanitizedValue: {} };
    }

    // Check if it's an object
    if (typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${field} must be an object`);
      return { isValid: false, errors, sanitizedValue };
    }

    // Validate each property
    const sanitizedObject: any = {};
    const obj = value as Record<string, any>;

    for (const [key, validator] of Object.entries(schema)) {
      try {
        const fieldResult = validator(obj[key], `${field}.${key}`);
        if (!fieldResult.isValid) {
          errors.push(...fieldResult.errors);
        } else {
          sanitizedObject[key] = fieldResult.sanitizedValue;
        }
      } catch (error) {
        errors.push(`${field}.${key}: ${error instanceof Error ? error.message : 'Validation error'}`);
      }
    }

    sanitizedValue = sanitizedObject;

    const result = { isValid: errors.length === 0, errors, sanitizedValue };

    if (options.throwOnError && !result.isValid) {
      throw new ValidationError(`Validation failed for ${field}`, field, { errors });
    }

    return result;
  }

  /**
   * Sanitize a string by removing dangerous characters
   */
  static sanitizeString(value: string): string {
    return value
      // Remove null bytes
      .replace(/\0/g, '')
      // Remove control characters except newlines and tabs
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Normalize Unicode
      .normalize('NFKC')
      // Trim
      .trim();
  }

  /**
   * Sanitize HTML by escaping dangerous characters
   */
  static sanitizeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Validate and sanitize user input for Discord messages
   */
  static validateDiscordMessage(value: unknown): ValidationResult {
    return this.validateString(value, 'message', {
      required: true,
      maxLength: 2000,
      sanitize: true,
      throwOnError: false
    });
  }

  /**
   * Validate and sanitize user input for Claude prompts
   */
  static validateClaudePrompt(value: unknown): ValidationResult {
    return this.validateString(value, 'prompt', {
      required: true,
      maxLength: 10000, // Reasonable limit for prompts
      sanitize: true,
      throwOnError: false
    });
  }

  /**
   * Validate thread ID
   */
  static validateThreadId(value: unknown): ValidationResult {
    return this.validateDiscordId(value, 'threadId', {
      required: true,
      throwOnError: false
    });
  }

  /**
   * Validate channel ID
   */
  static validateChannelId(value: unknown): ValidationResult {
    return this.validateDiscordId(value, 'channelId', {
      required: true,
      throwOnError: false
    });
  }

  /**
   * Validate user ID
   */
  static validateUserId(value: unknown): ValidationResult {
    return this.validateDiscordId(value, 'userId', {
      required: true,
      throwOnError: false
    });
  }
} 