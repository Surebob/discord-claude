import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { Database } from '../database';
import { logger } from '../../infra/logging';

/**
 * Migration metadata
 */
export interface Migration {
  version: string;
  description: string;
  filename: string;
  checksum: string;
  sql: string;
  appliedAt?: Date;
}

/**
 * Applied migration record from database
 */
export interface AppliedMigration {
  version: string;
  checksum: string;
  appliedAt: Date;
}

/**
 * Migration execution result
 */
export interface MigrationResult {
  version: string;
  description: string;
  status: 'success' | 'failed' | 'skipped' | 'applied';
  executionTime: number;
  message?: string;
  error?: string;
}

/**
 * Migration direction
 */
export type MigrationDirection = 'up' | 'down';

/**
 * Migration runner configuration
 */
export interface MigrationConfig {
  migrationsTable?: string;
  migrationsDir?: string;
  validateChecksums?: boolean;
  dryRun?: boolean;
}

/**
 * Migration Runner
 * Handles database schema migrations with version tracking and rollback support
 */
export class MigrationRunner {
  private database: Database;
  private migrationsDir: string;
  private migrationsTable: string;
  private validateChecksums: boolean;

  constructor(database: Database, config: MigrationConfig = {}) {
    this.database = database;
    this.migrationsTable = config.migrationsTable || 'schema_migrations';
    this.validateChecksums = config.validateChecksums ?? true;
    
    // Use provided directory or default to current directory + /migrations
    this.migrationsDir = config.migrationsDir || join(process.cwd(), 'src/modules/data/migrations');
  }

  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<MigrationResult[]> {
    logger.info('🔧 Starting database migrations...');
    
    try {
      // Ensure migration tracking table exists
      await this.ensureMigrationTable();
      
      // Get all available migrations
      const availableMigrations = await this.loadMigrations();
      logger.info(`Found ${availableMigrations.length} migration files`);
      
      // Get applied migrations
      const appliedMigrations = await this.getAppliedMigrations();
      logger.info(`${appliedMigrations.length} migrations already applied`);
      
      // Determine pending migrations
      const pendingMigrations = this.getPendingMigrations(availableMigrations, appliedMigrations);
      
      if (pendingMigrations.length === 0) {
        logger.info('✅ All migrations are up to date');
        return [];
      }
      
      logger.info(`📊 Running ${pendingMigrations.length} pending migrations...`);
      
      // Run pending migrations
      const results: MigrationResult[] = [];
      
      for (const migration of pendingMigrations) {
        const result = await this.runSingleMigration(migration);
        results.push(result);
        
        if (result.status === 'failed') {
          logger.error(`❌ Migration ${migration.version} failed, stopping migration process`);
          break;
        }
      }
      
      const successful = results.filter(r => r.status === 'success').length;
      const failed = results.filter(r => r.status === 'failed').length;
      
      if (failed > 0) {
        logger.error(`❌ Migration process completed with errors: ${successful} successful, ${failed} failed`);
      } else {
        logger.info(`✅ Migration process completed successfully: ${successful} migrations applied`);
      }
      
      return results;
      
    } catch (error) {
      logger.error('❌ Migration process failed:', error);
      throw error;
    }
  }

  /**
   * Check migration status without running them
   */
  async checkMigrationStatus(): Promise<{
    available: Migration[];
    applied: Migration[];
    pending: Migration[];
  }> {
    await this.ensureMigrationTable();
    
    const available = await this.loadMigrations();
    const applied = await this.getAppliedMigrations();
    const pending = this.getPendingMigrations(available, applied);
    
    return { available, applied, pending };
  }

  /**
   * Rollback the last applied migration (if supported)
   */
  async rollback(): Promise<void> {
    logger.warn('⚠️ Migration rollback is not yet implemented');
    throw new Error('Migration rollback is not yet implemented');
  }

  /**
   * Ensure the migration tracking table exists
   */
  private async ensureMigrationTable(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${this.migrationsTable} (
        version VARCHAR(255) PRIMARY KEY,
        description TEXT,
        applied_at TIMESTAMP DEFAULT NOW(),
        checksum VARCHAR(64)
      );
    `;
    
    try {
      await this.database.query(sql);
      logger.debug(`Migration tracking table ${this.migrationsTable} ensured`);
    } catch (error) {
      logger.error(`Failed to create migration tracking table ${this.migrationsTable}:`, error);
      throw error;
    }
  }

  /**
   * Load all available migration files
   */
  private async loadMigrations(): Promise<Migration[]> {
    const migrations: Migration[] = [];
    
    // For now, manually list migration files
    // In a real implementation, you might scan the directory
    const migrationFiles = [
      '001-initial-schema.sql'
    ];
    
    for (const filename of migrationFiles) {
      try {
        const filepath = join(this.migrationsDir, filename);
        const sql = readFileSync(filepath, 'utf8');
        const version = filename.split('-')[0];
        const description = this.extractDescription(sql, filename);
        const checksum = this.calculateChecksum(sql);
        
        migrations.push({
          version,
          description,
          filename,
          checksum,
          sql, // Add sql property
          // appliedAt: undefined // This will be set after successful application
        });
        
        logger.debug(`Loaded migration: ${version} - ${description}`);
      } catch (error) {
        logger.error(`Failed to load migration file ${filename}:`, error);
        throw error;
      }
    }
    
    // Sort by version
    migrations.sort((a, b) => a.version.localeCompare(b.version));
    
    return migrations;
  }

  /**
   * Get all applied migrations from the database
   */
  private async getAppliedMigrations(): Promise<Migration[]> {
    try {
      const result = await this.database.query(`
        SELECT version, description, applied_at, checksum 
        FROM ${this.migrationsTable} 
        ORDER BY version
      `);
      
      return result.rows;
    } catch (error) {
      logger.error(`Failed to fetch applied migrations from ${this.migrationsTable}:`, error);
      throw error;
    }
  }

  /**
   * Determine which migrations are pending
   */
  private getPendingMigrations(
    available: Migration[], 
    applied: Migration[]
  ): Migration[] {
    const appliedVersions = new Set(applied.map(m => m.version));
    
    return available.filter(migration => {
      const isApplied = appliedVersions.has(migration.version);
      
      if (isApplied) {
        // Check if checksum matches
        const appliedMigration = applied.find(m => m.version === migration.version);
        if (appliedMigration && appliedMigration.checksum !== migration.checksum) {
          logger.warn(`⚠️ Migration ${migration.version} checksum mismatch - file may have been modified`);
        }
      }
      
      return !isApplied;
    });
  }

  /**
   * Run a single migration
   */
  private async runSingleMigration(migration: Migration): Promise<MigrationResult> {
    logger.info(`🔧 Applying migration ${migration.version}: ${migration.description}`);
    
    try {
      // Begin transaction
      await this.database.query('BEGIN');
      
      try {
        // Run the migration SQL
        await this.database.query(migration.sql);
        
        // Record the migration as applied
        await this.database.query(`
          INSERT INTO ${this.migrationsTable} (version, description, checksum) 
          VALUES ($1, $2, $3)
        `, [migration.version, migration.description, migration.checksum]);
        
        // Commit transaction
        await this.database.query('COMMIT');
        
        logger.info(`✅ Migration ${migration.version} applied successfully`);
        
        return {
          version: migration.version,
          description: migration.description,
          status: 'applied', // Changed to 'applied'
          executionTime: 0, // Placeholder, actual time would be tracked
          message: 'Migration applied successfully'
        };
        
      } catch (error) {
        // Rollback transaction on error
        await this.database.query('ROLLBACK');
        throw error;
      }
      
    } catch (error) {
      logger.error(`❌ Migration ${migration.version} failed:`, error);
      
      return {
        version: migration.version,
        description: migration.description,
        status: 'failed',
        executionTime: 0, // Placeholder
        message: error instanceof Error ? error.message : 'Unknown error',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Extract description from migration file
   */
  private extractDescription(sql: string, filename: string): string {
    // Look for description comment
    const descriptionMatch = sql.match(/-- Description: (.+)/);
    if (descriptionMatch) {
      return descriptionMatch[1].trim();
    }
    
    // Fallback to filename-based description
    const parts = filename.replace('.sql', '').split('-');
    return parts.slice(1).join(' ').replace(/[_-]/g, ' ');
  }

  /**
   * Calculate checksum for a migration
   */
  private calculateChecksum(sql: string): string {
    return createHash('sha256')
      .update(sql.trim())
      .digest('hex')
      .substring(0, 16); // Use first 16 characters
  }

  /**
   * Validate database connection before running migrations
   */
  async validateConnection(): Promise<boolean> {
    try {
      await this.database.query('SELECT 1');
      return true;
    } catch (error) {
      logger.error('Database connection validation failed:', error);
      return false;
    }
  }
}

/**
 * Convenience function to run migrations
 */
export async function runMigrations(database: Database): Promise<MigrationResult[]> {
  const runner = new MigrationRunner(database);
  
  // Validate connection first
  const isConnected = await runner.validateConnection();
  if (!isConnected) {
    throw new Error('Database connection is not available');
  }
  
  return await runner.runMigrations();
}

/**
 * Convenience function to check migration status
 */
export async function checkMigrationStatus(database: Database) {
  const runner = new MigrationRunner(database);
  return await runner.checkMigrationStatus();
} 