import { Pool } from 'pg';
import { logger } from '../infra';

/**
 * Database Connection Manager
 * Centralized PostgreSQL connection and configuration management
 */
export class Database {
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
    
    // Secure SSL configuration - only allow insecure connections in development
    const sslConfig = process.env.NODE_ENV === 'production' 
      ? true  // Use full SSL verification in production
      : {     // Allow self-signed certs only in development
          rejectUnauthorized: false
        };
    
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('⚠️ Using insecure SSL configuration - development mode only');
    }
    
    this.pool = new Pool({
      connectionString: cleanConnectionString,
      ssl: sslConfig,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.pool.on('error', (err) => {
      logger.error('PostgreSQL pool error:', err);
    });
  }

  /**
   * Connect to the database
   */
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

  /**
   * Initialize database schema using migrations
   */
  async initializeSchema(): Promise<void> {
    try {
      // Import migration runner here to avoid circular dependencies
      const { runMigrations } = await import('./migrations/migration-runner.js');
      
      logger.info('🔧 Initializing database schema with migrations...');
      const results = await runMigrations(this);
      
      if (results.length === 0) {
        logger.info('✅ Database schema is up to date');
      } else {
        const successful = results.filter(r => r.status === 'applied').length;
        const failed = results.filter(r => r.status === 'failed').length;
        
        if (failed > 0) {
          throw new Error(`Database migration failed: ${failed} migrations failed`);
        }
        
        logger.info(`✅ Database schema initialized: ${successful} migrations applied`);
      }
    } catch (error) {
      logger.error('❌ Failed to initialize database schema:', error);
      throw error;
    }
  }

  /**
   * Execute a query
   */
  async query(text: string, params?: any[]): Promise<any> {
    try {
      const result = await this.pool.query(text, params);
      return result;
    } catch (error) {
      logger.error('Database query error:', { query: text, params, error });
      throw error;
    }
  }

  /**
   * Get a client from the pool for transactions
   */
  async getClient() {
    return await this.pool.connect();
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (error) {
      logger.error('❌ Database health check failed:', error);
      return false;
    }
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    try {
      await this.pool.end();
      this.isConnected = false;
      logger.info('📊 Database connection closed');
    } catch (error) {
      logger.error('❌ Error closing database connection:', error);
    }
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }
}

// NOTE: No global singleton exported - use DI container to resolve Database
// Example: const database = await container.resolve<Database>('database'); 