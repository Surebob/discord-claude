import { BaseRepository } from './base-repository';
import { 
  ConversationSummary, 
  CreateSummaryParams, 
  UpdateSummaryParams,
  ConversationSummaryRepository 
} from '../types';
import { Database } from '../database';

/**
 * Conversation Summary Repository
 * Data access layer for conversation summaries
 */
export class SummaryRepository extends BaseRepository<ConversationSummary> implements ConversationSummaryRepository {
  constructor(database: Database) {
    super(database, 'conversation_summaries');
  }

  /**
   * Find summary by ID
   */
  async findById(id: number): Promise<ConversationSummary | null> {
    const query = `
      SELECT * FROM conversation_summaries 
      WHERE id = $1
    `;

    const row = await this.querySingle<any>(query, [id]);
    return row ? this.mapRowToSummary(row) : null;
  }

  /**
   * Find all summaries
   */
  async findAll(): Promise<ConversationSummary[]> {
    const query = `
      SELECT * FROM conversation_summaries 
      ORDER BY created_at DESC
    `;

    const rows = await this.queryMany<any>(query);
    return rows.map(row => this.mapRowToSummary(row));
  }

  /**
   * Find summaries by channel ID
   */
  async findByChannelId(channelId: string): Promise<ConversationSummary[]> {
    this.logOperation('findByChannelId', { channelId });

    const query = `
      SELECT * FROM conversation_summaries 
      WHERE channel_id = $1 
      ORDER BY context_window_number ASC
    `;

    const rows = await this.queryMany<any>(query, [channelId]);
    const summaries = rows.map(row => this.mapRowToSummary(row));

    if (summaries.length > 0) {
      this.logOperation('foundSummaries', { count: summaries.length, channelId });
    }

    return summaries;
  }

  /**
   * Find latest summary by channel ID
   */
  async findLatestByChannelId(channelId: string): Promise<ConversationSummary | null> {
    this.logOperation('findLatestByChannelId', { channelId });

    const query = `
      SELECT * FROM conversation_summaries 
      WHERE channel_id = $1 
      ORDER BY context_window_number DESC 
      LIMIT 1
    `;

    const row = await this.querySingle<any>(query, [channelId]);
    
    if (!row) {
      this.logOperation('noSummariesFound', { channelId });
      return null;
    }

    const summary = this.mapRowToSummary(row);
    this.logOperation('foundLatestSummary', { 
      channelId, 
      windowNumber: summary.context_window_number 
    });

    return summary;
  }

  /**
   * Create a new conversation summary
   */
  async create(params: CreateSummaryParams): Promise<ConversationSummary> {
    const {
      channel_id,
      summary,
      files_mentioned,
      last_message_id,
      last_message_timestamp,
      context_window_number = 1
    } = params;

    const query = `
      INSERT INTO conversation_summaries (
        channel_id, summary, files_mentioned, last_message_id, 
        last_message_timestamp, context_window_number, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (channel_id, context_window_number) 
      DO UPDATE SET 
        summary = EXCLUDED.summary,
        files_mentioned = EXCLUDED.files_mentioned,
        last_message_id = EXCLUDED.last_message_id,
        last_message_timestamp = EXCLUDED.last_message_timestamp,
        updated_at = NOW()
      RETURNING *
    `;

    const row = await this.queryFirst<any>(query, [
      channel_id,
      summary,
      JSON.stringify(files_mentioned),
      last_message_id,
      last_message_timestamp,
      context_window_number
    ]);

    this.logOperation('createOrUpdateSummary', { 
      channelId: channel_id, 
      windowNumber: context_window_number 
    });

    return this.mapRowToSummary(row);
  }

  /**
   * Update an existing conversation summary
   */
  async update(params: UpdateSummaryParams): Promise<ConversationSummary> {
    const { id, ...updates } = params;
    
    // Build dynamic update query
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.summary !== undefined) {
      updateFields.push(`summary = $${paramIndex++}`);
      values.push(updates.summary);
    }
    if (updates.files_mentioned !== undefined) {
      updateFields.push(`files_mentioned = $${paramIndex++}`);
      values.push(JSON.stringify(updates.files_mentioned));
    }
    if (updates.last_message_id !== undefined) {
      updateFields.push(`last_message_id = $${paramIndex++}`);
      values.push(updates.last_message_id);
    }
    if (updates.last_message_timestamp !== undefined) {
      updateFields.push(`last_message_timestamp = $${paramIndex++}`);
      values.push(updates.last_message_timestamp);
    }

    updateFields.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE conversation_summaries 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const row = await this.queryFirst<any>(query, values);
    
    this.logOperation('updateSummary', { id, fieldsUpdated: Object.keys(updates) });
    
    return this.mapRowToSummary(row);
  }

  /**
   * Delete a conversation summary
   */
  async delete(id: number): Promise<void> {
    const query = `DELETE FROM conversation_summaries WHERE id = $1`;
    
    const result = await this.query(query, [id]);
    
    this.logOperation('deleteSummary', { id, rowsDeleted: result.rowCount });
  }

  /**
   * Delete all summaries for a channel
   */
  async deleteByChannelId(channelId: string): Promise<void> {
    const query = `DELETE FROM conversation_summaries WHERE channel_id = $1`;

    const result = await this.query(query, [channelId]);
    
    this.logOperation('deleteSummariesByChannel', { 
      channelId, 
      rowsDeleted: result.rowCount 
    });
  }

  /**
   * Get the next context window number for a channel
   */
  async getNextContextWindowNumber(channelId: string): Promise<number> {
    const query = `
      SELECT COALESCE(MAX(context_window_number), 0) + 1 as next_window
      FROM conversation_summaries 
      WHERE channel_id = $1
    `;

    const row = await this.queryFirst<{ next_window: number }>(query, [channelId]);
    const nextWindow = row.next_window;
    
    this.logOperation('getNextContextWindow', { channelId, nextWindow });
    
    return nextWindow;
  }

  /**
   * Map database row to ConversationSummary object (required by BaseRepository)
   */
  protected mapRowToEntity(row: any): ConversationSummary {
    return this.mapRowToSummary(row);
  }

  /**
   * Map database row to ConversationSummary object
   */
  private mapRowToSummary(row: any): ConversationSummary {
    return {
      ...row,
      files_mentioned: this.parseJsonField(row.files_mentioned, [])
    };
  }
} 