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
    await page.waitForTimeout(5000);
    
    // Multiple selectors to find business results in different Google Maps layouts
    const businessSelectors = [
      '[data-result-index="0"]',                    // Original selector
      'div[role="main"] .Nv2PK',                   // Search results container
      '.bJzME.Hu9e2e.tTVLSc',                      // Business card
      'a[data-result-index="0"]',                  // Link with result index
      '.hfpxzc[role="button"]',                    // Business listing button
      '.section-result .section-result-content',   // Search result content
      'div[jsaction*="click"]:has(.fontHeadlineSmall)' // Any clickable div with business name
    ];
    
    let businessResult = null;
    let selectorUsed = '';
    
    // Try each selector until we find results
    for (const selector of businessSelectors) {
      console.log(`🔍 Trying selector: ${selector}`);
      businessResult = await page.locator(selector).first();
      const count = await businessResult.count();
      console.log(`📊 Found ${count} elements with selector: ${selector}`);
      
      if (count > 0) {
        selectorUsed = selector;
        break;
      }
    }
    
    if (!businessResult || await businessResult.count() === 0) {
      console.log('❌ No business results found with any selector');
      
      // Debug: Take a screenshot and log page content
      console.log('🔍 Page URL:', page.url());
      await page.screenshot({ path: '/tmp/debug-no-results.png', fullPage: true }).catch(() => {});
      
      return createEmptyResult(data, 'No results found on Google Maps');
    }
    
    console.log(`✅ Found business result using selector: ${selectorUsed}`);
    
    // Check if this is already the detail view or if we need to click
    const isDetailView = await page.locator('h1[data-attrid="title"]').count() > 0 ||
                         await page.locator('.x3AX1-LfntMc-header-title-title').count() > 0 ||
                         await page.locator('[data-item-id="address"]').count() > 0;
    
    if (!isDetailView) {
      console.log('🔄 Clicking on business result to open details');
      // Click on the first result
      await businessResult.click();
      // Wait for business details to load
      await page.waitForTimeout(4000);
    } else {
      console.log('✅ Already in business detail view');
    }
    
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
    rating: '',
    reviewsCount: '',
    website: '',
    category: '',
    socialMedia: {},
    openingHours: {},
    
    // Metadata
    scrapedAt: new Date().toISOString(),
    status: 'success',
    error: null
  };
  
  try {
    // Extract business name with comprehensive selectors
    const nameSelectors = [
      'h1[data-attrid="title"]',                     // Main title attribute
      'h1.DUwDvf',                                   // Header class
      '[data-attrid="title"]',                       // Any element with title attribute
      '.qrShPb .fontHeadlineLarge',                  // Large headline in info panel
      '.x3AX1-LfntMc-header-title-title',           // Header title
      '.section-hero-header-title-title',            // Hero section title
      'h1.fontHeadlineLarge',                        // Direct headline class
      '.tAiQdd .fontHeadlineLarge',                  // Info section headline
      '.x3AX1-LfntMc-header-title .fontHeadlineLarge' // Header with large font
    ];
    
    result.fullName = await extractTextFromSelectors(page, nameSelectors) || originalData.name || '';
    console.log(`📝 Extracted name: ${result.fullName}`);
    
    // Extract address with multiple fallback selectors
    const addressSelectors = [
      '[data-item-id="address"] .Io6YTe',           // Primary address selector
      '.Io6YTe.fontBodyMedium',                     // Medium font body text
      '[data-attrid="kc:/location/location:address"]', // Knowledge panel address
      '[data-item-id="address"]',                   // Address item without specific class
      '.rogA2c .Io6YTe',                           // Alternative address container
      '[aria-label*="Address"]',                    // Aria label containing "Address"
      'button[data-item-id="address"]',             // Address as button
      '.section-info-line .section-info-text'      // Info line text
    ];
    
    result.fullAddress = await extractTextFromSelectors(page, addressSelectors) || '';
    console.log(`📍 Extracted address: ${result.fullAddress}`);
    
    // Extract phone number with comprehensive selectors
    const phoneSelectors = [
      '[data-item-id="phone"] .Io6YTe',            // Primary phone selector
      'span[data-attrid="kc:/collection/knowledge_panels/has_phone:phone"]', // Knowledge panel phone
      '.rogA2c .Io6YTe',                           // Alternative phone container
      '[data-item-id="phone"]',                    // Phone item without specific class
      'button[data-item-id="phone"]',              // Phone as button
      '[aria-label*="Phone"]',                     // Aria label containing "Phone"
      'a[href^="tel:"]',                           // Tel links
      '.section-info-line [href^="tel:"]'          // Phone links in info section
    ];
    
    result.phone = await extractTextFromSelectors(page, phoneSelectors) || '';
    console.log(`📞 Extracted phone: ${result.phone}`);
    
    // Extract rating with comprehensive selectors
    const ratingSelectors = [
      '.F7nice .ceNzKf',                           // Main rating display
      '[data-attrid="kc:/collection/knowledge_panels/has_rating:rating"]', // Knowledge panel rating
      '.MW4etd',                                   // Rating text
      'span.ceNzKf[aria-label*="stars"]',         // Star rating with aria label
      '.section-star-display .section-star-display-text', // Alternative rating display
      '[jsaction*="pane.rating"]'                  // Rating with jsaction
    ];
    
    result.rating = await extractTextFromSelectors(page, ratingSelectors) || '';
    console.log(`⭐ Extracted rating: ${result.rating}`);
    
    // Extract reviews count with comprehensive selectors
    const reviewsSelectors = [
      '.F7nice [aria-label*="reviews"]',           // Reviews count in aria label
      '.MW4etd:nth-child(2)',                      // Second element in rating container
      '[data-attrid="kc:/collection/knowledge_panels/has_rating:review_count"]', // Knowledge panel reviews
      '.section-reviewchart-numreviews',           // Review chart number
      'button[jsaction*="pane.reviewChart"] .MW4etd', // Reviews button text
      'span[aria-label*="review"]'                 // Any span with review in aria label
    ];
    
    result.reviewsCount = await extractTextFromSelectors(page, reviewsSelectors) || '';
    console.log(`📊 Extracted reviews count: ${result.reviewsCount}`);
    
    // Extract website with comprehensive selectors
    const websiteSelectors = [
      '[data-item-id="authority"] .Io6YTe',       // Primary website selector
      'a[href^="http"][data-item-id="authority"]', // Website link
      '[aria-label*="Website"]',                   // Aria label containing "Website"
      'button[data-item-id="authority"]',          // Website as button
      '.section-info-line a[href^="http"]:not([href*="google"])', // External links (not google)
      '[data-attrid="kc:/collection/knowledge_panels/has_url:url"]' // Knowledge panel URL
    ];
    
    result.website = await extractTextFromSelectors(page, websiteSelectors) || '';
    console.log(`🌐 Extracted website: ${result.website}`);
    
    // Extract category/business type with comprehensive selectors
    const categorySelectors = [
      '.DkEaL',                                    // Main category display
      '[data-attrid="kc:/collection/knowledge_panels/has_type:type"]', // Knowledge panel type
      '.section-hero-header-description',          // Hero section description
      '.section-editorial-quote',                  // Editorial quote (sometimes contains category)
      'button[jsaction*="pane.rating.category"]',  // Category button
      '.MW4etd:first-child',                       // First element might be category
      '[aria-label*="category"]'                   // Any element with category in aria label
    ];
    
    result.category = await extractTextFromSelectors(page, categorySelectors) || '';
    console.log(`🏷️ Extracted category: ${result.category}`);
    
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
      console.log(`🔍 Trying selector: ${selector}`);
      const element = await page.locator(selector).first();
      const count = await element.count();
      console.log(`📊 Found ${count} elements with selector: ${selector}`);
      
      if (count > 0) {
        const text = await element.textContent();
        console.log(`📝 Raw text from selector "${selector}": "${text}"`);
        if (text && text.trim()) {
          console.log(`✅ Successfully extracted: "${text.trim()}" using selector: ${selector}`);
          return text.trim();
        }
      }
    } catch (error) {
      console.log(`❌ Error with selector "${selector}": ${error.message}`);
      // Continue to next selector
      continue;
    }
  }
  console.log('❌ No text found with any of the provided selectors');
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