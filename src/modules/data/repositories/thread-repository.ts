import { BaseRepository } from './base-repository';
import { Database } from '../database';
import { logger } from '../../infra';

/**
 * Thread metadata for Discord threads
 */
export interface ThreadMetadata {
  id: string;
  thread_id: string;
  parent_channel_id: string;
  name: string;
  owner_id: string;
  created_at: Date;
  archived: boolean;
  locked: boolean;
  member_count?: number;
  message_count?: number;
  auto_archive_duration?: number;
  last_activity: Date;
  handoff_context?: string; // JSON string of conversation context
  tags?: string; // JSON array of tags
  metadata?: string; // JSON object for additional metadata
}

/**
 * Parameters for creating thread metadata
 */
export interface CreateThreadParams {
  thread_id: string;
  parent_channel_id: string;
  name: string;
  owner_id: string;
  archived?: boolean;
  locked?: boolean;
  member_count?: number;
  message_count?: number;
  auto_archive_duration?: number;
  handoff_context?: any;
  tags?: string[];
  metadata?: any;
}

/**
 * Parameters for updating thread metadata
 */
export interface UpdateThreadParams {
  name?: string;
  archived?: boolean;
  locked?: boolean;
  member_count?: number;
  message_count?: number;
  last_activity?: Date;
  handoff_context?: any;
  tags?: string[];
  metadata?: any;
}

/**
 * Thread Repository
 * Manages Discord thread metadata and relationships
 */
export class ThreadRepository extends BaseRepository<ThreadMetadata> {
  constructor(database: Database) {
    super(database, 'thread_metadata');
  }

  /**
   * Create thread metadata
   */
  async create(params: CreateThreadParams): Promise<ThreadMetadata> {
    const query = `
      INSERT INTO thread_metadata (
        thread_id, parent_channel_id, name, owner_id,
        archived, locked, member_count, message_count,
        auto_archive_duration, handoff_context, tags, metadata,
        created_at, last_activity
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
      ) RETURNING *
    `;

    const values = [
      params.thread_id,
      params.parent_channel_id,
      params.name,
      params.owner_id,
      params.archived || false,
      params.locked || false,
      params.member_count,
      params.message_count,
      params.auto_archive_duration,
      params.handoff_context ? JSON.stringify(params.handoff_context) : null,
      params.tags ? JSON.stringify(params.tags) : null,
      params.metadata ? JSON.stringify(params.metadata) : null
    ];

    const result = await this.executeQuery(query, values);
    
    if (result.rows.length === 0) {
      throw new Error('Failed to create thread metadata');
    }

    logger.info(`📝 Created thread metadata: ${params.name} (${params.thread_id})`);
    return this.mapRowToEntity(result.rows[0]);
  }

  /**
   * Find thread metadata by thread ID
   */
  async findByThreadId(threadId: string): Promise<ThreadMetadata | null> {
    const query = 'SELECT * FROM thread_metadata WHERE thread_id = $1';
    const result = await this.executeQuery(query, [threadId]);
    
    return result.rows.length > 0 ? this.mapRowToEntity(result.rows[0]) : null;
  }

  /**
   * Find all threads in a parent channel
   */
  async findByParentChannel(parentChannelId: string): Promise<ThreadMetadata[]> {
    const query = `
      SELECT * FROM thread_metadata 
      WHERE parent_channel_id = $1 
      ORDER BY last_activity DESC
    `;
    
    const result = await this.executeQuery(query, [parentChannelId]);
    return result.rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Find active (non-archived) threads
   */
  async findActiveThreads(parentChannelId?: string): Promise<ThreadMetadata[]> {
    let query = 'SELECT * FROM thread_metadata WHERE archived = false';
    const values: any[] = [];

    if (parentChannelId) {
      query += ' AND parent_channel_id = $1';
      values.push(parentChannelId);
    }

    query += ' ORDER BY last_activity DESC';

    const result = await this.executeQuery(query, values);
    return result.rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Update thread metadata
   */
  async updateByThreadId(threadId: string, params: UpdateThreadParams): Promise<ThreadMetadata | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Build dynamic update query
    if (params.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(params.name);
    }

    if (params.archived !== undefined) {
      updates.push(`archived = $${paramIndex++}`);
      values.push(params.archived);
    }

    if (params.locked !== undefined) {
      updates.push(`locked = $${paramIndex++}`);
      values.push(params.locked);
    }

    if (params.member_count !== undefined) {
      updates.push(`member_count = $${paramIndex++}`);
      values.push(params.member_count);
    }

    if (params.message_count !== undefined) {
      updates.push(`message_count = $${paramIndex++}`);
      values.push(params.message_count);
    }

    if (params.last_activity !== undefined) {
      updates.push(`last_activity = $${paramIndex++}`);
      values.push(params.last_activity);
    } else {
      // Always update last_activity when making changes
      updates.push(`last_activity = NOW()`);
    }

    if (params.handoff_context !== undefined) {
      updates.push(`handoff_context = $${paramIndex++}`);
      values.push(params.handoff_context ? JSON.stringify(params.handoff_context) : null);
    }

    if (params.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(params.tags ? JSON.stringify(params.tags) : null);
    }

    if (params.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(params.metadata ? JSON.stringify(params.metadata) : null);
    }

    if (updates.length === 0) {
      // Nothing to update
      return this.findByThreadId(threadId);
    }

    const query = `
      UPDATE thread_metadata 
      SET ${updates.join(', ')} 
      WHERE thread_id = $${paramIndex} 
      RETURNING *
    `;
    
    values.push(threadId);
    
    const result = await this.executeQuery(query, values);
    
    if (result.rows.length === 0) {
      return null;
    }

    logger.info(`📝 Updated thread metadata: ${threadId}`);
    return this.mapRowToEntity(result.rows[0]);
  }

  /**
   * Delete thread metadata
   */
  async deleteByThreadId(threadId: string): Promise<boolean> {
    const query = 'DELETE FROM thread_metadata WHERE thread_id = $1';
    const result = await this.executeQuery(query, [threadId]);
    
    const deleted = result.rowCount > 0;
    if (deleted) {
      logger.info(`🗑️ Deleted thread metadata: ${threadId}`);
    }
    
    return deleted;
  }

  /**
   * Get thread statistics
   */
  async getThreadStats(parentChannelId?: string): Promise<{
    total: number;
    active: number;
    archived: number;
    totalMessages: number;
    totalMembers: number;
  }> {
    let query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN archived = false THEN 1 END) as active,
        COUNT(CASE WHEN archived = true THEN 1 END) as archived,
        COALESCE(SUM(message_count), 0) as total_messages,
        COALESCE(SUM(member_count), 0) as total_members
      FROM thread_metadata
    `;

    const values: any[] = [];
    if (parentChannelId) {
      query += ' WHERE parent_channel_id = $1';
      values.push(parentChannelId);
    }

    const result = await this.executeQuery(query, values);
    const row = result.rows[0];

    return {
      total: parseInt(row.total),
      active: parseInt(row.active),
      archived: parseInt(row.archived),
      totalMessages: parseInt(row.total_messages),
      totalMembers: parseInt(row.total_members)
    };
  }

  /**
   * Search threads by name or tags
   */
  async searchThreads(query: string, parentChannelId?: string): Promise<ThreadMetadata[]> {
    let sql = `
      SELECT * FROM thread_metadata 
      WHERE (
        name ILIKE $1 
        OR tags::text ILIKE $1
      )
    `;
    
    const values: any[] = [`%${query}%`];

    if (parentChannelId) {
      sql += ' AND parent_channel_id = $2';
      values.push(parentChannelId);
    }

    sql += ' ORDER BY last_activity DESC LIMIT 50';

    const result = await this.executeQuery(sql, values);
    return result.rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Update last activity timestamp
   */
  async updateActivity(threadId: string): Promise<void> {
    const query = `
      UPDATE thread_metadata 
      SET last_activity = NOW() 
      WHERE thread_id = $1
    `;
    
    await this.executeQuery(query, [threadId]);
  }

  /**
   * Map database row to ThreadMetadata entity
   */
  protected mapRowToEntity(row: any): ThreadMetadata {
    return {
      id: row.id,
      thread_id: row.thread_id,
      parent_channel_id: row.parent_channel_id,
      name: row.name,
      owner_id: row.owner_id,
      created_at: row.created_at,
      archived: row.archived,
      locked: row.locked,
      member_count: row.member_count,
      message_count: row.message_count,
      auto_archive_duration: row.auto_archive_duration,
      last_activity: row.last_activity,
      handoff_context: row.handoff_context ? JSON.parse(row.handoff_context) : undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };
  }
} 