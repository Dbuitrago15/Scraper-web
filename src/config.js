// Application configuration settings
// Environment variables and configuration management

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export const config = {
  // Application Mode
  APP_MODE: process.env.APP_MODE || 'api',
  
  // Server Configuration
  PORT: parseInt(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Redis Configuration
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT) || 6379,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
  
  // Browser Pool Configuration
  MAX_BROWSER_INSTANCES: parseInt(process.env.MAX_BROWSER_INSTANCES) || 5,
  BROWSER_TIMEOUT: parseInt(process.env.BROWSER_TIMEOUT) || 30000,
  
  // Worker Configuration
  WORKER_CONCURRENCY: parseInt(process.env.WORKER_CONCURRENCY) || 5,
  
  // API Configuration
  API_RATE_LIMIT: parseInt(process.env.API_RATE_LIMIT) || 100,
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

console.log('✅ Configuration loaded:', {
  NODE_ENV: config.NODE_ENV,
  PORT: config.PORT,
  REDIS_HOST: config.REDIS_HOST,
  REDIS_PORT: config.REDIS_PORT,
  LOG_LEVEL: config.LOG_LEVEL
});