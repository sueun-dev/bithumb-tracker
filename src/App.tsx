import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import './App.css';
import { CoinData } from './types';
import CoinDetail from './CoinDetail';
import ComparisonPage from './ComparisonPage';

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

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  }, []);

  return { theme, toggleTheme };
};

// Memoized Theme Toggle Component
const ThemeToggle = memo<{ theme: 'light' | 'dark'; onToggle: () => void }>(({ theme, onToggle }) => {
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
});
ThemeToggle.displayName = 'ThemeToggle';

// Memoized format functions
const formatNumber = (num: string | null): string => {
  if (!num) return '-';
  const number = parseInt(num, 10);
  if (Number.isNaN(number)) return num;
  return number.toLocaleString('ko-KR');
};

const FormatPercent = memo<{ percent: string | null }>(({ percent }) => {
  if (!percent) return <span>-</span>;
  const num = parseFloat(percent);
  const color = num > 0 ? 'positive' : num < 0 ? 'negative' : '';
  return (
    <span className={color}>
      {num > 0 ? '+' : ''}{num}%
    </span>
  );
});
FormatPercent.displayName = 'FormatPercent';

// Memoized Coin Row Component for All View
const CoinRow = memo<{
  coin: CoinData;
  onSelectCoin: (coin: CoinData) => void;
}>(({ coin, onSelectCoin }) => {
  const handleClick = useCallback(() => {
    onSelectCoin(coin);
  }, [coin, onSelectCoin]);

  return (
    <tr onClick={handleClick}>
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
              30분전 대비 {Number(coin.holders_change.percent) > 0 ? '↑' : '↓'} {Math.abs(coin.holders_change.absolute).toLocaleString('ko-KR')}명 ({coin.holders_change.percent}%)
            </span>
          )}
        </div>
      </td>
      <td className="number">
        <div className="metric-with-change">
          <span>{formatNumber(coin.circulation)}</span>
          {coin.circulation_30min_change && (
            <span className={`change-indicator ${Number(coin.circulation_30min_change.percent) > 0 ? 'positive' : 'negative'}`}>
              30분전 대비 {Number(coin.circulation_30min_change.percent) > 0 ? '↑' : '↓'} {Math.abs(coin.circulation_30min_change.absolute).toLocaleString('ko-KR')} ({coin.circulation_30min_change.percent}%)
            </span>
          )}
        </div>
      </td>
      <td className="percent">
        <FormatPercent percent={coin.circulation_change} />
      </td>
      <td className="percent">
        <div className="metric-with-change">
          <span>{coin.holder_influence ? `${coin.holder_influence}%` : '-'}</span>
          {coin.holder_influence_change && (
            <span className={`change-indicator ${Number(coin.holder_influence_change.percent) > 0 ? 'positive' : 'negative'}`}>
              30분전 대비 {Number(coin.holder_influence_change.percent) > 0 ? '↑' : '↓'} {Math.abs(coin.holder_influence_change.absolute).toFixed(2)}%p ({coin.holder_influence_change.percent}%)
            </span>
          )}
        </div>
      </td>
      <td className="percent">
        <div className="metric-with-change">
          <span>{coin.trader_influence ? `${coin.trader_influence}%` : '-'}</span>
          {coin.trader_influence_change && (
            <span className={`change-indicator ${Number(coin.trader_influence_change.percent) > 0 ? 'positive' : 'negative'}`}>
              30분전 대비 {Number(coin.trader_influence_change.percent) > 0 ? '↑' : '↓'} {Math.abs(coin.trader_influence_change.absolute).toFixed(2)}%p ({coin.trader_influence_change.percent}%)
            </span>
          )}
        </div>
      </td>
    </tr>
  );
});
CoinRow.displayName = 'CoinRow';

// Memoized Change Row Component - for 30-minute changes view
const ChangeRow = memo<{
  coin: CoinData;
  onSelectCoin: (coin: CoinData) => void;
}>(({ coin, onSelectCoin }) => {
  const handleClick = useCallback(() => {
    onSelectCoin(coin);
  }, [coin, onSelectCoin]);

  const formatChange = (change: { absolute: number; percent: string } | null | undefined, isPercentage = false) => {
    if (!change) return <span className="no-change">변화 없음</span>;
    const isPositive = Number(change.percent) > 0;
    const arrow = isPositive ? '↑' : '↓';
    const className = isPositive ? 'positive' : 'negative';

    return (
      <span className={className}>
        {arrow} {Math.abs(change.absolute).toLocaleString('ko-KR')}{isPercentage ? '%p' : ''}
        <br />
        ({change.percent}%)
      </span>
    );
  };

  return (
    <tr onClick={handleClick}>
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
      <td className="number change-cell">
        {formatChange(coin.holders_change)}
      </td>
      <td className="number change-cell">
        {formatChange(coin.circulation_30min_change)}
      </td>
      <td className="percent change-cell">
        {formatChange(coin.holder_influence_change, true)}
      </td>
      <td className="percent change-cell">
        {formatChange(coin.trader_influence_change, true)}
      </td>
      <td className="timestamp">
        {coin.last_update ? new Date(coin.last_update).toLocaleString('ko-KR') : '-'}
      </td>
    </tr>
  );
});
ChangeRow.displayName = 'ChangeRow';

// Memoized Table Header Component for All View
const TableHeader = memo<{
  sortKey: keyof CoinData;
  sortOrder: 'asc' | 'desc';
  onSort: (key: keyof CoinData) => void;
}>(({ sortKey, sortOrder, onSort }) => {
  const columns: Array<{ key: keyof CoinData; label: string }> = [
    { key: 'symbol', label: '심볼' },
    { key: 'name_kr', label: '코인명' },
    { key: 'holders', label: '보유자 수' },
    { key: 'circulation', label: '빗썸 내부 유통량' },
    { key: 'circulation_change', label: '전일대비 유통량' },
    { key: 'holder_influence', label: '최상위 회원 영향도 (보유)' },
    { key: 'trader_influence', label: '최상위 회원 영향도 (거래)' },
  ];

  return (
    <thead>
      <tr>
        {columns.map(({ key, label }) => (
          <th
            key={key}
            onClick={() => onSort(key)}
            className="sortable"
          >
            {label} {sortKey === key && (sortOrder === 'asc' ? '▲' : '▼')}
          </th>
        ))}
      </tr>
    </thead>
  );
});
TableHeader.displayName = 'TableHeader';

// Memoized Change Table Header Component
const ChangeTableHeader = memo<{
  sortKey: keyof CoinData;
  sortOrder: 'asc' | 'desc';
  onSort: (key: keyof CoinData) => void;
}>(({ sortKey, sortOrder, onSort }) => {
  const columns: Array<{ key: keyof CoinData; label: string }> = [
    { key: 'symbol', label: '심볼' },
    { key: 'name_kr', label: '코인명' },
    { key: 'holders', label: '보유자 수 변화' },
    { key: 'circulation', label: '유통량 변화' },
    { key: 'holder_influence', label: '보유 영향도 변화' },
    { key: 'trader_influence', label: '거래 영향도 변화' },
    { key: 'last_update', label: '업데이트 시각' },
  ];

  return (
    <thead>
      <tr>
        {columns.map(({ key, label }) => (
          <th
            key={key}
            onClick={() => onSort(key)}
            className="sortable"
          >
            {label} {sortKey === key && (sortOrder === 'asc' ? '▲' : '▼')}
          </th>
        ))}
      </tr>
    </thead>
  );
});
ChangeTableHeader.displayName = 'ChangeTableHeader';

// Debounce hook for search input
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

function App() {
  // Theme Management
  const { theme, toggleTheme } = useTheme();

  // Application State with optimized updates
  const [coinsMap, setCoinsMap] = useState<Map<string, CoinData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<keyof CoinData>('symbol');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [selectedCoin, setSelectedCoin] = useState<CoinData | null>(null);
  const [viewMode, setViewMode] = useState<'all' | 'changes' | 'comparison'>('all');

  // Debounce search term to reduce re-renders
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Convert Map to array only when needed
  const coins = useMemo(() => Array.from(coinsMap.values()), [coinsMap]);

  // Memoized SSE connection
  const fetchData = useCallback(() => {
    const apiUrl = window.location.hostname === 'localhost'
      ? 'http://localhost:3001/api/stream'
      : 'http://34.44.60.202:3001/api/stream';
    const eventSource = new EventSource(apiUrl);

    eventSource.onmessage = (event) => {
      try {
        const coinData = JSON.parse(event.data);
        // Update only the specific coin, not the entire object
        setCoinsMap(prev => {
          const newMap = new Map(prev);
          newMap.set(coinData.symbol, coinData);
          return newMap;
        });
        setLastUpdate(new Date());
        setLoading(false);
      } catch (error) {
        // Silently handle parse error - never expose to console
        // No console.error() to prevent information leakage
      }
    };

    eventSource.onerror = () => {
      // Never log connection errors to console (security)
      eventSource.close();
      setLoading(false);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    const cleanup = fetchData();
    return cleanup;
  }, [fetchData]);

  // Memoized sort handler
  const handleSort = useCallback((key: keyof CoinData) => {
    if (sortKey === key) {
      // 같은 컬럼 클릭 시 정렬 순서 변경
      setSortOrder(prevOrder => prevOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // 다른 컬럼 클릭 시 해당 컬럼으로 변경하고 오름차순
      setSortKey(key);
      setSortOrder('asc');
    }
  }, [sortKey]);

  // Memoized filtered and sorted coins
  const filteredAndSortedCoins = useMemo(() => {
    let filtered = coins.filter(coin =>
      coin.symbol.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      coin.name_kr.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      coin.name_en.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
    );

    // Filter for changes view - only show coins with 30-minute changes
    if (viewMode === 'changes') {
      filtered = filtered.filter(coin =>
        coin.holders_change ||
        coin.circulation_30min_change ||
        coin.holder_influence_change ||
        coin.trader_influence_change
      );
    }

    return filtered.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      // 숫자 필드 목록
      const numericFields: Array<keyof CoinData> = [
        'circulation',
        'circulation_change',
        'holders',
        'holder_influence',
        'trader_influence'
      ];

      if (numericFields.includes(sortKey)) {
        // null, undefined, '-', 빈 문자열 처리
        const isAEmpty = aVal === null || aVal === undefined || aVal === '' || aVal === '-';
        const isBEmpty = bVal === null || bVal === undefined || bVal === '' || bVal === '-';

        if (isAEmpty && isBEmpty) return 0;
        if (isAEmpty) return 1; // 빈 값은 항상 마지막으로
        if (isBEmpty) return -1; // 빈 값은 항상 마지막으로

        // 쉼표와 퍼센트 기호 제거 후 숫자 변환
        const aNum = parseFloat(String(aVal).replace(/,/g, '').replace(/%/g, ''));
        const bNum = parseFloat(String(bVal).replace(/,/g, '').replace(/%/g, ''));

        // NaN 체크
        if (isNaN(aNum) && isNaN(bNum)) return 0;
        if (isNaN(aNum)) return 1; // NaN은 항상 마지막으로
        if (isNaN(bNum)) return -1; // NaN은 항상 마지막으로

        // 숫자 비교
        if (aNum < bNum) return sortOrder === 'asc' ? -1 : 1;
        if (aNum > bNum) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      } else {
        // 문자열 필드 처리
        const aStr = String(aVal || '');
        const bStr = String(bVal || '');

        // 빈 문자열 처리
        if (aStr === '' && bStr === '') return 0;
        if (aStr === '') return 1; // 빈 값은 항상 마지막으로
        if (bStr === '') return -1; // 빈 값은 항상 마지막으로

        // 문자열 비교 (한국어 locale)
        const comparison = aStr.localeCompare(bStr, 'ko-KR');
        return sortOrder === 'asc' ? comparison : -comparison;
      }
    });
  }, [coins, debouncedSearchTerm, sortKey, sortOrder]);

  // Memoized pagination values
  const { totalPages, currentCoins } = useMemo(() => {
    const total = Math.ceil(filteredAndSortedCoins.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return {
      totalPages: total,
      currentCoins: filteredAndSortedCoins.slice(startIndex, endIndex)
    };
  }, [filteredAndSortedCoins, currentPage, itemsPerPage]);

  // Reset page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchTerm]);

  // Memoized pagination handlers
  const handlePrevPage = useCallback(() => {
    setCurrentPage(prev => Math.max(1, prev - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setCurrentPage(prev => Math.min(totalPages || 1, prev + 1));
  }, [totalPages]);

  // Memoized coin selection handler
  const handleSelectCoin = useCallback((coin: CoinData) => {
    setSelectedCoin(coin);
  }, []);

  const handleCloseCoinDetail = useCallback(() => {
    setSelectedCoin(null);
  }, []);

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
                4시간마다 자동 업데이트
                {coins.some(c => c.last_update) ? (
                  <span className="last-update-time">
                    (4시간 업데이트: {new Date(coins.find(c => c.last_update)?.last_update || '').toLocaleTimeString('ko-KR')})
                  </span>
                ) : (
                  <span className="last-update-time">
                    (최근 데이터: {lastUpdate.toLocaleTimeString('ko-KR')})
                  </span>
                )}
              </div>
              <div className="connection-status">
                <span className="status-dot"></span>
                실시간: {coins.length}개 코인
              </div>
            </div>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </header>

      <div className="controls">
        <div className="controls-inner">
          <div className="view-mode-toggle">
            <button
              className={`view-mode-btn ${viewMode === 'all' ? 'active' : ''}`}
              onClick={() => setViewMode('all')}
            >
              📊 전체 데이터
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'changes' ? 'active' : ''}`}
              onClick={() => setViewMode('changes')}
            >
              📈 4시간 변화 추적
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'comparison' ? 'active' : ''}`}
              onClick={() => setViewMode('comparison')}
            >
              🔄 4시간 비교
            </button>
          </div>
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

      {viewMode === 'comparison' ? (
        <ComparisonPage />
      ) : (
        <>
          <div className="table-container">
            <div className="table-wrapper">
              <table className="coin-table">
                {viewMode === 'all' ? (
                  <>
                    <TableHeader
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                    <tbody>
                      {currentCoins.map((coin) => (
                        <CoinRow
                          key={coin.symbol}
                          coin={coin}
                          onSelectCoin={handleSelectCoin}
                        />
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <ChangeTableHeader
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                    <tbody>
                      {currentCoins.map((coin) => (
                        <ChangeRow
                          key={coin.symbol}
                          coin={coin}
                          onSelectCoin={handleSelectCoin}
                        />
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </div>

          <div className="pagination">
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1}
            >
              이전
            </button>
            <span>페이지 {currentPage} / {totalPages || 1}</span>
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages || totalPages === 0}
            >
              다음
            </button>
          </div>
        </>
      )}

      {selectedCoin && (
        <CoinDetail
          symbol={selectedCoin.symbol}
          name_kr={selectedCoin.name_kr}
          name_en={selectedCoin.name_en}
          onClose={handleCloseCoinDetail}
        />
      )}
    </div>
  );
}

export default App;