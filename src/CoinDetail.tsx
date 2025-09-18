import React, { useEffect, useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './CoinDetail.css';

interface CoinDetailProps {
  symbol: string;
  name_kr: string;
  name_en: string;
  onClose: () => void;
}

interface DetailData {
  symbol: string;
  current: any;
  previous: any;
  history: any[];
  comparison: {
    price_change: number;
    price_change_percent: string;
  };
}


const CoinDetail: React.FC<CoinDetailProps> = ({ symbol, name_kr, name_en, onClose }) => {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCoinDetail = useCallback(async () => {
    try {
      setLoading(true);
      // 서버의 /api/coin/:symbol 엔드포인트를 통해 실시간 데이터와 내부 데이터 가져오기
      // Use relative URL for production compatibility
      const apiUrl = window.location.hostname === 'localhost'
        ? `http://localhost:3001/api/coin/${symbol}`
        : `/api/coin/${symbol}`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error('Failed to fetch coin detail');
      }

      const result = await response.json();

      // 서버에서 반환한 데이터 구조 그대로 사용
      setData(result);
      setError(null);
    } catch (err) {
      // Silently handle error in production
      setError('실시간 데이터를 불러올 수 없습니다.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchCoinDetail();
  }, [fetchCoinDetail, symbol]);

  if (loading) {
    return (
      <div className="modal-overlay">
        <div className="modal-content">
          <div className="loading">데이터 로딩 중...</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>{name_kr} ({symbol})</h2>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body">
            <div className="error-banner" style={{ color: 'red', padding: '20px', textAlign: 'center' }}>
              {error || '데이터를 불러올 수 없습니다.'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3시간 가격 히스토리 차트 데이터 준비
  const chartData = data.history && data.history.length > 0
    ? data.history.map((item) => ({
        time: new Date(item.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        price: parseFloat(item.price || item.current_price || '0')
      }))
    : [];

  // 현재 가격을 차트에 추가
  if (data.current && chartData.length > 0) {
    chartData.push({
      time: '현재',
      price: parseFloat(data.current?.realtime_price || 0)
    });
  }

  const priceChangeClass = data.comparison?.price_change > 0 ? 'positive' : data.comparison?.price_change < 0 ? 'negative' : '';

  const formatNumber = (value: number | string) => Number(value).toLocaleString('ko-KR');
  const formatPrice = (price: number | string) => `₩${formatNumber(price)}`;
  const formatPercent = (percent: number | string) => {
    const num = Number(percent);
    return `${num > 0 ? '+' : ''}${isFinite(num) ? num.toFixed(2) : '0.00'}%`;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <h2 id="modal-title">
            {name_kr} ({symbol})
            <span className="name-en">{name_en}</span>
          </h2>
          <button className="close-btn" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="error-banner" style={{ color: 'red', padding: '10px', backgroundColor: '#ffeeee', borderRadius: '5px', marginBottom: '15px' }}>{error}</div>
          )}

          <div className="current-price-section">
            <h3>실시간 현재가</h3>
            <div className="realtime-price">
              <span className="price-value">{formatPrice(data.current?.realtime_price || 0)}</span>
              <span className={`price-change ${Number(data.current?.realtime_change_rate) > 0 ? 'positive' : Number(data.current?.realtime_change_rate) < 0 ? 'negative' : ''}`}>
                {formatPercent(data.current?.realtime_change_rate || 0)}
              </span>
            </div>
            <div className="price-info">
              <div>고가: {formatPrice(data.current?.realtime_high || 0)}</div>
              <div>저가: {formatPrice(data.current?.realtime_low || 0)}</div>
            </div>
          </div>

          <div className="comparison-section">
            <h3>전일 대비 변화</h3>
            <div className="comparison-grid">
              <div className="comparison-item">
                <div className="label">가격 변화</div>
                <div className={`value ${priceChangeClass}`}>
                  {formatPrice(Math.abs(data.comparison?.price_change || 0))}
                  <span className="percent">({formatPercent(data.comparison?.price_change_percent || 0)})</span>
                </div>
                <div className="detail">
                  전일: {formatPrice(data.previous?.current_price || 0)} → 현재: {formatPrice(data.current?.realtime_price || 0)}
                </div>
              </div>
            </div>
          </div>

          <div className="chart-section">
            <h3>가격 추이 (최근 3시간)</h3>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={70}
                  />
                  <YAxis
                    orientation="left"
                    stroke="#8884d8"
                    domain={['dataMin - 100', 'dataMax + 100']}
                    tickFormatter={(value) => formatNumber(value)}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    formatter={(value: any) => formatPrice(value)}
                    labelStyle={{ color: '#333' }}
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc' }}
                  />
                  <Legend />
                  <Line
                    type="linear"
                    dataKey="price"
                    stroke="#2563eb"
                    name="가격 (₩)"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4, fill: '#2563eb' }}
                    connectNulls={true}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: '50px 0', color: '#999' }}>
                차트 데이터를 불러오는 중입니다...
              </div>
            )}
          </div>

          <div className="detailed-info">
            <h3>상세 정보</h3>
            <div className="info-grid">
              <div className="info-item">
                <span className="label">24시간 거래대금:</span>
                <span className="value">{formatPrice(data.current?.acc_trade_value_24H || 0)}</span>
              </div>
              <div className="info-item">
                <span className="label">전일 거래대금:</span>
                <span className="value">{formatPrice(data.current?.acc_trade_value || 0)}</span>
              </div>
              <div className="info-item">
                <span className="label">전일 변동금액:</span>
                <span className={`value ${Number(data.current?.change_amount) > 0 ? 'positive' : Number(data.current?.change_amount) < 0 ? 'negative' : ''}`}>
                  {formatPrice(data.current?.change_amount || 0)}
                </span>
              </div>
              <div className="info-item">
                <span className="label">마지막 업데이트:</span>
                <span className="value">{data.current?.realtime_timestamp ? new Date(data.current.realtime_timestamp).toLocaleString('ko-KR') : '-'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoinDetail;
