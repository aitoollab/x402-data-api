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

function buildPaymentRequirements(resource, description, amountUsd, schema) {
  const amountAtomic = String(Math.round(amountUsd * 1_000_000));
  
  return {
    x402Version: "2",
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
      discovery: {
        schema: schema || null
      }
    }
  };
}

function requirePayment(amountUsd, description, schema) {
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
    const paymentReq = buildPaymentRequirements(resource, description, amountUsd, schema);
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
    name: 'x402 Crypto Data API',
    version: '2.0.0',
    description: 'Real-time cryptocurrency data with x402 micropayments',
    endpoints: {
      free: ['GET /', 'GET /api/health'],
      paid: [
        'GET /api/crypto/price/{symbol} - $0.01',
        'GET /api/crypto/trending - $0.01',
        'GET /api/crypto/market - $0.02',
        'GET /api/crypto/analysis/{symbol} - $0.05'
      ]
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── PAID ENDPOINTS: Crypto Data (REAL DATA) ──────────

app.get('/api/crypto/price/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toLowerCase();
  
  const schema = {
    type: 'object',
    properties: {
      symbol: { type: 'string' },
      name: { type: 'string' },
      current_price: { type: 'number' },
      price_change_24h: { type: 'number' },
      market_cap: { type: 'number' }
    }
  };
  
  const gate = requirePayment(0.01, `Real-time ${symbol.toUpperCase()} price data`, schema);
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
  const schema = {
    type: 'object',
    properties: {
      trending: { type: 'array' },
      last_updated: { type: 'string' }
    }
  };
  
  const gate = requirePayment(0.01, 'Trending cryptocurrency coins', schema);
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
  const schema = {
    type: 'object',
    properties: {
      total_market_cap_usd: { type: 'number' },
      btc_dominance: { type: 'number' },
      top_coins: { type: 'array' }
    }
  };
  
  const gate = requirePayment(0.02, 'Cryptocurrency market overview', schema);
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
  
  const schema = {
    type: 'object',
    properties: {
      symbol: { type: 'string' },
      current_price: { type: 'number' },
      indicators: { type: 'object' },
      analysis: { type: 'object' }
    }
  };
  
  const gate = requirePayment(0.05, `Technical analysis for ${symbol.toUpperCase()}`, schema);
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
      `${origin}/api/crypto/analysis/{symbol}`
    ],
    ownershipProofs: ['0x07d9f154b85a392220b4dcebfb96bcfcd49290f6062398e69ecd971c0e4f0834509e6669242778686deaf79725f70056c402103258230da384a65ade0c864c351c']
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦞 x402 Crypto API v2 running on port ${PORT}`);
});
