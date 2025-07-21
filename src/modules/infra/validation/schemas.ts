import { Validators, ValidationResult } from './validators';

/**
 * Validation schema definition
 */
export type ValidationSchema<T> = {
  [K in keyof T]: (value: unknown, field: string) => ValidationResult;
};

/**
 * Discord message schema
 */
export interface DiscordMessageData {
  content: string;
  channelId: string;
  userId: string;
  guildId?: string;
}

/**
 * Claude request schema
 */
export interface ClaudeRequestData {
  prompt: string;
  userId: string;
  channelId: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Thread creation schema
 */
export interface ThreadCreationData {
  name: string;
  purpose: string;
  initialMessage: string;
  channelId: string;
  userId: string;
}

/**
 * Thread query schema
 */
export interface ThreadQueryData {
  threadId: string;
  query: string;
  contextHint?: string;
  userId: string;
}

/**
 * Database summary schema
 */
export interface SummaryCreationData {
  channelId: string;
  summary: string;
  filesMentioned: Array<{
    name: string;
    size: number;
    type: string;
    uploadedAt: string;
    description: string;
    messageId: string;
  }>;
  lastMessageId: string;
  lastMessageTimestamp: Date;
  contextWindowNumber?: number;
}

/**
 * Configuration schema
 */
export interface ConfigurationData {
  discordToken: string;
  discordClientId: string;
  anthropicApiKey: string;
  databaseUrl: string;
  botName?: string;
  enableMentionResponses?: boolean;
  claudeModel?: string;
  maxTokensPerRequest?: number;
  claudeRequestsPerMinute?: number;
}

/**
 * Validation Schemas
 * Pre-defined validation schemas for common data structures
 */
export class ValidationSchemas {
  /**
   * Discord message validation schema
   */
  static readonly discordMessage: ValidationSchema<DiscordMessageData> = {
    content: (value, field) => Validators.validateDiscordMessage(value),
    channelId: (value, field) => Validators.validateChannelId(value),
    userId: (value, field) => Validators.validateUserId(value),
    guildId: (value, field) => Validators.validateDiscordId(value, field, { required: false })
  };

  /**
   * Claude request validation schema
   */
  static readonly claudeRequest: ValidationSchema<ClaudeRequestData> = {
    prompt: (value, field) => Validators.validateClaudePrompt(value),
    userId: (value, field) => Validators.validateUserId(value),
    channelId: (value, field) => Validators.validateChannelId(value),
    maxTokens: (value, field) => Validators.validateNumber(value, field, {
      required: false,
      min: 1,
      max: 200000,
      integer: true
    }),
    temperature: (value, field) => Validators.validateNumber(value, field, {
      required: false,
      min: 0,
      max: 2
    })
  };

  /**
   * Thread creation validation schema
   */
  static readonly threadCreation: ValidationSchema<ThreadCreationData> = {
    name: (value, field) => Validators.validateString(value, field, {
      required: true,
      minLength: 1,
      maxLength: 100,
      sanitize: true
    }),
    purpose: (value, field) => Validators.validateString(value, field, {
      required: true,
      minLength: 1,
      maxLength: 500,
      sanitize: true
    }),
    initialMessage: (value, field) => Validators.validateString(value, field, {
      required: true,
      minLength: 1,
      maxLength: 2000,
      sanitize: true
    }),
    channelId: (value, field) => Validators.validateChannelId(value),
    userId: (value, field) => Validators.validateUserId(value)
  };

  /**
   * Thread query validation schema
   */
  static readonly threadQuery: ValidationSchema<ThreadQueryData> = {
    threadId: (value, field) => Validators.validateThreadId(value),
    query: (value, field) => Validators.validateString(value, field, {
      required: true,
      minLength: 1,
      maxLength: 2000,
      sanitize: true
    }),
    contextHint: (value, field) => Validators.validateString(value, field, {
      required: false,
      maxLength: 500,
      sanitize: true
    }),
    userId: (value, field) => Validators.validateUserId(value)
  };

  /**
   * Summary creation validation schema
   */
  static readonly summaryCreation: ValidationSchema<SummaryCreationData> = {
    channelId: (value, field) => Validators.validateChannelId(value),
    summary: (value, field) => Validators.validateString(value, field, {
      required: true,
      minLength: 1,
      maxLength: 50000,
      sanitize: true
    }),
    filesMentioned: (value, field) => Validators.validateArray(
      value,
      field,
      (item, index) => {
        return Validators.validateObject(item, `${field}[${index}]`, {
          name: (val, f) => Validators.validateString(val, f, { required: true, maxLength: 255 }),
          size: (val, f) => Validators.validateNumber(val, f, { required: true, min: 0, integer: true }),
          type: (val, f) => Validators.validateString(val, f, { required: true, maxLength: 100 }),
          uploadedAt: (val, f) => Validators.validateString(val, f, { required: true }),
          description: (val, f) => Validators.validateString(val, f, { required: true, maxLength: 1000 }),
          messageId: (val, f) => Validators.validateDiscordId(val, f)
        });
      },
      { required: false, maxLength: 100 }
    ),
    lastMessageId: (value, field) => Validators.validateDiscordId(value, field),
    lastMessageTimestamp: (value, field) => {
      if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
        return { isValid: false, errors: [`${field} must be a valid date`], sanitizedValue: new Date() };
      }
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        return { isValid: false, errors: [`${field} must be a valid date`], sanitizedValue: new Date() };
      }
      return { isValid: true, errors: [], sanitizedValue: date };
    },
    contextWindowNumber: (value, field) => Validators.validateNumber(value, field, {
      required: false,
      min: 1,
      integer: true
    })
  };

  /**
   * Configuration validation schema
   */
  static readonly configuration: ValidationSchema<ConfigurationData> = {
    discordToken: (value, field) => Validators.validateString(value, field, {
      required: true,
      minLength: 50,
      sanitize: false
    }),
    discordClientId: (value, field) => Validators.validateDiscordId(value, field),
    anthropicApiKey: (value, field) => Validators.validateString(value, field, {
      required: true,
      minLength: 20,
      sanitize: false
    }),
    databaseUrl: (value, field) => Validators.validateString(value, field, {
      required: true,
      minLength: 10,
      sanitize: false
    }),
    botName: (value, field) => Validators.validateString(value, field, {
      required: false,
      maxLength: 32,
      sanitize: true
    }),
    enableMentionResponses: (value, field) => Validators.validateBoolean(value, field, {
      required: false
    }),
    claudeModel: (value, field) => Validators.validateString(value, field, {
      required: false,
      maxLength: 100,
      pattern: /^claude-/,
      sanitize: false
    }),
    maxTokensPerRequest: (value, field) => Validators.validateNumber(value, field, {
      required: false,
      min: 1,
      max: 200000,
      integer: true
    }),
    claudeRequestsPerMinute: (value, field) => Validators.validateNumber(value, field, {
      required: false,
      min: 1,
      max: 1000,
      integer: true
    })
  };

  /**
   * Validate data against a schema
   */
  static validate<T>(
    data: unknown,
    schema: ValidationSchema<T>,
    fieldName: string = 'data'
  ): ValidationResult {
    return Validators.validateObject(data, fieldName, schema as any);
  }

  /**
   * Validate Discord message data
   */
  static validateDiscordMessage(data: unknown): ValidationResult {
    return this.validate(data, this.discordMessage, 'discordMessage');
  }

  /**
   * Validate Claude request data
   */
  static validateClaudeRequest(data: unknown): ValidationResult {
    return this.validate(data, this.claudeRequest, 'claudeRequest');
  }

  /**
   * Validate thread creation data
   */
  static validateThreadCreation(data: unknown): ValidationResult {
    return this.validate(data, this.threadCreation, 'threadCreation');
  }

  /**
   * Validate thread query data
   */
  static validateThreadQuery(data: unknown): ValidationResult {
    return this.validate(data, this.threadQuery, 'threadQuery');
  }

  /**
   * Validate summary creation data
   */
  static validateSummaryCreation(data: unknown): ValidationResult {
    return this.validate(data, this.summaryCreation, 'summaryCreation');
  }

  /**
   * Validate configuration data
   */
  static validateConfiguration(data: unknown): ValidationResult {
    return this.validate(data, this.configuration, 'configuration');
  }
}

/**
 * Validation middleware for common operations
 */
export class ValidationMiddleware {
  /**
   * Validate and sanitize user input from Discord
   */
  static validateUserInput(
    content: unknown,
    userId: unknown,
    channelId: unknown,
    guildId?: unknown
  ): DiscordMessageData {
    const result = ValidationSchemas.validateDiscordMessage({
      content,
      userId,
      channelId,
      guildId
    });

    if (!result.isValid) {
      throw new Error(`Invalid user input: ${result.errors.join(', ')}`);
    }

    return result.sanitizedValue as DiscordMessageData;
  }

  /**
   * Validate Claude request parameters
   */
  static validateClaudeParams(
    prompt: unknown,
    userId: unknown,
    channelId: unknown,
    options?: { maxTokens?: unknown; temperature?: unknown }
  ): ClaudeRequestData {
    const result = ValidationSchemas.validateClaudeRequest({
      prompt,
      userId,
      channelId,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature
    });

    if (!result.isValid) {
      throw new Error(`Invalid Claude request: ${result.errors.join(', ')}`);
    }

    return result.sanitizedValue as ClaudeRequestData;
  }

  /**
   * Validate thread operation parameters
   */
  static validateThreadParams(
    threadId: unknown,
    query: unknown,
    userId: unknown,
    contextHint?: unknown
  ): ThreadQueryData {
    const result = ValidationSchemas.validateThreadQuery({
      threadId,
      query,
      userId,
      contextHint
    });

    if (!result.isValid) {
      throw new Error(`Invalid thread parameters: ${result.errors.join(', ')}`);
    }

    return result.sanitizedValue as ThreadQueryData;
  }
} 