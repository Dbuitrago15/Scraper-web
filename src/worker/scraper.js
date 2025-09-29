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
  
  // Strategy 4: Name + Country context for international searches with enhanced Swiss recognition
  if (data.name) {
    for (const nameVariation of businessNameVariations) {
      // Enhanced country context detection
      let countryContext = '';
      let isSwiss = false;
      
      // Swiss city detection
      const swissCities = [
        'zürich', 'zurich', 'genève', 'geneve', 'geneva', 'basel', 'bern', 'berne',
        'lausanne', 'winterthur', 'luzern', 'lucerne', 'st. gallen', 'lugano',
        'biel', 'bienne', 'thun', 'chur', 'schaffhausen', 'fribourg', 'neuchâtel'
      ];
      
      if (data.city) {
        const cityLower = data.city.toLowerCase();
        isSwiss = swissCities.some(city => cityLower.includes(city));
        
        if (cityLower.includes('cartagena')) {
          countryContext = 'Colombia';
        } else if (isSwiss || (data.postal_code && /^\d{4}$/.test(data.postal_code))) {
          countryContext = 'Schweiz Switzerland Suisse Svizzera';
          isSwiss = true;
        } else if (data.postal_code && /^\d{5}$/.test(data.postal_code)) {
          countryContext = 'Deutschland Germany';
        } else if (data.postal_code && /^\d{3}\s?\d{2}$/.test(data.postal_code)) {
          countryContext = 'Sverige Sweden';
        } else if (data.postal_code && /^\d{4}$/.test(data.postal_code)) {
          countryContext = 'Schweiz Switzerland'; // Default 4-digit to Swiss
          isSwiss = true;
        }
      }
      
      if (countryContext) {
        strategies.push({
          name: `Name + Country${nameVariation !== data.name ? ' (Normalized)' : ''}`,
          query: `${nameVariation} ${data.city || ''} ${countryContext}`.trim()
        });
      }
      
      // Additional Swiss-specific strategies
      if (isSwiss) {
        strategies.push({
          name: `Swiss Store${nameVariation !== data.name ? ' (Normalized)' : ''}`,
          query: `${nameVariation} ${data.city} Schweiz`.trim()
        });
        
        // Add postal code for better Swiss targeting
        if (data.postal_code) {
          strategies.push({
            name: `Swiss + Postal${nameVariation !== data.name ? ' (Normalized)' : ''}`,
            query: `${nameVariation} ${data.postal_code} ${data.city} Schweiz`.trim()
          });
        }
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
    latitude: '',
    longitude: '',
    socialMedia: {},
    openingHours: {},
    
    // Metadata
    scrapedAt: new Date().toISOString(),
    status: 'success',
    error: null
  };
  
  try {
    // Extract business name with enhanced selectors for Swiss/European businesses
    const nameSelectors = [
      'h1[data-attrid="title"]',                     // Main title attribute (highest priority)
      'h1.DUwDvf',                                   // Header class (most common)
      '[data-attrid="title"]',                       // Any element with title attribute
      '.qrShPb .fontHeadlineLarge',                  // Large headline in info panel
      '.x3AX1-LfntMc-header-title-title',           // Header title
      '.section-hero-header-title-title',            // Hero section title
      'h1.fontHeadlineLarge',                        // Direct headline class
      '.tAiQdd .fontHeadlineLarge',                  // Info section headline
      '.x3AX1-LfntMc-header-title .fontHeadlineLarge', // Header with large font
      // Enhanced selectors for business detail pages
      '.place-name',                                 // Place name class
      '[jsaction*="pane.placeDetails.placeInfo"] h1', // Place details info
      'h1[data-attrid="kc:/collection/knowledge_panels/local_entity:title"]', // Knowledge panel title
      '.fontHeadlineLarge[data-attrid]',            // Large font with data attribute
      '.section-hero-header-title-title .fontHeadlineLarge', // Nested headline
      '.x3AX1-LfntMc-header-title',                 // Header title container
      'h1[class*="fontHeadline"]',                  // Any h1 with headline class
      '[role="main"] h1',                           // Main section h1
      '.section-hero-header-title',                  // Hero header title
      'h1',                                          // Any h1 tag (fallback)
      '[data-attrid*="title"]'                      // Any element with title in attribute (fallback)
    ];
    
    result.fullName = await extractTextFromSelectors(page, nameSelectors, 'name') || originalData.name || '';
    console.log(`📝 Extracted name: ${result.fullName}`);
    
    // Extract address with enhanced selectors (Swiss/European support)
    const addressSelectors = [
      '[data-item-id="address"] .Io6YTe',           // Primary address selector
      '[data-item-id="address"] .fontBodyMedium',   // Address with medium font
      '[data-item-id="address"] span',              // Address span elements
      '.Io6YTe.fontBodyMedium',                     // Medium font body text
      '[data-attrid="kc:/location/location:address"]', // Knowledge panel address
      '[data-item-id="address"]',                   // Address item without specific class
      '.rogA2c .Io6YTe',                           // Alternative address container  
      '[data-item-id="address"] .fontBodySmall',    // Address with small font
      // Multi-language address labels
      '[aria-label*="Address"]',                    // English
      '[aria-label*="Adresse"]',                    // German/Swiss German
      '[aria-label*="Adresse"]',                    // French (Swiss)
      '[aria-label*="Indirizzo"]',                  // Italian (Swiss)
      '[aria-label*="Dirección"]',                  // Spanish
      '[aria-label*="Ubicación"]',                  // Spanish location
      // Address buttons and containers
      'button[data-item-id="address"]',             // Address as button
      '.section-info-line .section-info-text',     // Info line text
      '.section-info-text',                        // Info text (general)
      '.place-desc-medium',                        // Place description medium
      '[role="button"][aria-label*="dirección"]',  // Address buttons (Spanish)
      '[role="button"][aria-label*="adresse"]',    // Address buttons (German/French)
      '.section-result-location',                  // Result location section
      // Swiss-specific patterns
      '.fontBodyMedium[aria-label*="Schweiz"]',    // Swiss addresses
      '.fontBodyMedium[aria-label*="Suisse"]',     // Swiss addresses (French)
      '.fontBodyMedium[aria-label*="Svizzera"]',   // Swiss addresses (Italian)
      'span:contains("Schweiz")',                  // Swiss country indicator
      'span:contains("Suisse")',                   // Swiss country indicator (French)
      'span:contains("Svizzera")'                  // Swiss country indicator (Italian)
    ];
    
    result.fullAddress = await extractTextFromSelectors(page, addressSelectors, 'address') || '';
    console.log(`📍 Extracted address: ${result.fullAddress}`);
    
    // Extract phone number with enhanced selectors (Swiss/European support)
    const phoneSelectors = [
      '[data-item-id="phone"] .Io6YTe',            // Primary phone selector
      'span[data-attrid="kc:/collection/knowledge_panels/has_phone:phone"]', // Knowledge panel phone
      '[data-item-id="phone"] span',               // Phone span elements
      '[data-item-id="phone"] .fontBodyMedium',    // Phone with medium font
      '.rogA2c .Io6YTe',                           // Alternative phone container
      '[data-item-id="phone"]',                    // Phone item without specific class
      'button[data-item-id="phone"]',              // Phone as button
      '[data-item-id="phone"] .fontCaption',       // Phone in caption font
      // Multi-language phone labels
      '[aria-label*="Phone"]',                     // English
      '[aria-label*="Telefon"]',                   // German/Swiss German
      '[aria-label*="Téléphone"]',                 // French (Swiss)
      '[aria-label*="Telefono"]',                  // Italian (Swiss)
      '[aria-label*="Teléfono"]',                  // Spanish
      '[aria-label*="Llamar"]',                    // Spanish "Call"
      // Phone links and buttons
      'a[href^="tel:"]',                           // Tel links
      '.section-info-line [href^="tel:"]',         // Phone links in info section
      'button[aria-label*="phone"]',               // Phone buttons (English)
      'button[aria-label*="telefon"]',             // Phone buttons (German)
      'button[aria-label*="teléfono"]',           // Phone buttons (Spanish)
      'button[aria-label*="chiamare"]',            // Call buttons (Italian)
      'button[aria-label*="llamar"]',             // Call buttons (Spanish)
      '.section-result-phone-number',             // Result phone number
      '[href^="tel:"]',                           // Any tel links
      // Swiss-specific selectors
      'span[aria-label*="+41"]',                   // Swiss country code in aria-label
      '.fontBodyMedium[aria-label*="+41"]',        // Swiss numbers in medium font
      'span:contains("+41")',                      // Elements containing Swiss country code
      '.Io6YTe[aria-label*="0"]',                 // Phone elements with Swiss format
      '[data-item-id="phone"] .fontBodySmall'     // Phone in small font
    ];
    
    result.phone = await extractTextFromSelectors(page, phoneSelectors, 'phone') || '';
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
    
    result.rating = await extractTextFromSelectors(page, ratingSelectors, 'rating') || '';
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
    
    result.reviewsCount = await extractTextFromSelectors(page, reviewsSelectors, 'reviews') || '';
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
    
    result.website = await extractTextFromSelectors(page, websiteSelectors, 'website') || '';
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
    
    result.category = await extractTextFromSelectors(page, categorySelectors, 'category') || '';
    console.log(`🏷️ Extracted category: ${result.category}`);
    
    // Extract coordinates (latitude and longitude)
    const coordinates = await extractCoordinates(page);
    result.latitude = coordinates.latitude;
    result.longitude = coordinates.longitude;
    console.log(`📍 Extracted coordinates: ${result.latitude}, ${result.longitude}`);
    
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
 * Extracts text from multiple selectors with smart filtering
 * @param {Page} page - Playwright page
 * @param {string[]} selectors - Array of CSS selectors to try
 * @param {string} fieldType - Type of field being extracted (for better filtering)
 * @returns {Promise<string>} Extracted text or empty string
 */
async function extractTextFromSelectors(page, selectors, fieldType = 'general') {
  // Generic terms to avoid (indicates we're not on the right page)
  const genericTerms = [
    'resultados', 'results', 'resultado', 'result',
    'búsqueda', 'search', 'buscar', 'suchen',
    'filtros', 'filters', 'filtrar', 'filter'
  ];
  
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
          const cleanText = text.trim();
          
          // Skip generic terms for business names
          if (fieldType === 'name') {
            const isGeneric = genericTerms.some(term => 
              cleanText.toLowerCase().includes(term.toLowerCase())
            );
            if (isGeneric) {
              console.log(`⚠️ Skipping generic text: "${cleanText}"`);
              continue;
            }
            
            // Skip if it's just a number (probably a rating)
            if (/^\d+(\.\d+)?$/.test(cleanText)) {
              console.log(`⚠️ Skipping numeric value: "${cleanText}"`);
              continue;
            }
          }
          
          // Additional validation for phone numbers
          if (fieldType === 'phone') {
            // Only accept text that looks like a phone number
            const phonePattern = /[\d\s\-\+\(\)\.]{7,}/;
            if (!phonePattern.test(cleanText)) {
              console.log(`⚠️ Skipping non-phone text: "${cleanText}"`);
              continue;
            }
          }
          
          console.log(`✅ Successfully extracted: "${cleanText}" using selector: ${selector}`);
          return cleanText;
        }
      }
    } catch (error) {
      console.log(`❌ Error with selector "${selector}": ${error.message}`);
      // Continue to next selector
      continue;
    }
  }
  console.log('❌ No valid text found with any of the provided selectors');
  return '';
}

/**
 * Extracts latitude and longitude coordinates from Google Maps
 * @param {Page} page - Playwright page
 * @returns {Promise<Object>} Object with latitude and longitude
 */
async function extractCoordinates(page) {
  try {
    console.log('📍 Attempting to extract coordinates from URL...');
    
    // Wait a moment for the page to fully load
    await page.waitForTimeout(2000);
    
    // Get the current URL which should contain coordinates
    const currentUrl = page.url();
    console.log(`🔍 Current URL: ${currentUrl}`);
    
    // Method 1: Extract from URL pattern @lat,lng,zoom
    let coordinatesMatch = currentUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+\.?\d*)z/);
    
    if (coordinatesMatch) {
      const latitude = parseFloat(coordinatesMatch[1]);
      const longitude = parseFloat(coordinatesMatch[2]);
      console.log(`✅ Coordinates found in URL: ${latitude}, ${longitude}`);
      return { latitude: latitude.toString(), longitude: longitude.toString() };
    }
    
    // Method 2: Extract from different URL pattern !3d and !4d
    coordinatesMatch = currentUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    
    if (coordinatesMatch) {
      const latitude = parseFloat(coordinatesMatch[1]);
      const longitude = parseFloat(coordinatesMatch[2]);
      console.log(`✅ Coordinates found in URL (alternative pattern): ${latitude}, ${longitude}`);
      return { latitude: latitude.toString(), longitude: longitude.toString() };
    }
    
    // Method 3: Try to extract from place data in the page
    try {
      console.log('🔍 Trying to extract coordinates from page data...');
      
      // Look for coordinates in page scripts or data attributes
      const coordinates = await page.evaluate(() => {
        // Try to find coordinates in window data
        if (window.APP_INITIALIZATION_STATE) {
          const initState = window.APP_INITIALIZATION_STATE;
          const initStateStr = JSON.stringify(initState);
          
          // Look for coordinate patterns in the initialization state
          const coordMatch = initStateStr.match(/(-?\d+\.\d{6,}),(-?\d+\.\d{6,})/g);
          if (coordMatch && coordMatch.length > 0) {
            const coords = coordMatch[0].split(',');
            return {
              latitude: parseFloat(coords[0]),
              longitude: parseFloat(coords[1])
            };
          }
        }
        
        // Try to extract from meta tags or other data attributes
        const metaTags = document.querySelectorAll('meta[property*="geo"], meta[name*="geo"]');
        for (const meta of metaTags) {
          const content = meta.getAttribute('content');
          if (content && content.includes(',')) {
            const coords = content.split(',');
            if (coords.length >= 2) {
              const lat = parseFloat(coords[0].trim());
              const lng = parseFloat(coords[1].trim());
              if (!isNaN(lat) && !isNaN(lng)) {
                return { latitude: lat, longitude: lng };
              }
            }
          }
        }
        
        return null;
      });
      
      if (coordinates && coordinates.latitude && coordinates.longitude) {
        console.log(`✅ Coordinates found in page data: ${coordinates.latitude}, ${coordinates.longitude}`);
        return { 
          latitude: coordinates.latitude.toString(), 
          longitude: coordinates.longitude.toString() 
        };
      }
    } catch (evalError) {
      console.log('⚠️ Could not extract coordinates from page data:', evalError.message);
    }
    
    // Method 4: Try to extract from share button or URL sharing functionality
    try {
      console.log('🔍 Looking for share button to get coordinates...');
      
      // Look for share button
      const shareSelectors = [
        'button[data-value="Share"]',
        'button[aria-label*="Share"]',
        'button[aria-label*="Compartir"]',
        'button[aria-label*="Teilen"]',
        'button[aria-label*="Partager"]',
        '[data-item-id="share"]',
        'button[jsaction*="share"]'
      ];
      
      for (const selector of shareSelectors) {
        const shareButton = page.locator(selector).first();
        const count = await shareButton.count();
        
        if (count > 0) {
          console.log(`🔗 Found share button with selector: ${selector}`);
          
          // Click share button
          await shareButton.click();
          await page.waitForTimeout(2000);
          
          // Look for URL in share modal or clipboard
          const shareUrl = await page.evaluate(() => {
            // Look for input fields that might contain the share URL
            const inputs = document.querySelectorAll('input[value*="maps.google"], input[value*="goo.gl"]');
            for (const input of inputs) {
              if (input.value && input.value.includes('maps.google')) {
                return input.value;
              }
            }
            
            // Look for text content that might contain URL
            const textElements = document.querySelectorAll('div[role="dialog"] div, div[role="dialog"] span');
            for (const element of textElements) {
              const text = element.textContent || '';
              if (text.includes('maps.google.com') || text.includes('goo.gl')) {
                return text;
              }
            }
            
            return null;
          });
          
          if (shareUrl) {
            console.log(`🔍 Found share URL: ${shareUrl}`);
            
            // Extract coordinates from share URL
            const shareCoordMatch = shareUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+\.?\d*)z/);
            if (shareCoordMatch) {
              const latitude = parseFloat(shareCoordMatch[1]);
              const longitude = parseFloat(shareCoordMatch[2]);
              console.log(`✅ Coordinates found in share URL: ${latitude}, ${longitude}`);
              
              // Close share modal by pressing Escape
              await page.keyboard.press('Escape');
              
              return { latitude: latitude.toString(), longitude: longitude.toString() };
            }
          }
          
          // Close share modal by pressing Escape
          await page.keyboard.press('Escape');
          break;
        }
      }
    } catch (shareError) {
      console.log('⚠️ Could not extract coordinates from share functionality:', shareError.message);
    }
    
    console.log('❌ No coordinates found using any method');
    return { latitude: '', longitude: '' };
    
  } catch (error) {
    console.error('❌ Error extracting coordinates:', error);
    return { latitude: '', longitude: '' };
  }
}

/**
 * Extracts opening hours from Google Maps with enhanced Swiss/European support
 * @param {Page} page - Playwright page
 * @returns {Promise<Object>} Opening hours by day
 */
async function extractOpeningHours(page) {
  const hours = {};
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
  try {
    console.log('🕒 Attempting to extract opening hours...');
    
    // Try multiple strategies to find and expand hours section
    const hoursSectionSelectors = [
      '[data-item-id="oh"] button',                 // Standard hours button
      'button[aria-label*="Hours"]',                // Hours button (English)
      'button[aria-label*="Horarios"]',             // Hours button (Spanish)
      'button[aria-label*="Öffnungszeiten"]',       // Hours button (German)
      'button[aria-label*="Horaires"]',             // Hours button (French)
      'button[aria-label*="Orari"]',                // Hours button (Italian)
      '[data-item-id="oh"]',                        // Hours section without button
      '.section-open-hours-container button',       // Hours container button
      '.section-info-hours button'                  // Info hours button
    ];
    
    let hoursExpanded = false;
    for (const selector of hoursSectionSelectors) {
      try {
        const hoursButton = page.locator(selector).first();
        if (await hoursButton.count() > 0) {
          console.log(`🔍 Found hours button with selector: ${selector}`);
          await hoursButton.click();
          await page.waitForTimeout(1500);
          hoursExpanded = true;
          break;
        }
      } catch (error) {
        console.log(`⚠️ Hours button click failed for ${selector}: ${error.message}`);
        continue;
      }
    }
    
    // Try multiple selectors for hours rows
    const hourRowSelectors = [
      '.t39EBf .y0skZc',                           // Standard hours rows
      '[data-item-id="oh"] .y0skZc',               // Hours in oh section
      '.section-open-hours-container .y0skZc',     // Hours container rows
      '.section-info-hours .y0skZc',               // Info hours rows
      '[aria-label*="hours"] .y0skZc',             // Hours with aria label
      '.opening-hours .y0skZc',                    // Opening hours rows
      '.t39EBf div[class*="fontBody"]',            // Hours with font body class
      '[data-item-id="oh"] div[role="row"]',       // Hours as table rows
      '.section-open-hours div[class*="fontBody"]' // Hours section with font body
    ];
    
    let hoursFound = false;
    for (const selector of hourRowSelectors) {
      try {
        const hoursRows = await page.locator(selector).all();
        console.log(`📊 Found ${hoursRows.length} hour rows with selector: ${selector}`);
        
        if (hoursRows.length > 0) {
          for (let i = 0; i < Math.min(hoursRows.length, days.length); i++) {
            const dayElement = hoursRows[i];
            const dayText = await dayElement.textContent();
            
            if (dayText && dayText.trim()) {
              const day = days[i];
              hours[day] = dayText.trim();
              console.log(`📅 ${day}: ${dayText.trim()}`);
            }
          }
          hoursFound = true;
          break;
        }
      } catch (error) {
        console.log(`⚠️ Hours extraction failed for ${selector}: ${error.message}`);
        continue;
      }
    }
    
    if (!hoursFound) {
      console.log('⚠️ No opening hours found with standard selectors, trying alternative approach...');
      
      // Alternative approach: look for any text containing time patterns
      const timePatternSelectors = [
        'span:contains(":")',                       // Any span with colon (time)
        'div:contains("–")',                       // Any div with time range dash
        'span:contains("a.m.")',                   // AM/PM times
        'span:contains("p.m.")',                   // AM/PM times
        '[aria-label*="open"]',                    // Open status
        '[aria-label*="closed"]',                  // Closed status
        '.fontBodyMedium:contains(":")'            // Medium font with time
      ];
      
      for (const selector of timePatternSelectors) {
        try {
          const elements = await page.locator(selector).all();
          if (elements.length > 0) {
            console.log(`🕐 Found ${elements.length} potential time elements`);
            // This is a fallback - would need more complex parsing
            break;
          }
        } catch (error) {
          continue;
        }
      }
    }
    
    console.log(`✅ Extracted opening hours for ${Object.keys(hours).length} days`);
    
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
    rating: '',
    reviewsCount: '',
    website: '',
    category: '',
    latitude: '',
    longitude: '',
    socialMedia: {},
    openingHours: {},
    scrapedAt: new Date().toISOString(),
    status: 'failed',
    error: error
  };
}

console.log('✅ Web scraper module loaded');