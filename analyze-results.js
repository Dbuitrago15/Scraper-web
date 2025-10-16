#!/usr/bin/env node

/**
 * Diagnosis Script for Scraping Results
 * Analyzes CSV results and provides insights
 */

import fs from 'fs';
import csvParser from 'csv-parser';

async function analyzeResults(csvPath) {
  console.log('📊 Analyzing scraping results...\n');
  
  const results = [];
  const stats = {
    total: 0,
    success: 0,
    failed: 0,
    partial: 0,
    withHours: 0,
    withRating: 0,
    withReviews: 0,
    withPhone: 0,
    withWebsite: 0
  };

  return new Promise((resolve) => {
    fs.createReadStream(csvPath)
      .pipe(csvParser())
      .on('data', (row) => {
        results.push(row);
        stats.total++;
        
        if (row.Status === 'success') {
          stats.success++;
          
          // Check data completeness
          if (row['Monday Hours'] || row['Tuesday Hours']) stats.withHours++;
          if (row.Rating) stats.withRating++;
          if (row['Reviews Count']) stats.withReviews++;
          if (row.Phone) stats.withPhone++;
          if (row.Website) stats.withWebsite++;
          
          // Check if it's partial (has coordinates but missing data)
          const hasMinimalData = row.Rating || row.Phone || row['Monday Hours'];
          if (!hasMinimalData && (row.Latitude && row.Longitude)) {
            stats.partial++;
          }
        } else if (row.Status === 'failed') {
          stats.failed++;
        }
      })
      .on('end', () => {
        // Print overall stats
        console.log('═'.repeat(60));
        console.log('📈 OVERALL STATISTICS');
        console.log('═'.repeat(60));
        console.log(`Total businesses:     ${stats.total}`);
        console.log(`✅ Success:           ${stats.success} (${Math.round(stats.success/stats.total*100)}%)`);
        console.log(`❌ Failed:            ${stats.failed} (${Math.round(stats.failed/stats.total*100)}%)`);
        console.log(`⚠️  Partial success:  ${stats.partial} (${Math.round(stats.partial/stats.total*100)}%)`);
        console.log();
        
        // Data completeness
        console.log('═'.repeat(60));
        console.log('📋 DATA COMPLETENESS (of successful)');
        console.log('═'.repeat(60));
        const successRate = (count) => Math.round(count/stats.success*100);
        console.log(`🕒 With hours:        ${stats.withHours}/${stats.success} (${successRate(stats.withHours)}%)`);
        console.log(`⭐ With rating:       ${stats.withRating}/${stats.success} (${successRate(stats.withRating)}%)`);
        console.log(`💬 With reviews:      ${stats.withReviews}/${stats.success} (${successRate(stats.withReviews)}%)`);
        console.log(`📞 With phone:        ${stats.withPhone}/${stats.success} (${successRate(stats.withPhone)}%)`);
        console.log(`🌐 With website:      ${stats.withWebsite}/${stats.success} (${successRate(stats.withWebsite)}%)`);
        console.log();
        
        // Failed businesses
        if (stats.failed > 0) {
          console.log('═'.repeat(60));
          console.log('❌ FAILED BUSINESSES');
          console.log('═'.repeat(60));
          results
            .filter(r => r.Status === 'failed')
            .forEach((r, i) => {
              console.log(`${i+1}. ${r.Name || '(no name)'}`);
            });
          console.log();
        }
        
        // Partial success (coordinates only)
        if (stats.partial > 0) {
          console.log('═'.repeat(60));
          console.log('⚠️  PARTIAL SUCCESS (coordinates only, missing data)');
          console.log('═'.repeat(60));
          results
            .filter(r => r.Status === 'success' && r.Latitude && r.Longitude)
            .filter(r => !r.Rating && !r.Phone && !r['Monday Hours'])
            .forEach((r, i) => {
              console.log(`${i+1}. ${r.Name || '(no name)'}`);
              console.log(`   Address: ${r.Address || 'N/A'}`);
              console.log(`   Coords:  ${r.Latitude}, ${r.Longitude}`);
              console.log();
            });
        }
        
        // Hours format validation
        console.log('═'.repeat(60));
        console.log('🕒 HOURS FORMAT VALIDATION');
        console.log('═'.repeat(60));
        const hoursIssues = [];
        results
          .filter(r => r.Status === 'success' && r['Monday Hours'])
          .forEach(r => {
            const hour = r['Monday Hours'];
            // Check for 24h format (HH:MM - HH:MM)
            const is24h = /^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/.test(hour);
            const hasAmPm = /am|pm/i.test(hour);
            const hasBadFormat = /\d{4}:\d{2}/.test(hour); // Like "1221:00"
            
            if (!is24h && hour !== 'Closed' && hour !== 'Open 24 hours') {
              hoursIssues.push({ name: r.Name, hour, reason: 'Not 24h format' });
            } else if (hasAmPm) {
              hoursIssues.push({ name: r.Name, hour, reason: 'Contains am/pm' });
            } else if (hasBadFormat) {
              hoursIssues.push({ name: r.Name, hour, reason: 'Bad format (concatenated)' });
            }
          });
        
        if (hoursIssues.length === 0) {
          console.log('✅ All hours are in correct 24h format!');
        } else {
          console.log(`⚠️  Found ${hoursIssues.length} hours format issues:`);
          hoursIssues.forEach((issue, i) => {
            console.log(`${i+1}. ${issue.name}`);
            console.log(`   Hour: "${issue.hour}"`);
            console.log(`   Issue: ${issue.reason}`);
            console.log();
          });
        }
        console.log();
        
        // Success rate by pattern
        console.log('═'.repeat(60));
        console.log('📊 SUCCESS PATTERNS');
        console.log('═'.repeat(60));
        
        // Group by region (based on address)
        const regions = {};
        results.forEach(r => {
          if (r.Status !== 'success') return;
          
          const address = r.Address || '';
          let region = 'Unknown';
          
          if (address.includes('Switzerland') || address.includes('Schweiz')) region = 'Switzerland';
          else if (address.includes('Colombia')) region = 'Colombia';
          else if (address.includes('Spain')) region = 'Spain';
          else if (address.includes('Germany')) region = 'Germany';
          
          if (!regions[region]) regions[region] = { total: 0, withAllData: 0 };
          regions[region].total++;
          
          if (r.Rating && r.Phone && r['Monday Hours']) {
            regions[region].withAllData++;
          }
        });
        
        Object.entries(regions).forEach(([region, data]) => {
          const completeness = Math.round(data.withAllData / data.total * 100);
          console.log(`${region}: ${data.total} businesses, ${completeness}% with complete data`);
        });
        console.log();
        
        // Recommendations
        console.log('═'.repeat(60));
        console.log('💡 RECOMMENDATIONS');
        console.log('═'.repeat(60));
        
        if (stats.failed > 20) {
          console.log('⚠️  High failure rate! Consider:');
          console.log('   1. Adding full addresses to CSV');
          console.log('   2. Verifying business names match Google Maps exactly');
          console.log('   3. Adding postal codes for better geolocation');
        }
        
        if (stats.withRating < stats.success * 0.5) {
          console.log('⚠️  Low rating extraction rate. This is normal if:');
          console.log('   - Businesses are new');
          console.log('   - Businesses don\'t have Google reviews');
          console.log('   Consider: Manual verification of a few cases');
        }
        
        if (hoursIssues.length > 0) {
          console.log('⚠️  Hours format issues detected!');
          console.log('   Action: Check normalizeDayNames() function');
        }
        
        if (stats.partial > 5) {
          console.log('⚠️  Many partial successes (coordinates only)');
          console.log('   Possible causes:');
          console.log('   - Google Maps page structure changed');
          console.log('   - Selectors need updating');
          console.log('   Action: Check Docker logs for specific errors');
        }
        
        console.log();
        console.log('═'.repeat(60));
        console.log('✅ Analysis complete!');
        console.log('═'.repeat(60));
        
        resolve();
      });
  });
}

// Get CSV path from command line or use default
const csvPath = process.argv[2] || './scraping-results.csv';

if (!fs.existsSync(csvPath)) {
  console.error(`❌ File not found: ${csvPath}`);
  console.error('Usage: node analyze-results.js <path-to-csv>');
  process.exit(1);
}

analyzeResults(csvPath).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
