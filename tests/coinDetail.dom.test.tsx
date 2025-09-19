import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CoinDetail from '../src/CoinDetail';

declare global {
  // eslint-disable-next-line no-var
  var fetch: jest.Mock;
}

describe('CoinDetail', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const sampleResponse = {
    symbol: 'BTC',
    current: {
      realtime_price: '100000',
      realtime_volume: '2000',
      realtime_change_rate: 5,
      realtime_change_amount: '5000',
      realtime_high: '105000',
      realtime_low: '95000',
      acc_trade_value_24H: '100000000',
      acc_trade_value: '90000000',
      change_amount: 5000,
      realtime_timestamp: new Date('2024-01-01T01:00:00Z').toISOString()
    },
    previous: {
      current_price: '95000',
      volume: '1500'
    },
    history: [
      { timestamp: new Date('2024-01-01T00:00:00Z').toISOString(), current_price: '90000', volume: '1000' },
      { timestamp: new Date('2024-01-01T00:30:00Z').toISOString(), current_price: '92000', volume: '1200' }
    ],
    comparison: {
      price_change: 5000,
      price_change_percent: '5.26',
      volume_change: 500,
      volume_change_percent: '33.33'
    }
  };

  it('fetches coin detail data and renders primary sections', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => sampleResponse
    });

    render(<CoinDetail symbol="BTC" name_kr="비트코인" name_en="Bitcoin" onClose={jest.fn()} />);

    expect(screen.getByText(/데이터 로딩 중/)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/실시간 현재가/)).toBeInTheDocument());

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3001/api/coin/BTC');
    expect(screen.getByText('₩100,000', { selector: '.price-value' })).toBeInTheDocument();
    expect(screen.getByText(/가격 변화/)).toBeInTheDocument();
  });

  it('shows error message when the request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });

    render(<CoinDetail symbol="ETH" name_kr="이더리움" name_en="Ethereum" onClose={jest.fn()} />);

    await waitFor(() => expect(screen.getByText(/서비스를 일시적으로 사용할 수 없습니다/)).toBeInTheDocument());
  });

  it('calls onClose when the overlay is clicked', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => sampleResponse
    });

    const onClose = jest.fn();
    render(<CoinDetail symbol="BTC" name_kr="비트코인" name_en="Bitcoin" onClose={onClose} />);

    const overlay = document.querySelector('.modal-overlay');
    if (overlay) {
      await userEvent.click(overlay);
    }

    expect(onClose).toHaveBeenCalled();
  });

  it('refetches data when the symbol prop changes', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => sampleResponse
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...sampleResponse,
          symbol: 'ETH',
          current: {
            ...sampleResponse.current,
            realtime_price: '200000'
          }
        })
      });

    const { rerender } = render(<CoinDetail symbol="BTC" name_kr="비트코인" name_en="Bitcoin" onClose={jest.fn()} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('http://localhost:3001/api/coin/BTC'));

    rerender(<CoinDetail symbol="ETH" name_kr="이더리움" name_en="Ethereum" onClose={jest.fn()} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('http://localhost:3001/api/coin/ETH'));
  });
});
