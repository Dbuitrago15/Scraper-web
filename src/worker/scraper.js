// Web scraper implementation using Playwright
// Core scraping logic and browser automation

import { browserPool } from './browser-pool.js';

/**
 * Scrapes business information from Google Maps
 * @param {Object} data - Business data from CSV row
 * @param {string} data.name - Business name
 * @param {string} data.address - Business address
 * @param {string} data.city - City name
 * @param {string} data.postal_code - Postal code
 * @returns {Promise<Object>} Scraped business information
 */
export async function scrapeBusiness(data) {
  let browser = null;
  let context = null;
  
  try {
    console.log(`🔍 Starting scrape for: ${data.name || 'Unknown Business'}`);
    
    // Acquire browser from pool
    browser = await browserPool.acquire();
    console.log('📱 Browser acquired from pool');
    
    // Create new browser context for isolation
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    
    const page = await context.newPage();
    
    // Block unnecessary resources for performance
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'font', 'stylesheet', 'media'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });
    
    // Construct search query
    const searchQuery = buildSearchQuery(data);
    const googleMapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
    
    console.log(`🗺️ Navigating to Google Maps with query: ${searchQuery}`);
    
    // Navigate to Google Maps
    await page.goto(googleMapsUrl, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Wait for search results to load
    await page.waitForTimeout(3000);
    
    // Try to find and click on the first business result
    const businessResult = await page.locator('[data-result-index="0"]').first();
    
    if (await businessResult.count() === 0) {
      console.log('❌ No business results found');
      return createEmptyResult(data, 'No results found on Google Maps');
    }
    
    // Click on the first result
    await businessResult.click();
    
    // Wait for business details to load
    await page.waitForTimeout(4000);
    
    // Extract business information
    const scrapedData = await extractBusinessDetails(page, data);
    
    console.log(`✅ Successfully scraped: ${scrapedData.fullName}`);
    return scrapedData;
    
  } catch (error) {
    console.error(`❌ Error scraping business ${data.name}:`, error.message);
    return createEmptyResult(data, error.message);
  } finally {
    // Always clean up resources
    if (context) {
      try {
        await context.close();
        console.log('🧹 Browser context closed');
      } catch (error) {
        console.error('❌ Error closing context:', error);
      }
    }
    
    if (browser) {
      try {
        await browserPool.release(browser);
        console.log('🔄 Browser released back to pool');
      } catch (error) {
        console.error('❌ Error releasing browser:', error);
      }
    }
  }
}

/**
 * Builds a search query from business data
 * @param {Object} data - Business data
 * @returns {string} Search query
 */
function buildSearchQuery(data) {
  const parts = [];
  
  if (data.name) parts.push(data.name);
  if (data.address) parts.push(data.address);
  if (data.city) parts.push(data.city);
  if (data.postal_code) parts.push(data.postal_code);
  
  return parts.join(' ').trim();
}

/**
 * Extracts business details from Google Maps page
 * @param {Page} page - Playwright page object
 * @param {Object} originalData - Original CSV data
 * @returns {Promise<Object>} Extracted business information
 */
async function extractBusinessDetails(page, originalData) {
  const result = {
    // Original data
    originalName: originalData.name || '',
    originalAddress: originalData.address || '',
    originalCity: originalData.city || '',
    originalPostalCode: originalData.postal_code || '',
    
    // Scraped data
    fullName: '',
    fullAddress: '',
    phone: '',
    socialMedia: {},
    openingHours: {},
    
    // Metadata
    scrapedAt: new Date().toISOString(),
    status: 'success',
    error: null
  };
  
  try {
    // Extract business name
    const nameSelectors = [
      'h1[data-attrid="title"]',
      'h1.DUwDvf',
      '[data-attrid="title"]',
      '.qrShPb .fontHeadlineLarge'
    ];
    
    result.fullName = await extractTextFromSelectors(page, nameSelectors) || originalData.name || '';
    
    // Extract address
    const addressSelectors = [
      '[data-item-id="address"] .Io6YTe',
      '.Io6YTe.fontBodyMedium',
      '[data-attrid="kc:/location/location:address"]'
    ];
    
    result.fullAddress = await extractTextFromSelectors(page, addressSelectors) || '';
    
    // Extract phone number
    const phoneSelectors = [
      '[data-item-id="phone"] .Io6YTe',
      'span[data-attrid="kc:/collection/knowledge_panels/has_phone:phone"]',
      '.rogA2c .Io6YTe'
    ];
    
    result.phone = await extractTextFromSelectors(page, phoneSelectors) || '';
    
    // Extract opening hours
    result.openingHours = await extractOpeningHours(page);
    
    // Extract social media links
    result.socialMedia = await extractSocialMedia(page);
    
  } catch (error) {
    console.error('❌ Error extracting business details:', error);
    result.status = 'partial';
    result.error = error.message;
  }
  
  return result;
}

/**
 * Extracts text from multiple selectors (tries each until one works)
 * @param {Page} page - Playwright page
 * @param {string[]} selectors - Array of CSS selectors to try
 * @returns {Promise<string>} Extracted text or empty string
 */
async function extractTextFromSelectors(page, selectors) {
  for (const selector of selectors) {
    try {
      const element = await page.locator(selector).first();
      if (await element.count() > 0) {
        const text = await element.textContent();
        if (text && text.trim()) {
          return text.trim();
        }
      }
    } catch (error) {
      // Continue to next selector
      continue;
    }
  }
  return '';
}

/**
 * Extracts opening hours from Google Maps
 * @param {Page} page - Playwright page
 * @returns {Promise<Object>} Opening hours by day
 */
async function extractOpeningHours(page) {
  const hours = {};
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
  try {
    // Try to click hours section to expand it
    const hoursButton = page.locator('[data-item-id="oh"] button').first();
    if (await hoursButton.count() > 0) {
      await hoursButton.click();
      await page.waitForTimeout(1000);
    }
    
    // Extract hours for each day
    const hoursRows = await page.locator('.t39EBf .y0skZc').all();
    
    for (let i = 0; i < Math.min(hoursRows.length, days.length); i++) {
      const dayElement = hoursRows[i];
      const dayText = await dayElement.textContent();
      
      if (dayText) {
        const day = days[i];
        hours[day] = dayText.trim();
      }
    }
  } catch (error) {
    console.error('❌ Error extracting opening hours:', error);
  }
  
  return hours;
}

/**
 * Extracts social media links
 * @param {Page} page - Playwright page
 * @returns {Promise<Object>} Social media links
 */
async function extractSocialMedia(page) {
  const socialMedia = {};
  
  try {
    // Look for social media links
    const socialLinks = await page.locator('a[href*="facebook"], a[href*="instagram"], a[href*="twitter"], a[href*="linkedin"], a[href*="youtube"]').all();
    
    for (const link of socialLinks) {
      const href = await link.getAttribute('href');
      if (href) {
        if (href.includes('facebook')) socialMedia.facebook = href;
        else if (href.includes('instagram')) socialMedia.instagram = href;
        else if (href.includes('twitter')) socialMedia.twitter = href;
        else if (href.includes('linkedin')) socialMedia.linkedin = href;
        else if (href.includes('youtube')) socialMedia.youtube = href;
      }
    }
  } catch (error) {
    console.error('❌ Error extracting social media:', error);
  }
  
  return socialMedia;
}

/**
 * Creates an empty result object for failed scrapes
 * @param {Object} originalData - Original CSV data
 * @param {string} error - Error message
 * @returns {Object} Empty result object
 */
function createEmptyResult(originalData, error) {
  return {
    originalName: originalData.name || '',
    originalAddress: originalData.address || '',
    originalCity: originalData.city || '',
    originalPostalCode: originalData.postal_code || '',
    fullName: '',
    fullAddress: '',
    phone: '',
    socialMedia: {},
    openingHours: {},
    scrapedAt: new Date().toISOString(),
    status: 'failed',
    error: error
  };
}

console.log('✅ Web scraper module loaded');