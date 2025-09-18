export interface ChangeData {
  absolute: number;
  percent: string;
}

export interface CoinData {
  symbol: string;
  code: string;
  name_kr: string;
  name_en: string;
  timestamp?: string;
  circulation: string | null;
  circulation_change: string | null;
  holders: string | null;
  holder_influence: string | null;
  trader_influence: string | null;
  purity?: string | null;
  error?: string | null;

  // 30-minute change tracking fields
  holders_change?: ChangeData | null;
  circulation_30min_change?: ChangeData | null;
  holder_influence_change?: ChangeData | null;
  trader_influence_change?: ChangeData | null;

  // Previous values for comparison
  prev_holders?: string | null;
  prev_circulation?: string | null;
  prev_holder_influence?: string | null;
  prev_trader_influence?: string | null;

  // Last update timestamp
  last_update?: string;
}

export interface AllCoinsResponse {
  coins: {
    [symbol: string]: CoinData;
  };
  lastUpdate?: string;
  count?: number;
}