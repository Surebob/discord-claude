-- Migration: 001-initial-schema.sql
-- Description: Initial database schema for Discord Claude bot
-- Created: 2025-01-19
-- Author: Discord Claude Bot Migration System

-- Create conversation summaries table
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
  
  -- Ensure unique combination of channel and context window
  UNIQUE(channel_id, context_window_number)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_channel_id 
ON conversation_summaries(channel_id);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_window 
ON conversation_summaries(channel_id, context_window_number);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_timestamp 
ON conversation_summaries(last_message_timestamp);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_created 
ON conversation_summaries(created_at);

-- Create function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at on row updates
DROP TRIGGER IF EXISTS update_conversation_summaries_updated_at ON conversation_summaries;
CREATE TRIGGER update_conversation_summaries_updated_at
    BEFORE UPDATE ON conversation_summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create migrations tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  description TEXT,
  applied_at TIMESTAMP DEFAULT NOW(),
  checksum VARCHAR(64)
);

-- Record this migration
INSERT INTO schema_migrations (version, description, checksum) 
VALUES ('001', 'Initial schema with conversation summaries', '001-initial-schema-v1')
ON CONFLICT (version) DO NOTHING;

-- Grant permissions (adjust as needed for your environment)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_summaries TO discord_claude_app;
-- GRANT USAGE, SELECT ON SEQUENCE conversation_summaries_id_seq TO discord_claude_app; 