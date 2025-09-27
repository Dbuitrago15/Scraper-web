// Main application entry point
// This file will initialize the API server and worker processes

import { startServer } from './api/server.js';
import { config } from './config.js';

console.log('🚀 High-Performance Web Scraper - Starting...');
console.log(`📊 Environment: ${config.NODE_ENV}`);

// Start the API server
async function main() {
  try {
    await startServer();
    console.log('✅ Application started successfully');
  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Graceful shutdown initiated...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

// Start the application
main();