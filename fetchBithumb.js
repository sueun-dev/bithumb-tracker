"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BithumbFetcher = void 0;
const axios_1 = __importDefault(require("axios"));
const events_1 = require("events");
const api = axios_1.default.create({
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
class BithumbFetcher extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.running = false;
    }

    async fetchAll() {
        try {
            // 모든 코인 목록 가져오기 (start() 함수와 동일한 엔드포인트 사용)
            const response = await api.get('/exchange/v1/comn/intro?coinType=&marketType=C0100');
            if (!response.data?.data?.coinList) {
                return {};
            }

            const allCoins = {};
            const coinList = response.data.data.coinList;
            console.log(`📊 Found ${coinList.length} coins to fetch`);

            // 10개씩 배치로 병렬 처리
            const batchSize = 10;
            for (let i = 0; i < coinList.length; i += batchSize) {
                const batch = coinList.slice(i, i + batchSize);
                const promises = batch.map(async (coin) => {
                    try {
                        const details = await this.fetchCoinDetails(coin);
                        return { success: true, data: details };
                    } catch (error) {
                        console.error(`Error fetching ${coin.coinSymbol}:`, error?.message || error);
                        return { success: false, symbol: coin.coinSymbol };
                    }
                });

                const results = await Promise.allSettled(promises);
                for (const result of results) {
                    if (result.status === 'fulfilled' && result.value.success) {
                        allCoins[result.value.data.symbol] = result.value.data;
                    }
                }

                console.log(`✅ Fetched batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(coinList.length/batchSize)} (${Object.keys(allCoins).length} coins so far)`);
            }

            console.log(`🎯 Successfully fetched ${Object.keys(allCoins).length} coins`);
            return allCoins;
        }
        catch (error) {
            console.error('Error fetching all coins:', error);
            return {};
        }
    }

    async fetchCoinDetails(coin) {
        const symbol = coin.coinSymbol;
        const code = coin.coinType;
        const coinData = {
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
        // 병렬로 4개 API 호출
        const [circulation, holders, holderShare, traderShare] = await Promise.allSettled([
            api.get(`/exchange/v1/trade/accumulation/deposit/${code}-C0100`),
            api.get(`/exchange/v1/trade/holders/${code}`),
            api.get(`/exchange/v1/trade/top/holder/share/${code}`),
            api.get(`/exchange/v1/trade/top/trader/share/${code}`)
        ]);
        // 유통량
        if (circulation.status === 'fulfilled' && circulation.value.data?.data) {
            const d = circulation.value.data.data;
            coinData.circulation = d.accumulationDepositAmt;
            coinData.circulation_change = d.depositChangeRate;
        }
        // 보유자
        if (holders.status === 'fulfilled' && holders.value.data?.data) {
            const d = holders.value.data.data;
            coinData.holders = d.numberOfHolders;
        }
        // 보유 비중
        if (holderShare.status === 'fulfilled' && holderShare.value.data?.data) {
            const d = holderShare.value.data.data;
            coinData.holder_influence = d.holdingPercentage;
        }
        // 거래 비중
        if (traderShare.status === 'fulfilled' && traderShare.value.data?.data) {
            const d = traderShare.value.data.data;
            coinData.trader_influence = d.tradingPercentage;
        }
        return coinData;
    }
    async start() {
        if (this.running)
            return;
        this.running = true;
        try {
            // 코인 목록 가져오기
            const response = await api.get('/exchange/v1/comn/intro?coinType=&marketType=C0100');
            if (response.data?.data?.coinList) {
                const coinList = response.data.data.coinList;
                // 10개씩 배치로 병렬 처리
                const batchSize = 10;
                for (let i = 0; i < coinList.length; i += batchSize) {
                    if (!this.running)
                        break;
                    const batch = coinList.slice(i, i + batchSize);
                    const promises = batch.map(coin => this.fetchCoinDetails(coin));
                    const results = await Promise.allSettled(promises);
                    for (const result of results) {
                        if (result.status === 'fulfilled') {
                            this.emit('data', result.value);
                        }
                        else {
                            console.error('Failed to fetch coin:', result.reason);
                        }
                    }
                }
            }
            this.emit('complete');
        }
        catch (error) {
            this.emit('error', error);
        }
        finally {
            this.running = false;
        }
    }
    stop() {
        this.running = false;
    }
}
exports.BithumbFetcher = BithumbFetcher;
// 스트리밍 모드로 실행 (서버에서 사용)
if (require.main === module) {
    const fetcher = new BithumbFetcher();
    fetcher.on('data', (coinData) => {
        console.log(JSON.stringify(coinData));
    });
    fetcher.on('error', (error) => {
        console.error('Error:', error);
    });
    fetcher.on('complete', () => {
        process.exit(0);
    });
    fetcher.start();
}
