/**
 * Database Migrations Module
 * 
 * Handles database schema versioning and migrations:
 * - SQL migration file execution
 * - Migration tracking and validation
 * - Checksum verification for file integrity
 * - Transaction-safe migration process
 * 
 * @example
 * ```typescript
 * import { runMigrations, checkMigrationStatus } from '@/modules/data/migrations';
 * import { database } from '@/modules/data';
 * 
 * // Run all pending migrations
 * const results = await runMigrations(database);
 * 
 * // Check migration status
 * const status = await checkMigrationStatus(database);
 * console.log(`${status.pending.length} migrations pending`);
 * ```
 */

// Export migration runner
export {
  MigrationRunner,
  runMigrations,
  checkMigrationStatus,
  type Migration,
  type AppliedMigration,
  type MigrationResult
} from './migration-runner'; 