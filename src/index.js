// Main application entry point
// This file will initialize the API server and worker processes

import { startServer } from './api/server.js';
import { startScrapingWorker } from './worker/processor.js';
import { config } from './config.js';

console.log('🚀 High-Performance Web Scraper - Starting...');
console.log(`📊 Environment: ${config.NODE_ENV}`);
console.log(`🖥️ Process ID: ${process.pid}`);

/**
 * Determines the application mode based on environment variables or command line arguments
 * @returns {string} Application mode: 'api', 'worker', or 'both'
 */
function getAppMode() {
  // Check environment variable first
  if (process.env.APP_MODE) {
    return process.env.APP_MODE.toLowerCase();
  }
  
  // Check command line arguments
  const args = process.argv.slice(2);
  if (args.includes('--mode=api') || args.includes('api')) {
    return 'api';
  }
  if (args.includes('--mode=worker') || args.includes('worker')) {
    return 'worker';
  }
  if (args.includes('--mode=both') || args.includes('both')) {
    return 'both';
  }
  
  // Default mode
  return 'api';
}

/**
 * Starts the API server
 */
async function startApiMode() {
  try {
    console.log('🌐 Starting API server mode...');
    await startServer();
    console.log('✅ API server started successfully');
  } catch (error) {
    console.error('❌ Failed to start API server:', error);
    throw error;
  }
}

/**
 * Starts the worker process
 */
async function startWorkerMode() {
  try {
    console.log('👷 Starting worker mode...');
    await startScrapingWorker();
    console.log('✅ Worker started successfully');
  } catch (error) {
    console.error('❌ Failed to start worker:', error);
    throw error;
  }
}

/**
 * Starts both API server and worker
 */
async function startBothMode() {
  try {
    console.log('🔄 Starting both API server and worker...');
    
    // Start API server
    await startApiMode();
    
    // Start worker
    await startWorkerMode();
    
    console.log('✅ Both API server and worker started successfully');
  } catch (error) {
    console.error('❌ Failed to start application in both mode:', error);
    throw error;
  }
}

/**
 * Main application function
 */
async function main() {
  const mode = getAppMode();
  console.log(`🎯 Application mode: ${mode.toUpperCase()}`);
  
  try {
    switch (mode) {
      case 'api':
        await startApiMode();
        break;
      case 'worker':
        await startWorkerMode();
        break;
      case 'both':
        await startBothMode();
        break;
      default:
        throw new Error(`Invalid application mode: ${mode}. Use 'api', 'worker', or 'both'`);
    }
    
    console.log(`✅ Application started successfully in ${mode.toUpperCase()} mode`);
    
  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Graceful shutdown initiated (SIGINT)...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Graceful shutdown initiated (SIGTERM)...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Display usage information
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
📖 Usage:
  node src/index.js [mode]
  
🎯 Modes:
  api     - Start only the API server (default)
  worker  - Start only the worker process
  both    - Start both API server and worker
  
🌍 Environment Variables:
  APP_MODE=api|worker|both  - Set application mode
  
📚 Examples:
  node src/index.js api
  node src/index.js worker  
  node src/index.js both
  APP_MODE=worker node src/index.js
  `);
  process.exit(0);
}

// Start the application
main();