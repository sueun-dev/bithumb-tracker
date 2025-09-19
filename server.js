const express = require('express');
const cors = require('cors');
const https = require('https');
const { BithumbFetcher } = require('./fetchBithumb');
const DataManager = require('./dataManager');

const PORT = 3001;
const HOST = '127.0.0.1';
const THIRTY_MINUTES = 30 * 60 * 1000;

function defaultPriceFetcher(symbol) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.bithumb.com',
      path: `/public/ticker/${symbol}_KRW`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status === '0000' && parsed.data) {
            resolve(parsed.data);
          } else {
            reject(new Error('API 응답 오류'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.end();
  });
}

// Helper function to calculate change between values
function calculateChange(newValue, oldValue) {
  if (!newValue || !oldValue) return null;

  const newNum = parseFloat(String(newValue).replace(/,/g, ''));
  const oldNum = parseFloat(String(oldValue).replace(/,/g, ''));

  if (isNaN(newNum) || isNaN(oldNum) || oldNum === 0) return null;

  const change = newNum - oldNum;
  const changePercent = (change / oldNum) * 100;

  return {
    absolute: change,
    percent: changePercent.toFixed(2)
  };
}

function createServer(options = {}) {
  const {
    dataManager = new DataManager(),
    fetcherFactory = () => new BithumbFetcher(),
    now = () => Date.now(),
    priceFetcher = defaultPriceFetcher,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    logger = console,
  } = options;

  const app = express();

  // CORS 설정 - 프로덕션과 개발 환경 모두 지원
  const corsOptions = {
    origin: function (origin, callback) {
      // 허용할 origin 목록
      const allowedOrigins = [
        // 개발 환경
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        // GCP 프로덕션 (현재 인스턴스)
        'http://34.44.60.202',
        'http://34.44.60.202:3000',
        'http://34.44.60.202:3001',
        'https://34.44.60.202',
        // 추가 도메인 (나중에 도메인 연결시)
        process.env.ALLOWED_DOMAIN
      ].filter(Boolean);

      // SSE나 같은 도메인 요청은 origin이 없을 수 있음
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.log(`⚠️ CORS blocked: ${origin}`);
        // 프로덕션에서는 에러 대신 false 반환 (더 안전)
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Length', 'X-Request-Id'],
    maxAge: 86400 // 24시간 preflight 캐시
  };

  app.use(cors(corsOptions));
  app.use(express.json());

  let coinsCache = {};
  let coinsHistory = {};
  let previousCache = {}; // Store previous values to calculate changes
  let lastHistorySave = now();
  let saveInterval = null;

  // SSE 연결 관리
  const sseConnections = new Map(); // 활성 연결 추적
  const MAX_SSE_CONNECTIONS = 100; // 최대 동시 연결 수
  const SSE_TIMEOUT = 5 * 60 * 1000; // 5분 타임아웃
  let connectionIdCounter = 0;

  async function initializeData() {
    try {
      const savedData = await dataManager.loadLatestData();
      if (savedData && Object.keys(savedData).length > 0) {
        logger.log('📂 Loaded existing data from CSV');
        coinsCache = Object.values(savedData).reduce((acc, coin) => {
          acc[coin.symbol] = coin;
          return acc;
        }, {});
      }

      logger.log('🔄 Fetching fresh data from Bithumb...');
      const fetcher = fetcherFactory();
      if (typeof fetcher.fetchAll !== 'function') {
        throw new Error('Fetcher must implement fetchAll()');
      }

      const freshData = await fetcher.fetchAll();

      if (freshData && Object.keys(freshData).length > 0) {
        coinsCache = freshData;
        await dataManager.saveData(freshData);
        logger.log('✅ Initial data saved to CSV');
      }

      await dataManager.cleanOldData();

      if (saveInterval) {
        clearIntervalFn(saveInterval);
      }

      saveInterval = setIntervalFn(async () => {
        logger.log('⏰ 30-minute update triggered');
        try {
          const periodicFetcher = fetcherFactory();
          const updatedData = await periodicFetcher.fetchAll();

          if (updatedData && Object.keys(updatedData).length > 0) {
            // Store previous values before updating
            previousCache = { ...coinsCache };

            // Calculate changes for each coin
            Object.keys(updatedData).forEach(symbol => {
              const newData = updatedData[symbol];
              const oldData = previousCache[symbol];

              if (oldData) {
                // Calculate changes for each metric
                newData.holders_change = calculateChange(newData.holders, oldData.holders);
                newData.circulation_30min_change = calculateChange(newData.circulation, oldData.circulation);
                newData.holder_influence_change = calculateChange(newData.holder_influence, oldData.holder_influence);
                newData.trader_influence_change = calculateChange(newData.trader_influence, oldData.trader_influence);

                // Include previous values for comparison
                newData.prev_holders = oldData.holders;
                newData.prev_circulation = oldData.circulation;
                newData.prev_holder_influence = oldData.holder_influence;
                newData.prev_trader_influence = oldData.trader_influence;

                // Timestamp for last update
                newData.last_update = new Date().toISOString();
              }
            });

            coinsCache = updatedData;
            await dataManager.saveData(updatedData);
            logger.log('✅ Periodic data update saved with change tracking');
          }
        } catch (error) {
          logger.error('❌ Error during periodic update:', error);
        }
      }, THIRTY_MINUTES);
    } catch (error) {
      logger.error('❌ Error initializing data:', error);
    }
  }

  app.get('/api/stream', (req, res) => {
    // 연결 수 제한 체크
    if (sseConnections.size >= MAX_SSE_CONNECTIONS) {
      logger.log(`⚠️ SSE connection limit reached (${MAX_SSE_CONNECTIONS})`);
      res.status(503).json({ error: 'Too many connections' });
      return;
    }

    // 고유 연결 ID 생성
    const connectionId = ++connectionIdCounter;
    const clientIp = req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Connection-Id': connectionId
    });

    // 연결 정보 저장
    const connectionInfo = {
      id: connectionId,
      response: res,
      ip: clientIp,
      startTime: Date.now(),
      timeout: null,
      fetcher: null,
      handlers: {}
    };

    // 타임아웃 설정 (5분 후 자동 종료)
    connectionInfo.timeout = setTimeout(() => {
      logger.log(`⏱️ SSE connection ${connectionId} timed out after 5 minutes`);
      cleanupConnection(connectionId);
    }, SSE_TIMEOUT);

    // 연결 추가
    sseConnections.set(connectionId, connectionInfo);
    logger.log(`✅ SSE connection ${connectionId} established (${sseConnections.size} active)`);

    // 캐시된 데이터 즉시 전송
    if (Object.keys(coinsCache).length > 0) {
      Object.values(coinsCache).forEach(coin => {
        res.write(`data: ${JSON.stringify(coin)}\n\n`);
      });
      logger.log(`📤 Sent ${Object.keys(coinsCache).length} cached coins to connection ${connectionId}`);
    }

    // 새 fetcher는 캐시가 비어있을 때만 생성
    if (Object.keys(coinsCache).length === 0) {
      const fetcher = fetcherFactory();
      connectionInfo.fetcher = fetcher;

      const handleData = (coinData) => {
        coinsCache[coinData.symbol] = coinData;

        const nowTs = now();
        if (nowTs - lastHistorySave >= THIRTY_MINUTES) {
          Object.keys(coinsCache).forEach(symbol => {
            if (!coinsHistory[symbol]) {
              coinsHistory[symbol] = [];
            }
            coinsHistory[symbol].push({
              ...coinsCache[symbol],
              timestamp: new Date().toISOString()
            });
            if (coinsHistory[symbol].length > 48) {
              coinsHistory[symbol].shift();
            }
          });
          lastHistorySave = nowTs;
        }

        // 모든 활성 연결에 데이터 전송
        sseConnections.forEach((conn) => {
          try {
            conn.response.write(`data: ${JSON.stringify(coinData)}\n\n`);
          } catch (err) {
            logger.error(`Failed to send data to connection ${conn.id}:`, err.message);
            cleanupConnection(conn.id);
          }
        });
      };

      const handleError = (error) => {
        logger.error('Fetcher error:', error);
      };

      const handleComplete = () => {
        logger.log('Fetch complete');
      };

      connectionInfo.handlers = { handleData, handleError, handleComplete };
      fetcher.on('data', handleData);
      fetcher.on('error', handleError);
      fetcher.on('complete', handleComplete);
      fetcher.start();
    }

    // 클라이언트 연결 종료 처리
    req.on('close', () => {
      cleanupConnection(connectionId);
    });

    // 에러 처리
    req.on('error', (err) => {
      logger.error(`SSE connection ${connectionId} error:`, err.message);
      cleanupConnection(connectionId);
    });

    // Keep-alive ping (30초마다)
    const keepAlive = setInterval(() => {
      try {
        res.write(':ping\n\n');
      } catch (err) {
        clearInterval(keepAlive);
        cleanupConnection(connectionId);
      }
    }, 30000);

    connectionInfo.keepAlive = keepAlive;
  });

  // 연결 정리 함수
  function cleanupConnection(connectionId) {
    const connection = sseConnections.get(connectionId);
    if (!connection) return;

    // 타임아웃 클리어
    if (connection.timeout) {
      clearTimeout(connection.timeout);
    }

    // Keep-alive 클리어
    if (connection.keepAlive) {
      clearInterval(connection.keepAlive);
    }

    // Fetcher 정리
    if (connection.fetcher && connection.handlers) {
      connection.fetcher.removeListener('data', connection.handlers.handleData);
      connection.fetcher.removeListener('error', connection.handlers.handleError);
      connection.fetcher.removeListener('complete', connection.handlers.handleComplete);
      connection.fetcher.stop();
    }

    // Response 종료
    try {
      connection.response.end();
    } catch (err) {
      // Already closed
    }

    // 연결 제거
    sseConnections.delete(connectionId);
    logger.log(`🔌 SSE connection ${connectionId} closed (${sseConnections.size} active)`);
  }

  app.get('/api/coins', (req, res) => {
    res.json({
      coins: coinsCache,
      count: Object.keys(coinsCache).length,
      lastUpdate: new Date().toISOString()
    });
  });

  app.get('/api/coin/:symbol', async (req, res) => {
    const { symbol } = req.params;

    try {
      // 현재 실시간 가격 가져오기
      const currentData = await priceFetcher(symbol);

      // 캐시된 코인 데이터 (보유자수, 유통량 등)
      const cachedData = coinsCache[symbol] || {};

      // 3시간 전부터 현재까지 10분 간격으로 가격 데이터 가져오기 (candlestick API 사용)
      const candlestickResponse = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.bithumb.com',
          path: `/public/candlestick/${symbol}_KRW/10m`,  // 10분봉 데이터
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (e) {
              reject(e);
            }
          });
        });

        req.on('error', (e) => {
          reject(e);
        });

        req.end();
      });

      // 3시간 = 180분 = 18개의 10분봉 데이터
      let priceHistory = [];
      if (candlestickResponse.status === '0000' && candlestickResponse.data) {
        // 최근 18개 데이터만 사용 (3시간)
        const recentData = candlestickResponse.data.slice(-18);
        priceHistory = recentData.map(item => ({
          timestamp: new Date(parseInt(item[0])).toISOString(),  // item[0]: 시간(timestamp)
          price: item[2],  // item[2]: 종가
          volume: item[5]  // item[5]: 거래량
        }));
      }

      // 전일 종가 (24시간 전 가격)
      const prevClosing = parseFloat(currentData.prev_closing_price || currentData.opening_price || '0');
      const currentPrice = parseFloat(currentData.closing_price || '0');

      res.json({
        symbol,
        current: {
          ...cachedData,  // 보유자수, 유통량 등 내부 API 데이터
          realtime_price: currentData.closing_price,
          realtime_volume: currentData.units_traded_24H,
          realtime_change_rate: currentData.fluctate_rate_24H,
          realtime_change_amount: currentData.fluctate_24H,
          realtime_high: currentData.max_price,
          realtime_low: currentData.min_price,
          realtime_timestamp: new Date().toISOString(),
          acc_trade_value_24H: currentData.acc_trade_value_24H,
          acc_trade_value: currentData.acc_trade_value,
          change_amount: currentData.fluctate_24H,
          opening_price: currentData.opening_price,
          prev_closing_price: currentData.prev_closing_price
        },
        previous: {
          current_price: currentData.prev_closing_price || currentData.opening_price
        },
        history: priceHistory,  // 3시간 가격 히스토리
        comparison: {
          price_change: currentPrice - prevClosing,
          price_change_percent: (prevClosing === 0 ? 0 : ((currentPrice - prevClosing) / prevClosing * 100)).toFixed(2)
          // 거래량 변화 제거
        }
      });
    } catch (error) {
      logger.error('Error fetching coin detail:', error);
      res.status(500).json({ error: 'Failed to fetch coin detail' });
    }
  });

  app.get('/', (req, res) => {
    res.send('Server running');
  });

  function shutdown() {
    logger.log('🛑 Shutting down server...');

    // 모든 SSE 연결 정리
    sseConnections.forEach((_, id) => {
      logger.log(`Closing SSE connection ${id}`);
      cleanupConnection(id);
    });

    // 정기 업데이트 인터벌 정리
    if (saveInterval) {
      clearIntervalFn(saveInterval);
      saveInterval = null;
    }

    logger.log('✅ Server shutdown complete');
  }

  return {
    app,
    initializeData,
    shutdown,
    getState: () => ({ coinsCache, coinsHistory })
  };
}

if (require.main === module) {
  const serverInstance = createServer();
  serverInstance.initializeData();

  const server = serverInstance.app.listen(PORT, HOST, () => {
    console.log(`Running on http://${HOST}:${PORT}`);
  });

  process.on('SIGINT', () => {
    console.log('\n🛑 Server shutting down...');
    serverInstance.shutdown();
    server.close(() => process.exit(0));
  });
}

module.exports = {
  createServer,
  fetchCurrentPrice: defaultPriceFetcher,
  PORT
};
