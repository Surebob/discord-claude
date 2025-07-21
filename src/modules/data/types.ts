/**
 * Data Module Types
 * Type definitions for database entities and operations
 */

/**
 * File description for conversation summaries
 */
export interface FileDescription {
  name: string;
  size: number;
  type: string;
  uploaded_at: string;
  description: string;
  message_id: string;
}

/**
 * Conversation summary entity
 */
export interface ConversationSummary {
  id: number;
  channel_id: string;
  summary: string;
  files_mentioned: FileDescription[];
  last_message_id: string;
  last_message_timestamp: Date;
  context_window_number: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Parameters for creating a conversation summary
 */
export interface CreateSummaryParams {
  channel_id: string;
  summary: string;
  files_mentioned: FileDescription[];
  last_message_id: string;
  last_message_timestamp: Date;
  context_window_number?: number;
}

/**
 * Parameters for updating a conversation summary
 */
export interface UpdateSummaryParams {
  id: number;
  summary?: string;
  files_mentioned?: FileDescription[];
  last_message_id?: string;
  last_message_timestamp?: Date;
}

/**
 * Database query result wrapper
 */
export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  command: string;
}

/**
 * Database transaction client
 */
export interface TransactionClient {
  query(text: string, params?: any[]): Promise<QueryResult>;
  release(): void;
}

/**
 * Repository base interface
 */
export interface Repository<T, CreateParams, UpdateParams> {
  findById(id: number): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(params: CreateParams): Promise<T>;
  update(params: UpdateParams): Promise<T>;
  delete(id: number): Promise<void>;
}

/**
 * Conversation summary repository interface
 */
export interface ConversationSummaryRepository extends Repository<ConversationSummary, CreateSummaryParams, UpdateSummaryParams> {
  findByChannelId(channelId: string): Promise<ConversationSummary[]>;
  findLatestByChannelId(channelId: string): Promise<ConversationSummary | null>;
  getNextContextWindowNumber(channelId: string): Promise<number>;
  deleteByChannelId(channelId: string): Promise<void>;
}

/**
 * Database connection configuration
 */
export interface DatabaseConfig {
  connectionString: string;
  ssl?: {
    rejectUnauthorized: boolean;
  };
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
} 