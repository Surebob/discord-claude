/**
 * Database Configuration
 * Centralized settings for PostgreSQL database integration
 */

/**
 * Database connection configuration
 */
export const DATABASE_CONFIG = {
  // Connection settings
  url: process.env.DATABASE_URL,
  
  // Connection pool settings
  pooling: {
    max: parseInt(process.env.DATABASE_MAX_CONNECTIONS || '20'),
    min: parseInt(process.env.DATABASE_MIN_CONNECTIONS || '2'),
    idleTimeoutMillis: parseInt(process.env.DATABASE_IDLE_TIMEOUT || '30000'),
    connectionTimeoutMillis: parseInt(process.env.DATABASE_CONNECTION_TIMEOUT || '10000'),
    acquireTimeoutMillis: parseInt(process.env.DATABASE_ACQUIRE_TIMEOUT || '60000')
  },
  
  // SSL settings for production
  ssl: {
    rejectUnauthorized: process.env.NODE_ENV === 'production' ? true : false,
    // For DigitalOcean and other managed databases
    mode: process.env.DATABASE_SSL_MODE || 'prefer'
  },
  
  // Query settings
  query: {
    timeout: parseInt(process.env.DATABASE_QUERY_TIMEOUT || '30000'),
    maxRetries: parseInt(process.env.DATABASE_MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.DATABASE_RETRY_DELAY || '1000')
  },
  
  // Migration settings
  migrations: {
    directory: 'src/modules/data/migrations',
    tableName: 'schema_migrations',
    autoRun: process.env.DATABASE_AUTO_MIGRATE !== 'false'
  },
  
  // Monitoring settings
  monitoring: {
    enableQueryLogging: process.env.NODE_ENV === 'development',
    slowQueryThreshold: parseInt(process.env.DATABASE_SLOW_QUERY_THRESHOLD || '5000'),
    enableMetrics: process.env.DATABASE_ENABLE_METRICS !== 'false'
  }
} as const;

/**
 * Database schema configuration
 */
export const DATABASE_SCHEMA = {
  // Table names
  tables: {
    conversationSummaries: 'conversation_summaries',
    schemaMigrations: 'schema_migrations'
  },
  
  // Column constraints
  constraints: {
    channelId: {
      type: 'VARCHAR(20)',
      nullable: false
    },
    messageId: {
      type: 'VARCHAR(20)', 
      nullable: false
    },
    summary: {
      type: 'TEXT',
      nullable: false,
      maxLength: 50000
    },
    filesMentioned: {
      type: 'JSONB',
      nullable: false,
      default: '[]'
    }
  },
  
  // Index definitions
  indexes: {
    conversationSummariesChannelId: 'idx_conversation_summaries_channel_id',
    conversationSummariesWindow: 'idx_conversation_summaries_window',
    conversationSummariesTimestamp: 'idx_conversation_summaries_timestamp',
    conversationSummariesCreated: 'idx_conversation_summaries_created'
  }
} as const;

/**
 * Database performance settings
 */
export const DATABASE_PERFORMANCE = {
  // Connection pool optimization
  poolOptimization: {
    // Number of connections to keep alive
    keepAlive: 5,
    
    // How often to check for idle connections (ms)
    idleCheckInterval: 10000,
    
    // Maximum time a connection can be idle before being closed (ms)
    maxIdleTime: 300000, // 5 minutes
    
    // Maximum lifetime of a connection (ms)
    maxLifetime: 3600000 // 1 hour
  },
  
  // Query optimization
  queryOptimization: {
    // Use prepared statements for frequently executed queries
    usePreparedStatements: true,
    
    // Cache query plans
    enableQueryPlanCache: true,
    
    // Maximum number of cached query plans
    maxCachedPlans: 100
  },
  
  // Batch processing settings
  batchProcessing: {
    // Maximum number of operations to batch together
    maxBatchSize: 100,
    
    // Maximum time to wait before processing a batch (ms)
    maxBatchWait: 1000,
    
    // Enable batch processing for inserts
    enableBatchInserts: true,
    
    // Enable batch processing for updates
    enableBatchUpdates: true
  }
} as const;

/**
 * Database health check configuration
 */
export const DATABASE_HEALTH_CHECK = {
  // How often to run health checks (ms)
  interval: 30000, // 30 seconds
  
  // Query to use for health checks
  healthQuery: 'SELECT 1 as health',
  
  // Timeout for health check queries (ms)
  timeout: 5000,
  
  // Number of consecutive failures before marking as unhealthy
  failureThreshold: 3,
  
  // Number of consecutive successes needed to mark as healthy
  successThreshold: 2
} as const;

/**
 * Validate database configuration
 */
export function validateDatabaseConfiguration(): void {
  if (!DATABASE_CONFIG.url) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  
  // Validate URL format
  try {
    const url = new URL(DATABASE_CONFIG.url);
    
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
      throw new Error('Database URL must use postgresql:// or postgres:// protocol');
    }
    
    if (!url.hostname) {
      throw new Error('Database URL must include a hostname');
    }
    
    if (!url.pathname || url.pathname === '/') {
      console.warn('⚠️ Database URL does not specify a database name');
    }
    
  } catch (error) {
    throw new Error(`Invalid DATABASE_URL format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  // Validate connection pool settings
  if (DATABASE_CONFIG.pooling.max < DATABASE_CONFIG.pooling.min) {
    throw new Error('Database max connections cannot be less than min connections');
  }
  
  if (DATABASE_CONFIG.pooling.max > 100) {
    console.warn('⚠️ Database max connections is very high (>100), this may cause issues');
  }
  
  // Parse connection details for logging (without password)
  const url = new URL(DATABASE_CONFIG.url);
  const redactedUrl = `${url.protocol}//${url.username ? '[username]' : ''}${url.username ? '@' : ''}${url.hostname}:${url.port || 5432}${url.pathname}`;
  
  console.log(`📊 Database configured: ${redactedUrl}`);
  console.log(`📊 Connection pool: ${DATABASE_CONFIG.pooling.min}-${DATABASE_CONFIG.pooling.max} connections`);
}

/**
 * Get database connection URL with custom parameters
 */
export function getDatabaseUrl(overrides: Record<string, string> = {}): string {
  if (!DATABASE_CONFIG.url) {
    throw new Error('DATABASE_URL not configured');
  }
  
  const url = new URL(DATABASE_CONFIG.url);
  
  // Apply overrides to search params
  for (const [key, value] of Object.entries(overrides)) {
    url.searchParams.set(key, value);
  }
  
  return url.toString();
}

/**
 * Get connection parameters for pg client
 */
export function getConnectionParams(): any {
  if (!DATABASE_CONFIG.url) {
    throw new Error('DATABASE_URL not configured');
  }
  
  return {
    connectionString: DATABASE_CONFIG.url,
    ssl: DATABASE_CONFIG.ssl.rejectUnauthorized ? {
      rejectUnauthorized: true
    } : {
      rejectUnauthorized: false
    },
    max: DATABASE_CONFIG.pooling.max,
    min: DATABASE_CONFIG.pooling.min,
    idleTimeoutMillis: DATABASE_CONFIG.pooling.idleTimeoutMillis,
    connectionTimeoutMillis: DATABASE_CONFIG.pooling.connectionTimeoutMillis,
    acquireTimeoutMillis: DATABASE_CONFIG.pooling.acquireTimeoutMillis,
    query_timeout: DATABASE_CONFIG.query.timeout,
    application_name: 'discord-claude-bot'
  };
}

/**
 * Check if we're using a managed database service
 */
export function isManagedDatabase(): boolean {
  if (!DATABASE_CONFIG.url) return false;
  
  const url = new URL(DATABASE_CONFIG.url);
  const managedProviders = [
    'db.digitalocean.com',
    'rds.amazonaws.com',
    'postgres.database.azure.com',
    'sql.cloud.google.com',
    'planetscale.com',
    'railway.app',
    'supabase.com'
  ];
  
  return managedProviders.some(provider => url.hostname.includes(provider));
}

/**
 * Get optimal configuration for the detected database provider
 */
export function getOptimalConfiguration(): typeof DATABASE_CONFIG {
  if (isManagedDatabase()) {
    // Create a deep copy for managed databases
    return {
      ...DATABASE_CONFIG,
      pooling: {
        ...DATABASE_CONFIG.pooling,
        max: Math.min(20, DATABASE_CONFIG.pooling.max)
      },
      ssl: {
        ...DATABASE_CONFIG.ssl,
        rejectUnauthorized: true
      },
      query: {
        ...DATABASE_CONFIG.query,
        timeout: 30000
      }
    };
  }
  
  return DATABASE_CONFIG;
} 