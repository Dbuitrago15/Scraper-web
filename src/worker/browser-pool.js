// Browser instance pool management
// Manages a pool of browser instances for efficient resource usage

import { createPool } from 'generic-pool';
import { chromium } from 'playwright';
import { config } from '../config.js';

/**
 * Factory for creating browser instances
 */
const browserFactory = {
  /**
   * Creates a new Chromium browser instance with performance optimizations
   * @returns {Promise<Browser>} Playwright browser instance
   */
  async create() {
    console.log('🚀 Creating new browser instance...');
    
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-field-trial-config',
        '--disable-back-forward-cache',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--disable-extensions',
        '--disable-default-apps',
        '--no-first-run',
        '--no-default-browser-check',
        '--memory-pressure-off',
        '--max_old_space_size=4096'
      ],
      timeout: config.BROWSER_TIMEOUT
    });

    console.log('✅ Browser instance created successfully');
    return browser;
  },

  /**
   * Destroys a browser instance
   * @param {Browser} browser - Playwright browser instance to destroy
   * @returns {Promise<void>}
   */
  async destroy(browser) {
    try {
      console.log('🗑️ Destroying browser instance...');
      await browser.close();
      console.log('✅ Browser instance destroyed successfully');
    } catch (error) {
      console.error('❌ Error destroying browser instance:', error);
    }
  },

  /**
   * Validates if a browser instance is still usable
   * @param {Browser} browser - Browser instance to validate
   * @returns {Promise<boolean>} True if browser is connected
   */
  async validate(browser) {
    try {
      return browser.isConnected();
    } catch (error) {
      console.error('❌ Browser validation failed:', error);
      return false;
    }
  }
};

/**
 * Browser pool configuration (Balanced for speed + reliability)
 */
const poolOptions = {
  min: 2, // Keep 2 browsers ready
  max: config.MAX_BROWSER_INSTANCES || 6, // Balanced max browsers
  acquireTimeoutMillis: 20000, // Balanced timeout
  createTimeoutMillis: 25000, // Balanced creation timeout
  destroyTimeoutMillis: 5000, // Balanced destruction
  idleTimeoutMillis: 120000, // Close idle browsers after 2 minutes
  reapIntervalMillis: 10000, // Check every 10s
  maxUses: 50, // Reduced to prevent memory leaks
  testOnBorrow: true, // Validate browser when borrowing
  testOnReturn: false, // Don't validate when returning
  evictionRunIntervalMillis: 15000, // Run eviction more frequently
  softIdleTimeoutMillis: 120000, // Reduced soft idle (2 minutes)
  priorityRange: 1
};

/**
 * Create the browser pool instance (Singleton)
 */
export const browserPool = createPool(browserFactory, poolOptions);

// Pool event listeners for monitoring
browserPool.on('factoryCreateError', (err) => {
  console.error('❌ Browser pool factory create error:', err);
});

browserPool.on('factoryDestroyError', (err) => {
  console.error('❌ Browser pool factory destroy error:', err);
});

/**
 * Get pool statistics
 * @returns {Object} Pool statistics
 */
export function getPoolStats() {
  return {
    size: browserPool.size,
    available: browserPool.available,
    borrowed: browserPool.borrowed,
    invalid: browserPool.invalid,
    pending: browserPool.pending,
    max: browserPool.max,
    min: browserPool.min
  };
}

/**
 * Gracefully drain and close the browser pool
 * @returns {Promise<void>}
 */
export async function closeBrowserPool() {
  try {
    console.log('🔄 Draining browser pool...');
    await browserPool.drain();
    console.log('🗑️ Clearing browser pool...');
    await browserPool.clear();
    console.log('✅ Browser pool closed successfully');
  } catch (error) {
    console.error('❌ Error closing browser pool:', error);
  }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, closing browser pool...');
  await closeBrowserPool();
});

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, closing browser pool...');
  await closeBrowserPool();
});

console.log('✅ Browser pool module loaded');
console.log(`🎯 Pool configuration: min=${poolOptions.min}, max=${poolOptions.max}`);