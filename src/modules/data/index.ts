/**
 * Data Persistence Module
 * 
 * Centralized data access and persistence layer:
 * - Database connection management
 * - Repository pattern implementation
 * - Transaction support
 * - Schema migrations
 * - Thread and conversation metadata
 * 
 * @example
 * ```typescript
 * import { Database, SummaryRepository, ThreadRepository } from '@/modules/data';
 * import { container } from '@/core/dependency-injection';
 * 
 * // Use DI container to get repositories
 * const database = await container.resolve<Database>('database');
 * const summaryRepo = await container.resolve<SummaryRepository>('summaryRepository');
 * const threadRepo = await container.resolve<ThreadRepository>('threadRepository');
 * 
 * const summaries = await summaryRepo.findByChannelId(channelId);
 * const threads = await threadRepo.findByParentChannel(channelId);
 * ```
 */

// Export database connection
export { Database } from './database';

// Export repository classes (not instances - use DI container for instances)
export { BaseRepository } from './repositories/base-repository';
export { SummaryRepository } from './repositories/summary-repository';
export { ThreadRepository } from './repositories/thread-repository';

// Export context service
export { ContextService } from './context-service';
export { ThreadService } from './thread-service';

// Export types
export type {
  FileDescription,
  ConversationSummary,
  CreateSummaryParams,
  UpdateSummaryParams,
  QueryResult,
  TransactionClient,
  Repository,
  ConversationSummaryRepository,
  DatabaseConfig
} from './types';

// Export migration utilities
export {
  runMigrations,
  checkMigrationStatus,
  type Migration,
  type AppliedMigration
} from './migrations';

// NOTE: Repository instances are now managed by DI container
// Use: const summaryRepo = await container.resolve<SummaryRepository>('summaryRepository');
// Instead of: import { summaryRepository } from '@/modules/data'; 