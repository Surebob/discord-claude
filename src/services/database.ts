import { Pool } from 'pg';
import { logger } from '@/utils/logger.js';

interface ConversationSummary {
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

interface FileDescription {
  name: string;
  size: number;
  type: string;
  uploaded_at: string;
  description: string;
  message_id: string;
}

interface CreateSummaryParams {
  channel_id: string;
  summary: string;
  files_mentioned: FileDescription[];
  last_message_id: string;
  last_message_timestamp: Date;
  context_window_number?: number;
}

class DatabaseService {
  private pool: Pool;
  private isConnected = false;

  constructor() {
    // DigitalOcean uses DATABASE_URL connection string
    if (!process.env.DATABASE_URL) {
      logger.error('❌ DATABASE_URL environment variable is required for DigitalOcean PostgreSQL');
      throw new Error('DATABASE_URL environment variable is required');
    }

    logger.info('📊 Using DATABASE_URL for DigitalOcean PostgreSQL connection');
    
    // Parse the DATABASE_URL and override SSL settings for DigitalOcean
    const connectionString = process.env.DATABASE_URL;
    const url = new URL(connectionString);
    
    // Remove sslmode from search params to avoid conflicts
    url.searchParams.delete('sslmode');
    const cleanConnectionString = url.toString();
    
    logger.info(`🔗 Connecting to: ${url.hostname}:${url.port}/${url.pathname.slice(1)}`);
    
    this.pool = new Pool({
      connectionString: cleanConnectionString,
      ssl: {
        rejectUnauthorized: false // DigitalOcean managed databases use self-signed certificates
      },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.pool.on('error', (err) => {
      logger.error('PostgreSQL pool error:', err);
    });
  }

  async connect(): Promise<void> {
    try {
      logger.info('🔌 Attempting PostgreSQL connection...');
      const client = await this.pool.connect();
      logger.info('✅ PostgreSQL connected successfully');
      client.release();
      this.isConnected = true;
      
      logger.info('🔧 Initializing database schema...');
      await this.initializeSchema();
      logger.info('✅ Database initialization complete');
    } catch (error) {
      logger.error('❌ PostgreSQL connection failed:', error);
      
      // Log specific connection details for debugging
      if (error instanceof Error) {
        logger.error(`❌ Error message: ${error.message}`);
        logger.error(`❌ Error code: ${(error as any).code}`);
        logger.error(`❌ Error errno: ${(error as any).errno}`);
        logger.error(`❌ Error syscall: ${(error as any).syscall}`);
        logger.error(`❌ Error address: ${(error as any).address}`);
        logger.error(`❌ Error port: ${(error as any).port}`);
      }
      
      throw error;
    }
  }

  async initializeSchema(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id SERIAL PRIMARY KEY,
        channel_id VARCHAR(20) NOT NULL,
        summary TEXT NOT NULL,
        files_mentioned JSONB NOT NULL DEFAULT '[]'::jsonb,
        last_message_id VARCHAR(20) NOT NULL,
        last_message_timestamp TIMESTAMP NOT NULL,
        context_window_number INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        UNIQUE(channel_id, context_window_number)
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_summaries_channel_id 
      ON conversation_summaries(channel_id);
      
      CREATE INDEX IF NOT EXISTS idx_conversation_summaries_window 
      ON conversation_summaries(channel_id, context_window_number);
    `;

    try {
      await this.pool.query(createTableSQL);
      logger.info('✅ Database schema initialized');
    } catch (error) {
      logger.error('❌ Failed to initialize database schema:', error);
      throw error;
    }
  }

  async createSummary(params: CreateSummaryParams): Promise<ConversationSummary> {
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

    try {
      const result = await this.pool.query(query, [
        channel_id,
        summary,
        JSON.stringify(files_mentioned),
        last_message_id,
        last_message_timestamp,
        context_window_number
      ]);

      logger.info(`📝 Created/updated summary for channel ${channel_id}, window ${context_window_number}`);
      return result.rows[0];
    } catch (error) {
      logger.error('❌ Failed to create summary:', error);
      throw error;
    }
  }

  async getAllSummaries(channel_id: string): Promise<ConversationSummary[]> {
    const query = `
      SELECT * FROM conversation_summaries 
      WHERE channel_id = $1 
      ORDER BY context_window_number ASC
    `;

    try {
      const result = await this.pool.query(query, [channel_id]);
      if (result.rows.length > 0) {
      logger.info(`📚 Retrieved ${result.rows.length} summaries for channel`);
    }
      return result.rows.map(row => ({
        ...row,
        files_mentioned: typeof row.files_mentioned === 'string' 
          ? JSON.parse(row.files_mentioned) 
          : row.files_mentioned
      }));
    } catch (error) {
      logger.error('❌ Failed to get summaries:', error);
      throw error;
    }
  }

  async getLatestSummary(channel_id: string): Promise<ConversationSummary | null> {
    const query = `
      SELECT * FROM conversation_summaries 
      WHERE channel_id = $1 
      ORDER BY context_window_number DESC 
      LIMIT 1
    `;

    try {
      const result = await this.pool.query(query, [channel_id]);
      if (result.rows.length === 0) {
        logger.info(`📭 No summaries found for channel ${channel_id}`);
        return null;
      }

      const summary = result.rows[0];
      logger.info(`📖 Retrieved latest summary for channel ${channel_id}, window ${summary.context_window_number}`);
      return {
        ...summary,
        files_mentioned: typeof summary.files_mentioned === 'string' 
          ? JSON.parse(summary.files_mentioned) 
          : summary.files_mentioned
      };
    } catch (error) {
      logger.error('❌ Failed to get latest summary:', error);
      throw error;
    }
  }

  async getNextContextWindowNumber(channel_id: string): Promise<number> {
    const query = `
      SELECT COALESCE(MAX(context_window_number), 0) + 1 as next_window
      FROM conversation_summaries 
      WHERE channel_id = $1
    `;

    try {
      const result = await this.pool.query(query, [channel_id]);
      const nextWindow = result.rows[0].next_window;
      logger.info(`🔢 Next context window for channel ${channel_id}: ${nextWindow}`);
      return nextWindow;
    } catch (error) {
      logger.error('❌ Failed to get next context window number:', error);
      return 1;
    }
  }

  async deleteSummariesForChannel(channel_id: string): Promise<void> {
    const query = `DELETE FROM conversation_summaries WHERE channel_id = $1`;

    try {
      const result = await this.pool.query(query, [channel_id]);
      logger.info(`🗑️ Deleted ${result.rowCount} summaries for channel ${channel_id}`);
    } catch (error) {
      logger.error('❌ Failed to delete summaries:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (error) {
      logger.error('❌ Database health check failed:', error);
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      await this.pool.end();
      this.isConnected = false;
      logger.info('📊 Database connection closed');
    } catch (error) {
      logger.error('❌ Error closing database connection:', error);
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }
}

export const databaseService = new DatabaseService();
export type { ConversationSummary, FileDescription, CreateSummaryParams }; 