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

## Architecture Principles

- **Scalability**: Horizontal scaling through containerization
- **Reliability**: Job queue system ensures task completion
- **Performance**: Browser pooling and efficient resource management
- **Maintainability**: Modular architecture with clear separation of concerns