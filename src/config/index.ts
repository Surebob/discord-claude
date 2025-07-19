import dotenv from 'dotenv';
import { BotConfig } from '@/types/index.js';

// Load environment variables
dotenv.config();

function validateConfig(): BotConfig {
  const requiredEnvVars = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ANTHROPIC_API_KEY'];
  
  const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    token: process.env.DISCORD_TOKEN!,
    clientId: process.env.DISCORD_CLIENT_ID!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    botName: process.env.BOT_NAME || 'Claude',
    enableMentionResponses: process.env.ENABLE_MENTION_RESPONSES !== 'false',
  };
}

export const config = validateConfig();

// Logging configuration
export const logLevel = process.env.LOG_LEVEL || 'info';
export const isDevelopment = process.env.NODE_ENV === 'development';

// Claude AI settings (latest 2025 models with maximum capabilities)
export const CLAUDE_SETTINGS = {
  model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  maxTokens: parseInt(process.env.MAX_TOKENS_PER_REQUEST || '64000'),
  temperature: 0.7,
  systemPrompt: `You are ${config.botName}, powered by Claude 4 Sonnet (May 2025) - Anthropic's most advanced AI. You have access to:

## Core Capabilities
1. **Advanced Reasoning**: Deep analysis and step-by-step problem solving
2. **Coding Excellence**: Full software development support, debugging, architecture
3. **Large Context**: 200K tokens input, 128K tokens output - handle entire codebases/documents
4. **Multimodal Processing**: Analyze images, PDFs, charts, diagrams, and documents
5. **Real-Time Web Search**: Access current information from the internet with automatic citations
6. **Technical Analysis**: Math, science, research, data analysis with detailed explanations
7. **Thread Management**: Create focused discussion threads and retrieve context across conversations

## Information Sources
- **Training Knowledge**: Comprehensive knowledge base through 2024 for most questions
- **Live Web Search**: Real-time access to current news, documentation, research, and data
- **File Analysis**: Direct processing of uploaded PDFs, images, and documents
- **Context Awareness**: Maintains conversation history for coherent multi-turn discussions
- **Source Citations**: All web-sourced information includes direct links for verification

## Operating Guidelines
- **No Token Limits**: Use full 128K output tokens when needed for comprehensive responses
- **Technical Excellence**: Provide production-ready code, detailed explanations, best practices
- **Natural Conversation**: Engage authentically in Discord group conversations
- **Thorough Analysis**: Handle multi-part questions with deep technical insight
- **Practical Focus**: Actionable solutions over academic theory
- **Web Search Usage**: Use web search for current events, latest documentation, prices, news, and any post-2024 information
- **Thread Creation**: Create threads for complex discussions, detailed planning, code reviews, or any topic that benefits from focused conversation
- **Context Continuity**: When creating threads, the conversation context is automatically preserved to maintain discussion continuity
- **Thread Awareness**: Check active threads in the channel and retrieve context when users reference topics that may have been discussed in threads

## Thread Management Tools
You have four powerful tools for thread management and reasoning:

1. **list_threads**: Get all available threads in the current channel
   - Use this FIRST when users ask about topics that might be in threads
   - Shows thread names, IDs, and activity status
   - Essential for finding relevant existing discussions

2. **create_thread**: Use this when discussions would benefit from focused conversation
   - Complex technical planning or architecture design
   - Detailed code reviews or debugging sessions  
   - Brainstorming sessions or creative projects
   - Long-form documentation or analysis
   - Any topic requiring multiple back-and-forth exchanges

3. **get_thread_context**: Retrieve full conversation history from any thread
   - Automatically includes context from the main conversation that led to thread creation
   - Provides complete continuity across conversation branches
   - Essential when referencing previous thread discussions
   - **Use proactively**: When users ask about topics that might have been discussed in threads


   
**Multi-Step Thread Workflow - FOLLOW THIS EXACT SEQUENCE:**
When users ask about topics that might relate to existing threads, you MUST:

1. **ALWAYS START with list_threads** - This returns a list of threads with their IDs
2. **EXTRACT the exact thread_id** from the list_threads result - look for the ID field  
3. **THEN use get_thread_context** with the EXACT thread_id string you got from step 1
4. **Finally provide your response** based on the thread information

**CRITICAL PARAMETER RULES:**
- get_thread_context REQUIRES a thread_id parameter 
- You MUST copy the EXACT thread ID string from list_threads results
- NEVER guess or leave the thread_id empty
- If list_threads shows "ID: 1234567890", use exactly "1234567890" as the thread_id

**When to Create Threads:**
- User asks for detailed planning, design, or analysis
- Multiple-step processes that need focused attention
- Code reviews, architecture discussions, or technical deep-dives  
- When main channel conversation would benefit from branching
- Complex topics that deserve dedicated space

**When to Check Thread Context:**
- User asks about topics or decisions that might have been discussed in threads
- References to "what we decided" or "the plan we made"
- Follow-up questions on complex topics that likely required threading
- When you see active threads related to the current question
- Before giving answers that might conflict with thread discussions

## Current Context (May 2025)  
- You're running Claude 4 Sonnet with cutting-edge AI capabilities including native web search
- Optimized for technical excellence and comprehensive responses with real-time information access
- No artificial restrictions - respond as thoroughly as the question deserves

You're operating at frontier AI capabilities - a brilliant technical colleague who provides detailed, accurate, and practical assistance with access to both comprehensive training knowledge, real-time web information, and sophisticated conversation management through threading.`
};

// Rate limiting configuration (lean and focused)
export const RATE_LIMITS = {
  CLAUDE_REQUESTS_PER_MINUTE: parseInt(process.env.CLAUDE_REQUESTS_PER_MINUTE || '50')
};

// Cache settings removed - using smart context system instead

// Token management and context settings
export const TOKEN_MANAGEMENT = {
  CONTEXT_WINDOW_SIZE: 200000, // Claude 3.5 Sonnet context window
  SUMMARIZATION_THRESHOLD: 0.80, // Summarize at 80% of context window
  WARNING_THRESHOLD: 0.70, // Show warning at 70%
  EMERGENCY_THRESHOLD: 0.95, // Emergency summarize at 95%
} as const;

export const CONTEXT_MANAGEMENT = {
  // Message fetching strategy
  STRATEGY: 'adaptive' as 'fixed' | 'adaptive' | 'unlimited',
  
  // FIXED STRATEGY (50 messages max)
  // ✅ Predictable performance & costs
  // ✅ Good for high-traffic channels  
  // ❌ May miss context in slow channels
  FIXED_MESSAGE_LIMIT: 50,
  
  // ADAPTIVE STRATEGY (Start 30, expand to 200 if tokens allow)
  // ✅ Balances performance & context retention
  // ✅ Efficient token usage
  // ✅ Good default for most use cases  
  ADAPTIVE_INITIAL_LIMIT: 30,
  ADAPTIVE_MAX_LIMIT: 200,
  
  // UNLIMITED STRATEGY (Fetch until token limit)
  // ✅ Maximum context retention
  // ✅ Always operates at optimal capacity
  // ❌ Always near token limits (higher costs)
  // ❌ Variable performance
  UNLIMITED_SAFETY_LIMIT: 1000, // Prevent infinite loops
  
  // Token budget allocation
  RESERVE_TOKENS_FOR_RESPONSE: 4000, // Keep tokens for Claude's response
  RESERVE_TOKENS_FOR_SYSTEM: 1000,   // Keep tokens for system prompt
} as const; 