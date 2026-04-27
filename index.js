/**
 * x402 Data API — v2 compliant with REAL crypto data
 * 修复：移除不存在的 inputSchema/outputSchema，使用正确的 v2 格式
 */

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.set('trust proxy', true);

// ─── Config ───────────────────────────────────────────
const WALLET = '0x1D99D952eAd3E8907c9989D15303d3Bcc443Ef97';

// USDC contract addresses
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const NETWORK = 'eip155:8453';
const ASSET = NETWORK === 'eip155:8453' ? USDC_BASE : USDC_BASE_SEPOLIA;

// CoinGecko API (free, no key needed)
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// DeFi Llama API (free, no key needed)
const DEFILLAMA_API = 'https://api.llama.fi';

// Etherscan API (free tier)
const ETHERSCAN_API = 'https://api.etherscan.io/api';
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || 'YourApiKeyToken';

// Open-Meteo Weather API (free, no key needed, unlimited)
const OPEN_METEO_API = 'https://api.open-meteo.com/v1';

// Simple cache
const cache = new Map();
const CACHE_TTL = 60000;

async function fetchWithCache(url) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  
  cache.set(url, { data, time: Date.now() });
  return data;
}

// ─── x402 v2 helpers ──────────────────────────────────

function buildPaymentRequirements(resource, description, amountUsd, httpMethod, queryParams, outputExample) {
  const amountAtomic = String(Math.round(amountUsd * 1_000_000));
  
  // Build bazaar extension per spec: https://github.com/coinbase/x402/blob/main/specs/extensions/bazaar.md
  const bazaarInfo = {
    input: {
      type: 'http',
      method: httpMethod || 'GET',
      queryParams: queryParams || {}
    },
    output: {
      type: 'json',
      example: outputExample || {}
    }
  };
  
  const bazaarSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    type: 'object',
    properties: {
      input: {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'http' },
          method: { type: 'string', enum: ['GET', 'HEAD', 'DELETE'] },
          queryParams: {
            type: 'object',
            additionalProperties: { type: 'string' }
          }
        },
        required: ['type', 'method']
      },
      output: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          example: { type: 'object' }
        },
        required: ['type']
      }
    },
    required: ['input']
  };
  
  return {
    x402Version: 2,
    error: 'X-PAYMENT header is required',
    resource: {
      url: resource,
      description: description,
      mimeType: 'application/json'
    },
    accepts: [{
      scheme: 'exact',
      network: NETWORK,
      amount: amountAtomic,
      payTo: WALLET,
      asset: ASSET,
      maxTimeoutSeconds: 60,
      extra: {
        name: 'USDC',
        version: '2'
      }
    }],
    extensions: {
      bazaar: {
        info: bazaarInfo,
        schema: bazaarSchema
      }
    }
  };
}

function requirePayment(amountUsd, description, httpMethod, queryParams, outputExample) {
  return (req, res) => {
    const paymentHeader = req.headers['x-payment'];
    
    if (paymentHeader) {
      try {
        const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
        console.log('Payment received:', decoded);
        return 'paid';
      } catch (e) {
        console.log('Invalid payment header:', e.message);
      }
    }
    
    const resource = `https://${req.get('host')}${req.originalUrl}`;
    const paymentReq = buildPaymentRequirements(resource, description, amountUsd, httpMethod, queryParams, outputExample);
    const bodyB64 = Buffer.from(JSON.stringify(paymentReq)).toString('base64');
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Payment-Required', bodyB64);
    res.status(402).json(paymentReq);
    return null;
  };
}

// ─── FREE ENDPOINTS ───────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    name: 'x402 Data API Hub',
    version: '2.4.0',
    description: 'Multi-category data APIs with x402 micropayments',
    endpoints: {
      free: ['GET /', 'GET /api/health'],
      crypto: [
        'GET /api/crypto/price/{symbol} - $0.01',
        'GET /api/crypto/trending - $0.01',
        'GET /api/crypto/market - $0.02',
        'GET /api/crypto/analysis/{symbol} - $0.05'
      ],
      defi: [
        'GET /api/defi/yields - $0.05',
        'GET /api/defi/tvl - $0.03'
      ],
      weather: [
        'GET /api/weather/{city} - $0.01',
        'GET /api/weather/forecast/{city} - $0.02'
      ],
      security: [
        'GET /api/security/address/{address} - $0.08',
        'GET /api/security/token/{address} - $0.05'
      ],
      dex: [
        'GET /api/dex/volume/{token} - $0.03',
        'GET /api/dex/trending - $0.02'
      ]
    },
    supported_cities: ['beijing', 'shanghai', 'shenzhen', 'tokyo', 'new york', 'london', 'paris', 'singapore', 'sydney', 'dubai', 'hong kong', 'moscow', 'mumbai', 'seoul', 'los angeles']
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── PAID ENDPOINTS: Crypto Data (REAL DATA) ──────────

app.get('/api/crypto/price/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toLowerCase();
  
  const outputExample = {
    symbol: symbol.toUpperCase(),
    name: 'Bitcoin',
    current_price: 45000.00,
    price_change_24h: 500.00,
    market_cap: 880000000000
  };
  
  const gate = requirePayment(0.01, `Real-time ${symbol.toUpperCase()} price data`, 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      const coinIds = {
        'btc': 'bitcoin', 'eth': 'ethereum', 'sol': 'solana',
        'bnb': 'binancecoin', 'xrp': 'ripple', 'ada': 'cardano',
        'doge': 'dogecoin', 'dot': 'polkadot', 'link': 'chainlink'
      };
      
      const coinId = coinIds[symbol] || symbol;
      const data = await fetchWithCache(
        `${COINGECKO_API}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
      );
      
      res.json({
        symbol: symbol.toUpperCase(),
        name: data.name,
        current_price: data.market_data.current_price.usd,
        price_change_24h: data.market_data.price_change_24h,
        price_change_percentage_24h: data.market_data.price_change_percentage_24h,
        market_cap: data.market_data.market_cap.usd,
        total_volume: data.market_data.total_volume.usd,
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch price data' });
    }
  }
});

app.get('/api/crypto/trending', async (req, res) => {
  const outputExample = {
    trending: [
      { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', market_cap_rank: 1 }
    ],
    last_updated: '2026-04-26T23:00:00.000Z'
  };
  
  const gate = requirePayment(0.01, 'Trending cryptocurrency coins', 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      const data = await fetchWithCache(`${COINGECKO_API}/search/trending`);
      
      const trending = data.coins.slice(0, 7).map(c => ({
        id: c.item.id,
        name: c.item.name,
        symbol: c.item.symbol,
        market_cap_rank: c.item.market_cap_rank,
        price_btc: c.item.price_btc
      }));
      
      res.json({
        trending,
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch trending data' });
    }
  }
});

app.get('/api/crypto/market', async (req, res) => {
  const outputExample = {
    total_market_cap_usd: 2500000000000,
    btc_dominance: 52.5,
    top_coins: [
      { symbol: 'BTC', name: 'Bitcoin', price: 45000, change_24h: 2.5 }
    ]
  };
  
  const gate = requirePayment(0.02, 'Cryptocurrency market overview', 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      const [global, topCoins] = await Promise.all([
        fetchWithCache(`${COINGECKO_API}/global`),
        fetchWithCache(`${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false`)
      ]);
      
      res.json({
        total_market_cap_usd: global.data.total_market_cap.usd,
        total_volume_usd: global.data.total_volume.usd,
        btc_dominance: global.data.market_cap_percentage.btc,
        eth_dominance: global.data.market_cap_percentage.eth,
        top_coins: topCoins.map(c => ({
          symbol: c.symbol.toUpperCase(),
          name: c.name,
          price: c.current_price,
          change_24h: c.price_change_percentage_24h,
          market_cap: c.market_cap
        })),
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch market data' });
    }
  }
});

app.get('/api/crypto/analysis/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toLowerCase();
  
  const outputExample = {
    symbol: symbol.toUpperCase(),
    current_price: 45000,
    indicators: { rsi: 55.5, ma_7: 44000, ma_30: 42000 },
    analysis: { trend: 'bullish', recommendation: 'buy' }
  };
  
  const gate = requirePayment(0.05, `Technical analysis for ${symbol.toUpperCase()}`, 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      const coinIds = { 'btc': 'bitcoin', 'eth': 'ethereum', 'sol': 'solana' };
      const coinId = coinIds[symbol] || symbol;
      
      const ohlc = await fetchWithCache(
        `${COINGECKO_API}/coins/${coinId}/ohlc?vs_currency=usd&days=30`
      );
      
      const prices = ohlc.map(c => c[4]);
      const currentPrice = prices[prices.length - 1];
      
      // Technical indicators
      const ma7 = prices.slice(-7).reduce((a, b) => a + b, 0) / 7;
      const ma30 = prices.reduce((a, b) => a + b, 0) / prices.length;
      
      let gains = 0, losses = 0;
      for (let i = 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
      }
      const rsi = 100 - (100 / (1 + gains / (losses || 0.001) / prices.length));
      
      let trend = 'neutral', recommendation = 'hold';
      if (currentPrice > ma7 && ma7 > ma30) {
        trend = 'bullish';
        recommendation = rsi < 70 ? 'buy' : 'hold (overbought)';
      } else if (currentPrice < ma7 && ma7 < ma30) {
        trend = 'bearish';
        recommendation = rsi > 30 ? 'sell' : 'hold (oversold)';
      }
      
      res.json({
        symbol: symbol.toUpperCase(),
        current_price: currentPrice,
        indicators: { rsi: Math.round(rsi * 100) / 100, ma_7: ma7, ma_30: ma30 },
        analysis: { trend, recommendation },
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to perform analysis' });
    }
  }
});

// ─── PAID ENDPOINTS: DeFi Data (DIFFERENTIATED) ──────────

app.get('/api/defi/yields', async (req, res) => {
  const outputExample = {
    top_yields: [
      { protocol: 'Aave', chain: 'Ethereum', apy: 5.2, tvl: 1000000000 },
      { protocol: 'Compound', chain: 'Ethereum', apy: 4.8, tvl: 800000000 }
    ],
    last_updated: '2026-04-27T00:00:00.000Z'
  };
  
  const gate = requirePayment(0.05, 'Top DeFi yields across protocols', 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      // DeFi Llama API - free, no key needed
      const data = await fetchWithCache(`${DEFILLAMA_API}/yields`);
      
      // Filter and sort by APY, exclude stablecoin pools with low TVL
      const topYields = data.data
        .filter(p => p.tvlUsd > 1000000 && p.apy > 0)
        .sort((a, b) => b.apy - a.apy)
        .slice(0, 20)
        .map(p => ({
          protocol: p.project,
          chain: p.chain,
          pool: p.symbol,
          apy: Math.round(p.apy * 100) / 100,
          tvl_usd: Math.round(p.tvlUsd),
          reward_tokens: p.rewardTokens?.slice(0, 2) || []
        }));
      
      res.json({
        top_yields: topYields,
        total_pools: data.data.length,
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch DeFi yields' });
    }
  }
});

app.get('/api/defi/tvl', async (req, res) => {
  const outputExample = {
    total_tvl: 50000000000,
    chains: [
      { chain: 'Ethereum', tvl: 30000000000, change_24h: 2.5 }
    ],
    protocols: [
      { name: 'Lido', tvl: 15000000000, chain: 'Ethereum' }
    ]
  };
  
  const gate = requirePayment(0.03, 'DeFi TVL statistics', 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      const [chains, protocols] = await Promise.all([
        fetchWithCache(`${DEFILLAMA_API}/v2/chains`),
        fetchWithCache(`${DEFILLAMA_API}/protocols`)
      ]);
      
      const totalTvl = chains.reduce((sum, c) => sum + (c.tvl || 0), 0);
      
      res.json({
        total_tvl: Math.round(totalTvl),
        chains: chains
          .filter(c => c.tvl > 10000000)
          .sort((a, b) => b.tvl - a.tvl)
          .slice(0, 15)
          .map(c => ({
            chain: c.name,
            tvl: Math.round(c.tvl),
            change_24h: Math.round((c.change_1d || 0) * 100) / 100
          })),
        top_protocols: protocols
          .sort((a, b) => b.tvl - a.tvl)
          .slice(0, 10)
          .map(p => ({
            name: p.name,
            tvl: Math.round(p.tvl),
            chain: p.chain,
            category: p.category
          })),
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch TVL data' });
    }
  }
});

// ─── PAID ENDPOINTS: Weather Data (HIGH DEMAND) ──────────

// City name to coordinates mapping (major cities)
const CITY_COORDS = {
  'beijing': { lat: 39.9042, lon: 116.4074, tz: 'Asia/Shanghai' },
  'shanghai': { lat: 31.2304, lon: 121.4737, tz: 'Asia/Shanghai' },
  'shenzhen': { lat: 22.5431, lon: 114.0579, tz: 'Asia/Shanghai' },
  'tokyo': { lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo' },
  'new york': { lat: 40.7128, lon: -74.0060, tz: 'America/New_York' },
  'london': { lat: 51.5074, lon: -0.1278, tz: 'Europe/London' },
  'paris': { lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris' },
  'singapore': { lat: 1.3521, lon: 103.8198, tz: 'Asia/Singapore' },
  'sydney': { lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney' },
  'dubai': { lat: 25.2048, lon: 55.2708, tz: 'Asia/Dubai' },
  'hong kong': { lat: 22.3193, lon: 114.1694, tz: 'Asia/Hong_Kong' },
  'moscow': { lat: 55.7558, lon: 37.6173, tz: 'Europe/Moscow' },
  'mumbai': { lat: 19.0760, lon: 72.8777, tz: 'Asia/Kolkata' },
  'seoul': { lat: 37.5665, lon: 126.9780, tz: 'Asia/Seoul' },
  'los angeles': { lat: 34.0522, lon: -118.2437, tz: 'America/Los_Angeles' }
};

app.get('/api/weather/:city', async (req, res) => {
  const city = req.params.city.toLowerCase();
  
  const outputExample = {
    city: city,
    temperature: 22.5,
    humidity: 65,
    wind_speed: 10.2,
    weather_code: 0,
    weather_description: 'Clear sky',
    last_updated: '2026-04-27T00:00:00.000Z'
  };
  
  const gate = requirePayment(0.01, `Current weather for ${city}`, 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      const coords = CITY_COORDS[city];
      if (!coords) {
        return res.status(400).json({ 
          error: 'City not supported',
          supported_cities: Object.keys(CITY_COORDS)
        });
      }
      
      // Open-Meteo API - completely free, no API key needed
      const data = await fetchWithCache(
        `${OPEN_METEO_API}/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=${encodeURIComponent(coords.tz)}`
      );
      
      const weatherCodes = {
        0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
        45: 'Foggy', 48: 'Depositing rime fog', 51: 'Light drizzle',
        53: 'Moderate drizzle', 55: 'Dense drizzle', 61: 'Slight rain',
        63: 'Moderate rain', 65: 'Heavy rain', 71: 'Slight snow',
        73: 'Moderate snow', 75: 'Heavy snow', 95: 'Thunderstorm'
      };
      
      res.json({
        city: city.charAt(0).toUpperCase() + city.slice(1),
        temperature: data.current.temperature_2m,
        humidity: data.current.relative_humidity_2m,
        wind_speed: data.current.wind_speed_10m,
        weather_code: data.current.weather_code,
        weather_description: weatherCodes[data.current.weather_code] || 'Unknown',
        units: { temperature: '°C', humidity: '%', wind_speed: 'km/h' },
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch weather data' });
    }
  }
});

app.get('/api/weather/forecast/:city', async (req, res) => {
  const city = req.params.city.toLowerCase();
  
  const outputExample = {
    city: city,
    forecast: [
      { date: '2026-04-27', max_temp: 25, min_temp: 18, weather: 'Sunny' }
    ]
  };
  
  const gate = requirePayment(0.02, `7-day weather forecast for ${city}`, 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      const coords = CITY_COORDS[city];
      if (!coords) {
        return res.status(400).json({ 
          error: 'City not supported',
          supported_cities: Object.keys(CITY_COORDS)
        });
      }
      
      const data = await fetchWithCache(
        `${OPEN_METEO_API}/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=${encodeURIComponent(coords.tz)}`
      );
      
      const weatherCodes = {
        0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
        45: 'Foggy', 61: 'Rain', 71: 'Snow', 95: 'Thunderstorm'
      };
      
      const forecast = data.daily.time.map((date, i) => ({
        date,
        max_temp: data.daily.temperature_2m_max[i],
        min_temp: data.daily.temperature_2m_min[i],
        weather_code: data.daily.weather_code[i],
        weather: weatherCodes[data.daily.weather_code[i]] || 'Unknown',
        precipitation_mm: data.daily.precipitation_sum[i]
      }));
      
      res.json({
        city: city.charAt(0).toUpperCase() + city.slice(1),
        forecast,
        units: { temperature: '°C', precipitation: 'mm' },
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch forecast data' });
    }
  }
});

// ─── PAID ENDPOINTS: Onchain Security (HIGH VALUE) ──────────

app.get('/api/security/address/:address', async (req, res) => {
  const address = req.params.address.toLowerCase();
  
  const outputExample = {
    address: address,
    risk_score: 35,
    risk_level: 'LOW',
    tags: ['normal_user'],
    tx_count: 150,
    first_tx: '2023-01-15',
    last_tx: '2026-04-26'
  };
  
  const gate = requirePayment(0.08, `Address risk analysis for ${address}`, 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      // Etherscan API - get transaction list (free tier)
      const data = await fetchWithCache(
        `${ETHERSCAN_API}?module=account&action=txlist&address=${address}&sort=desc&apikey=${ETHERSCAN_KEY}`
      );
      
      const txs = data.result || [];
      const txCount = txs.length;
      
      // Risk analysis
      let riskScore = 0;
      const tags = [];
      
      // Transaction frequency analysis
      if (txCount === 0) {
        riskScore += 30;
        tags.push('new_address');
      } else if (txCount < 10) {
        riskScore += 10;
        tags.push('low_activity');
      } else if (txCount > 1000) {
        riskScore += 5;
        tags.push('high_activity');
      } else {
        tags.push('normal_user');
      }
      
      // Time analysis
      if (txs.length > 0) {
        const firstTx = new Date(txs[txs.length - 1].timeStamp * 1000);
        const lastTx = new Date(txs[0].timeStamp * 1000);
        const daysActive = (lastTx - firstTx) / (1000 * 60 * 60 * 24);
        
        if (daysActive < 7) {
          riskScore += 25;
          tags.push('very_new');
        } else if (daysActive < 30) {
          riskScore += 15;
          tags.push('new');
        }
      }
      
      // Value analysis
      const totalValue = txs.reduce((sum, tx) => sum + parseFloat(tx.value || 0), 0);
      if (totalValue > 1e21) { // > 1000 ETH
        tags.push('whale');
      }
      
      // Failed transaction analysis
      const failedTxs = txs.filter(tx => tx.isError === '1').length;
      if (failedTxs > txCount * 0.3) {
        riskScore += 20;
        tags.push('high_failed_tx');
      }
      
      // Determine risk level
      let riskLevel = 'LOW';
      if (riskScore >= 60) riskLevel = 'HIGH';
      else if (riskScore >= 30) riskLevel = 'MEDIUM';
      
      res.json({
        address: address,
        risk_score: Math.min(riskScore, 100),
        risk_level: riskLevel,
        tags,
        tx_count: txCount,
        total_value_eth: Math.round(totalValue / 1e18 * 1000) / 1000,
        first_tx: txs.length > 0 ? new Date(txs[txs.length - 1].timeStamp * 1000).toISOString().split('T')[0] : null,
        last_tx: txs.length > 0 ? new Date(txs[0].timeStamp * 1000).toISOString().split('T')[0] : null,
        analysis_timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to analyze address' });
    }
  }
});

app.get('/api/security/token/:address', async (req, res) => {
  const address = req.params.address.toLowerCase();
  
  const outputExample = {
    address: address,
    is_honeypot: false,
    risk_score: 25,
    warnings: [],
    holder_count: 1500,
    liquidity_usd: 500000
  };
  
  const gate = requirePayment(0.05, `Token security check for ${address}`, 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      // Basic token info from Etherscan
      const tokenData = await fetchWithCache(
        `${ETHERSCAN_API}?module=account&action=txlist&address=${address}&sort=desc&apikey=${ETHERSCAN_KEY}`
      );
      
      // Risk scoring (simplified - real implementation would use GoPlus/Honeypot.is)
      let riskScore = 0;
      const warnings = [];
      
      const txCount = (tokenData.result || []).length;
      
      // Basic heuristics
      if (txCount < 100) {
        riskScore += 20;
        warnings.push('Low transaction count');
      }
      
      if (txCount > 10000) {
        riskScore += 10;
        warnings.push('High activity token');
      }
      
      // Note: Real implementation would check:
      // - Honeypot detection via API
      // - Contract verification status
      // - Holder concentration
      // - Liquidity locked status
      
      res.json({
        address: address,
        risk_score: Math.min(riskScore, 100),
        risk_level: riskScore >= 50 ? 'HIGH' : riskScore >= 25 ? 'MEDIUM' : 'LOW',
        warnings,
        note: 'Basic analysis. For full security check, integrate GoPlus API.',
        tx_count: txCount,
        analysis_timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to analyze token' });
    }
  }
});

// ─── PAID ENDPOINTS: DEX Data (GROWING DEMAND) ──────────

app.get('/api/dex/volume/:token', async (req, res) => {
  const token = req.params.token.toLowerCase();
  
  const outputExample = {
    token: token.toUpperCase(),
    volume_24h_usd: 15000000,
    transactions_24h: 2500,
    top_pairs: [
      { pair: 'WETH/USDC', volume: 5000000, dex: 'Uniswap' }
    ]
  };
  
  const gate = requirePayment(0.03, `DEX volume analysis for ${token.toUpperCase()}`, 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      // Use DeFi Llama for DEX data
      const dexData = await fetchWithCache(
        `https://coins.llama.fi/v2/coin/coingecko:${token}`
      );
      
      // Get DEX volumes from DeFi Llama
      const volumes = await fetchWithCache(
        'https://api.llama.fi/overview/dexs'
      );
      
      // Filter relevant data
      const relevantDexs = volumes.protocols?.slice(0, 10) || [];
      
      res.json({
        token: token.toUpperCase(),
        price_usd: dexData.coins?.[`coingecko:${token}`]?.price || null,
        total_dex_volume_24h: volumes.totalVolume24h || 0,
        top_dexs: relevantDexs.map(d => ({
          name: d.name,
          volume_24h: Math.round(d.volume24h || 0),
          chain: d.chain
        })),
        note: 'Real-time DEX volume from DeFi Llama',
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch DEX volume data' });
    }
  }
});

app.get('/api/dex/trending', async (req, res) => {
  const outputExample = {
    trending_tokens: [
      { symbol: 'PEPE', volume_change_24h: 150, price_change_24h: 25 }
    ]
  };
  
  const gate = requirePayment(0.02, 'Trending tokens on DEXs', 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      // Get trending from CoinGecko
      const trending = await fetchWithCache(
        `${COINGECKO_API}/search/trending`
      );
      
      const tokens = trending.coins?.slice(0, 10).map(c => ({
        symbol: c.item.symbol,
        name: c.item.name,
        market_cap_rank: c.item.market_cap_rank,
        price_btc: c.item.price_btc
      })) || [];
      
      res.json({
        trending_tokens: tokens,
        note: 'Tokens trending on CoinGecko, often correlates with DEX activity',
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch trending tokens' });
    }
  }
});

// ─── OpenAPI / Discovery ──────────────────────────────

app.get('/openapi.json', (req, res) => {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'x402 Crypto Data API',
      description: 'Real-time cryptocurrency data with micropayments.',
      version: '2.0.0'
    },
    'x-discovery': {
      ownershipProofs: ['0x07d9f154b85a392220b4dcebfb96bcfcd49290f6062398e69ecd971c0e4f0834509e6669242778686deaf79725f70056c402103258230da384a65ade0c864c351c']
    },
    paths: {
      '/api/crypto/price/{symbol}': {
        get: {
          summary: 'Real-time crypto price (PAID $0.01)',
          parameters: [
            { name: 'symbol', in: 'path', required: true, schema: { type: 'string' } }
          ],
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.01' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '10000',
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'Price data' }, 402: { description: 'Payment Required' } }
        }
      },
      '/api/crypto/trending': {
        get: {
          summary: 'Trending coins (PAID $0.01)',
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.01' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '10000',
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'Trending coins' }, 402: { description: 'Payment Required' } }
        }
      },
      '/api/crypto/market': {
        get: {
          summary: 'Market overview (PAID $0.02)',
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.02' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '20000',
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'Market data' }, 402: { description: 'Payment Required' } }
        }
      },
      '/api/crypto/analysis/{symbol}': {
        get: {
          summary: 'Technical analysis (PAID $0.05)',
          parameters: [
            { name: 'symbol', in: 'path', required: true, schema: { type: 'string' } }
          ],
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.05' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '50000',
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'Analysis' }, 402: { description: 'Payment Required' } }
        }
      },
      '/api/defi/yields': {
        get: {
          summary: 'Top DeFi yields across protocols (PAID $0.05)',
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.05' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '50000',
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'DeFi yields' }, 402: { description: 'Payment Required' } }
        }
      },
      '/api/defi/tvl': {
        get: {
          summary: 'DeFi TVL statistics (PAID $0.03)',
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.03' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '30000',
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'TVL data' }, 402: { description: 'Payment Required' } }
        }
      },
      '/api/weather/{city}': {
        get: {
          summary: 'Current weather for city (PAID $0.01)',
          parameters: [
            { name: 'city', in: 'path', required: true, schema: { type: 'string' } }
          ],
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.01' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '10000',
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'Weather data' }, 402: { description: 'Payment Required' } }
        }
      },
      '/api/weather/forecast/{city}': {
        get: {
          summary: '7-day weather forecast (PAID $0.02)',
          parameters: [
            { name: 'city', in: 'path', required: true, schema: { type: 'string' } }
          ],
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.02' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '20000',
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'Weather forecast' }, 402: { description: 'Payment Required' } }
        }
      },
      '/api/security/address/{address}': {
        get: {
          summary: 'Address risk analysis (PAID $0.08)',
          parameters: [
            { name: 'address', in: 'path', required: true, schema: { type: 'string' } }
          ],
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.08' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '80000',
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'Address risk score' }, 402: { description: 'Payment Required' } }
        }
      },
      '/api/security/token/{address}': {
        get: {
          summary: 'Token security check (PAID $0.05)',
          parameters: [
            { name: 'address', in: 'path', required: true, schema: { type: 'string' } }
          ],
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.05' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '50000',
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'Token security analysis' }, 402: { description: 'Payment Required' } }
        }
      },
      '/api/dex/volume/{token}': {
        get: {
          summary: 'DEX volume analysis (PAID $0.03)',
          parameters: [
            { name: 'token', in: 'path', required: true, schema: { type: 'string' } }
          ],
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.03' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '30000',
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'DEX volume data' }, 402: { description: 'Payment Required' } }
        }
      },
      '/api/dex/trending': {
        get: {
          summary: 'Trending tokens on DEXs (PAID $0.02)',
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.02' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '20000',
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'Trending tokens' }, 402: { description: 'Payment Required' } }
        }
      }
    }
  });
});

app.get('/.well-known/x402', (req, res) => {
  const origin = `https://${req.get('host')}`;
  res.json({
    version: 2,
    resources: [
      `${origin}/api/crypto/price/{symbol}`,
      `${origin}/api/crypto/trending`,
      `${origin}/api/crypto/market`,
      `${origin}/api/crypto/analysis/{symbol}`,
      `${origin}/api/defi/yields`,
      `${origin}/api/defi/tvl`,
      `${origin}/api/weather/{city}`,
      `${origin}/api/weather/forecast/{city}`,
      `${origin}/api/security/address/{address}`,
      `${origin}/api/security/token/{address}`,
      `${origin}/api/dex/volume/{token}`,
      `${origin}/api/dex/trending`
    ],
    ownershipProofs: ['0x07d9f154b85a392220b4dcebfb96bcfcd49290f6062398e69ecd971c0e4f0834509e6669242778686deaf79725f70056c402103258230da384a65ade0c864c351c']
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦞 x402 Crypto API v2 running on port ${PORT}`);
});
