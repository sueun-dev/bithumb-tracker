const fs = require('fs').promises;
const fsSync = require('fs');
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

    // 초기화는 별도 메서드로 이동 (constructor는 async 불가)
    this.initialized = false;
    this.initPromise = this.initialize();
  }

  // 비동기 초기화 메서드
  async initialize() {
    try {
      // 디렉토리 존재 확인 (비동기)
      await fs.access(this.dataDir);
    } catch (error) {
      // 디렉토리가 없으면 생성 (비동기)
      console.log(`📁 Creating data directory: ${this.dataDir}`);
      await fs.mkdir(this.dataDir, { recursive: true });
    }
    this.initialized = true;
    return true;
  }

  // 초기화 대기 헬퍼
  async ensureInitialized() {
    if (!this.initialized) {
      await this.initPromise;
    }
  }

  // 파일 존재 확인 (비동기)
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Save data to CSV (완전 비동기)
  async saveData(coinsData) {
    try {
      await this.ensureInitialized();

      const timestamp = new Date().toISOString();
      const records = [];

      // Convert object to array for CSV
      Object.entries(coinsData).forEach(([, data]) => {
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

      // 파일 존재 확인 (비동기)
      const fileExists = await this.fileExists(this.csvPath);

      const writer = createCsvWriter({
        path: this.csvPath,
        header: this.csvHeader,
        append: fileExists,
        headerIdDelimiter: '.'
      });

      await writer.writeRecords(records);

      // Save last update time (비동기)
      await fs.writeFile(
        this.lastUpdatePath,
        JSON.stringify({
          lastUpdate: timestamp,
          recordCount: records.length
        }, null, 2)
      );

      console.log(`✅ Saved ${records.length} records to CSV at ${timestamp}`);
      return true;
    } catch (error) {
      console.error('❌ Error saving data to CSV:', error);
      return false;
    }
  }

  // Load latest data from CSV (이미 비동기)
  async loadLatestData() {
    await this.ensureInitialized();

    // 파일 존재 확인 (비동기)
    const exists = await this.fileExists(this.csvPath);

    if (!exists) {
      console.log('📝 No existing CSV data found');
      return {};
    }

    return new Promise((resolve, reject) => {
      const latestData = {};
      const timestamps = new Set();

      // createReadStream은 이미 비동기 스트림
      fsSync.createReadStream(this.csvPath)
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

  // Get last update info (완전 비동기)
  async getLastUpdateInfo() {
    try {
      await this.ensureInitialized();

      // 파일 존재 확인 (비동기)
      const exists = await this.fileExists(this.lastUpdatePath);
      if (!exists) {
        return null;
      }

      // 파일 읽기 (비동기)
      const data = await fs.readFile(this.lastUpdatePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading last update info:', error);
      return null;
    }
  }

  // Clean old data (keep only last 7 days) - 완전 비동기
  async cleanOldData() {
    try {
      await this.ensureInitialized();

      // 파일 존재 확인 (비동기)
      const exists = await this.fileExists(this.csvPath);
      if (!exists) return;

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const keepData = [];

      await new Promise((resolve, reject) => {
        fsSync.createReadStream(this.csvPath)
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

  // 파일 시스템 상태 확인 (디버깅용)
  async getStorageStats() {
    try {
      await this.ensureInitialized();

      const stats = {};

      // CSV 파일 크기 확인 (비동기)
      if (await this.fileExists(this.csvPath)) {
        const csvStats = await fs.stat(this.csvPath);
        stats.csvSize = (csvStats.size / 1024 / 1024).toFixed(2) + ' MB';
        stats.csvModified = csvStats.mtime;
      }

      // 마지막 업데이트 파일 확인 (비동기)
      if (await this.fileExists(this.lastUpdatePath)) {
        const updateStats = await fs.stat(this.lastUpdatePath);
        stats.updateSize = updateStats.size + ' bytes';
        stats.updateModified = updateStats.mtime;
      }

      // 디렉토리 내 파일 목록 (비동기)
      const files = await fs.readdir(this.dataDir);
      stats.totalFiles = files.length;

      return stats;
    } catch (error) {
      console.error('Error getting storage stats:', error);
      return null;
    }
  }
}

module.exports = DataManager;