# Scraper Web - High-Performance Web Scraping System

## Project Objective

A robust web scraping system designed to solve critical performance bottlenecks by processing business information from CSV files, scraping detailed data from Google Maps, and providing real-time progress updates. The system leverages JavaScript's asynchronous nature to minimize CPU and memory usage while maximizing throughput.

## Key Features

- **High Performance**: Shared browser pool architecture minimizes resource overhead
- **Asynchronous Processing**: Non-blocking I/O operations for maximum efficiency
- **Real-time Updates**: Live progress tracking for scraping operations
- **Robust Error Handling**: Comprehensive retry mechanisms and error recovery
- **Scalable Architecture**: Built for horizontal scaling with BullMQ and Redis

## Technology Stack

- **Language**: JavaScript (ESNext with ES Modules)
- **Runtime**: Node.js (>=18.0.0)
- **API Framework**: Fastify - Ultra-fast web framework
- **Task Queue**: BullMQ - Distributed job queue system
- **Message Broker**: Redis - In-memory data structure store
- **Web Scraping**: Playwright - Modern browser automation
- **Data Validation**: Zod - Schema validation library
- **Containerization**: Docker & Docker Compose

## Project Structure

```
/
├── src/
│   ├── api/
│   │   ├── routes/          # API route handlers
│   │   └── schemas.js       # Request/response schemas
│   ├── jobs/
│   │   ├── queue.js         # Job queue configuration
│   │   └── producer.js      # Job creation and management
│   ├── worker/
│   │   ├── scraper.js       # Core scraping logic
│   │   ├── browser-pool.js  # Shared browser instance management
│   │   └── processor.js     # Business data processing
│   ├── config/
│   │   └── index.js         # Application configuration
│   └── index.js             # Application entry point
├── docs/
│   ├── ARCHITECTURE.md      # System architecture documentation
│   └── DEVELOPMENT_LOG.md   # Development progress log
├── .env.example             # Environment variables template
├── .gitignore              # Git ignore patterns
├── Dockerfile              # Container configuration
├── docker-compose.yml      # Multi-container setup
├── package.json            # Dependencies and scripts
└── README.md               # This file
```

## Getting Started

### Prerequisites

- Node.js (>=18.0.0)
- Redis server
- Docker (optional, for containerized deployment)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Scraper-web
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the development server:
```bash
npm run dev
```

## Development Scripts

- `npm start` - Start the production server
- `npm run dev` - Start the development server with hot reload

## Core Principles

1. **Code Quality & Clarity**: Clean, modular JavaScript with comprehensive JSDoc documentation
2. **Performance First**: Optimized for minimal resource usage and maximum throughput
3. **Robustness**: Comprehensive error handling and retry mechanisms
4. **Living Documentation**: Continuously updated architecture and development logs

## License

MIT

---

*This project is designed for high-performance web scraping with a focus on scalability, reliability, and maintainability.*

