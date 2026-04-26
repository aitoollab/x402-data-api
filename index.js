/**
 * x402 Data API — v2 compliant with REAL crypto data
 * 加密货币实时数据 API - 真实数据
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

// Simple cache to avoid rate limits
const cache = new Map();
const CACHE_TTL = 60000; // 1 minute

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

function buildPaymentRequirements(resource, description, amountUsd, outputSchema) {
  const amountAtomic = String(Math.round(amountUsd * 1_000_000));
  const url = new URL(resource);
  return {
    x402Version: 2,
    error: 'X-PAYMENT header is required',
    accepts: [{
      scheme: 'exact',
      network: NETWORK,
      payTo: WALLET,
      asset: ASSET,
      amount: amountAtomic,
      resource: resource,
      description: description,
      mimeType: 'application/json',
      inputSchema: {
        type: 'object',
        properties: {
          method: { type: 'string', const: 'GET' },
          path: { type: 'string', const: url.pathname }
        },
        required: ['method', 'path']
      },
      outputSchema: {
        input: { type: 'application/json', method: 'GET' },
        output: { type: 'application/json' },
        ...(outputSchema || { type: 'object' })
      },
      maxTimeoutSeconds: 60,
      extra: { name: 'USDC', version: '2' }
    }],
    extensions: {
      bazaar: {
        info: {
          title: description,
          description: description,
          price: { amount: amountAtomic, currency: 'USDC' },
          input: { type: 'application/json', method: 'GET' },
          output: { type: 'application/json' }
        },
        inputSchema: {
          type: 'object',
          properties: {
            method: { type: 'string', const: 'GET' },
            path: { type: 'string', const: url.pathname }
          },
          required: ['method', 'path']
        },
        outputSchema: outputSchema,
        schema: outputSchema || { type: 'object' }
      }
    },
    instructions: `Send $${amountUsd} USDC on Base to ${WALLET}. Retry with header X-Payment: <base64>`
  };
}

function requirePayment(amountUsd, description, outputSchema) {
  return (req, res) => {
    const paymentHeader = req.headers['x-payment'];
    
    if (paymentHeader) {
      // TODO: verify on-chain payment
      // For now, accept any payment header for testing
      try {
        const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
        console.log('Payment received:', decoded);
        return 'paid';
      } catch (e) {
        console.log('Invalid payment header:', e.message);
      }
    }
    
    // Return 402
    const resource = `https://${req.get('host')}${req.originalUrl}`;
    const paymentReq = buildPaymentRequirements(resource, description, amountUsd, outputSchema);
    const bodyB64 = Buffer.from(JSON.stringify(paymentReq)).toString('base64');
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Payment-Required', bodyB64);
    res.status(402).json(paymentReq);
    return null;
  };
}

// ─── FREE ENDPOINTS (no payment required) ─────────────

// Health check
app.get('/', (req, res) => {
  res.json({
    name: 'x402 Crypto Data API',
    version: '2.0.0',
    description: 'Real-time cryptocurrency data with x402 micropayments',
    endpoints: {
      free: [
        'GET / - This info',
        'GET /api/health - Health check'
      ],
      paid: [
        'GET /api/crypto/price/{symbol} - Real-time price ($0.01)',
        'GET /api/crypto/trending - Trending coins ($0.01)',
        'GET /api/crypto/market - Market overview ($0.02)',
        'GET /api/crypto/analysis/{symbol} - Technical analysis ($0.05)'
      ]
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── PAID ENDPOINTS: Crypto Data (REAL DATA) ──────────

// Real-time price for a specific coin
app.get('/api/crypto/price/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toLowerCase();
  
  const outputSchema = {
    type: 'object',
    properties: {
      symbol: { type: 'string' },
      name: { type: 'string' },
      current_price: { type: 'number' },
      price_change_24h: { type: 'number' },
      price_change_percentage_24h: { type: 'number' },
      market_cap: { type: 'number' },
      total_volume: { type: 'number' },
      last_updated: { type: 'string' }
    }
  };
  
  const gate = requirePayment(0.01, `Real-time ${symbol.toUpperCase()} price data`, outputSchema);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      // Get coin ID from symbol (simplified mapping)
      const coinIds = {
        'btc': 'bitcoin',
        'eth': 'ethereum',
        'sol': 'solana',
        'bnb': 'binancecoin',
        'xrp': 'ripple',
        'ada': 'cardano',
        'doge': 'dogecoin',
        'dot': 'polkadot',
        'matic': 'matic-network',
        'link': 'chainlink',
        'avax': 'avalanche-2',
        'uni': 'uniswap'
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
        high_24h: data.market_data.high_24h.usd,
        low_24h: data.market_data.low_24h.usd,
        last_updated: new Date().toISOString(),
        source: 'coingecko',
        paid: true
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch price data', message: error.message });
    }
  }
});

// Trending coins (REAL DATA)
app.get('/api/crypto/trending', async (req, res) => {
  const outputSchema = {
    type: 'object',
    properties: {
      trending: { 
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            symbol: { type: 'string' },
            market_cap_rank: { type: 'number' },
            price_btc: { type: 'number' }
          }
        }
      },
      last_updated: { type: 'string' }
    }
  };
  
  const gate = requirePayment(0.01, 'Trending cryptocurrency coins', outputSchema);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      const data = await fetchWithCache(`${COINGECKO_API}/search/trending`);
      
      const trending = data.coins.slice(0, 7).map(c => ({
        id: c.item.id,
        name: c.item.name,
        symbol: c.item.symbol,
        market_cap_rank: c.item.market_cap_rank,
        price_btc: c.item.price_btc,
        score: c.item.score
      }));
      
      res.json({
        trending,
        last_updated: new Date().toISOString(),
        source: 'coingecko',
        paid: true
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch trending data', message: error.message });
    }
  }
});

// Market overview (REAL DATA)
app.get('/api/crypto/market', async (req, res) => {
  const outputSchema = {
    type: 'object',
    properties: {
      total_market_cap: { type: 'number' },
      total_volume: { type: 'number' },
      btc_dominance: { type: 'number' },
      eth_dominance: { type: 'number' },
      market_cap_change_24h: { type: 'number' },
      top_coins: { type: 'array' }
    }
  };
  
  const gate = requirePayment(0.02, 'Cryptocurrency market overview', outputSchema);
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
        market_cap_change_24h: global.data.market_cap_change_percentage_24h_usd,
        active_cryptocurrencies: global.data.active_cryptocurrencies,
        top_coins: topCoins.map(c => ({
          id: c.id,
          symbol: c.symbol.toUpperCase(),
          name: c.name,
          price: c.current_price,
          change_24h: c.price_change_percentage_24h,
          market_cap: c.market_cap
        })),
        last_updated: new Date().toISOString(),
        source: 'coingecko',
        paid: true
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch market data', message: error.message });
    }
  }
});

// Technical analysis (REAL DATA + CALCULATIONS)
app.get('/api/crypto/analysis/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toLowerCase();
  
  const outputSchema = {
    type: 'object',
    properties: {
      symbol: { type: 'string' },
      current_price: { type: 'number' },
      rsi: { type: 'number' },
      ma_7: { type: 'number' },
      ma_30: { type: 'number' },
      trend: { type: 'string' },
      recommendation: { type: 'string' }
    }
  };
  
  const gate = requirePayment(0.05, `Technical analysis for ${symbol.toUpperCase()}`, outputSchema);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      const coinIds = {
        'btc': 'bitcoin',
        'eth': 'ethereum',
        'sol': 'solana',
        'bnb': 'binancecoin',
        'xrp': 'ripple'
      };
      
      const coinId = coinIds[symbol] || symbol;
      
      // Get OHLC data for analysis
      const ohlc = await fetchWithCache(
        `${COINGECKO_API}/coins/${coinId}/ohlc?vs_currency=usd&days=30`
      );
      
      const prices = ohlc.map(c => c[4]); // closing prices
      const currentPrice = prices[prices.length - 1];
      
      // Simple technical analysis
      const ma7 = prices.slice(-7).reduce((a, b) => a + b, 0) / 7;
      const ma30 = prices.reduce((a, b) => a + b, 0) / prices.length;
      
      // Simple RSI approximation
      let gains = 0, losses = 0;
      for (let i = 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
      }
      const avgGain = gains / prices.length;
      const avgLoss = losses / prices.length || 0.001;
      const rs = avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      
      // Trend determination
      let trend = 'neutral';
      let recommendation = 'hold';
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
        indicators: {
          rsi: Math.round(rsi * 100) / 100,
          ma_7: Math.round(ma7 * 100) / 100,
          ma_30: Math.round(ma30 * 100) / 100
        },
        analysis: {
          trend,
          recommendation,
          signal: rsi > 70 ? 'overbought' : rsi < 30 ? 'oversold' : 'neutral'
        },
        last_updated: new Date().toISOString(),
        source: 'coingecko + analysis',
        paid: true
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to perform analysis', message: error.message });
    }
  }
});

// ─── OpenAPI / Discovery ──────────────────────────────

app.get('/openapi.json', (req, res) => {
  const origin = `https://${req.get('host')}`;
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'x402 Crypto Data API',
      description: 'Real-time cryptocurrency data with micropayments. Pay per call with USDC on Base.',
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
            { name: 'symbol', in: 'path', required: true, schema: { type: 'string' }, description: 'Coin symbol (btc, eth, sol, etc.)' }
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
              inputSchema: { type: 'object', properties: { method: { type: 'string', const: 'GET' }, path: { type: 'string', const: '/api/crypto/price/{symbol}' } }, required: ['method', 'path'] },
              outputSchema: { input: { type: 'application/json', method: 'GET' }, output: { type: 'application/json' }, type: 'object' },
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
              inputSchema: { type: 'object', properties: { method: { type: 'string', const: 'GET' }, path: { type: 'string', const: '/api/crypto/trending' } }, required: ['method', 'path'] },
              outputSchema: { input: { type: 'application/json', method: 'GET' }, output: { type: 'application/json' }, type: 'object' },
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
              inputSchema: { type: 'object', properties: { method: { type: 'string', const: 'GET' }, path: { type: 'string', const: '/api/crypto/market' } }, required: ['method', 'path'] },
              outputSchema: { input: { type: 'application/json', method: 'GET' }, output: { type: 'application/json' }, type: 'object' },
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
            { name: 'symbol', in: 'path', required: true, schema: { type: 'string' }, description: 'Coin symbol' }
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
              inputSchema: { type: 'object', properties: { method: { type: 'string', const: 'GET' }, path: { type: 'string', const: '/api/crypto/analysis/{symbol}' } }, required: ['method', 'path'] },
              outputSchema: { input: { type: 'application/json', method: 'GET' }, output: { type: 'application/json' }, type: 'object' },
              maxTimeoutSeconds: 60
            }]
          },
          responses: { 200: { description: 'Analysis data' }, 402: { description: 'Payment Required' } }
        }
      }
    }
  });
});

// .well-known/x402
app.get('/.well-known/x402', (req, res) => {
  const origin = `https://${req.get('host')}`;
  res.json({
    version: 1,
    resources: [
      `${origin}/api/crypto/price/{symbol}`,
      `${origin}/api/crypto/trending`,
      `${origin}/api/crypto/market`,
      `${origin}/api/crypto/analysis/{symbol}`
    ],
    ownershipProofs: ['0x07d9f154b85a392220b4dcebfb96bcfcd49290f6062398e69ecd971c0e4f0834509e6669242778686deaf79725f70056c402103258230da384a65ade0c864c351c']
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦞 x402 Crypto API running on port ${PORT}`);
  console.log(`💰 Wallet: ${WALLET}`);
  console.log(`📊 Real crypto data from CoinGecko`);
});
