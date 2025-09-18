/** @jest-environment node */

import { EventEmitter } from 'events';
import { createServer as createDashboardServer } from '../server';

function getRoute(app: any, method: string, path: string) {
  const layer = app._router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }
  return layer.route.stack[0].handle;
}

function createMockResponse() {
  const res: any = {};
  res.statusCode = 200;
  res.headers = {};
  res.body = '';
  res.writeHead = jest.fn((_status: number, headers: Record<string, string>) => {
    res.headers = headers;
  });
  res.write = jest.fn((chunk: string) => {
    res.body += chunk;
  });
  res.end = jest.fn(() => {});
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
  });
  return res;
}

function invokeJsonRoute(app: any, method: 'get' | 'post', path: string, reqOverrides: any = {}) {
  const handler = getRoute(app, method, path);
  const req: any = { params: {}, query: {}, body: {}, ...reqOverrides };
  const res = createMockResponse();
  handler(req, res);
  return res;
}

describe('server createServer', () => {
  it('initializes data, saves snapshots, and schedules periodic updates', async () => {
    const savedData = {
      BTC: { symbol: 'BTC', code: 'BTC', name_kr: '비트코인', name_en: 'Bitcoin' }
    } as any;

    const freshData = {
      ETH: { symbol: 'ETH', code: 'ETH', name_kr: '이더리움', name_en: 'Ethereum' }
    } as any;

    const periodicData = {
      XRP: { symbol: 'XRP', code: 'XRP', name_kr: '리플', name_en: 'Ripple' }
    } as any;

    const dataManager = {
      loadLatestData: jest.fn().mockResolvedValue(savedData),
      saveData: jest.fn().mockResolvedValue(true),
      cleanOldData: jest.fn().mockResolvedValue(true)
    };

    const initialFetcher = { fetchAll: jest.fn().mockResolvedValue(freshData) } as any;
    const periodicFetcher = { fetchAll: jest.fn().mockResolvedValue(periodicData) } as any;

    const fetcherFactory = jest
      .fn()
      .mockReturnValueOnce(initialFetcher)
      .mockReturnValueOnce(periodicFetcher);

    const intervals: Array<() => Promise<void> | void> = [];
    const setIntervalFn = jest.fn((cb: any) => {
      intervals.push(cb);
      return Symbol('interval');
    });
    const clearIntervalFn = jest.fn();
    const logger = { log: jest.fn(), error: jest.fn() } as Console;

    const server = createDashboardServer({
      dataManager: dataManager as any,
      fetcherFactory,
      setIntervalFn,
      clearIntervalFn,
      logger
    });

    await server.initializeData();

    expect(dataManager.loadLatestData).toHaveBeenCalledTimes(1);
    expect(initialFetcher.fetchAll).toHaveBeenCalledTimes(1);
    expect(dataManager.saveData).toHaveBeenCalledWith(freshData);
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000);

    await intervals[0]();
    expect(periodicFetcher.fetchAll).toHaveBeenCalledTimes(1);
    expect(dataManager.saveData).toHaveBeenCalledWith(periodicData);

    const state = server.getState();
    expect(state.coinsCache).toEqual(periodicData);

    server.shutdown();
    expect(clearIntervalFn).toHaveBeenCalledTimes(1);
  });

  it('returns cached coin summary via /api/coins', () => {
    const server = createDashboardServer({ logger: { log: jest.fn(), error: jest.fn() } as Console });
    Object.assign(server.getState().coinsCache, {
      BTC: { symbol: 'BTC', code: 'BTC', name_kr: '비트코인', name_en: 'Bitcoin' }
    });

    const res = invokeJsonRoute(server.app, 'get', '/api/coins');

    expect(res.body.coins.BTC.symbol).toBe('BTC');
    expect(res.body.count).toBe(1);
  });

  it('provides coin detail merged with realtime ticker', async () => {
    const priceFetcher = jest.fn().mockResolvedValue({
      closing_price: '100',
      units_traded_24H: '10',
      fluctate_rate_24H: '5',
      fluctate_24H: '5',
      max_price: '110',
      min_price: '90'
    });

    const server = createDashboardServer({
      priceFetcher,
      logger: { log: jest.fn(), error: jest.fn() } as Console
    });

    const state = server.getState();
    state.coinsCache['BTC'] = {
      symbol: 'BTC',
      current_price: '95',
      volume: '8'
    } as any;
    state.coinsHistory['BTC'] = [];

    const handler = getRoute(server.app, 'get', '/api/coin/:symbol');
    const req: any = { params: { symbol: 'BTC' } };
    const res = createMockResponse();
    await handler(req, res);

    expect(priceFetcher).toHaveBeenCalledWith('BTC');
    expect(res.body.symbol).toBe('BTC');
    expect(res.body.current.realtime_price).toBe('100');
    expect(res.body.history.length).toBe(18);
    expect(res.body.comparison.price_change).toBeCloseTo(100);
  });

  it('streams cached and live data via SSE', async () => {
    const cached = { symbol: 'BTC', code: 'BTC' } as any;
    const live = { symbol: 'ETH', code: 'ETH' } as any;

    let lastFetcher: (EventEmitter & { start: () => void; stop: jest.Mock }) | undefined;

    const fetcherFactory = jest.fn(() => {
      const emitter = new EventEmitter() as EventEmitter & {
        start: () => void;
        stop: jest.Mock;
      };

      emitter.stop = jest.fn();
      emitter.start = () => {
        setImmediate(() => {
          emitter.emit('data', live);
          emitter.emit('complete');
        });
      };

      lastFetcher = emitter;
      return emitter;
    });

    const server = createDashboardServer({
      fetcherFactory,
      logger: { log: jest.fn(), error: jest.fn() } as Console
    });

    Object.assign(server.getState().coinsCache, { [cached.symbol]: cached });

    const handler = getRoute(server.app, 'get', '/api/stream');
    const req = new EventEmitter() as any;
    const res = createMockResponse();

    handler(req, res);

    await new Promise((resolve) => setImmediate(resolve));

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream' }));
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify(cached)}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify(live)}\n\n`);

    req.emit('close');
    expect(lastFetcher?.stop).toHaveBeenCalled();
  });

  it('logs an error when initialization fails', async () => {
    const logger = { log: jest.fn(), error: jest.fn() } as unknown as Console;
    const fetcherFactory = jest.fn(() => ({ fetchAll: jest.fn().mockRejectedValue(new Error('boom')) }));
    const server = createDashboardServer({
      dataManager: {
        loadLatestData: jest.fn().mockResolvedValue({}),
        saveData: jest.fn(),
        cleanOldData: jest.fn()
      } as any,
      fetcherFactory,
      logger
    });

    await server.initializeData();

    expect(logger.error).toHaveBeenCalledWith('❌ Error initializing data:', expect.any(Error));
  });
});
