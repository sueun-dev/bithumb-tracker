/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const os = require('os');
const DataManager = require('../dataManager');

describe('DataManager', () => {
  let tempRoot;
  let dataDir;
  let manager;

  beforeEach(async () => {
    tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'data-manager-test-'));
    dataDir = path.join(tempRoot, 'data');
    manager = new DataManager({ dataDir });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  });

  it('saves CSV rows and last update metadata', async () => {
    const data = {
      BTC: {
        symbol: 'BTC',
        code: 'BTC',
        name_kr: '비트코인',
        name_en: 'Bitcoin',
        holders: '100',
        circulation: '1000',
        circulation_change: '1.2',
        holder_influence: '10',
        trader_influence: '8',
        purity: '99.9'
      }
    };

    const saved = await manager.saveData(data);
    expect(saved).toBe(true);

    const csvContent = await fs.promises.readFile(path.join(dataDir, 'bithumb_data.csv'), 'utf8');
    expect(csvContent).toContain('TIMESTAMP');
    expect(csvContent).toContain('BTC');

    const lastUpdate = JSON.parse(await fs.promises.readFile(path.join(dataDir, 'last_update.json'), 'utf8'));
    expect(lastUpdate).toHaveProperty('lastUpdate');
    expect(lastUpdate).toHaveProperty('recordCount', 1);

    const info = manager.getLastUpdateInfo();
    expect(info.recordCount).toBe(1);
  });

  it('returns the latest data per symbol when multiple snapshots exist', async () => {
    jest.useFakeTimers();
    const base = new Date('2024-01-01T00:00:00Z');

    jest.setSystemTime(base);
    await manager.saveData({
      BTC: {
        symbol: 'BTC',
        code: 'BTC',
        name_kr: '비트코인',
        name_en: 'Bitcoin',
        holders: '100'
      }
    });

    jest.setSystemTime(new Date(base.getTime() + 60 * 60 * 1000));
    await manager.saveData({
      BTC: {
        symbol: 'BTC',
        code: 'BTC',
        name_kr: '비트코인',
        name_en: 'Bitcoin',
        holders: '200'
      },
      ETH: {
        symbol: 'ETH',
        code: 'ETH',
        name_kr: '이더리움',
        name_en: 'Ethereum',
        holders: '50'
      }
    });

    const latest = await manager.loadLatestData();
    expect(Object.keys(latest)).toEqual(['BTC', 'ETH']);
    expect(latest.BTC.holders).toBe('200');
    expect(latest.ETH.holders).toBe('50');
  });

  it('cleans entries older than seven days and keeps recent data', async () => {
    jest.useFakeTimers();
    const now = new Date('2024-01-10T00:00:00Z');

    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    await manager.saveData({
      BTC: {
        symbol: 'BTC',
        code: 'BTC',
        name_kr: '비트코인',
        name_en: 'Bitcoin',
        holders: '10'
      }
    });

    jest.setSystemTime(now);
    await manager.saveData({
      BTC: {
        symbol: 'BTC',
        code: 'BTC',
        name_kr: '비트코인',
        name_en: 'Bitcoin',
        holders: '20'
      }
    });

    await manager.cleanOldData();

    const csvContent = await fs.promises.readFile(path.join(dataDir, 'bithumb_data.csv'), 'utf8');
    const rows = csvContent.trim().split('\n');
    expect(rows.length).toBe(2); // header + one recent row

    const latest = await manager.loadLatestData();
    expect(latest.BTC.holders).toBe('20');
  });

  it('returns null when last update info does not exist', () => {
    expect(manager.getLastUpdateInfo()).toBeNull();
  });

  it('loads empty object when CSV file is missing', async () => {
    const latest = await manager.loadLatestData();
    expect(latest).toEqual({});
  });
});
