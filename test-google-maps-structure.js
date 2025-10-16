/**
 * Test script to inspect current Google Maps HTML structure
 * Run with: node test-google-maps-structure.js
 */

import { chromium } from 'playwright';

async function inspectGoogleMapsStructure() {
  console.log('🚀 Starting Google Maps structure inspection...\n');
  
  const browser = await chromium.launch({ headless: false }); // Set to false to see browser
  
  try {
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'Europe/Zurich',
      permissions: ['geolocation'],
      geolocation: { latitude: 47.3769, longitude: 8.5417 }, // Zürich coordinates
    });
    
    const page = await context.newPage();
    
    // Test with a Swiss business
    const testQuery = 'Coop Supermarkt Zürich Bahnhofbrücke';
    const testCity = 'Zürich';
    const centerCoords = '47.3769,8.5417'; // Zürich center
    
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(testQuery + ' ' + testCity)}?hl=en&center=${centerCoords}&zoom=13`;
    
    console.log(`🔍 Testing URL: ${mapsUrl}\n`);
    
    await page.goto(mapsUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Click on first result
    console.log('🖱️ Clicking on first business result...\n');
    const firstResult = page.locator('a[href*="/maps/place/"]').first();
    if (await firstResult.count() > 0) {
      await firstResult.click();
      await page.waitForTimeout(3000);
    }
    
    // Inspect hours button and structure
    console.log('🕒 Inspecting hours section structure...\n');
    
    const hoursButtonSelectors = [
      '[data-item-id="oh"] button',
      'button[aria-label*="Hours"]',
      'button[aria-label*="hours"]',
    ];
    
    for (const selector of hoursButtonSelectors) {
      const button = page.locator(selector).first();
      if (await button.count() > 0) {
        console.log(`✅ Found hours button: ${selector}`);
        const ariaLabel = await button.getAttribute('aria-label');
        console.log(`   aria-label: ${ariaLabel}`);
        
        // Click to expand
        await button.click();
        await page.waitForTimeout(2000);
        break;
      }
    }
    
    // Extract hours structure
    console.log('\n📊 Extracting hours HTML structure...\n');
    
    const hoursHTML = await page.evaluate(() => {
      const hoursSection = document.querySelector('[data-item-id="oh"]');
      if (!hoursSection) return 'Hours section not found';
      
      return hoursSection.innerHTML;
    });
    
    console.log('Hours section HTML (first 2000 chars):');
    console.log('='.repeat(80));
    console.log(hoursHTML.substring(0, 2000));
    console.log('='.repeat(80));
    
    // Extract hour rows with multiple methods
    console.log('\n🔍 Testing different hour row selectors...\n');
    
    const testSelectors = [
      '.t39EBf .y0skZc',
      '[data-item-id="oh"] .y0skZc',
      '[data-item-id="oh"] div[class*="fontBody"]',
      '[data-item-id="oh"] table tr',
      '[data-item-id="oh"] [role="row"]',
      '.t39EBf table tbody tr',
    ];
    
    for (const selector of testSelectors) {
      const rows = await page.locator(selector).all();
      console.log(`\n📌 Selector: ${selector}`);
      console.log(`   Count: ${rows.length}`);
      
      if (rows.length > 0) {
        // Get first 3 rows
        for (let i = 0; i < Math.min(3, rows.length); i++) {
          const text = await rows[i].textContent();
          const html = await rows[i].evaluate(el => el.outerHTML);
          console.log(`   Row ${i + 1} text: "${text?.trim()}"`);
          console.log(`   Row ${i + 1} HTML: ${html.substring(0, 200)}...`);
        }
      }
    }
    
    // Check for table structure
    console.log('\n📋 Checking for table structure...\n');
    const tableStructure = await page.evaluate(() => {
      const table = document.querySelector('[data-item-id="oh"] table');
      if (!table) return 'No table found';
      
      const rows = table.querySelectorAll('tr');
      const result = [];
      
      rows.forEach((row, index) => {
        const cells = row.querySelectorAll('td, th');
        const cellData = [];
        cells.forEach(cell => {
          cellData.push({
            text: cell.textContent?.trim(),
            class: cell.className,
            innerHTML: cell.innerHTML.substring(0, 100)
          });
        });
        result.push({ row: index + 1, cells: cellData });
      });
      
      return result;
    });
    
    console.log('Table structure:');
    console.log(JSON.stringify(tableStructure, null, 2));
    
    // Take screenshot
    await page.screenshot({ path: 'google-maps-structure.png', fullPage: true });
    console.log('\n📸 Screenshot saved: google-maps-structure.png');
    
    console.log('\n⏸️ Pausing for 60 seconds for manual inspection...');
    console.log('   Check the browser window and screenshot');
    await page.waitForTimeout(60000);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

inspectGoogleMapsStructure();
