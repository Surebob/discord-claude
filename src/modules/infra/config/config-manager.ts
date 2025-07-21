import { validateEnvironment } from './environment';
import { validateClaudeConfiguration } from './claude-config';
import { validateDiscordConfiguration } from './discord-config';
import { validateDatabaseConfiguration } from './database-config';
import { logger } from '../logging';

/**
 * Configuration validation result
 */
export interface ConfigurationValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  modules: {
    environment: boolean;
    claude: boolean;
    discord: boolean;
    database: boolean;
  };
}

/**
 * Configuration Manager
 * Centralized orchestration of all configuration modules
 */
export class ConfigurationManager {
  private static instance?: ConfigurationManager;
  private isInitialized = false;
  private validationResult?: ConfigurationValidationResult;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  /**
   * Initialize all configuration modules
   */
  async initialize(): Promise<ConfigurationValidationResult> {
    if (this.isInitialized) {
      logger.warn('Configuration manager already initialized');
      return this.validationResult!;
    }

    logger.info('🔧 Initializing configuration manager...');

    const result: ConfigurationValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      modules: {
        environment: false,
        claude: false,
        discord: false,
        database: false
      }
    };

    // Validate environment variables first
    try {
      validateEnvironment();
      result.modules.environment = true;
      logger.debug('✅ Environment configuration validated');
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Environment: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logger.error('❌ Environment configuration failed:', error);
    }

    // Validate Claude configuration
    try {
      validateClaudeConfiguration();
      result.modules.claude = true;
      logger.debug('✅ Claude configuration validated');
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Claude: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logger.error('❌ Claude configuration failed:', error);
    }

    // Validate Discord configuration
    try {
      validateDiscordConfiguration();
      result.modules.discord = true;
      logger.debug('✅ Discord configuration validated');
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Discord: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logger.error('❌ Discord configuration failed:', error);
    }

    // Validate Database configuration
    try {
      validateDatabaseConfiguration();
      result.modules.database = true;
      logger.debug('✅ Database configuration validated');
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Database: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logger.error('❌ Database configuration failed:', error);
    }

    this.validationResult = result;
    this.isInitialized = true;

    // Log summary
    const validModules = Object.values(result.modules).filter(Boolean).length;
    const totalModules = Object.keys(result.modules).length;

    if (result.isValid) {
      logger.info(`✅ Configuration manager initialized: ${validModules}/${totalModules} modules valid`);
    } else {
      logger.error(`❌ Configuration manager initialization failed: ${result.errors.length} errors found`);
      result.errors.forEach(error => logger.error(`  - ${error}`));
    }

    if (result.warnings.length > 0) {
      logger.warn(`⚠️ Configuration warnings:`);
      result.warnings.forEach(warning => logger.warn(`  - ${warning}`));
    }

    return result;
  }

  /**
   * Get validation result
   */
  getValidationResult(): ConfigurationValidationResult | undefined {
    return this.validationResult;
  }

  /**
   * Check if configuration is valid
   */
  isValid(): boolean {
    return this.validationResult?.isValid ?? false;
  }

  /**
   * Get configuration summary for debugging
   */
  getConfigurationSummary(): Record<string, any> {
    return {
      initialized: this.isInitialized,
      valid: this.isValid(),
      modules: this.validationResult?.modules || {},
      errorCount: this.validationResult?.errors.length || 0,
      warningCount: this.validationResult?.warnings.length || 0,
      environment: {
        nodeEnv: process.env.NODE_ENV,
        logLevel: process.env.LOG_LEVEL,
        hasDiscordToken: !!process.env.DISCORD_TOKEN,
        hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
        hasDatabaseUrl: !!process.env.DATABASE_URL
      }
    };
  }

  /**
   * Reload configuration (useful for development)
   */
  async reload(): Promise<ConfigurationValidationResult> {
    logger.info('🔄 Reloading configuration...');
    this.isInitialized = false;
    this.validationResult = undefined;
    return await this.initialize();
  }

  /**
   * Validate specific configuration module
   */
  async validateModule(moduleName: string): Promise<{ isValid: boolean; error?: string }> {
    try {
      switch (moduleName) {
        case 'environment':
          validateEnvironment();
          break;
        case 'claude':
          validateClaudeConfiguration();
          break;
        case 'discord':
          validateDiscordConfiguration();
          break;
        case 'database':
          validateDatabaseConfiguration();
          break;
        default:
          return { isValid: false, error: `Unknown module: ${moduleName}` };
      }
      return { isValid: true };
    } catch (error) {
      return { 
        isValid: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Get environment-specific configuration recommendations
   */
  getEnvironmentRecommendations(): string[] {
    const recommendations: string[] = [];
    const nodeEnv = process.env.NODE_ENV;

    if (!nodeEnv) {
      recommendations.push('Set NODE_ENV environment variable (development/production)');
    }

    if (nodeEnv === 'production') {
      if (!process.env.DATABASE_URL?.includes('ssl=true')) {
        recommendations.push('Enable SSL for production database connections');
      }
      if (process.env.LOG_LEVEL === 'debug') {
        recommendations.push('Consider using "info" log level in production for better performance');
      }
    }

    if (nodeEnv === 'development') {
      if (!process.env.LOG_LEVEL) {
        recommendations.push('Set LOG_LEVEL=debug for better development experience');
      }
    }

    return recommendations;
  }

  /**
   * Export configuration for external tools (sanitized)
   */
  exportConfiguration(): Record<string, any> {
    const summary = this.getConfigurationSummary();
    
    // Remove sensitive information
    const sanitized = {
      ...summary,
      environment: {
        ...summary.environment,
        // Remove actual secrets, just indicate presence
        discordToken: summary.environment.hasDiscordToken ? '[SET]' : '[NOT SET]',
        anthropicKey: summary.environment.hasAnthropicKey ? '[SET]' : '[NOT SET]',
        databaseUrl: summary.environment.hasDatabaseUrl ? '[SET]' : '[NOT SET]'
      }
    };

    return sanitized;
  }
}

/**
 * Global configuration manager instance
 */
export const configManager = ConfigurationManager.getInstance();

/**
 * Initialize all configuration (convenience function)
 */
export async function initializeConfiguration(): Promise<ConfigurationValidationResult> {
  return await configManager.initialize();
}

/**
 * Validate all configuration (convenience function)
 */
export function validateAllConfiguration(): void {
  const result = configManager.getValidationResult();
  
  if (!result) {
    throw new Error('Configuration not initialized. Call initializeConfiguration() first.');
  }
  
  if (!result.isValid) {
    throw new Error(`Configuration validation failed: ${result.errors.join(', ')}`);
  }
}

/**
 * Get configuration validation status
 */
export function getConfigurationStatus(): {
  initialized: boolean;
  valid: boolean;
  summary: Record<string, any>;
} {
  return {
    initialized: configManager.getValidationResult() !== undefined,
    valid: configManager.isValid(),
    summary: configManager.getConfigurationSummary()
  };
} 