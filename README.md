# 🤖 Discord-Claude Bot

A production-grade Discord bot powered by **Claude 4 Sonnet (January 2025)** - Anthropic's most advanced AI with hybrid reasoning, 200K context, native file processing, **real-time web search**, and **intelligent conversation management**. Built with Bun, TypeScript, and PostgreSQL for enterprise-scale performance.

> **Note**: Engineered for Claude 4 Sonnet's cutting-edge capabilities! Features adaptive context building, conversation summarization, thread management, document deduplication, and Carmack-level code optimization.

## ✨ Features

### 🧠 **Advanced AI Capabilities**
- **Claude 4 Sonnet (2025)** - Latest AI model with 200K context, 128K output
- **🌐 Real-Time Web Search** - Native internet access with automatic citations
- **🧵 Thread Management** - Create, list, and manage Discord threads dynamically
- **⚡ Advanced Reasoning** - Deep analysis and step-by-step problem solving
- **🎯 Coding Excellence** - Full software development support, debugging, architecture

### 📊 **Intelligent Context Management**
- **🔄 Adaptive Context Building** - Smart message selection based on conversation length
- **📝 Conversation Summarization** - PostgreSQL-powered conversation memory
- **🗂️ Document Deduplication** - Intelligent file processing across conversation history
- **📏 Accurate Token Counting** - Precise token tracking using Anthropic's API
- **💾 Persistent Memory** - Long-term conversation context with automatic summarization

### 📁 **Advanced File Processing**
- **Native PDF Processing** - Direct PDF, image, and document analysis via Claude's API
- **📎 Smart Document Handling** - Automatic deduplication and context preservation
- **🔍 History Scanning** - Processes attachments from recent conversation history
- **📊 Multi-format Support** - Text, PDF, images, charts, and diagrams

### 🚀 **Production Features**
- **💬 Smart Mention Detection** - Natural conversation flow in group chats
- **📈 Intelligent Rate Limiting** - API abuse prevention with exponential backoff
- **🗄️ PostgreSQL Integration** - Robust data persistence and conversation management
- **🔄 Graceful Error Handling** - Comprehensive error recovery and retry logic
- **📊 Detailed Logging** - Production-ready monitoring and debugging

## 🚀 Quick Start

### Prerequisites

- **Bun 1.0+** ([Install Bun](https://bun.sh/docs/installation))
- **PostgreSQL Database** (Local or cloud-hosted like DigitalOcean)
- **Discord Bot Token** ([Discord Developer Portal](https://discord.com/developers/applications))
- **Anthropic API Key** ([Anthropic Console](https://console.anthropic.com/))

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd discord-claude-bot
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Configure environment**
   ```bash
   cp env.example .env
   # Edit .env with your API keys and database URL
   ```

4. **Set up PostgreSQL Database**
   ```bash
   # The bot will automatically create tables on first run
   # Just ensure your DATABASE_URL is correct in .env
   ```

5. **Build the project**
   ```bash
   bun run build
   ```

6. **Start the bot**
   ```bash
   bun start
   ```

### Development Mode

For development with hot reload:

```bash
bun run dev
```

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| **Core Configuration** |
| `DISCORD_TOKEN` | ✅ | Your Discord bot token |
| `DISCORD_CLIENT_ID` | ✅ | Your Discord application ID |
| `ANTHROPIC_API_KEY` | ✅ | Your Anthropic API key |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| **Bot Behavior** |
| `BOT_NAME` | ❌ | Bot display name (default: "Claude") |
| `ENABLE_MENTION_RESPONSES` | ❌ | Respond to mentions (default: true) |
| `ENABLE_WEB_SEARCH` | ❌ | Enable web search capabilities (default: true) |
| **Performance & Limits** |
| `CLAUDE_REQUESTS_PER_MINUTE` | ❌ | Rate limit for Claude requests (default: 50) |
| `MAX_TOKENS_PER_REQUEST` | ❌ | Maximum tokens per request (default: 128000) |
| `ADAPTIVE_CONTEXT_SIZE` | ❌ | Base context size for adaptive building (default: 30) |
| **Advanced Settings** |
| `CLAUDE_MODEL` | ❌ | Claude model to use (default: claude-4-sonnet-20250719) |
| `LOG_LEVEL` | ❌ | Logging level (default: "info") |
| `SUMMARY_TRIGGER_LENGTH` | ❌ | Messages before summarization (default: 50) |

### PostgreSQL Database Setup

The bot requires a PostgreSQL database for conversation management:

**Option 1: Local PostgreSQL**
```bash
# Install PostgreSQL locally
createdb discord_claude
export DATABASE_URL="postgresql://username:password@localhost:5432/discord_claude"
```

**Option 2: Cloud Database (Recommended)**
```bash
# Use DigitalOcean, AWS RDS, or similar
export DATABASE_URL="postgresql://user:pass@host:port/dbname?sslmode=require"
```

The bot automatically creates the required tables on startup.

### Discord Bot Setup

1. **Create Discord Application**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Click "New Application" and give it a name
   - Copy the Application ID for `DISCORD_CLIENT_ID`

2. **Create Bot User**
   - Navigate to "Bot" section
   - Click "Add Bot"
   - Copy the token for `DISCORD_TOKEN`
   - Enable "Message Content Intent" under "Privileged Gateway Intents"

3. **Invite Bot to Server**
   - Go to "OAuth2" > "URL Generator"
   - Select scopes: `bot`
   - Select permissions: `Send Messages`, `Read Message History`, `Manage Threads`
   - Use generated URL to invite bot

### Anthropic API Setup

1. **Get API Key**
   - Sign up at [Anthropic Console](https://console.anthropic.com/)
   - Navigate to "API Keys"
   - Create new key and copy for `ANTHROPIC_API_KEY`

## 🎮 Usage

### @Mention Conversations

Simply mention the bot in any channel or DM for natural conversations:

```
You: @Claude what do you think about quantum computing?
Claude: Quantum computing is a fascinating field that leverages quantum mechanics...

Your Friend: @Claude can you explain that in simpler terms?
Claude: Of course! Think of quantum computing like this...

You: @Claude what are the latest developments in this field?
Claude: 🌐 *Searches web for latest quantum computing news*
Based on recent developments, here are the key breakthroughs...
```

### Thread Management

Create and manage Discord threads dynamically:

```
You: @Claude create a thread called "Project Planning" for discussing our new app
Claude: ✅ Created thread "Project Planning" 
*[New thread appears with Claude's welcome message]*

You: @Claude list all threads in this channel
Claude: 📋 Here are the active threads:
1. "Project Planning" - Created 2 minutes ago
2. "Bug Reports" - Created 1 hour ago
...

You: @Claude get context from the "Bug Reports" thread
Claude: 📖 Here's what's been discussed in "Bug Reports":
*[Summary of thread conversation]*
```

### Web Search Integration

Claude can search the web for real-time information:

```
You: @Claude what's the weather in Tokyo right now?
Claude: 🌐 *Searches for current Tokyo weather*
Current weather in Tokyo: 15°C, partly cloudy...

You: @Claude latest news about AI developments
Claude: 🌐 *Searches for recent AI news*
Here are the latest AI developments from this week...
```

### Perfect for Group DMs

The bot is designed for natural group conversations:
- **Context Awareness**: Remembers the entire conversation flow with summarization
- **Multi-user Support**: Responds to anyone who mentions it
- **Adaptive Context**: Automatically adjusts context size based on conversation length
- **Document Memory**: Remembers files shared across the conversation

## 📁 Advanced File Handling

This bot leverages **Claude's native file processing** with intelligent deduplication and context management!

### Supported File Types

**📄 Documents:**
- **PDF files** (up to 32MB, 100 pages) - Full text and visual analysis
- **Text files** (.txt, .md, .json, .html, .rtf, .csv) - Direct content extraction

**🖼️ Images:**
- **Image formats** (.png, .jpg, .jpeg, .gif, .webp) - Up to 30MB, 8000x8000 pixels
- **Charts & diagrams** - Claude can interpret graphs, flowcharts, screenshots

### Smart Document Processing

**Automatic Deduplication:**
```
User 1: [uploads report.pdf]
User 2: [uploads same report.pdf again]
You: @Claude analyze that report
Claude: ✅ *Processes the document once, ignores duplicate*
```

**Context Preservation:**
- Documents remain in context across conversation
- Smart attachment scanning from recent message history
- Efficient token usage through deduplication
- Persistent document memory with conversation summaries

**Example Use Cases:**
- 📊 **"Compare these quarterly reports"** - Upload multiple PDFs for analysis
- 🎨 **"What changed in this UI mockup?"** - Reference previous screenshots
- 📝 **"Continue our discussion about that research paper"** - Long-form document analysis
- 💼 **"Update the contract based on our conversation"** - Iterative document editing
- 🗂️ **"Extract trends from these data files"** - Multi-file data analysis

## 🧠 Intelligent Context Management

### Adaptive Context Building

The bot intelligently manages conversation context:

- **🔄 Dynamic Sizing**: Adjusts context window based on conversation activity
- **📝 Smart Summarization**: Automatically creates conversation summaries
- **🗂️ Document Integration**: Seamlessly includes relevant files in context
- **📏 Token Optimization**: Precise token counting for maximum efficiency

### Conversation Memory

**How It Works:**
1. **Active Context**: Recent messages (default: 30) kept in full detail
2. **Summarization**: Older conversations automatically summarized
3. **Document Persistence**: Important files remain accessible
4. **Context Switching**: Adapts to conversation patterns and user behavior

**Benefits:**
- **Long Conversations**: No context loss in extended discussions
- **Multi-Session Memory**: Remembers across bot restarts
- **Efficient Token Usage**: Optimal balance of detail and efficiency
- **Seamless Experience**: Users never notice context management happening

## 🏗️ Architecture

### Project Structure

```
src/
├── client/           # Discord client management and event handling
├── config/           # Configuration and environment handling
├── services/         # Core services (Claude, database, conversation)
│   ├── claude.ts     # Claude API integration with streaming
│   ├── database.ts   # PostgreSQL service for conversation persistence
│   └── ...
├── types/            # TypeScript type definitions
├── utils/            # Utilities (logging, rate limiting)
└── index.ts          # Main entry point
```

### Key Components

- **DiscordClientManager**: Handles Discord events, mention detection, and thread management
- **ClaudeService**: Advanced Claude API integration with streaming, tools, and multimodal processing
- **DatabaseService**: PostgreSQL integration for conversation summaries and persistence
- **RateLimitService**: Intelligent rate limiting with exponential backoff
- **Logger**: Comprehensive logging with structured output and multiple levels

### Advanced Claude Integration

**Streaming Responses:**
- Real-time message streaming for responsive user experience
- Tool usage detection and execution (web search, thread management)
- Proper handling of server-side tools vs client-side tools

**Token Management:**
- Accurate token counting using Anthropic's token counting API
- Smart context building to maximize available tokens
- Adaptive response sizing based on available token budget

**Error Handling:**
- Exponential backoff for rate limiting
- Graceful degradation for API issues
- Comprehensive logging for debugging

## 🚀 Deployment

### Using Docker

```dockerfile
FROM oven/bun:1-alpine
WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./
RUN bun install --production

# Copy built application
COPY dist/ ./dist/

# Set environment
ENV NODE_ENV=production

# Start the bot
CMD ["bun", "start"]
```

**Docker Compose Example:**
```yaml
version: '3.8'
services:
  discord-claude:
    build: .
    environment:
      - DATABASE_URL=postgresql://user:pass@postgres:5432/discord_claude
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    depends_on:
      - postgres
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=discord_claude
      - POSTGRES_USER=discord_user
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
```

### Using PM2

```bash
bun add -g pm2
bun run build
pm2 start dist/index.js --name discord-claude-bot
pm2 save
pm2 startup
```

### Environment Considerations

- **Production**: Set `NODE_ENV=production`
- **Database**: Use connection pooling for high-traffic deployments
- **Logging**: Configure appropriate log levels and rotation
- **Rate Limits**: Adjust based on your user base and API quotas
- **Memory**: Monitor conversation cache and summary storage

## 📊 Monitoring & Observability

### Comprehensive Logging

The bot generates structured logs with multiple levels:

**Log Levels:**
- `error`: Critical errors requiring immediate attention
- `warn`: Warnings about rate limits, API issues, performance
- `info`: General operation information, feature usage
- `debug`: Detailed debugging information for development

**Log Outputs:**
- Console (formatted for development)
- `logs/combined.log` (all logs with rotation)
- `logs/error.log` (errors only)
- Structured JSON format for log aggregation

### Performance Metrics

**Built-in Monitoring:**
- 📊 **Token Usage Tracking**: Detailed breakdown of context vs response tokens
- ⏱️ **Response Time Monitoring**: Track Claude API response times
- 🔄 **Rate Limit Monitoring**: Real-time rate limit status and warnings
- 💾 **Memory Usage**: Conversation cache and database connection monitoring
- 🌐 **Web Search Usage**: Track search frequency and costs

**Health Checks:**
- Discord connection status and heartbeat
- Claude API availability and rate limits
- PostgreSQL connection and query performance
- Memory usage and cleanup cycles

### Example Log Output

```
2025-01-19 10:29:35 [info]: 🧠 Context built (adaptive): 0 summaries, 30 messages, 2 documents
2025-01-19 10:29:35 [info]: 📊 Token breakdown: 0+6096+26687+1000 = 33783 total
2025-01-19 10:29:35 [info]: 🎯 Available for response: 166217 tokens (83.1% remaining)
2025-01-19 10:29:35 [info]: 🤖 Generating Claude response with web search
2025-01-19 10:29:36 [info]: 🌐 Server-side tools (handled by Anthropic): web_search
2025-01-19 10:29:38 [info]: ✅ Response completed: 1247 tokens in 2.3s
```

## 🛡️ Security & Best Practices

### Security Features

- **🔐 Environment Security**: All sensitive data in environment variables
- **🛡️ Input Validation**: Comprehensive validation of all user inputs
- **📝 Audit Logging**: Complete audit trail of all bot interactions
- **🚫 Rate Limiting**: Multi-layered protection against abuse
- **🔒 Database Security**: Parameterized queries and connection encryption

### Best Practices

**API Key Management:**
- Store keys in environment variables, never in code
- Use different keys for development and production
- Rotate keys regularly and monitor usage

**Database Security:**
- Use SSL/TLS for database connections
- Implement proper user permissions
- Regular backups and monitoring

**Error Handling:**
- Never expose internal errors to users
- Comprehensive logging for debugging
- Graceful degradation for service outages

## 🔧 Development

### Scripts

```bash
bun run dev          # Development with hot reload
bun run build        # Build for production
bun run start        # Start production build
bun run lint         # Run ESLint
bun run format       # Format code with Prettier
bun run test         # Run test suite (when implemented)
```

### Development Features

**Hot Reload:**
- Automatic restart on file changes
- Preserves database connections
- Fast iteration cycles

**Debug Mode:**
```bash
LOG_LEVEL=debug bun run dev
```

**Database Management:**
```bash
# View conversation summaries
psql $DATABASE_URL -c "SELECT * FROM conversation_summaries;"

# Clean old summaries (example)
psql $DATABASE_URL -c "DELETE FROM conversation_summaries WHERE created_at < NOW() - INTERVAL '30 days';"
```

### Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes following TypeScript best practices
4. Add tests if applicable
5. Run linting and formatting (`bun run lint && bun run format`)
6. Update documentation as needed
7. Submit a pull request with detailed description

## 📋 Troubleshooting

### Common Issues

**Bot not responding to mentions:**
- ✅ Check `ENABLE_MENTION_RESPONSES` is true
- ✅ Verify "Message Content Intent" is enabled in Discord Developer Portal
- ✅ Check bot permissions: `Send Messages`, `Read Message History`, `Manage Threads`
- ✅ Review logs for error messages

**Database connection issues:**
- ✅ Verify `DATABASE_URL` format: `postgresql://user:pass@host:port/dbname`
- ✅ Check PostgreSQL server is running and accessible
- ✅ Ensure SSL mode is correctly configured
- ✅ Review connection pool settings

**Claude API errors:**
- ✅ Verify `ANTHROPIC_API_KEY` is correct and active
- ✅ Check API quota and billing status
- ✅ Monitor rate limits in logs
- ✅ Ensure model name is correct (`claude-4-sonnet-20250719`)

**Web search not working:**
- ✅ Verify `ENABLE_WEB_SEARCH` is true
- ✅ Check Anthropic account has web search enabled
- ✅ Monitor for rate limiting or quota issues
- ✅ Review tool execution logs

**High memory usage:**
- ✅ Monitor conversation cache size in logs
- ✅ Check database connection pooling
- ✅ Review document attachment processing
- ✅ Consider restarting periodically for very high-traffic usage

**Thread management issues:**
- ✅ Ensure bot has `Manage Threads` permission
- ✅ Check if trying to create threads within threads (not supported)
- ✅ Verify channel type supports thread creation

### Debug Mode

Enable comprehensive debugging:
```bash
NODE_ENV=development LOG_LEVEL=debug bun run dev
```

### Performance Optimization

**For High-Traffic Servers:**
- Increase PostgreSQL connection pool size
- Adjust `ADAPTIVE_CONTEXT_SIZE` based on usage patterns
- Monitor token usage and optimize context building
- Consider horizontal scaling with multiple bot instances

## 🆕 Recent Updates

### Version 2.0 Features

- **🧵 Thread Management**: Create, list, and manage Discord threads
- **🌐 Real-Time Web Search**: Native internet access with citations
- **📊 Adaptive Context**: Intelligent context size management
- **🗄️ PostgreSQL Integration**: Persistent conversation memory
- **🗂️ Document Deduplication**: Smart file processing
- **📏 Accurate Token Counting**: Precise Anthropic API token tracking
- **🔄 Advanced Error Handling**: Exponential backoff and retry logic
- **📝 Conversation Summarization**: Long-term memory management

### Breaking Changes from v1.x

- PostgreSQL database now required
- Environment variable changes (see configuration section)
- New permission requirements (`Manage Threads`)

## 📄 License

MIT License - feel free to use this in your own projects!

## 🙏 Acknowledgments

- **Anthropic** for the incredible Claude AI models and multimodal capabilities
- **Discord.js** for the excellent Discord API wrapper
- **PostgreSQL** for robust data persistence
- **Bun** for blazing-fast JavaScript runtime
- **John Carmack** for the inspiration to build something exceptional

---

*Built with ❤️ for the Discord and AI community*

*"Programs must be written for people to read, and only incidentally for machines to execute." - Harold Abelson* 