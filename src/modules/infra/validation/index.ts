/**
 * Infrastructure Validation Module
 * 
 * Comprehensive input validation and sanitization system:
 * - Common validators for all data types
 * - Pre-defined schemas for application data structures
 * - Validation middleware for common operations
 * - Input sanitization and security features
 * 
 * @example
 * ```typescript
 * import { Validators, ValidationSchemas, ValidationMiddleware } from '@/modules/infra/validation';
 * 
 * // Direct validation
 * const result = Validators.validateString(userInput, 'message', { 
 *   required: true, 
 *   maxLength: 2000 
 * });
 * 
 * // Schema validation
 * const discordData = ValidationSchemas.validateDiscordMessage({
 *   content: message,
 *   userId: user.id,
 *   channelId: channel.id
 * });
 * 
 * // Middleware validation
 * const sanitized = ValidationMiddleware.validateUserInput(
 *   content, userId, channelId
 * );
 * ```
 */

// Export validators
export {
  Validators,
  type ValidationResult,
  type ValidationOptions,
  type StringValidationOptions,
  type NumberValidationOptions
} from './validators';

// Export schemas
export {
  ValidationSchemas,
  ValidationMiddleware,
  type ValidationSchema,
  type DiscordMessageData,
  type ClaudeRequestData,
  type ThreadCreationData,
  type ThreadQueryData,
  type SummaryCreationData,
  type ConfigurationData
} from './schemas'; 