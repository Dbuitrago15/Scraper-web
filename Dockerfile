# Multi-stage build for production optimization

# Stage 1: Dependencies
FROM node:18-alpine AS dependencies
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: Development (optional for local dev)
FROM node:18 AS development
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "run", "dev"]

# Stage 3: Playwright setup
FROM node:18 AS playwright-setup
WORKDIR /app

# Install system dependencies for Playwright
RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    libxss1 \
    libgconf-2-4 \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm ci

# Install Playwright browsers
RUN npx playwright install chromium

# Stage 4: Production
FROM node:18-slim AS production
WORKDIR /app

# Install runtime dependencies for Playwright
RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    libxss1 \
    libgconf-2-4 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r scraper && useradd -r -g scraper scraper

# Copy production dependencies from dependencies stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy Playwright browsers from playwright-setup stage
COPY --from=playwright-setup /root/.cache/ms-playwright /home/scraper/.cache/ms-playwright

# Copy application code
COPY --chown=scraper:scraper . .

# Set proper permissions
RUN chown -R scraper:scraper /app && \
    chown -R scraper:scraper /home/scraper/.cache

# Switch to non-root user
USER scraper

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Expose port
EXPOSE 3000

# Start command
CMD ["node", "src/index.js"]

