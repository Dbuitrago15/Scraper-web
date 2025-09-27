# System Architecture

## Overview

The High-Performance Web Scraper is built using a microservices architecture with the following key components:

## Core Components

### API Server (`src/api/server.js`)
- Fastify-based HTTP server
- Handles incoming scraping requests
- Manages API endpoints and routing
- Implements rate limiting and CORS

### Job Queue System (`src/jobs/`)
- **Queue Manager** (`queue.js`): BullMQ configuration and setup
- **Job Producer** (`producer.js`): Creates and enqueues scraping tasks

### Worker System (`src/worker/`)
- **Scraper** (`scraper.js`): Core scraping logic using Playwright
- **Browser Pool** (`browser-pool.js`): Manages browser instances efficiently
- **Processor** (`processor.js`): Data transformation and output handling

### Configuration (`src/config.js`)
- Centralized configuration management
- Environment variable handling
- Application settings

## Technology Stack

- **Runtime**: Node.js with ES Modules
- **Web Framework**: Fastify
- **Job Queue**: BullMQ with Redis
- **Browser Automation**: Playwright
- **Data Processing**: CSV Parser
- **Containerization**: Docker & Docker Compose
- **Database**: Redis

## API Server & Job Creation

### Request Flow
1. **File Upload**: Client uploads CSV file via POST `/api/v1/scraping-batch`
2. **CSV Parsing**: Server uses `csv-parser` to stream and parse CSV data
3. **Job Creation**: Each CSV row becomes a job in the BullMQ queue
4. **Response**: Server immediately returns `batchId` and job count

### Components
- **Fastify Server**: High-performance HTTP server with multipart support
- **CSV Parser**: Streaming CSV parser for memory-efficient processing
- **Job Producer**: Creates and enqueues scraping jobs with unique IDs
- **BullMQ Queue**: Redis-backed job queue with retry logic and monitoring

### Job Structure
```javascript
{
  id: "uuid",
  batchId: "uuid",
  data: { /* CSV row data */ },
  timestamp: "ISO string",
  createdAt: "ISO string"
}
```

## Worker & Scraping Engine

### Browser Pool Management
- **Technology**: `generic-pool` library with Playwright Chromium instances
- **Performance**: Optimized browser launch arguments for resource efficiency
- **Capacity**: Configurable pool size (default: 5 browsers)
- **Lifecycle**: Automatic browser creation, validation, and cleanup
- **Resource Management**: Idle timeout, max usage limits, and graceful shutdown

### Scraping Engine (`scrapeBusiness`)
1. **Browser Acquisition**: Gets browser from pool with timeout handling
2. **Context Isolation**: Creates new browser context for each job
3. **Resource Blocking**: Blocks images, fonts, stylesheets for performance
4. **Google Maps Navigation**: Constructs search query and navigates to results
5. **Data Extraction**: Extracts business information using multiple selector strategies
6. **Error Handling**: Comprehensive try-catch-finally with proper cleanup

### Data Extraction Process
- **Business Name**: Multiple selector fallbacks for different Google Maps layouts
- **Address**: Comprehensive address extraction with validation
- **Phone Number**: Multiple phone number selector patterns
- **Opening Hours**: Day-by-day hour extraction with expandable sections
- **Social Media**: Link detection for major platforms (Facebook, Instagram, etc.)

### BullMQ Worker System
- **Concurrency**: Configurable parallel job processing (default: 5)
- **Job Processing**: Streams jobs from Redis queue with retry logic
- **Progress Tracking**: Real-time job progress updates
- **Error Handling**: Failed job tracking with detailed error information
- **Monitoring**: Comprehensive event logging and statistics

### Worker Deployment Modes
- **API Mode**: `npm run start:api` - Only API server
- **Worker Mode**: `npm run start:worker` - Only worker process
- **Both Mode**: `npm run start:both` - API + Worker in single process
- **Environment Control**: `APP_MODE` environment variable

### Performance Optimizations
- **Resource Blocking**: Prevents loading of non-essential resources
- **Browser Reuse**: Pool pattern reduces browser creation overhead
- **Concurrent Processing**: Multiple jobs processed simultaneously
- **Memory Management**: Automatic cleanup and resource limits
- **Network Efficiency**: Optimized wait strategies and timeouts

### Error Resilience
- **Job Retries**: Automatic retry with exponential backoff
- **Browser Recovery**: Failed browsers are replaced automatically
- **Graceful Degradation**: Partial data extraction when possible
- **Timeout Handling**: Prevents infinite waiting scenarios
- **Memory Leaks**: Proper context and page cleanup

## Architecture Principles

- **Scalability**: Horizontal scaling through containerization
- **Reliability**: Job queue system ensures task completion
- **Performance**: Browser pooling and efficient resource management
- **Maintainability**: Modular architecture with clear separation of concerns