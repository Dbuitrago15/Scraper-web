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

## Architecture Principles

- **Scalability**: Horizontal scaling through containerization
- **Reliability**: Job queue system ensures task completion
- **Performance**: Browser pooling and efficient resource management
- **Maintainability**: Modular architecture with clear separation of concerns