import { Database } from '../database';
import { QueryResult, TransactionClient } from '../types';
import { logger } from '../../infra';

/**
 * Base Repository
 * Provides common database operations and utilities for all repositories
 */
export abstract class BaseRepository<T = any> {
  protected database: Database;
  protected tableName: string;

  constructor(database: Database, tableName: string) {
    this.database = database;
    this.tableName = tableName;
  }

  /**
   * Execute a query with parameters
   */
  protected async executeQuery<R = any>(text: string, params?: any[]): Promise<QueryResult<R>> {
    try {
      const result = await this.database.query(text, params);
      return result;
    } catch (error) {
      logger.error('Repository query error:', {
        repository: this.constructor.name,
        table: this.tableName,
        query: text,
        params,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Execute a query with parameters (alias for backward compatibility)
   */
  protected async query<R = any>(text: string, params?: any[]): Promise<QueryResult<R>> {
    return this.executeQuery<R>(text, params);
  }

  /**
   * Abstract method to map database row to entity
   */
  protected abstract mapRowToEntity(row: any): T;

  /**
   * Execute a query and return a single row
   */
  protected async querySingle<R = any>(text: string, params?: any[]): Promise<R | null> {
    const result = await this.query<R>(text, params);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Execute a query and return multiple rows
   */
  protected async queryMany<R = any>(text: string, params?: any[]): Promise<R[]> {
    const result = await this.query<R>(text, params);
    return result.rows;
  }

  /**
   * Execute a query and return the first row
   */
  protected async queryFirst<R = any>(text: string, params?: any[]): Promise<R> {
    const result = await this.query<R>(text, params);
    if (result.rows.length === 0) {
      throw new Error('No rows returned from query');
    }
    return result.rows[0];
  }

  /**
   * Get a transaction client
   */
  protected async getTransaction(): Promise<TransactionClient> {
    return await this.database.getClient();
  }

  /**
   * Execute operations within a transaction
   */
  protected async withTransaction<T>(callback: (client: TransactionClient) => Promise<T>): Promise<T> {
    const client = await this.getTransaction();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Parse JSON field safely
   */
  protected parseJsonField<R>(value: any, defaultValue: R): R {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (error) {
        logger.warn('Failed to parse JSON field, using default value', {
          value,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        return defaultValue;
      }
    }
    return value || defaultValue;
  }

  /**
   * Build WHERE clause from conditions
   */
  protected buildWhereClause(conditions: Record<string, any>): { clause: string; params: any[] } {
    const keys = Object.keys(conditions).filter(key => conditions[key] !== undefined);
    
    if (keys.length === 0) {
      return { clause: '', params: [] };
    }

    const clause = keys.map((key, index) => `${key} = $${index + 1}`).join(' AND ');
    const params = keys.map(key => conditions[key]);

    return { clause: `WHERE ${clause}`, params };
  }

  /**
   * Build ORDER BY clause
   */
  protected buildOrderClause(orderBy?: string, direction: 'ASC' | 'DESC' = 'ASC'): string {
    if (!orderBy) return '';
    return `ORDER BY ${orderBy} ${direction}`;
  }

  /**
   * Build LIMIT clause
   */
  protected buildLimitClause(limit?: number, offset?: number): string {
    let clause = '';
    if (limit) clause += `LIMIT ${limit}`;
    if (offset) clause += ` OFFSET ${offset}`;
    return clause;
  }

  /**
   * Log repository operation
   */
  protected logOperation(operation: string, details?: Record<string, any>): void {
    logger.info(`Repository operation: ${operation}`, {
      repository: this.constructor.name,
      operation,
      ...details
    });
  }
} 