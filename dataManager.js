const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const csvParser = require('csv-parser');

class DataManager {
  constructor(options = {}) {
    const { dataDir } = options;

    this.dataDir = dataDir || path.join(__dirname, 'data');
    this.csvPath = path.join(this.dataDir, 'bithumb_data.csv');
    this.lastUpdatePath = path.join(this.dataDir, 'last_update.json');
    this.csvHeader = [
      { id: 'timestamp', title: 'TIMESTAMP' },
      { id: 'symbol', title: 'SYMBOL' },
      { id: 'code', title: 'CODE' },
      { id: 'name_kr', title: 'NAME_KR' },
      { id: 'name_en', title: 'NAME_EN' },
      { id: 'holders', title: 'HOLDERS' },
      { id: 'circulation', title: 'CIRCULATION' },
      { id: 'circulation_change', title: 'CIRCULATION_CHANGE' },
      { id: 'holder_influence', title: 'HOLDER_INFLUENCE' },
      { id: 'trader_influence', title: 'TRADER_INFLUENCE' },
      { id: 'purity', title: 'PURITY' }
    ];

    // Create data directory if it doesn't exist
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

  }

  // Save data to CSV
  async saveData(coinsData) {
    try {
      const timestamp = new Date().toISOString();
      const records = [];

      // Convert object to array for CSV
      Object.entries(coinsData).forEach(([symbol, data]) => {
        records.push({
          timestamp,
          symbol: data.symbol,
          code: data.code,
          name_kr: data.name_kr,
          name_en: data.name_en,
          holders: data.holders || '',
          circulation: data.circulation || '',
          circulation_change: data.circulation_change || '',
          holder_influence: data.holder_influence || '',
          trader_influence: data.trader_influence || '',
          purity: data.purity || ''
        });
      });

      const fileExists = fs.existsSync(this.csvPath);

      const writer = createCsvWriter({
        path: this.csvPath,
        header: this.csvHeader,
        append: fileExists,
        headerIdDelimiter: '.'
      });

      await writer.writeRecords(records);

      // Save last update time
      fs.writeFileSync(this.lastUpdatePath, JSON.stringify({
        lastUpdate: timestamp,
        recordCount: records.length
      }, null, 2));

      console.log(`✅ Saved ${records.length} records to CSV at ${timestamp}`);
      return true;
    } catch (error) {
      console.error('❌ Error saving data to CSV:', error);
      return false;
    }
  }

  // Load latest data from CSV
  async loadLatestData() {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.csvPath)) {
        console.log('📝 No existing CSV data found');
        resolve({});
        return;
      }

      const latestData = {};
      const timestamps = new Set();

      fs.createReadStream(this.csvPath)
        .pipe(csvParser({
          mapHeaders: ({ header }) => header.toLowerCase()
        }))
        .on('data', (row) => {
          timestamps.add(row.timestamp);
          // Keep only the latest entry for each symbol
          if (!latestData[row.symbol] || row.timestamp > latestData[row.symbol].timestamp) {
            latestData[row.symbol] = row;
          }
        })
        .on('end', () => {
          const uniqueTimestamps = Array.from(timestamps).sort().reverse();
          console.log(`📊 Loaded data from CSV:`);
          console.log(`   - Total unique timestamps: ${uniqueTimestamps.length}`);
          console.log(`   - Latest timestamp: ${uniqueTimestamps[0] || 'N/A'}`);
          console.log(`   - Total coins: ${Object.keys(latestData).length}`);
          resolve(latestData);
        })
        .on('error', (error) => {
          console.error('❌ Error reading CSV:', error);
          reject(error);
        });
    });
  }

  // Get last update info
  getLastUpdateInfo() {
    try {
      if (fs.existsSync(this.lastUpdatePath)) {
        const info = JSON.parse(fs.readFileSync(this.lastUpdatePath, 'utf8'));
        return info;
      }
    } catch (error) {
      console.error('Error reading last update info:', error);
    }
    return null;
  }

  // Clean old data (keep only last 7 days)
  async cleanOldData() {
    try {
      if (!fs.existsSync(this.csvPath)) return;

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const keepData = [];

      await new Promise((resolve, reject) => {
        fs.createReadStream(this.csvPath)
          .pipe(csvParser({
            mapHeaders: ({ header }) => header.toLowerCase()
          }))
          .on('data', (row) => {
            const rowDate = new Date(row.timestamp);
            if (rowDate > sevenDaysAgo) {
              keepData.push(row);
            }
          })
          .on('end', resolve)
          .on('error', reject);
      });

      // Rewrite file with cleaned data
      if (keepData.length > 0) {
        // Create new writer to overwrite file
        const cleanWriter = createCsvWriter({
          path: this.csvPath,
          header: this.csvHeader
        });

        await cleanWriter.writeRecords(keepData);
        console.log(`🗑️ Cleaned old data, kept ${keepData.length} records from last 7 days`);
      }
    } catch (error) {
      console.error('Error cleaning old data:', error);
    }
  }
}

module.exports = DataManager;
