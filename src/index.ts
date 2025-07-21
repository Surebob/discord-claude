import { app } from './core/application';
import { logger } from './modules/infra/logging';

async function main() {
  try {
    // Initialize and start the application using the new orchestrator
    await app.initialize();
    await app.start();
    
    logger.info('🚀 Discord Claude Bot started successfully');
    
  } catch (error) {
    logger.error('Failed to start application:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  try {
    await app.shutdown();
    logger.info('Application shut down successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  try {
    await app.shutdown();
    logger.info('Application shut down successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Start the application
main(); 