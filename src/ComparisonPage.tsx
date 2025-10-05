import { useState, useEffect } from 'react';
import './ComparisonPage.css';

interface ComparisonData {
  symbol: string;
  code: string;
  name_kr: string;
  name_en: string;
  current: {
    holders: string;
    circulation: string;
    holder_influence: string;
    trader_influence: string;
    purity: string;
  };
  previous_4h: {
    holders?: string;
    circulation?: string;
    holder_influence?: string;
    trader_influence?: string;
    purity?: string;
  };
  changes_4h: {
    holders: { absolute: number; percent: string } | null;
    circulation: { absolute: number; percent: string } | null;
    holder_influence: { absolute: number; percent: string } | null;
    trader_influence: { absolute: number; percent: string } | null;
    purity: { absolute: number; percent: string } | null;
  };
  last_update: string;
}

const ComparisonPage = () => {
  const [data, setData] = useState<ComparisonData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'symbol' | 'holders' | 'circulation' | 'holder_influence' | 'trader_influence' | 'purity'>('symbol');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const itemsPerPage = 30;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/comparison');
        if (!response.ok) {
          throw new Error('Failed to fetch comparison data');
        }
        const result = await response.json();
        setData(result.data);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute

    return () => clearInterval(interval);
  }, []);

  const formatNumber = (value: string | number | undefined): string => {
    if (!value) return '-';
    const num = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : value;
    if (isNaN(num)) return '-';
    return num.toLocaleString('ko-KR');
  };

  const formatPercent = (value: string | number | undefined): string => {
    if (!value) return '-';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '-';
    return `${num.toFixed(2)}%`;
  };

  const renderChange = (change: { absolute: number; percent: string } | null, unit: string = '') => {
    if (!change) {
      return <span className="no-data">처음 4시간 - 비교 데이터 없음</span>;
    }

    const isPositive = Number(change.percent) > 0;
    const arrow = isPositive ? '↑' : '↓';
    const className = isPositive ? 'positive' : 'negative';

    return (
      <span className={`change ${className}`}>
        {arrow} {Math.abs(change.absolute).toLocaleString('ko-KR')}{unit} ({change.percent}%)
      </span>
    );
  };

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  // Filter data by search term
  const filteredData = data.filter(coin =>
    coin.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
    coin.name_kr.toLowerCase().includes(searchTerm.toLowerCase()) ||
    coin.name_en.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortedData = [...filteredData].sort((a, b) => {
    let aValue, bValue;

    if (sortBy === 'symbol') {
      aValue = a.symbol;
      bValue = b.symbol;
      return sortOrder === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    // For numeric fields, use the change percentage
    const changeKey = `${sortBy}` as keyof ComparisonData['changes_4h'];
    const aChange = a.changes_4h[changeKey];
    const bChange = b.changes_4h[changeKey];

    aValue = aChange ? parseFloat(aChange.percent) : 0;
    bValue = bChange ? parseFloat(bChange.percent) : 0;

    return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
  });

  // Pagination
  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentPageData = sortedData.slice(startIndex, endIndex);

  // Reset to page 1 when search term changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  if (loading) {
    return <div className="comparison-loading">데이터 로딩 중...</div>;
  }

  if (error) {
    return <div className="comparison-error">에러: {error}</div>;
  }

  return (
    <div className="comparison-page">
      <div className="comparison-header">
        <h1>🔄 4시간 비교 데이터</h1>
        <p>모든 코인의 4시간 전 대비 변화를 확인하세요</p>
        <p className="update-info">
          마지막 업데이트: {data[0]?.last_update ? new Date(data[0].last_update).toLocaleString('ko-KR') : '-'}
        </p>
      </div>

      <div className="comparison-controls">
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
            <strong>{filteredData.length}</strong>개 코인
          </div>
          <div className="stat-badge">
            페이지 <strong>{currentPage}/{totalPages || 1}</strong>
          </div>
        </div>
      </div>

      <div className="comparison-table-container">
        <table className="comparison-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('symbol')} className="sortable">
                코인 {sortBy === 'symbol' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
              <th>이름</th>
              <th onClick={() => handleSort('holders')} className="sortable">
                보유자 수 변화 {sortBy === 'holders' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('circulation')} className="sortable">
                유통량 변화 {sortBy === 'circulation' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('holder_influence')} className="sortable">
                홀더 영향력 변화 {sortBy === 'holder_influence' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('trader_influence')} className="sortable">
                트레이더 영향력 변화 {sortBy === 'trader_influence' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('purity')} className="sortable">
                순도 변화 {sortBy === 'purity' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
            </tr>
          </thead>
          <tbody>
            {currentPageData.map((coin) => (
              <tr key={coin.symbol}>
                <td>
                  <div className="coin-symbol">
                    <div className="coin-avatar">{coin.symbol.charAt(0)}</div>
                    <span>{coin.symbol}</span>
                  </div>
                </td>
                <td>
                  <div className="coin-name">
                    <div className="name-kr">{coin.name_kr}</div>
                    <div className="name-en">{coin.name_en}</div>
                  </div>
                </td>
                <td>
                  <div className="metric-cell">
                    <div className="current-value">현재: {formatNumber(coin.current.holders)}명</div>
                    <div className="previous-value">
                      4시간 전: {coin.previous_4h.holders ? formatNumber(coin.previous_4h.holders) + '명' : '-'}
                    </div>
                    <div className="change-value">{renderChange(coin.changes_4h.holders, '명')}</div>
                  </div>
                </td>
                <td>
                  <div className="metric-cell">
                    <div className="current-value">현재: {formatNumber(coin.current.circulation)}</div>
                    <div className="previous-value">
                      4시간 전: {coin.previous_4h.circulation ? formatNumber(coin.previous_4h.circulation) : '-'}
                    </div>
                    <div className="change-value">{renderChange(coin.changes_4h.circulation)}</div>
                  </div>
                </td>
                <td>
                  <div className="metric-cell">
                    <div className="current-value">현재: {formatPercent(coin.current.holder_influence)}</div>
                    <div className="previous-value">
                      4시간 전: {coin.previous_4h.holder_influence ? formatPercent(coin.previous_4h.holder_influence) : '-'}
                    </div>
                    <div className="change-value">{renderChange(coin.changes_4h.holder_influence, '%p')}</div>
                  </div>
                </td>
                <td>
                  <div className="metric-cell">
                    <div className="current-value">현재: {formatPercent(coin.current.trader_influence)}</div>
                    <div className="previous-value">
                      4시간 전: {coin.previous_4h.trader_influence ? formatPercent(coin.previous_4h.trader_influence) : '-'}
                    </div>
                    <div className="change-value">{renderChange(coin.changes_4h.trader_influence, '%p')}</div>
                  </div>
                </td>
                <td>
                  <div className="metric-cell">
                    <div className="current-value">현재: {formatPercent(coin.current.purity)}</div>
                    <div className="previous-value">
                      4시간 전: {coin.previous_4h.purity ? formatPercent(coin.previous_4h.purity) : '-'}
                    </div>
                    <div className="change-value">{renderChange(coin.changes_4h.purity, '%p')}</div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    </div>
  );
};

export default ComparisonPage;
