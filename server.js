const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const compression = require('compression');
const { body, param, query, validationResult } = require('express-validator');
const mongoSanitize = require('express-mongo-sanitize');
const { BithumbFetcher } = require('./fetchBithumb');
const DataManager = require('./dataManager');

// Load environment variables
require('dotenv').config();

// Configuration with environment variables
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const THIRTY_MINUTES = 30 * 60 * 1000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Validate required environment variables in production
if (NODE_ENV === 'production') {
  const requiredEnvVars = ['BITHUMB_API_KEY', 'BITHUMB_API_SECRET'];
  const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
    console.error('Please set them in your production environment');
    process.exit(1);
  }
}

function defaultPriceFetcher(symbol) {
  // Additional validation layer for safety
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) {
    return Promise.reject(new Error('Invalid symbol format'));
  }
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

  // Request tracking for DDoS protection
  const requestCounts = new Map(); // Track requests per IP
  const blacklistedIPs = new Set(); // Temporarily block abusive IPs
  const BLACKLIST_DURATION = 60 * 60 * 1000; // 1 hour blacklist
  const MAX_REQUESTS_PER_SECOND = 10; // Per IP per second limit

  // Compression middleware - reduces bandwidth usage (DDoS mitigation)
  app.use(compression({
    level: 6, // Balance between speed and compression
    threshold: 1024, // Only compress responses > 1kb
    filter: (req, res) => {
      // Don't compress SSE streams
      if (res.getHeader('Content-Type') === 'text/event-stream') {
        return false;
      }
      return compression.filter(req, res);
    }
  }));

  // IP Blacklist Middleware - MUST be first after compression
  app.use((req, res, next) => {
    const ip = getClientIP(req);

    if (blacklistedIPs.has(ip)) {
      logger.log(`🚫 Blocked blacklisted IP: ${ip}`);
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Track request rate per second
    const now = Date.now();
    const second = Math.floor(now / 1000);
    const key = `${ip}:${second}`;

    const count = requestCounts.get(key) || 0;
    if (count >= MAX_REQUESTS_PER_SECOND) {
      logger.log(`⚠️ Rate limit per second exceeded for IP: ${ip}`);
      blacklistedIPs.add(ip);
      setTimeout(() => blacklistedIPs.delete(ip), BLACKLIST_DURATION);
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    requestCounts.set(key, count + 1);

    // Clean old entries every 10 seconds
    if (Math.random() < 0.01) { // 1% chance to clean
      const cutoff = second - 10;
      for (const [k] of requestCounts) {
        const [, ts] = k.split(':');
        if (parseInt(ts) < cutoff) {
          requestCounts.delete(k);
        }
      }
    }

    next();
  });

  // Helper to get real client IP
  function getClientIP(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      // Take the first IP from the comma-separated list
      return forwardedFor.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || req.ip || 'unknown';
  }

  // Request timeout protection - prevent slowloris attacks
  app.use((req, res, next) => {
    // Set timeout for all requests (30 seconds)
    req.setTimeout(30000, () => {
      logger.log(`⏱️ Request timeout for ${getClientIP(req)}`);
      res.status(408).json({ error: 'Request timeout' });
    });

    // Set response timeout
    res.setTimeout(30000, () => {
      logger.log(`⏱️ Response timeout for ${getClientIP(req)}`);
      res.status(503).json({ error: 'Service unavailable' });
    });

    next();
  });

  // Security middleware - MUST be after IP tracking
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],  // React needs inline styles
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "http://localhost:*", "http://127.0.0.1:*", "http://34.44.60.202:*"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: [],
        blockAllMixedContent: []
      },
    },
    crossOriginEmbedderPolicy: false,  // For SSE
    hsts: false, // HTTPS는 선택적으로 사용 (자체 서명 인증서 지원)
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permittedCrossDomainPolicies: false
  }));

  // Additional security headers
  app.use((req, res, next) => {
    // Cache control for security
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Additional security headers
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Remove server header
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');

    next();
  });

  // Request sanitization - removes $ and . from req.body, req.query, req.params
  app.use(mongoSanitize({
    replaceWith: '_',
    onSanitize: ({ req, key }) => {
      logger.log(`⚠️ Sanitized dangerous character in ${key}`);
    }
  }));

  // Body parsing with strict size limits and type checking
  app.use(express.json({
    limit: '100kb',  // Strict limit for JSON (was 1mb)
    strict: true,     // Only accept arrays and objects
    type: 'application/json',
    verify: (req, res, buf) => {
      // Additional verification for suspicious payloads
      const str = buf.toString('utf8');
      // Check for potential JSON bomb patterns
      if (str.includes('999999999') || str.match(/{\s*{\s*{\s*{/)) {
        throw new Error('Suspicious payload detected');
      }
    }
  }));
  app.use(express.urlencoded({
    extended: false,  // Use simpler parsing (more secure)
    limit: '100kb',    // Strict limit
    parameterLimit: 50 // Limit number of parameters
  }));

  // Memory store for rate limiting (shared across all limiters)
  const rateLimitStore = new Map();

  // General rate limiter with progressive penalties
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    keyGenerator: (req) => getClientIP(req), // Use real IP
    handler: (req, res) => {
      const ip = getClientIP(req);
      logger.log(`🚫 Rate limit exceeded for IP: ${ip}`);
      // Add to blacklist for repeat offenders
      const violations = (rateLimitStore.get(`violations:${ip}`) || 0) + 1;
      rateLimitStore.set(`violations:${ip}`, violations);

      if (violations > 3) {
        blacklistedIPs.add(ip);
        setTimeout(() => blacklistedIPs.delete(ip), BLACKLIST_DURATION);
        logger.log(`⛔ IP blacklisted due to repeated violations: ${ip}`);
      }

      res.status(429).json({ error: 'Too many requests, please try again later.' });
    }
  });

  // Progressive slowdown - gradually delays responses for frequent requesters
  const speedLimiter = slowDown({
    windowMs: 15 * 60 * 1000, // 15 minutes
    delayAfter: 50, // Start delaying after 50 requests
    delayMs: (hits) => hits * 100, // Add 100ms delay per request over limit
    maxDelayMs: 5000, // Maximum delay of 5 seconds
    keyGenerator: (req) => getClientIP(req),
  });

  // Strict rate limiter for API endpoints with burst protection
  const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 20, // 20 requests per minute for API endpoints
    message: 'API rate limit exceeded.',
    skipSuccessfulRequests: false,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getClientIP(req),
    skip: (req) => {
      // Skip rate limiting for health checks from monitoring
      const ip = getClientIP(req);
      // Add your monitoring IPs here if needed
      const monitoringIPs = ['127.0.0.1', '::1'];
      return monitoringIPs.includes(ip);
    }
  });

  // Burst limiter - prevent rapid bursts
  const burstLimiter = rateLimit({
    windowMs: 1000, // 1 second
    max: 5, // Max 5 requests per second
    skipFailedRequests: true,
    keyGenerator: (req) => getClientIP(req),
  });

  // Very strict limiter for SSE connections with connection tracking
  const sseConnectionsPerIP = new Map();
  const MAX_SSE_PER_IP = 2; // Max 2 concurrent SSE connections per IP

  const sseLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 3, // Only 3 SSE connection attempts per IP per 5 minutes
    message: 'Too many stream connections.',
    skipSuccessfulRequests: false,
    keyGenerator: (req) => getClientIP(req),
    handler: (req, res) => {
      const ip = getClientIP(req);
      logger.log(`🚫 SSE rate limit exceeded for IP: ${ip}`);
      res.status(429).json({ error: 'Too many stream connections, please try again later.' });
    }
  });

  // Custom SSE connection limiter per IP
  const sseConnectionLimiter = (req, res, next) => {
    const ip = getClientIP(req);
    const currentConnections = sseConnectionsPerIP.get(ip) || 0;

    if (currentConnections >= MAX_SSE_PER_IP) {
      logger.log(`⚠️ Too many concurrent SSE connections from IP: ${ip}`);
      return res.status(429).json({ error: 'Too many concurrent connections' });
    }

    next();
  };

  // Apply rate limiting layers in order of strictness
  app.use(generalLimiter);   // General rate limit
  app.use(speedLimiter);     // Progressive slowdown
  app.use(burstLimiter);     // Burst protection

  // Input validation helper
  const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.log(`❌ Validation failed: ${JSON.stringify(errors.array())}`);
      return res.status(400).json({
        error: 'Invalid input parameters',
        details: process.env.NODE_ENV === 'development' ? errors.array() : undefined
      });
    }
    next();
  };

  // Custom validator for coin symbols - validates against actual cached coins
  const isValidCoinSymbol = (value) => {
    // Check format: 2-10 uppercase letters/numbers only
    if (!/^[A-Z0-9]{2,10}$/.test(value)) {
      throw new Error('Invalid symbol format');
    }
    // Reject dangerous patterns
    const dangerous = ['..', '/', '\\', '<', '>', '"', "'", '%', '&', '$', '#', '@', '!', '?', ':', ';', '__proto__', 'constructor', 'prototype'];
    if (dangerous.some(pattern => value.includes(pattern))) {
      throw new Error('Dangerous characters detected');
    }
    return true;
  };

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

  // Serve static files in production
  if (NODE_ENV === 'production') {
    // Serve static files from React build
    app.use(express.static(path.join(__dirname, 'build')));
  }

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
          logger.error('❌ Error during periodic update');
      // Never log full error details in production
      if (process.env.NODE_ENV === 'development') {
        console.error(error);
      }
        }
      }, THIRTY_MINUTES);
    } catch (error) {
      logger.error('❌ Error initializing data');
      // Never log full error details in production
      if (process.env.NODE_ENV === 'development') {
        console.error(error);
      }
    }
  }

  app.get('/api/stream',
    sseLimiter,              // Rate limiting for SSE
    sseConnectionLimiter,    // Per-IP connection limiting
    [
      // Validate headers to prevent injection
      query('client_id').optional().isAlphanumeric().isLength({ max: 50 }),
    ],
    handleValidationErrors,
    (req, res) => {
    // 연결 수 제한 체크
    if (sseConnections.size >= MAX_SSE_CONNECTIONS) {
      logger.log(`⚠️ SSE connection limit reached (${MAX_SSE_CONNECTIONS})`);
      res.status(503).json({ error: 'Too many connections' });
      return;
    }

    // 고유 연결 ID 생성
    const connectionId = ++connectionIdCounter;
    // Get validated client IP
    const clientIp = getClientIP(req);

    // Track SSE connection for this IP
    const currentCount = sseConnectionsPerIP.get(clientIp) || 0;
    sseConnectionsPerIP.set(clientIp, currentCount + 1);

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
            logger.error(`Failed to send data to connection ${conn.id}`);
            // Never expose error details
            cleanupConnection(conn.id);
          }
        });
      };

      const handleError = (error) => {
        logger.error('Fetcher error');
        // Never expose error details
        if (process.env.NODE_ENV === 'development') {
          console.error(error);
        }
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
      // Decrement SSE connection count for this IP
      const count = sseConnectionsPerIP.get(clientIp) || 0;
      if (count > 0) {
        sseConnectionsPerIP.set(clientIp, count - 1);
      }
    });

    // 에러 처리
    req.on('error', (err) => {
      logger.error(`SSE connection ${connectionId} error`);
      // Never log error details that could expose system info
      if (process.env.NODE_ENV === 'development') {
        console.error(err);
      }
      cleanupConnection(connectionId);
      // Decrement SSE connection count for this IP
      const count = sseConnectionsPerIP.get(clientIp) || 0;
      if (count > 0) {
        sseConnectionsPerIP.set(clientIp, count - 1);
      }
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

  app.get('/api/coins',
    apiLimiter,  // API rate limiting
    [
      // Validate query parameters
      query('sort').optional().isIn(['symbol', 'name', 'price', 'volume', 'holders']).withMessage('Invalid sort parameter'),
      query('limit').optional().isInt({ min: 1, max: 1000 }).toInt().withMessage('Limit must be between 1-1000'),
      query('offset').optional().isInt({ min: 0, max: 10000 }).toInt().withMessage('Invalid offset'),
    ],
    handleValidationErrors,
    (req, res) => {
    // Sanitize output data to prevent XSS
    const sanitizedCache = {};
    Object.keys(coinsCache).forEach(key => {
      // Only include safe keys
      if (/^[A-Z0-9]{2,10}$/.test(key)) {
        sanitizedCache[key] = {
          ...coinsCache[key],
          // Ensure all string values are safe
          symbol: String(coinsCache[key].symbol || '').substring(0, 10),
          code: String(coinsCache[key].code || '').substring(0, 10),
          name_kr: String(coinsCache[key].name_kr || '').substring(0, 100),
          name_en: String(coinsCache[key].name_en || '').substring(0, 100),
        };
      }
    });

    res.json({
      coins: sanitizedCache,
      count: Object.keys(sanitizedCache).length,
      lastUpdate: new Date().toISOString()
    });
  });

  app.get('/api/coin/:symbol',
    apiLimiter,  // API rate limiting
    [
      // CRITICAL: Validate symbol parameter to prevent injection attacks
      param('symbol')
        .trim()
        .toUpperCase()
        .custom(isValidCoinSymbol)
        .withMessage('Invalid coin symbol'),
    ],
    handleValidationErrors,
    async (req, res) => {
    // Symbol is now validated and safe to use
    const symbol = req.params.symbol.toUpperCase();

    try {
      // Validate symbol exists in cache first
      if (!coinsCache[symbol]) {
        logger.log(`⚠️ Symbol not found in cache: ${symbol}`);
        return res.status(404).json({ error: 'Coin not found' });
      }

      // 현재 실시간 가격 가져오기 (symbol is now validated)
      const currentData = await priceFetcher(symbol);

      // 캐시된 코인 데이터 (보유자수, 유통량 등)
      const cachedData = coinsCache[symbol] || {};

      // 3시간 전부터 현재까지 10분 간격으로 가격 데이터 가져오기 (candlestick API 사용)
      const candlestickResponse = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.bithumb.com',
          // Symbol is validated, but still use template literal safely
          path: `/public/candlestick/${encodeURIComponent(symbol)}_KRW/10m`,  // 10분봉 데이터
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
      logger.error('Error fetching coin detail');
      // Never expose internal errors to client
      if (process.env.NODE_ENV === 'development') {
        console.error(error);
      }
      // Generic error message - never expose details
      res.status(500).json({ error: 'Service temporarily unavailable' });
    }
  });

  // Catch-all route for React app - must be after all API routes
  app.get('*',
    rateLimit({
      windowMs: 1 * 60 * 1000,
      max: 30,  // Health checks can be more frequent
    }),
    (req, res) => {
    if (NODE_ENV === 'production' && fs.existsSync(path.join(__dirname, 'build', 'index.html'))) {
      res.sendFile(path.join(__dirname, 'build', 'index.html'));
    } else {
      res.send('Server running');
    }
  });

  // Circuit breaker for upstream API protection
  let circuitBreakerState = 'closed'; // closed, open, half-open
  let failureCount = 0;
  const FAILURE_THRESHOLD = 5;
  const CIRCUIT_RESET_TIMEOUT = 60000; // 1 minute

  function checkCircuitBreaker() {
    if (circuitBreakerState === 'open') {
      return false;
    }
    return true;
  }

  function recordSuccess() {
    failureCount = 0;
    if (circuitBreakerState === 'half-open') {
      circuitBreakerState = 'closed';
      logger.log('🔌 Circuit breaker closed');
    }
  }

  function recordFailure() {
    failureCount++;
    if (failureCount >= FAILURE_THRESHOLD) {
      circuitBreakerState = 'open';
      logger.log('⚡ Circuit breaker opened due to failures');
      setTimeout(() => {
        circuitBreakerState = 'half-open';
        logger.log('🔄 Circuit breaker half-open, testing...');
      }, CIRCUIT_RESET_TIMEOUT);
    }
  }

  // Global error handler with circuit breaker integration
  app.use((err, req, res, next) => {
    // Log generic message only
    logger.error('Unhandled error occurred');

    // Only log details in development
    if (process.env.NODE_ENV === 'development') {
      console.error(err);
    }

    // Record failure for circuit breaker (check without exposing)
    if (err && err.message) {
      const msg = String(err.message);
      if (msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED')) {
        recordFailure();
      }
    }

    // NEVER leak any error details to client
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
      error: statusCode === 404 ? 'Resource not found' : 'Service unavailable',
      // Never include error messages or stack traces
      code: statusCode
    });
  });

  // DDoS protection status endpoint (for monitoring)
  app.get('/api/ddos-status',
    rateLimit({
      windowMs: 1 * 60 * 1000,
      max: 10,
      keyGenerator: (req) => getClientIP(req),
    }),
    (req, res) => {
      const ip = getClientIP(req);
      // Only allow from localhost for security
      if (ip !== '127.0.0.1' && ip !== '::1') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      res.json({
        blacklistedIPs: blacklistedIPs.size,
        activeRequests: requestCounts.size,
        sseConnections: sseConnections.size,
        sseConnectionsPerIP: Array.from(sseConnectionsPerIP.entries()),
        circuitBreaker: circuitBreakerState,
        timestamp: new Date().toISOString()
      });
    }
  );

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

  // HTTP 서버
  const server = serverInstance.app.listen(PORT, HOST, () => {
    console.log(`📡 HTTP Server running on http://${HOST}:${PORT}`);
  });

  // HTTPS 서버 (프로덕션 환경에서만)
  if (NODE_ENV === 'production') {
    try {
      // 자체 서명 인증서 경로 (GCP 서버에서 생성해야 함)
      const httpsOptions = {
        key: fs.readFileSync('/etc/ssl/certs/bithumb/server.key'),
        cert: fs.readFileSync('/etc/ssl/certs/bithumb/server.crt')
      };

      const httpsServer = https.createServer(httpsOptions, serverInstance.app).listen(443, HOST, () => {
        console.log(`🔒 HTTPS Server running on https://${HOST}:443`);
      });

      process.on('SIGINT', () => {
        console.log('\n🛑 Servers shutting down...');
        serverInstance.shutdown();
        server.close();
        httpsServer.close(() => process.exit(0));
      });
    } catch (err) {
      console.log('⚠️  HTTPS 인증서를 찾을 수 없음. HTTP만 실행됩니다.');
      console.log('   인증서 생성 방법:');
      console.log('   sudo mkdir -p /etc/ssl/certs/bithumb');
      console.log('   sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\');
      console.log('     -keyout /etc/ssl/certs/bithumb/server.key \\');
      console.log('     -out /etc/ssl/certs/bithumb/server.crt \\');
      console.log('     -subj "/C=KR/ST=Seoul/L=Seoul/O=Bithumb/CN=34.44.60.202" \\');
      console.log('     -addext "subjectAltName=IP:34.44.60.202"');

      process.on('SIGINT', () => {
        console.log('\n🛑 Server shutting down...');
        serverInstance.shutdown();
        server.close(() => process.exit(0));
      });
    }
  } else {
    process.on('SIGINT', () => {
      console.log('\n🛑 Server shutting down...');
      serverInstance.shutdown();
      server.close(() => process.exit(0));
    });
  }
}

module.exports = {
  createServer,
  fetchCurrentPrice: defaultPriceFetcher,
  PORT
};
