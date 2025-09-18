import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';

class MockEventSource {
  public url: string;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public readyState = 1;

  constructor(url: string) {
    this.url = url;
  }

  close() {
    this.readyState = 2;
  }

  emit(data: any) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  fail() {
    this.onerror?.(new Event('error'));
  }
}

// 실제 Bithumb API를 사용하는 테스트 설정
import axios from 'axios';

const api = axios.create({
  baseURL: 'https://gw.bithumb.com',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Origin': 'https://www.bithumb.com',
    'Referer': 'https://www.bithumb.com/'
  },
  timeout: 10000
});

const makeDirectFetchMock = () => {
  return jest.fn(async (input: RequestInfo) => {
    const url = String(input);

    try {
      // 실제 Bithumb API 호출
      if (url.includes('/comn/intro')) {
        const response = await api.get('/exchange/v1/comn/intro?coinType=&marketType=C0100');
        return { ok: true, json: async () => ({ data: response.data }) };
      }

      if (url.includes('/accumulation/deposit')) {
        const coinMatch = url.match(/\/([A-Z]+)-C0100/);
        if (coinMatch) {
          const response = await api.get(`/exchange/v1/trade/accumulation/deposit/${coinMatch[1]}-C0100`);
          return { ok: true, json: async () => ({ data: response.data }) };
        }
      }

      if (url.includes('/trade/holders/')) {
        const coinMatch = url.match(/\/holders\/([A-Z]+)/);
        if (coinMatch) {
          const response = await api.get(`/exchange/v1/trade/holders/${coinMatch[1]}`);
          return { ok: true, json: async () => ({ data: response.data }) };
        }
      }

      if (url.includes('/top/holder/share/')) {
        const coinMatch = url.match(/\/share\/([A-Z]+)/);
        if (coinMatch) {
          const response = await api.get(`/exchange/v1/trade/top/holder/share/${coinMatch[1]}`);
          return { ok: true, json: async () => ({ data: response.data }) };
        }
      }

      if (url.includes('/top/trader/share/')) {
        const coinMatch = url.match(/\/share\/([A-Z]+)/);
        if (coinMatch) {
          const response = await api.get(`/exchange/v1/trade/top/trader/share/${coinMatch[1]}`);
          return { ok: true, json: async () => ({ data: response.data }) };
        }
      }

      // 실시간 가격 API (public API)
      if (url.includes('/ticker/')) {
        const coinMatch = url.match(/\/ticker\/([A-Z]+)_KRW/);
        if (coinMatch) {
          const publicResponse = await axios.get(`https://api.bithumb.com/public/ticker/${coinMatch[1]}_KRW`);
          return { ok: true, json: async () => publicResponse.data };
        }
      }

      return { ok: true, json: async () => ({}) };
    } catch (error) {
      console.error('API call failed:', error);
      // 오류 발생 시 빈 응답 반환
      return { ok: true, json: async () => ({ data: null }) };
    }
  });
};

describe('App', () => {
  let eventSource: MockEventSource | null;

  beforeAll(() => {
    (global as any).EventSource = jest.fn();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    eventSource = null;
    jest.spyOn(global as any, 'EventSource').mockImplementation((url: unknown) => {
      eventSource = new MockEventSource(String(url));
      return eventSource as unknown as EventSource;
    });
    (global as any).fetch = makeDirectFetchMock();
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  // 실제 API 데이터를 사용하여 코인 데이터 생성
  const fetchRealCoinData = async (symbol: string, code: string, name_kr: string, name_en: string) => {
    try {
      const [circulation, holders, holderShare, traderShare] = await Promise.allSettled([
        api.get(`/exchange/v1/trade/accumulation/deposit/${code}-C0100`),
        api.get(`/exchange/v1/trade/holders/${code}`),
        api.get(`/exchange/v1/trade/top/holder/share/${code}`),
        api.get(`/exchange/v1/trade/top/trader/share/${code}`)
      ]);

      const coinData: any = {
        symbol,
        code,
        name_kr,
        name_en,
        circulation: null,
        circulation_change: null,
        holders: null,
        holder_influence: null,
        trader_influence: null
      };

      if (circulation.status === 'fulfilled' && circulation.value.data?.data) {
        const d = circulation.value.data.data;
        coinData.circulation = d.accumulationDepositAmt;
        coinData.circulation_change = d.depositChangeRate;
      }

      if (holders.status === 'fulfilled' && holders.value.data?.data) {
        const d = holders.value.data.data;
        coinData.holders = d.numberOfHolders;
      }

      if (holderShare.status === 'fulfilled' && holderShare.value.data?.data) {
        const d = holderShare.value.data.data;
        coinData.holder_influence = d.holdingPercentage;
      }

      if (traderShare.status === 'fulfilled' && traderShare.value.data?.data) {
        const d = traderShare.value.data.data;
        coinData.trader_influence = d.tradingPercentage;
      }

      return coinData;
    } catch (error) {
      console.error('Error fetching real coin data:', error);
      // 오류 시 기본값 반환
      return {
        symbol,
        code,
        name_kr,
        name_en,
        circulation: '0',
        circulation_change: '0',
        holders: '0',
        holder_influence: '0',
        trader_influence: '0'
      };
    }
  };

  const emitCoins = async (coins: any[]) => {
    for (const coin of coins) {
      // 실제 데이터를 가져오는 경우
      if (coin.symbol && coin.code && !coin.holders) {
        const realData = await fetchRealCoinData(coin.symbol, coin.code, coin.name_kr, coin.name_en);
        eventSource?.emit(realData);
      } else {
        eventSource?.emit(coin);
      }
    }
  };

  it('shows loading state and opens SSE connection on mount', () => {
    render(<App />);
    expect(screen.getByText(/불러오는 중/i)).toBeInTheDocument();
    expect(global.EventSource).toHaveBeenCalledWith('http://localhost:3001/api/stream');
  });

  it('renders streamed coins and updates counts', async () => {
    render(<App />);

    // 실제 API에서 가져온 데이터를 사용
    await emitCoins([
      { symbol: 'BTC', code: 'BTC', name_kr: '비트코인', name_en: 'Bitcoin' },
      { symbol: 'ETH', code: 'ETH', name_kr: '이더리움', name_en: 'Ethereum' }
    ]);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/코인 검색/)).toBeInTheDocument();
      expect(screen.getByText('BTC')).toBeInTheDocument();
      expect(screen.getByText('ETH')).toBeInTheDocument();
    }, { timeout: 10000 });

    expect(screen.getByText(/실시간: 2/)).toBeInTheDocument();
  });

  it('filters coins by search term regardless of case', async () => {
    render(<App />);

    // 실제 API 데이터 사용
    await emitCoins([
      { symbol: 'BTC', code: 'BTC', name_kr: '비트코인', name_en: 'Bitcoin' },
      { symbol: 'ETH', code: 'ETH', name_kr: '이더리움', name_en: 'Ethereum' }
    ]);

    const search = await screen.findByPlaceholderText(/코인 검색/);
    await userEvent.type(search, 'eth');

    await waitFor(() => {
      expect(screen.queryByText('BTC')).not.toBeInTheDocument();
      expect(screen.getByText('ETH')).toBeInTheDocument();
    }, { timeout: 10000 });
  });

  it('sorts coins by holders when header clicked', async () => {
    render(<App />);

    // 실제 API에서 일부 코인 데이터 가져오기
    await emitCoins([
      { symbol: 'BTC', code: 'BTC', name_kr: '비트코인', name_en: 'Bitcoin' },
      { symbol: 'ETH', code: 'ETH', name_kr: '이더리움', name_en: 'Ethereum' },
      { symbol: 'XRP', code: 'XRP', name_kr: '리플', name_en: 'Ripple' }
    ]);

    await waitFor(() => expect(screen.getByText('BTC')).toBeInTheDocument(), { timeout: 10000 });

    const header = screen.getByText(/보유자 수/);
    fireEvent.click(header);
    fireEvent.click(header);

    await waitFor(() => {
      const rows = screen.getAllByRole('row').slice(1);
      const holderValues = rows.map(row => {
        const text = within(row).getAllByRole('cell')[2].textContent || '0';
        return parseInt(text.replace(/[^0-9]/g, '') || '0');
      });
      // 내림차순으로 정렬되었는지 확인
      const sorted = [...holderValues].sort((a, b) => b - a);
      expect(holderValues).toEqual(sorted);
    });
  });

  it('supports pagination when more than 30 coins arrive', async () => {
    render(<App />);

    const manyCoins = Array.from({ length: 35 }).map((_, index) => ({
      symbol: `COIN${index + 1}`,
      name_kr: `코인${index + 1}`,
      name_en: `Coin${index + 1}`,
      holders: `${index + 1}`,
      circulation: '0',
      circulation_change: '0',
      holder_influence: '0',
      trader_influence: '0',
      code: `COIN${index + 1}`
    }));

    emitCoins(manyCoins);

    await waitFor(() => expect(screen.getByText('COIN1')).toBeInTheDocument());
    expect(screen.getAllByRole('row')).toHaveLength(31);

    const nextButton = screen.getByRole('button', { name: /다음/ });
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.queryByText('COIN1')).not.toBeInTheDocument();
    });

    const firstDataRow = screen.getAllByRole('row')[1];
    const firstSymbol = within(firstDataRow).getAllByRole('cell')[0].textContent?.trim();
    expect(firstSymbol).not.toBe('COIN1');
  });

  it('opens coin detail modal when a coin row is clicked', async () => {
    render(<App />);

    // 실제 API 데이터 사용
    await emitCoins([
      { symbol: 'BTC', code: 'BTC', name_kr: '비트코인', name_en: 'Bitcoin' }
    ]);

    const row = await screen.findByText('BTC');
    fireEvent.click(row.closest('tr')!);

    await waitFor(() => expect(screen.getByText(/실시간 현재가/)).toBeInTheDocument(), { timeout: 10000 });
  });

  it('resets to first page when the search term changes', async () => {
    render(<App />);

    const manyCoins = Array.from({ length: 35 }).map((_, index) => ({
      symbol: `COIN${index + 1}`,
      name_kr: `코인${index + 1}`,
      name_en: `Coin${index + 1}`,
      holders: `${index + 1}`,
      circulation: '0',
      circulation_change: '0',
      holder_influence: '0',
      trader_influence: '0',
      code: `COIN${index + 1}`
    }));

    emitCoins(manyCoins);
    await waitFor(() => expect(screen.getByText('COIN1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /다음/ }));
    await waitFor(() => expect(screen.queryByText('COIN1')).not.toBeInTheDocument());

    const search = await screen.findByPlaceholderText(/코인 검색/);
    await userEvent.type(search, 'COIN1');

    await waitFor(() => {
      expect(screen.getByText('COIN1')).toBeInTheDocument();
      expect(screen.getByText('11')).toBeInTheDocument();
      expect(screen.getAllByText(/페이지/)[0]).toBeInTheDocument();
    });
  });

  it('closes EventSource when an error occurs', () => {
    const closeSpy = jest.fn();
    jest.spyOn(global as any, 'EventSource').mockImplementation((url: unknown) => {
      eventSource = new MockEventSource(String(url));
      eventSource.close = closeSpy;
      return eventSource as unknown as EventSource;
    });

    render(<App />);
    eventSource?.fail();

    expect(closeSpy).toHaveBeenCalled();
  });
});
