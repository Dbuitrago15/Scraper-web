// Test script to verify UTF-8 encoding and BOM handling
// Tests the CSV parsing with European special characters

import fs from 'fs';
import csv from 'csv-parser';
import iconv from 'iconv-lite';
import chardet from 'chardet';
import { Readable } from 'stream';

/**
 * Test CSV parsing with UTF-8 BOM and special characters
 */
async function testEncodingParsing(filePath) {
  console.log('\n' + '='.repeat(80));
  console.log(`📁 Testing file: ${filePath}`);
  console.log('='.repeat(80) + '\n');

  // Read file as buffer
  const buffer = fs.readFileSync(filePath);
  
  console.log(`📊 File size: ${buffer.length} bytes`);
  console.log(`🔢 First 10 bytes: ${Array.from(buffer.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  
  // Check for UTF-8 BOM
  const hasBOM = buffer.length >= 3 && 
                 buffer[0] === 0xEF && 
                 buffer[1] === 0xBB && 
                 buffer[2] === 0xBF;
  
  console.log(`🔍 UTF-8 BOM detected: ${hasBOM ? '✅ YES' : '❌ NO'}`);
  
  // Detect encoding
  const detectedEncoding = chardet.detect(buffer);
  console.log(`🌐 Detected encoding: ${detectedEncoding}`);
  
  // Determine encoding to use
  let encoding = 'utf-8';
  if (detectedEncoding) {
    const encodingLower = detectedEncoding.toLowerCase();
    if (encodingLower.includes('utf-8') || encodingLower.includes('utf8')) {
      encoding = 'utf-8';
    } else if (encodingLower.includes('iso-8859') || encodingLower.includes('latin')) {
      encoding = 'iso-8859-1';
    } else if (encodingLower.includes('windows-1252') || encodingLower.includes('cp1252')) {
      encoding = 'windows-1252';
    }
  }
  
  console.log(`📝 Using encoding: ${encoding}\n`);
  
  // Remove BOM if present
  let processedBuffer = buffer;
  if (hasBOM) {
    console.log('🔧 Removing UTF-8 BOM...');
    processedBuffer = buffer.slice(3);
  }
  
  // Decode to UTF-8 string
  let csvString;
  try {
    csvString = iconv.decode(processedBuffer, encoding);
    console.log('✅ Successfully decoded buffer to UTF-8 string\n');
  } catch (error) {
    console.error('❌ Decoding error:', error.message);
    csvString = processedBuffer.toString('utf-8');
    console.log('⚠️ Fallback to default UTF-8\n');
  }
  
  // Show first line
  const lines = csvString.split('\n');
  console.log('📋 CSV Header:');
  console.log(`   ${lines[0]}\n`);
  
  // Parse CSV
  console.log('📊 Parsed Rows:\n');
  const rows = [];
  
  return new Promise((resolve, reject) => {
    const stream = Readable.from(csvString);
    
    stream
      .pipe(csv({
        skipEmptyLines: true,
        mapHeaders: ({ header }) => header.trim().toLowerCase()
      }))
      .on('data', (row) => {
        rows.push(row);
        
        // Print row with character analysis
        console.log('   Row ' + (rows.length) + ':');
        Object.entries(row).forEach(([key, value]) => {
          const hasSpecialChars = /[äöüßåæøàáâãèéêëìíîïòóôõùúûüçñ]/i.test(value);
          const specialCharIcon = hasSpecialChars ? '🌍' : '  ';
          console.log(`      ${specialCharIcon} ${key}: "${value}"`);
        });
        console.log('');
      })
      .on('end', () => {
        console.log('─'.repeat(80));
        console.log(`✅ Successfully parsed ${rows.length} rows`);
        
        // Character analysis
        const allText = JSON.stringify(rows);
        const specialChars = allText.match(/[äöüßåæøàáâãèéêëìíîïòóôõùúûüçñ]/gi) || [];
        const uniqueSpecialChars = [...new Set(specialChars)];
        
        if (uniqueSpecialChars.length > 0) {
          console.log(`🌍 Found ${specialChars.length} special character(s) of ${uniqueSpecialChars.length} unique type(s):`);
          console.log(`   ${uniqueSpecialChars.join(', ')}`);
        } else {
          console.log('ℹ️  No European special characters detected in this file');
        }
        
        console.log('─'.repeat(80) + '\n');
        resolve(rows);
      })
      .on('error', (error) => {
        console.error('❌ CSV parsing error:', error);
        reject(error);
      });
  });
}

/**
 * Create a test CSV file with UTF-8 BOM and special characters
 */
function createTestCSV() {
  const testData = [
    'name,address,city,postcode',
    'Bäckerei Müller,Hauptstraße 25,München,80331',
    'Café Zürich,Bürgerstraße 10,Zürich,8001',
    'Hälsokost Åkersberga,Kungsgatan 5,Göteborg,411 19',
    'Restaurant Røros,Storgata 15,Oslo,0150'
  ].join('\n');
  
  // Create buffer with UTF-8 BOM
  const utf8BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
  const textBuffer = Buffer.from(testData, 'utf-8');
  const fileBuffer = Buffer.concat([utf8BOM, textBuffer]);
  
  const testFilePath = 'test-european-chars.csv';
  fs.writeFileSync(testFilePath, fileBuffer);
  
  console.log(`\n✅ Created test file: ${testFilePath}`);
  console.log(`   - UTF-8 BOM: YES`);
  console.log(`   - Special characters: ä, ö, ü, ß, å, ø, Ü, Å\n`);
  
  return testFilePath;
}

/**
 * Main test execution
 */
async function runTests() {
  console.log('\n' + '█'.repeat(80));
  console.log('🧪 UTF-8 ENCODING & BOM HANDLING TEST SUITE');
  console.log('█'.repeat(80));
  
  try {
    // Test 1: Create and parse test file
    console.log('\n📝 TEST 1: Generated Test File with UTF-8 BOM');
    const testFile = createTestCSV();
    await testEncodingParsing(testFile);
    
    // Test 2: Parse user's actual file if it exists
    const userFile = 'Adresse-Öffnungszeiten2.csv';
    if (fs.existsSync(userFile)) {
      console.log('\n📝 TEST 2: User\'s Actual CSV File (Adresse-Öffnungszeiten2.csv)');
      await testEncodingParsing(userFile);
    } else {
      console.log(`\n⚠️  User file "${userFile}" not found in current directory`);
      console.log(`   Looking in: ${process.cwd()}`);
      console.log(`   Please copy the file to the project root directory`);
    }
    
    // Test 3: Parse without BOM
    console.log('\n📝 TEST 3: UTF-8 without BOM');
    const noBOMFile = 'test-no-bom.csv';
    const testDataNoBOM = 'name,city\nSüpermarket,München\nCafé,Zürich';
    fs.writeFileSync(noBOMFile, testDataNoBOM, 'utf-8');
    console.log(`✅ Created test file: ${noBOMFile} (no BOM)\n`);
    await testEncodingParsing(noBOMFile);
    
    console.log('\n' + '█'.repeat(80));
    console.log('✅ ALL TESTS COMPLETED SUCCESSFULLY');
    console.log('█'.repeat(80) + '\n');
    
    // Cleanup
    fs.unlinkSync(testFile);
    fs.unlinkSync(noBOMFile);
    console.log('🧹 Cleaned up test files\n');
    
  } catch (error) {
    console.error('\n' + '█'.repeat(80));
    console.error('❌ TEST FAILED');
    console.error('█'.repeat(80));
    console.error('\nError:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Run tests
runTests();
