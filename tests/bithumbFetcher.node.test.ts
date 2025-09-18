/** @jest-environment node */

jest.mock('axios', () => {
  const mockGet = jest.fn();
  const mockCreate = jest.fn(() => ({ get: mockGet }));
  return {
    __esModule: true,
    default: { create: mockCreate },
    create: mockCreate,
    __mockGet: mockGet
  };
});

const axiosMock: any = jest.requireMock('axios');
const mockCreate = axiosMock.create;
const mockGet = axiosMock.__mockGet;

import { BithumbFetcher } from '../fetchBithumb';

describe('BithumbFetcher', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockCreate.mockReset();
    mockCreate.mockImplementation(() => ({ get: mockGet }));
  });

  it('fetchCoinDetails merges responses from multiple endpoints', async () => {
    const fetcher = new BithumbFetcher();
    const coin = {
      coinSymbol: 'BTC',
      coinType: 'BTC',
      coinName: '비트코인',
      coinNameEn: 'Bitcoin'
    };

    mockGet
      .mockResolvedValueOnce({ data: { data: { accumulationDepositAmt: '1000', depositChangeRate: '5.1' } } })
      .mockResolvedValueOnce({ data: { data: { numberOfHolders: '200' } } })
      .mockResolvedValueOnce({ data: { data: { holdingPercentage: '10.5' } } })
      .mockResolvedValueOnce({ data: { data: { tradingPercentage: '7.2' } } });

    const result = await fetcher.fetchCoinDetails(coin as any);

    expect(mockGet).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({
      symbol: 'BTC',
      circulation: '1000',
      circulation_change: '5.1',
      holders: '200',
      holder_influence: '10.5',
      trader_influence: '7.2'
    });
  });

  it('fetchCoinDetails tolerates partial failures', async () => {
    const fetcher = new BithumbFetcher();
    const coin = {
      coinSymbol: 'ETH',
      coinType: 'ETH',
      coinName: '이더리움',
      coinNameEn: 'Ethereum'
    };

    mockGet
      .mockResolvedValueOnce({ data: { data: { accumulationDepositAmt: '500', depositChangeRate: '-1.1' } } })
      .mockResolvedValueOnce({ data: { data: { numberOfHolders: '120' } } })
      .mockRejectedValueOnce(new Error('holder share error'))
      .mockRejectedValueOnce(new Error('trader share error'));

    const result = await fetcher.fetchCoinDetails(coin as any);

    expect(result).toMatchObject({
      symbol: 'ETH',
      circulation: '500',
      circulation_change: '-1.1',
      holders: '120',
      holder_influence: null,
      trader_influence: null
    });
  });

  it('fetchAll aggregates coin details and skips failures', async () => {
    const fetcher = new BithumbFetcher();
    const coinList = [
      { coinSymbol: 'BTC', coinType: 'BTC', coinName: '비트코인', coinNameEn: 'Bitcoin' },
      { coinSymbol: 'XRP', coinType: 'XRP', coinName: '리플', coinNameEn: 'Ripple' }
    ];

    mockGet.mockResolvedValueOnce({ data: { data: { coinList } } });

    const detailSpy = jest.spyOn(fetcher, 'fetchCoinDetails');
    detailSpy
      .mockResolvedValueOnce({ symbol: 'BTC', code: 'BTC', name_kr: '비트코인', name_en: 'Bitcoin' } as any)
      .mockRejectedValueOnce(new Error('boom'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await fetcher.fetchAll();

    expect(mockGet).toHaveBeenCalledWith('/exchange/v1/comn/intro?coinType=&marketType=C0100');
    expect(detailSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      BTC: { symbol: 'BTC', code: 'BTC', name_kr: '비트코인', name_en: 'Bitcoin' }
    });
    expect(consoleSpy).toHaveBeenCalledWith('Error fetching XRP:', 'boom');

    consoleSpy.mockRestore();
  });

  it('start emits streamed data batches and completes once finished', async () => {
    const fetcher = new BithumbFetcher();
    const coinList = [
      { coinSymbol: 'BTC', coinType: 'BTC', coinName: '비트코인', coinNameEn: 'Bitcoin' },
      { coinSymbol: 'ETH', coinType: 'ETH', coinName: '이더리움', coinNameEn: 'Ethereum' }
    ];

    mockGet.mockResolvedValueOnce({ data: { data: { coinList } } });

    const detailSpy = jest.spyOn(fetcher, 'fetchCoinDetails');
    detailSpy
      .mockImplementationOnce(async (coin: any) => ({ symbol: coin.coinSymbol }))
      .mockImplementationOnce(async (coin: any) => ({ symbol: coin.coinSymbol }));

    const received: string[] = [];
    const completion = new Promise<void>((resolve) => {
      fetcher.on('complete', resolve);
    });

    fetcher.on('data', (coinData) => {
      received.push(coinData.symbol);
    });

    await fetcher.start();
    await completion;

    expect(received).toEqual(['BTC', 'ETH']);
    expect(detailSpy).toHaveBeenCalledTimes(2);
  });

  it('does not start a second run while already running', async () => {
    const fetcher = new BithumbFetcher();
    mockGet.mockResolvedValue({ data: { data: { coinList: [] } } });

    const first = fetcher.start();
    const second = fetcher.start();

    await Promise.all([first, second]);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('stops scheduling additional batches after stop is called', async () => {
    const fetcher = new BithumbFetcher();
    const coinList = Array.from({ length: 12 }).map((_, idx) => ({
      coinSymbol: `C${idx}`,
      coinType: `C${idx}`,
      coinName: `코인${idx}`,
      coinNameEn: `Coin${idx}`
    }));

    mockGet.mockResolvedValueOnce({ data: { data: { coinList } } });

    const detailSpy = jest.spyOn(fetcher, 'fetchCoinDetails');
    detailSpy.mockImplementation(async (coin) => {
      if (coin.coinSymbol === 'C0') {
        fetcher.stop();
      }
      return {
        symbol: coin.coinSymbol,
        code: coin.coinType,
        name_kr: coin.coinName,
        name_en: coin.coinNameEn
      } as any;
    });

    const dataListener = jest.fn();
    fetcher.on('data', dataListener);

    await fetcher.start();

    expect(detailSpy).toHaveBeenCalledTimes(10);
    expect(dataListener).toHaveBeenCalledTimes(10);

    detailSpy.mockRestore();
  });
});
