// Web scraper implementation using Playwright
// Core scraping logic and browser automation

import { browserPool } from './browser-pool.js';
import { 
  normalizeForSearch, 
  generateSearchVariations, 
  hasEuropeanChars, 
  getAllEuropeanSelectors 
} from '../utils/character-normalization.js';

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
    
    // Try multiple search strategies
    const searchStrategies = buildSearchStrategies(data);
    let searchSuccess = false;
    let currentStrategy = '';
    
    for (let i = 0; i < searchStrategies.length && !searchSuccess; i++) {
      const searchQuery = searchStrategies[i].query;
      currentStrategy = searchStrategies[i].name;
      const googleMapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
      
      console.log(`🗺️ Strategy ${i + 1}/${searchStrategies.length} (${currentStrategy}): ${searchQuery}`);
      
      try {
        // Navigate to Google Maps
        await page.goto(googleMapsUrl, { 
          waitUntil: 'networkidle',
          timeout: 30000 
        });
        
        // Wait for search results to load
        await page.waitForTimeout(5000);
        
        // Check if we found something
        searchSuccess = await checkIfBusinessFound(page);
        
        if (searchSuccess) {
          console.log(`✅ Search successful with strategy: ${currentStrategy}`);
          break;
        } else {
          console.log(`❌ Strategy ${currentStrategy} failed, trying next...`);
        }
      } catch (error) {
        console.log(`❌ Strategy ${currentStrategy} error: ${error.message}`);
        continue;
      }
    }
    
    if (!searchSuccess) {
      console.log('❌ All search strategies failed');
      return createEmptyResult(data, 'Business not found with any search strategy');
    }
    
    // Enhanced detection for business detail view (Spanish/International support)
    const detailViewSelectors = [
      'h1[data-attrid="title"]',                   // Main title
      '.x3AX1-LfntMc-header-title-title',         // Header title
      '[data-item-id="address"]',                 // Address element
      'h1.DUwDvf',                               // Business name header
      '.qrShPb .fontHeadlineLarge',              // Large headline
      '[data-item-id="phone"]',                  // Phone element
      '.MW4etd',                                 // Rating element
      '.F7nice',                                 // Rating container
      'button[data-item-id="authority"]',        // Website button
      '[aria-label*="estrella"]',                // Spanish: stars
      '[aria-label*="star"]',                    // English: stars
      '.section-star-display',                   // Star display
      '[data-attrid*="rating"]'                  // Rating attribute
    ];
    
    let isDetailView = false;
    let detailSelector = '';
    
    // Check if we're already in a business detail view
    for (const selector of detailViewSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        isDetailView = true;
        detailSelector = selector;
        console.log(`✅ Detected business detail view using selector: ${selector}`);
        break;
      }
    }
    
    if (!isDetailView) {
      console.log('🔍 Not in detail view, trying to find business results...');
      
      // Multiple selectors to find business results in different Google Maps layouts
      const businessSelectors = [
        '[data-result-index="0"]',                    // Original selector
        'div[role="main"] .Nv2PK',                   // Search results container
        '.bJzME.Hu9e2e.tTVLSc',                      // Business card
        'a[data-result-index="0"]',                  // Link with result index
        '.hfpxzc[role="button"]',                    // Business listing button
        '.section-result .section-result-content',   // Search result content
        'div[jsaction*="click"]:has(.fontHeadlineSmall)', // Any clickable div with business name
        '.section-result-title',                     // Result title
        '.section-result .section-result-title',     // Result title in section
        'a[href*="/place/"]',                       // Direct place links
        '[data-result-index]:first-child',          // First result item
        '.section-listbox .section-result'          // Results in listbox
      ];
      
      let businessResult = null;
      let selectorUsed = '';
      
      // Try each selector until we find results
      for (const selector of businessSelectors) {
        console.log(`🔍 Trying business selector: ${selector}`);
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
      console.log('🔄 Clicking on business result to open details');
      
      // Click on the first result
      await businessResult.click();
      // Wait for business details to load
      await page.waitForTimeout(5000);
      
      // Re-check if we're now in detail view
      for (const selector of detailViewSelectors) {
        const count = await page.locator(selector).count();
        if (count > 0) {
          isDetailView = true;
          detailSelector = selector;
          console.log(`✅ Now in business detail view using selector: ${selector}`);
          break;
        }
      }
      
      if (!isDetailView) {
        console.log('❌ Still not in detail view after clicking');
        return createEmptyResult(data, 'Could not access business details');
      }
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
 * Builds multiple search strategies for finding a business
 * Enhanced with European character normalization
 * @param {Object} data - Business data
 * @returns {Array} Array of search strategies
 */
function buildSearchStrategies(data) {
  const strategies = [];
  const hasEuropeanCharacters = hasEuropeanChars(data.name || '');
  
  console.log(`🔤 Building search strategies for: ${data.name}`);
  if (hasEuropeanCharacters) {
    console.log('🇪🇺 Detected European characters, adding normalized variations');
  }
  
  // Generate business name variations for European characters
  const businessNameVariations = data.name ? generateSearchVariations(data.name) : [data.name];
  console.log(`📝 Generated ${businessNameVariations.length} name variations:`, businessNameVariations);
  
  // Strategy 1: Full search (name + address + city + postal_code) - Original and normalized
  if (data.name && data.address && data.city) {
    for (const nameVariation of businessNameVariations) {
      const parts = [];
      if (nameVariation) parts.push(nameVariation);
      if (data.address) parts.push(data.address);
      if (data.city) parts.push(data.city);
      if (data.postal_code) parts.push(data.postal_code);
      
      strategies.push({
        name: `Full Search${nameVariation !== data.name ? ' (Normalized)' : ''}`,
        query: parts.join(' ').trim()
      });
    }
  }
  
  // Strategy 2: Name + City (without specific address) - Original and normalized
  if (data.name && data.city) {
    for (const nameVariation of businessNameVariations) {
      strategies.push({
        name: `Name + City${nameVariation !== data.name ? ' (Normalized)' : ''}`,
        query: `${nameVariation} ${data.city}`.trim()
      });
    }
  }
  
  // Strategy 3: Name + Address (without city) - Original and normalized
  if (data.name && data.address) {
    for (const nameVariation of businessNameVariations) {
      strategies.push({
        name: `Name + Address${nameVariation !== data.name ? ' (Normalized)' : ''}`,
        query: `${nameVariation} ${data.address}`.trim()
      });
    }
  }
  
  // Strategy 4: Name + Country context for international searches
  if (data.name) {
    for (const nameVariation of businessNameVariations) {
      // Determine country context based on city or postal code
      let countryContext = '';
      if (data.city) {
        if (data.city.toLowerCase().includes('cartagena')) {
          countryContext = 'Colombia';
        } else if (data.postal_code && /^\d{5}$/.test(data.postal_code)) {
          countryContext = 'Deutschland'; // German postal codes
        } else if (data.postal_code && /^\d{4}$/.test(data.postal_code)) {
          countryContext = 'Schweiz'; // Swiss postal codes
        } else if (data.postal_code && /^\d{3}\s?\d{2}$/.test(data.postal_code)) {
          countryContext = 'Sverige'; // Swedish postal codes
        }
      }
      
      if (countryContext) {
        strategies.push({
          name: `Name + Country${nameVariation !== data.name ? ' (Normalized)' : ''}`,
          query: `${nameVariation} ${data.city || ''} ${countryContext}`.trim()
        });
      }
    }
  }
  
  // Strategy 5: Clean name only (remove common business suffixes in multiple languages)
  if (data.name) {
    for (const nameVariation of businessNameVariations) {
      const cleanName = nameVariation
        .replace(/\s+(restaurante|restaurant|café|cafe|bar|hotel|centro comercial|supermarket|supermercado|gmbh|ag|ab|as|aps|oy|ltd|llc|inc|co\.?|company|företag|selskab|gesellschaft)/gi, '')
        .trim();
      
      if (cleanName && cleanName !== nameVariation && cleanName.length > 2) {
        strategies.push({
          name: `Clean Name + City${nameVariation !== data.name ? ' (Normalized)' : ''}`,
          query: `${cleanName} ${data.city || ''}`.trim()
        });
      }
    }
  }
  
  // Strategy 6: Just the business name variations
  if (data.name) {
    for (const nameVariation of businessNameVariations) {
      strategies.push({
        name: `Name Only${nameVariation !== data.name ? ' (Normalized)' : ''}`,
        query: nameVariation.trim()
      });
    }
  }
  
  // Remove duplicates and empty queries
  const uniqueStrategies = [];
  const seenQueries = new Set();
  
  for (const strategy of strategies) {
    if (strategy.query.length > 0 && !seenQueries.has(strategy.query.toLowerCase())) {
      seenQueries.add(strategy.query.toLowerCase());
      uniqueStrategies.push(strategy);
    }
  }
  
  console.log(`🎯 Generated ${uniqueStrategies.length} unique search strategies`);
  return uniqueStrategies;
}

/**
 * Checks if a business was found on the current page
 * @param {Page} page - Playwright page
 * @returns {Promise<boolean>} True if business found
 */
async function checkIfBusinessFound(page) {
  const businessIndicators = [
    'h1[data-attrid="title"]',
    'h1.DUwDvf',
    '[data-item-id="address"]',
    '.MW4etd',
    '.F7nice',
    '.section-result',
    '[data-result-index]',
    '.hfpxzc[role="button"]',
    '.place-name',
    '.section-hero-header-title'
  ];
  
  for (const selector of businessIndicators) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      return true;
    }
  }
  
  return false;
}

/**
 * Builds a search query from business data (legacy function)
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
    // Extract business name with comprehensive selectors (Spanish/International support)
    const nameSelectors = [
      'h1[data-attrid="title"]',                     // Main title attribute
      'h1.DUwDvf',                                   // Header class (most common)
      '[data-attrid="title"]',                       // Any element with title attribute
      '.qrShPb .fontHeadlineLarge',                  // Large headline in info panel
      '.x3AX1-LfntMc-header-title-title',           // Header title
      '.section-hero-header-title-title',            // Hero section title
      'h1.fontHeadlineLarge',                        // Direct headline class
      '.tAiQdd .fontHeadlineLarge',                  // Info section headline
      '.x3AX1-LfntMc-header-title .fontHeadlineLarge', // Header with large font
      'h1',                                          // Any h1 tag
      '[role="main"] h1',                           // Main section h1
      '.section-hero-header-title',                  // Hero header title
      '[data-attrid*="title"]'                      // Any element with title in attribute
    ];
    
    result.fullName = await extractTextFromSelectors(page, nameSelectors) || originalData.name || '';
    console.log(`📝 Extracted name: ${result.fullName}`);
    
    // Extract address with multiple fallback selectors (Spanish/International support)
    const addressSelectors = [
      '[data-item-id="address"] .Io6YTe',           // Primary address selector
      '.Io6YTe.fontBodyMedium',                     // Medium font body text
      '[data-attrid="kc:/location/location:address"]', // Knowledge panel address
      '[data-item-id="address"]',                   // Address item without specific class
      '.rogA2c .Io6YTe',                           // Alternative address container
      '[aria-label*="Address"]',                    // Aria label containing "Address" (English)
      '[aria-label*="Dirección"]',                  // Aria label containing "Address" (Spanish)
      '[aria-label*="Ubicación"]',                  // Aria label containing "Location" (Spanish)
      'button[data-item-id="address"]',             // Address as button
      '.section-info-line .section-info-text',     // Info line text
      '[data-item-id="address"] span',             // Address span elements
      '.section-info-text',                        // Info text (general)
      '.place-desc-medium',                        // Place description medium
      '[role="button"][aria-label*="dirección"]', // Address buttons (Spanish)
      '.section-result-location'                   // Result location section
    ];
    
    result.fullAddress = await extractTextFromSelectors(page, addressSelectors) || '';
    console.log(`📍 Extracted address: ${result.fullAddress}`);
    
    // Extract phone number with comprehensive selectors (Spanish/International support)
    const phoneSelectors = [
      '[data-item-id="phone"] .Io6YTe',            // Primary phone selector
      'span[data-attrid="kc:/collection/knowledge_panels/has_phone:phone"]', // Knowledge panel phone
      '.rogA2c .Io6YTe',                           // Alternative phone container
      '[data-item-id="phone"]',                    // Phone item without specific class
      'button[data-item-id="phone"]',              // Phone as button
      '[aria-label*="Phone"]',                     // Aria label containing "Phone" (English)
      '[aria-label*="Teléfono"]',                  // Aria label containing "Phone" (Spanish)
      '[aria-label*="Llamar"]',                    // Aria label containing "Call" (Spanish)
      'a[href^="tel:"]',                           // Tel links
      '.section-info-line [href^="tel:"]',         // Phone links in info section
      '[data-item-id="phone"] span',              // Phone span elements
      'button[aria-label*="teléfono"]',           // Phone buttons (Spanish)
      'button[aria-label*="llamar"]',             // Call buttons (Spanish)
      '.section-result-phone-number',             // Result phone number
      '[href^="tel:"]'                           // Any tel links
    ];
    
    result.phone = await extractTextFromSelectors(page, phoneSelectors) || '';
    console.log(`📞 Extracted phone: ${result.phone}`);
    
    // Extract rating with comprehensive selectors (Multi-language European support)
    const europeanSelectors = getAllEuropeanSelectors();
    const ratingSelectors = [
      '.F7nice .ceNzKf',                           // Main rating display
      '[data-attrid="kc:/collection/knowledge_panels/has_rating:rating"]', // Knowledge panel rating
      '.MW4etd',                                   // Rating text (most common)
      // English selectors
      'span.ceNzKf[aria-label*="stars"]',         // Star rating with aria label (English)
      '[role="img"][aria-label*="star"]',         // Star image elements (English)
      '.fontBodyMedium[aria-label*="star"]',      // Medium font star labels (English)
      // Spanish selectors  
      'span.ceNzKf[aria-label*="estrella"]',      // Star rating with aria label (Spanish)
      '[role="img"][aria-label*="estrella"]',     // Star image elements (Spanish) 
      '.fontBodyMedium[aria-label*="estrella"]',  // Medium font star labels (Spanish)
      // German selectors
      'span.ceNzKf[aria-label*="stern"]',         // Star rating with aria label (German)
      '[role="img"][aria-label*="stern"]',        // Star image elements (German)
      '.fontBodyMedium[aria-label*="bewertung"]', // Rating labels (German)
      'span.ceNzKf[aria-label*="bewertung"]',     // Rating with aria label (German)
      // Swedish selectors
      'span.ceNzKf[aria-label*="stjärn"]',        // Star rating with aria label (Swedish)  
      '[role="img"][aria-label*="stjärn"]',       // Star image elements (Swedish)
      '.fontBodyMedium[aria-label*="betyg"]',     // Rating labels (Swedish)
      'span.ceNzKf[aria-label*="betyg"]',         // Rating with aria label (Swedish)
      // Norwegian selectors
      'span.ceNzKf[aria-label*="stjerne"]',       // Star rating with aria label (Norwegian)
      '[role="img"][aria-label*="stjerne"]',      // Star image elements (Norwegian) 
      '.fontBodyMedium[aria-label*="vurdering"]', // Rating labels (Norwegian)
      'span.ceNzKf[aria-label*="vurdering"]',     // Rating with aria label (Norwegian)
      // Danish selectors
      'span.ceNzKf[aria-label*="stjerne"]',       // Star rating with aria label (Danish)
      '[role="img"][aria-label*="stjerne"]',      // Star image elements (Danish)
      '.fontBodyMedium[aria-label*="bedømmelse"]',// Rating labels (Danish)
      'span.ceNzKf[aria-label*="bedømmelse"]',    // Rating with aria label (Danish)
      // Generic selectors
      '.section-star-display .section-star-display-text', // Alternative rating display
      '[jsaction*="pane.rating"]',                 // Rating with jsaction
      '.F7nice span:first-child',                  // First span in rating container
      'span[data-value]',                         // Spans with data-value (ratings)
      '.section-star-display'                     // Star display section
    ];
    
    result.rating = await extractTextFromSelectors(page, ratingSelectors) || '';
    console.log(`⭐ Extracted rating: ${result.rating}`);
    
    // Extract reviews count with comprehensive selectors (Multi-language European support)
    const reviewsSelectors = [
      '.MW4etd:nth-child(2)',                      // Second element in rating container
      '[data-attrid="kc:/collection/knowledge_panels/has_rating:review_count"]', // Knowledge panel reviews
      '.section-reviewchart-numreviews',           // Review chart number
      'button[jsaction*="pane.reviewChart"] .MW4etd', // Reviews button text
      '.F7nice .MW4etd:last-child',               // Last element in rating container
      // English selectors
      '.F7nice [aria-label*="reviews"]',           // Reviews count in aria label (English)
      'span[aria-label*="review"]',                // Any span with review in aria label (English)
      'button[aria-label*="review"] .MW4etd',     // Review button text (English)
      '.fontBodyMedium[aria-label*="review"]',    // Medium font review labels (English)
      // Spanish selectors
      '.F7nice [aria-label*="reseña"]',            // Reviews count in aria label (Spanish)
      '.F7nice [aria-label*="opinión"]',           // Reviews count in aria label (Spanish alt)
      'span[aria-label*="reseña"]',                // Any span with review in aria label (Spanish)
      'span[aria-label*="opinión"]',               // Any span with review in aria label (Spanish alt)
      'button[aria-label*="reseña"] .MW4etd',     // Review button text (Spanish)
      '.fontBodyMedium[aria-label*="reseña"]',    // Medium font review labels (Spanish)
      // German selectors
      '.F7nice [aria-label*="bewertungen"]',       // Reviews count in aria label (German)
      '.F7nice [aria-label*="rezensionen"]',       // Reviews count in aria label (German alt)
      'span[aria-label*="bewertungen"]',           // Any span with review in aria label (German)
      'span[aria-label*="rezensionen"]',           // Any span with review in aria label (German alt)
      'button[aria-label*="bewertungen"] .MW4etd', // Review button text (German)
      '.fontBodyMedium[aria-label*="bewertungen"]', // Medium font review labels (German)
      // Swedish selectors
      '.F7nice [aria-label*="recensioner"]',       // Reviews count in aria label (Swedish)
      '.F7nice [aria-label*="omdömen"]',           // Reviews count in aria label (Swedish alt)
      'span[aria-label*="recensioner"]',           // Any span with review in aria label (Swedish)
      'span[aria-label*="omdömen"]',               // Any span with review in aria label (Swedish alt)
      'button[aria-label*="recensioner"] .MW4etd', // Review button text (Swedish)
      '.fontBodyMedium[aria-label*="recensioner"]', // Medium font review labels (Swedish)
      // Norwegian selectors
      '.F7nice [aria-label*="anmeldelser"]',       // Reviews count in aria label (Norwegian)
      'span[aria-label*="anmeldelser"]',           // Any span with review in aria label (Norwegian)
      'button[aria-label*="anmeldelser"] .MW4etd', // Review button text (Norwegian)
      '.fontBodyMedium[aria-label*="anmeldelser"]', // Medium font review labels (Norwegian)
      // Danish selectors
      '.F7nice [aria-label*="anmeldelser"]',       // Reviews count in aria label (Danish)
      'span[aria-label*="anmeldelser"]',           // Any span with review in aria label (Danish)
      'button[aria-label*="anmeldelser"] .MW4etd', // Review button text (Danish)
      '.fontBodyMedium[aria-label*="anmeldelser"]' // Medium font review labels (Danish)
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
    
    // Extract category/business type with comprehensive selectors (Spanish/International support)
    const categorySelectors = [
      '.DkEaL',                                    // Main category display
      '[data-attrid="kc:/collection/knowledge_panels/has_type:type"]', // Knowledge panel type
      '.section-hero-header-description',          // Hero section description
      '.section-editorial-quote',                  // Editorial quote (sometimes contains category)
      'button[jsaction*="pane.rating.category"]',  // Category button
      '.MW4etd:first-child',                       // First element might be category
      '[aria-label*="category"]',                  // Any element with category in aria label (English)
      '[aria-label*="categoría"]',                 // Any element with category in aria label (Spanish)
      '.fontBodyMedium:first-of-type',            // First medium font element (often category)
      '.section-result-details',                   // Result details section
      '.section-result-meta',                      // Result metadata
      'button[data-value*="category"]',           // Category buttons
      '.place-desc-large',                        // Place description
      '.section-info-definition'                  // Info definition (category)
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