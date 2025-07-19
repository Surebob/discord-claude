# 🤖 Discord-Claude Bot

A lean Discord bot powered by **Claude 4 Sonnet (January 2025)** - Anthropic's most advanced AI with hybrid reasoning, 200K context, native file processing, and **real-time web search** capabilities. Built with Bun and TypeScript for maximum performance.

> **Note**: Optimized for Claude 4 Sonnet's native capabilities! Features mention-based interaction, direct file processing, and Carmack-level code efficiency. Every component engineered for performance and maintainability.

## ✨ Features

- 🧠 **Claude 4 Sonnet (2025)** - Latest AI model with 200K context, 128K output
- 🌐 **Real-Time Web Search** - Native internet access with automatic citations ($10/1000 searches)
- ⚡ **Advanced Reasoning** - Deep analysis and step-by-step problem solving
- 🎯 **Coding Excellence** - Full software development support, debugging, architecture
- 📁 **Native File Processing** - Direct PDF, image, and document analysis via Claude's API
- 💬 **Smart Mention Detection** - Responds naturally when mentioned in group conversations
- 📈 **Rate Limiting** - Intelligent rate limiting to prevent API abuse
- 🧵 **Conversation Context** - Maintains conversation history for better responses
- 🔄 **Graceful Error Handling** - Robust error handling with detailed logging
- 📊 **Production Ready** - Comprehensive logging, monitoring, and deployment support

## 🚀 Quick Start

### Prerequisites

- **Bun 1.0+** ([Install Bun](https://bun.sh/docs/installation))
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
   # Edit .env with your API keys
   ```

4. **Build the project**
   ```bash
   bun run build
   ```

5. **Clear any existing slash commands** (optional)
   ```bash
   bun run clear-commands
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
| `DISCORD_TOKEN` | ✅ | Your Discord bot token |
| `DISCORD_CLIENT_ID` | ✅ | Your Discord application ID |
| `ANTHROPIC_API_KEY` | ✅ | Your Anthropic API key |
| `BOT_NAME` | ❌ | Bot display name (default: "Claude") |
| `ENABLE_MENTION_RESPONSES` | ❌ | Respond to mentions (default: true) |
| `CLAUDE_REQUESTS_PER_MINUTE` | ❌ | Rate limit for Claude requests (default: 50) |
| `MAX_TOKENS_PER_REQUEST` | ❌ | Maximum tokens per request (default: 128000) |
| `CLAUDE_MODEL` | ❌ | Claude model to use (default: claude-4-sonnet-20250719) |
| `LOG_LEVEL` | ❌ | Logging level (default: "info") |

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
   - Select permissions: `Send Messages`, `Read Message History`
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
Claude: Let me share some recent developments in quantum computing...
```

### Perfect for Group DMs

The bot is designed for natural group conversations:
- **Context Awareness**: Remembers the conversation flow
- **Multi-user Support**: Responds to anyone who mentions it
- **Natural Flow**: No commands needed, just mention @Claude
- Respond naturally in the conversation flow

## 📁 File Handling

This bot leverages **Claude's native file processing** capabilities - no custom backend processing required!

### Supported File Types

**📄 Documents:**
- **PDF files** (up to 32MB, 100 pages) - Full text and visual analysis
- **Text files** (.txt, .md, .json, .html, .rtf) - Direct content extraction

**🖼️ Images:**
- **Image formats** (.png, .jpg, .jpeg, .gif, .webp) - Up to 30MB, 8000x8000 pixels
- **Charts & diagrams** - Claude can interpret graphs, flowcharts, screenshots

### How It Works

**Natural Conversation Flow:**
```
User: [uploads important-document.pdf]
User: @Claude can you summarize the key points from that PDF?
Claude: ✅ [Analyzes the PDF content and provides summary]
```

**Smart History Scanning:**
- Bot automatically detects files from recent chat history (last 10 messages)
- No need to re-upload files for follow-up questions
- Works with files uploaded by any user in the conversation

**Example Use Cases:**
- 📊 **"Analyze this quarterly report"** - Upload financial PDFs
- 🎨 **"What's in this screenshot?"** - Share UI mockups or diagrams  
- 📝 **"Summarize this research paper"** - Upload academic documents
- 💼 **"Review this contract"** - Upload legal documents
- 🗂️ **"Extract data from this chart"** - Share graphs and visualizations

### Technical Implementation

The bot uses Claude's native multimodal API:
- **No custom parsing** - Claude handles PDF text/image extraction
- **No RAG pipeline** - Direct document understanding
- **32MB file limit** - Matches Claude's native limits
- **Automatic optimization** - Files processed efficiently by Claude's infrastructure

This approach provides superior accuracy compared to traditional RAG systems while requiring zero additional infrastructure.

## 🏗️ Architecture

### Project Structure

```
src/
├── client/           # Discord client management  
├── config/           # Configuration and environment handling
├── services/         # Core services (Claude, conversation management)
├── types/            # TypeScript type definitions
├── utils/            # Utilities (logging, rate limiting)
└── index.ts          # Main entry point
```

### Key Components

- **DiscordClientManager**: Handles Discord events, message processing, and mention detection
- **ClaudeService**: Manages Claude API interactions and multimodal processing
- **ConversationManager**: Maintains conversation context and history
- **RateLimitService**: Prevents API abuse with intelligent rate limiting
- **Logger**: Comprehensive logging with different levels and outputs

### Claude Integration

This bot uses Claude 4 Sonnet's advanced multimodal capabilities through the official Anthropic API. Features include:

- **Direct API Integration**: Uses Claude's native file processing and reasoning capabilities
- **Multimodal Support**: Handles text, images, PDFs, and documents natively
- **Context Awareness**: Maintains conversation history for better responses
- **Hybrid Reasoning**: Leverages Claude 4's advanced thinking capabilities
- **Production Scale**: Designed for reliable, high-volume usage

## 🚀 Deployment

### Using Docker

```dockerfile
# Example Dockerfile (create this file)
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --production
COPY dist/ ./dist/
CMD ["bun", "start"]
```

### Using PM2

```bash
bun add -g pm2
bun run build
pm2 start dist/index.js --name discord-claude-bot
```

### Environment Considerations

- **Production**: Set `NODE_ENV=production`
- **Logging**: Configure appropriate log levels
- **Rate Limits**: Adjust based on your user base
- **Memory**: Monitor conversation cache size

## 📊 Monitoring

### Logs

The bot generates structured logs with different levels:
- `error`: Critical errors that require attention
- `warn`: Warnings about rate limits, API issues
- `info`: General operation information
- `debug`: Detailed debugging information

Logs are written to:
- Console (formatted for development)
- `logs/combined.log` (all logs)
- `logs/error.log` (errors only)

### Health Checks

The bot includes built-in health checks:
- Discord connection status
- Claude API availability
- Memory usage monitoring
- Rate limit status

## 🛡️ Security

- **Environment Variables**: Never commit API keys
- **Rate Limiting**: Prevents abuse and API quota exhaustion
- **Input Validation**: All user inputs are validated
- **Error Handling**: Graceful error handling prevents crashes
- **Logging**: Comprehensive audit trail

## 🔧 Development

### Scripts

- `bun run dev` - Development with hot reload
- `bun run build` - Build for production  
- `bun run clear-commands` - Clear any existing slash commands
- `bun run lint` - Run ESLint
- `bun run format` - Format code with Prettier

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run linting and formatting
6. Submit a pull request

## 📋 Troubleshooting

### Common Issues

**Bot not responding to mentions:**
- Check `ENABLE_MENTION_RESPONSES` is true
- Verify "Message Content Intent" is enabled
- Check bot permissions in the channel

**Rate limiting issues:**
- Check rate limit settings in config
- Monitor logs for rate limit warnings
- Adjust `CLAUDE_REQUESTS_PER_MINUTE` based on usage

**Claude API errors:**
- Verify `ANTHROPIC_API_KEY` is correct
- Check API quota and billing
- Monitor rate limits

**High memory usage:**
- Adjust `MAX_CACHED_CONVERSATIONS` in config
- Monitor conversation cleanup logs
- Consider restarting periodically

### Debug Mode

Enable debug logging:
```bash
NODE_ENV=development LOG_LEVEL=debug bun run dev
```

## 📄 License

MIT License - feel free to use this in your own projects!

## 🙏 Acknowledgments

- **Anthropic** for the incredible Claude AI models
- **Discord.js** for the excellent Discord API wrapper
- **John Carmack** for the inspiration to build something exceptional

---

*Built with ❤️ for the Discord and AI community* 