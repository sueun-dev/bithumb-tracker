import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import { CoinData } from './types';
import CoinDetail from './CoinDetail';

// Theme Management Hook
const useTheme = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    // Check for saved theme preference or system preference
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) return savedTheme;

    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });

  useEffect(() => {
    // Apply theme to document
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      // Only update if user hasn't manually set a preference
      if (!localStorage.getItem('theme')) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  return { theme, toggleTheme };
};

// Theme Toggle Component
const ThemeToggle: React.FC<{ theme: 'light' | 'dark'; onToggle: () => void }> = ({ theme, onToggle }) => {
  return (
    <div className="theme-toggle">
      <span className="theme-label">☀️</span>
      <button
        className={`theme-switch ${theme === 'dark' ? 'active' : ''}`}
        onClick={onToggle}
        aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      >
        <div className="theme-switch-thumb">
          {theme === 'light' ? '☀️' : '🌙'}
        </div>
      </button>
      <span className="theme-label">🌙</span>
    </div>
  );
};

const DIRECT_FETCH_LIMIT = 40;
const DIRECT_REFRESH_INTERVAL = 60_000;

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function fetchCoinDetailDirect(coin: any): Promise<CoinData | null> {
  const symbol = coin.coinSymbol;
  const code = coin.coinType;
  const coinData: CoinData = {
    symbol,
    code,
    name_kr: coin.coinName,
    name_en: coin.coinNameEn,
    circulation: null,
    circulation_change: null,
    holders: null,
    holder_influence: null,
    trader_influence: null
  };

  try {
    const [circulation, holders, holderShare, traderShare] = await Promise.allSettled([
      fetchJson(`https://gw.bithumb.com/exchange/v1/trade/accumulation/deposit/${code}-C0100`),
      fetchJson(`https://gw.bithumb.com/exchange/v1/trade/holders/${code}`),
      fetchJson(`https://gw.bithumb.com/exchange/v1/trade/top/holder/share/${code}`),
      fetchJson(`https://gw.bithumb.com/exchange/v1/trade/top/trader/share/${code}`)
    ]);

    if (circulation.status === 'fulfilled' && circulation.value?.data?.data) {
      const d = circulation.value.data.data;
      coinData.circulation = d.accumulationDepositAmt ?? null;
      coinData.circulation_change = d.depositChangeRate ?? null;
    }

    if (holders.status === 'fulfilled' && holders.value?.data?.data) {
      const d = holders.value.data.data;
      coinData.holders = d.numberOfHolders ?? null;
    }

    if (holderShare.status === 'fulfilled' && holderShare.value?.data?.data) {
      const d = holderShare.value.data.data;
      coinData.holder_influence = d.holdingPercentage ?? null;
    }

    if (traderShare.status === 'fulfilled' && traderShare.value?.data?.data) {
      const d = traderShare.value.data.data;
      coinData.trader_influence = d.tradingPercentage ?? null;
    }

    return coinData;
  } catch (error) {
    // Silently handle error in production
    return null;
  }
}

function App() {
  // Theme Management
  const { theme, toggleTheme } = useTheme();

  // Application State
  const [coins, setCoins] = useState<{ [key: string]: CoinData }>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<keyof CoinData>('symbol');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [selectedCoin, setSelectedCoin] = useState<CoinData | null>(null);
  const directIntervalRef = React.useRef<number | null>(null);
  const [isDirectMode, setIsDirectMode] = useState(false);

  const formatNumber = (num: string | null) => {
    if (!num) return '-';
    const number = parseInt(num, 10);
    if (Number.isNaN(number)) return num;
    return number.toLocaleString('ko-KR');
  };

  const formatPercent = (percent: string | null) => {
    if (!percent) return '-';
    const num = parseFloat(percent);
    const color = num > 0 ? 'positive' : num < 0 ? 'negative' : '';
    return (
      <span className={color}>
        {num > 0 ? '+' : ''}{num}%
      </span>
    );
  };

  const stopDirectPolling = useCallback(() => {
    if (directIntervalRef.current !== null) {
      clearInterval(directIntervalRef.current);
      directIntervalRef.current = null;
    }
    setIsDirectMode(false);
  }, []);

  const fetchLiveCoinsDirect = useCallback(async () => {
    try {
      const response = await fetchJson('https://gw.bithumb.com/exchange/v1/comn/intro?coinType=&marketType=C0100');
      const coinList: any[] = response?.data?.data?.coinList ?? [];
      const limited = coinList.slice(0, DIRECT_FETCH_LIMIT);

      const next: Record<string, CoinData> = {};
      for (const coin of limited) {
        const detail = await fetchCoinDetailDirect(coin);
        if (detail) {
          next[detail.symbol] = detail;
        }
      }

      if (Object.keys(next).length === 0) {
        throw new Error('No coin data resolved');
      }

      setCoins(next);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (error) {
      // Silently handle error in production
      setLoading(false);
    }
  }, []);

  const startDirectPolling = useCallback(() => {
    if (directIntervalRef.current !== null) return;
    setIsDirectMode(true);
    fetchLiveCoinsDirect();
    directIntervalRef.current = window.setInterval(fetchLiveCoinsDirect, DIRECT_REFRESH_INTERVAL);
  }, [fetchLiveCoinsDirect]);

  const fetchData = useCallback(() => {
    // Use relative URL for production compatibility
    const apiUrl = window.location.hostname === 'localhost'
      ? 'http://localhost:3001/api/stream'
      : '/api/stream';
    const eventSource = new EventSource(apiUrl);

    eventSource.onmessage = (event) => {
      try {
        const coinData = JSON.parse(event.data);
        stopDirectPolling();
        setCoins(prev => ({
          ...prev,
          [coinData.symbol]: coinData
        }));
        setLastUpdate(new Date());
        setLoading(false);
      } catch (error) {
        // Silently handle parse error
      }
    };

    eventSource.onerror = () => {
      // Silently handle stream error and fallback to direct polling
      eventSource.close();
      startDirectPolling();
    };

    return () => {
      eventSource.close();
    };
  }, [startDirectPolling, stopDirectPolling]);

  useEffect(() => {
    const cleanup = fetchData();
    return () => {
      cleanup?.();
      stopDirectPolling();
    };
  }, [fetchData, stopDirectPolling]);

  const handleSort = (key: keyof CoinData) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const filteredAndSortedCoins = Object.values(coins)
    .filter(coin =>
      coin.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      coin.name_kr.toLowerCase().includes(searchTerm.toLowerCase()) ||
      coin.name_en.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      const numericFields: Array<keyof CoinData> = ['circulation', 'circulation_change', 'holders', 'holder_influence', 'trader_influence'];

      if (numericFields.includes(sortKey)) {
        // null이나 빈 값 처리
        if (aVal === null || aVal === undefined || aVal === '') {
          return sortOrder === 'asc' ? 1 : -1;  // null 값은 뒤로
        }
        if (bVal === null || bVal === undefined || bVal === '') {
          return sortOrder === 'asc' ? -1 : 1;  // null 값은 뒤로
        }

        const aNum = parseFloat(String(aVal).replace(/,/g, '').replace(/%/g, ''));
        const bNum = parseFloat(String(bVal).replace(/,/g, '').replace(/%/g, ''));

        // NaN 체크
        if (isNaN(aNum)) return sortOrder === 'asc' ? 1 : -1;
        if (isNaN(bNum)) return sortOrder === 'asc' ? -1 : 1;

        const comparison = aNum - bNum;
        return sortOrder === 'asc' ? comparison : -comparison;
      }

      const aStr = String(aVal || '');
      const bStr = String(bVal || '');
      const comparison = aStr.localeCompare(bStr, 'ko-KR');
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const totalPages = Math.ceil(filteredAndSortedCoins.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentCoins = filteredAndSortedCoins.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <h1>빗썸 거래소 데이터를 불러오는 중...</h1>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="header">
        <div className="header-content">
          <div className="header-left">
            <div className="logo-section">
              <div className="logo">B</div>
              <h1>빗썸 실시간 대시보드</h1>
            </div>
          </div>
          <div className="header-right">
            <div className="header-info">
              <div className="update-info">
                30분마다 자동 업데이트
                {Object.values(coins).some(c => c.last_update) ? (
                  <span className="last-update-time">
                    (30분 업데이트: {new Date(Object.values(coins).find(c => c.last_update)?.last_update || '').toLocaleTimeString('ko-KR')})
                  </span>
                ) : (
                  <span className="last-update-time">
                    (최근 데이터: {lastUpdate.toLocaleTimeString('ko-KR')})
                  </span>
                )}
              </div>
              <div className="connection-status">
                <span className="status-dot"></span>
                {isDirectMode ? '직접 API' : '실시간'}: {Object.keys(coins).length}개 코인
              </div>
            </div>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </header>

      <div className="controls">
        <div className="controls-inner">
          <div className="search-container">
            <input
              type="text"
              placeholder="코인 검색 (심볼, 한글명, 영문명)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <span className="search-icon">🔍</span>
          </div>
          <div className="stats">
            <div className="stat-badge">
              <strong>{filteredAndSortedCoins.length}</strong>개 코인
            </div>
            <div className="stat-badge">
              페이지 <strong>{currentPage}/{totalPages || 1}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="table-container">
        <div className="table-wrapper">
          <table className="coin-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('symbol')} className="sortable">
                심볼 {sortKey === 'symbol' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('name_kr')} className="sortable">
                코인명 {sortKey === 'name_kr' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('holders')} className="sortable">
                보유자 수 {sortKey === 'holders' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('circulation')} className="sortable">
                빗썸 내부 유통량 {sortKey === 'circulation' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('circulation_change')} className="sortable">
                전일대비 유통량 {sortKey === 'circulation_change' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('holder_influence')} className="sortable">
                최상위 회원 영향도 (보유) {sortKey === 'holder_influence' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('trader_influence')} className="sortable">
                최상위 회원 영향도 (거래) {sortKey === 'trader_influence' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
            </tr>
          </thead>
          <tbody>
            {currentCoins.map((coin) => (
              <tr key={coin.symbol} onClick={() => setSelectedCoin(coin)}>
                <td>
                  <div className="symbol-cell">
                    <div className="coin-avatar">{coin.symbol.charAt(0)}</div>
                    <span className="symbol">{coin.symbol}</span>
                  </div>
                </td>
                <td>
                  <div className="coin-name">
                    <div className="name-kr">{coin.name_kr}</div>
                    <div className="name-en">{coin.name_en}</div>
                  </div>
                </td>
                <td className="number">
                  <div className="metric-with-change">
                    <span>{formatNumber(coin.holders)}명</span>
                    {coin.holders_change && (
                      <span className={`change-indicator ${Number(coin.holders_change.percent) > 0 ? 'positive' : 'negative'}`}>
                        {Number(coin.holders_change.percent) > 0 ? '↑' : '↓'} {Math.abs(coin.holders_change.absolute)}명 ({coin.holders_change.percent}%)
                      </span>
                    )}
                  </div>
                </td>
                <td className="number">
                  <div className="metric-with-change">
                    <span>{formatNumber(coin.circulation)}</span>
                    {coin.circulation_30min_change && (
                      <span className={`change-indicator ${Number(coin.circulation_30min_change.percent) > 0 ? 'positive' : 'negative'}`}>
                        {Number(coin.circulation_30min_change.percent) > 0 ? '↑' : '↓'} {Math.abs(coin.circulation_30min_change.absolute).toLocaleString('ko-KR')} ({coin.circulation_30min_change.percent}%)
                      </span>
                    )}
                  </div>
                </td>
                <td className="percent">{formatPercent(coin.circulation_change)}</td>
                <td className="percent">
                  <div className="metric-with-change">
                    <span>{coin.holder_influence ? `${coin.holder_influence}%` : '-'}</span>
                    {coin.holder_influence_change && (
                      <span className={`change-indicator ${Number(coin.holder_influence_change.percent) > 0 ? 'positive' : 'negative'}`}>
                        {Number(coin.holder_influence_change.percent) > 0 ? '↑' : '↓'} {coin.holder_influence_change.percent}%
                      </span>
                    )}
                  </div>
                </td>
                <td className="percent">
                  <div className="metric-with-change">
                    <span>{coin.trader_influence ? `${coin.trader_influence}%` : '-'}</span>
                    {coin.trader_influence_change && (
                      <span className={`change-indicator ${Number(coin.trader_influence_change.percent) > 0 ? 'positive' : 'negative'}`}>
                        {Number(coin.trader_influence_change.percent) > 0 ? '↑' : '↓'} {coin.trader_influence_change.percent}%
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="pagination">
        <button
          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
          disabled={currentPage === 1}
        >
          이전
        </button>
        <span>페이지 {currentPage} / {totalPages || 1}</span>
        <button
          onClick={() => setCurrentPage(prev => Math.min(totalPages || 1, prev + 1))}
          disabled={currentPage === totalPages || totalPages === 0}
        >
          다음
        </button>
      </div>

      {selectedCoin && (
        <CoinDetail
          symbol={selectedCoin.symbol}
          name_kr={selectedCoin.name_kr}
          name_en={selectedCoin.name_en}
          onClose={() => setSelectedCoin(null)}
        />
      )}
    </div>
  );
}

export default App;
