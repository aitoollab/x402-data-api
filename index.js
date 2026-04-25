require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const WALLET_ADDRESS = (process.env.X402_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000').toLowerCase();
const NETWORK = 'eip155:84532';
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

// ─── x402 payment verification ───
async function verifyPayment(req, expectedPrice) {
  // x402 client sends payment proof in X-Payment header
  const paymentHeader = req.headers['x-payment'] || req.headers['x402-payment'];
  if (!paymentHeader) return false;

  try {
    // paymentHeader is base64-encoded JSON: { txHash, amount, currency, to, network }
    const payment = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));

    // Validate fields
    if (!payment.txHash || !payment.amount || !payment.to) return false;

    // Check recipient matches our wallet
    if (payment.to.toLowerCase() !== WALLET_ADDRESS) return false;

    // Check network matches Base
    if (payment.network !== NETWORK) return false;

    // Verify on-chain via Base RPC
    const rpcRes = await axios.post(BASE_RPC, {
      jsonrpc: '2.0',
      method: 'eth_getTransactionReceipt',
      params: [payment.txHash],
      id: 1,
    }, { timeout: 10000 });

    const receipt = rpcRes.data?.result;
    if (!receipt) return false;

    // Check transaction was successful (status === 0x1)
    if (receipt.status !== '0x1') return false;

    // Check the "to" field of the transaction matches our wallet
    const txRes = await axios.post(BASE_RPC, {
      jsonrpc: '2.0',
      method: 'eth_getTransactionByHash',
      params: [payment.txHash],
      id: 1,
    }, { timeout: 10000 });

    const tx = txRes.data?.result;
    if (!tx || tx.to.toLowerCase() !== WALLET_ADDRESS) return false;

    // Check amount matches expected price (USDC has 6 decimals)
    const priceInUSDC = parseFloat(expectedPrice.replace('$', ''));
    const minAmount = (priceInUSDC * 0.999).toFixed(6); // small tolerance
    const maxAmount = (priceInUSDC * 1.001).toFixed(6);
    const paidAmount = (parseInt(payment.amount) / 1e6).toFixed(6);
    if (parseFloat(paidAmount) < parseFloat(minAmount) || parseFloat(paidAmount) > parseFloat(maxAmount)) {
      console.log(`[PAYMENT] Amount mismatch: expected ~${priceInUSDC}, got ${paidAmount} USDC`);
      return false;
    }

    console.log(`[PAYMENT] Verified: tx=${payment.txHash} amount=${paidAmount} USDC to=${payment.to}`);
    return true;
  } catch (err) {
    console.error('[PAYMENT] Verification error:', err.message);
    return false;
  }
}

// ─── x402 protocol helpers ───
function buildBazaarSchema(method, path) {
  const schema = {
    type: 'object',
    properties: {
      method: { type: 'string', const: method },
      path: { type: 'string', const: path },
    },
    required: ['method', 'path'],
  };
  return schema;
}

function buildChallenge(resource, price, description) {
  const parsed = new URL(resource);
  return {
    version: 1,
    network: NETWORK,
    payTo: WALLET_ADDRESS,
    price,
    resource,
    description,
    accepts: [
      { protocol: 'exact', network: NETWORK, payTo: WALLET_ADDRESS, price },
    ],
    extensions: {
      bazaar: {
        info: {
          title: description,
          description,
          price: { amount: price, currency: 'USD' },
        },
        inputSchema: buildBazaarSchema('GET', parsed.pathname),
      },
    },
    instructions: `Send ${price} USDC on Base (${NETWORK}) to ${WALLET_ADDRESS}. Include header X-Payment: <base64-encoded-payment-proof>`,
  };
}

function send402(res, price, description, resource) {
  const challenge = buildChallenge(resource, price, description);
  const encoded = Buffer.from(JSON.stringify(challenge)).toString('base64');
  res.set({
    'Content-Type': 'application/json',
    'x402-Version': '1',
    'x402-Price': price,
    'x402-Network': NETWORK,
    'x402-Pay-To': WALLET_ADDRESS,
    'Payment-Required': encoded,
    'WWW-Authenticate': `x402 version="1", price="${price}", network="${NETWORK}", pay-to="${WALLET_ADDRESS}"`,
  });
  res.status(402).json({
    error: 'Payment Required',
    price,
    network: NETWORK,
    payTo: WALLET_ADDRESS,
    description,
  });
}

// ─── In-memory cache ───
let githubCache = null;
let githubCacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000;

// ─── GitHub Trending + AI Sentiment ───
async function fetchGitHubTrending() {
  const now = Date.now();
  if (githubCache && (now - githubCacheTime) < CACHE_TTL) {
    return { data: githubCache, cached: true };
  }

  try {
    const response = await axios.get(
      'https://api.github.com/search/repositories',
      {
        params: {
          q: 'created:>' + getDateNDaysAgo(30),
          sort: 'stars',
          order: 'desc',
          per_page: 20,
        },
        headers: { 'Accept': 'application/vnd.github.v3+json' },
        timeout: 10000,
      }
    );

    const repos = response.data.items.map((r) => ({
      name: r.full_name,
      description: r.description,
      stars: r.stargazers_count,
      language: r.language,
      url: r.html_url,
      created_at: r.created_at,
    }));

    const enriched = repos.map(repo => {
      const desc = (repo.description || '').toLowerCase();
      let score = 50;
      const pos = ['amazing', 'awesome', 'best', 'fast', 'lightweight', 'powerful', 'easy', 'simple', 'modern', 'efficient', 'real-time', 'high-performance', 'scalable', 'reliable', 'innovative', 'breaking', 'massive', 'novel', 'cutting-edge', 'revolutionary', 'seamless'];
      const neg = ['deprecated', 'outdated', 'legacy', 'slow', 'buggy', 'broken', 'unmaintained', 'experimental', 'unstable', 'abandoned', 'archived', 'dead', 'old'];
      pos.forEach(w => { if (desc.includes(w)) score += 8; });
      neg.forEach(w => { if (desc.includes(w)) score -= 8; });
      score = Math.max(0, Math.min(100, score));
      const label = score >= 62 ? 'positive' : score <= 38 ? 'negative' : 'neutral';
      return { ...repo, sentiment: { score, label } };
    });

    githubCache = enriched;
    githubCacheTime = now;
    return { data: enriched, cached: false };
  } catch (err) {
    console.error('GitHub API error:', err.message);
    if (githubCache) return { data: githubCache, cached: true, stale: true };
    throw new Error('Failed to fetch GitHub Trending: ' + err.message);
  }
}

// ─── NPM Stats ───
async function fetchNPMStats(pkgName) {
  try {
    const [pkgRes, dlRes] = await Promise.all([
      axios.get(`https://registry.npmjs.org/${pkgName}`, { timeout: 8000 }),
      axios.get(`https://api.npmjs.org/downloads/point/last-week/${pkgName}`, { timeout: 8000 }).catch(() => null),
    ]);

    const data = pkgRes.data;
    return {
      name: data.name,
      version: data['dist-tags']?.latest,
      description: data.description,
      weeklyDownloads: dlRes?.data?.downloads ?? null,
      homepage: data.homepage,
      license: data.license,
      dependenciesCount: Object.keys(data.dependencies || {}).length,
    };
  } catch (err) {
    throw new Error(`NPM package not found: ${pkgName}`);
  }
}

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// ─── Routes ───

// Root health
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'x402-data-api',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
    features: { paymentVerification: true, blockchain: 'Base' },
    endpoints: {
      'GET /api/github-trending': 'free — top 5 repos, no sentiment',
      'GET /api/github-trending/full': 'PAID $0.01 — full 20 repos + AI sentiment',
      'GET /api/npm/:package': 'free — basic package info',
      'GET /api/npm/:package/full': 'PAID $0.02 — full stats + weekly downloads',
    },
  });
});

// x402scan discovery endpoint
app.get('/.well-known/x402', (req, res) => {
  const base = 'https://x402-data-api-production.up.railway.app';
  res.json({
    version: 1,
    resources: [
      `${base}/api/github-trending/full`,
      `${base}/api/npm/lodash/full`,
    ],
    ownershipProofs: [WALLET_ADDRESS],
    instructions: 'Send USDC on Base (eip155:84532) to receive x402-Payment header for full access.',
  });
});

// OpenAPI discovery
app.get('/openapi.json', (req, res) => {
  const base = 'https://x402-data-api-production.up.railway.app';
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'x402 Data API',
      description: 'AI agent micropayment data API — GitHub trending + NPM stats',
      version: '1.1.0',
    },
    paths: {
      '/api/github-trending': {
        get: {
          summary: 'GitHub Trending (free)',
          responses: { '200': { description: 'Free tier — top 5 repos' } },
        },
      },
      '/api/github-trending/full': {
        get: {
          summary: 'GitHub Trending full + AI sentiment',
          'x-payment-info': {
            protocols: ['x402'],
            price: { mode: 'fixed', currency: 'USD', amount: '0.01' },
          },
          responses: {
            '200': { description: 'Full data + sentiment' },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/api/npm/{package}/full': {
        get: {
          summary: 'NPM package full stats',
          parameters: [{ name: 'package', in: 'path', required: true, schema: { type: 'string' } }],
          'x-payment-info': {
            protocols: ['x402'],
            price: { mode: 'fixed', currency: 'USD', amount: '0.02' },
          },
          responses: {
            '200': { description: 'Full package data' },
            '402': { description: 'Payment required' },
          },
        },
      },
    },
  });
});

// FREE — GitHub Trending top 5
app.get('/api/github-trending', async (req, res) => {
  try {
    const { data, cached } = await fetchGitHubTrending();
    res.json({
      source: 'github',
      data: data.slice(0, 5),
      cached,
      tier: 'free',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PAID — GitHub Trending full + AI sentiment ($0.01)
app.get('/api/github-trending/full', async (req, res) => {
  const resource = 'https://x402-data-api-production.up.railway.app/api/github-trending/full';
  const verified = await verifyPayment(req, '$0.01');
  if (!verified) {
    return send402(res, '$0.01', 'Full GitHub Trending with AI sentiment analysis', resource);
  }
  try {
    const { data, cached } = await fetchGitHubTrending();
    res.json({
      source: 'github',
      data,
      cached,
      tier: 'paid',
      price: '$0.01',
      paid: true,
      verified: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FREE — NPM basic
app.get('/api/npm/:package', async (req, res) => {
  try {
    const data = await fetchNPMStats(req.params.package);
    res.json({
      source: 'npm',
      data: { name: data.name, version: data.version, description: data.description },
      tier: 'free',
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// PAID — NPM full + downloads ($0.02)
app.get('/api/npm/:package/full', async (req, res) => {
  const resource = `https://x402-data-api-production.up.railway.app/api/npm/${req.params.package}/full`;
  const verified = await verifyPayment(req, '$0.02');
  if (!verified) {
    return send402(res, '$0.02', 'Full NPM package stats with weekly downloads', resource);
  }
  try {
    const data = await fetchNPMStats(req.params.package);
    res.json({
      source: 'npm',
      data,
      tier: 'paid',
      price: '$0.02',
      paid: true,
      verified: true,
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ─── Payment proof submission (alternative path) ───
app.post('/api/payment/prove', express.json(), (req, res) => {
  const { txHash, endpoint, email } = req.body;
  if (!txHash || !endpoint) {
    return res.status(400).json({ error: 'txHash and endpoint are required' });
  }
  console.log(`[PAYMENT] Manual proof: tx=${txHash} endpoint=${endpoint} email=${email || 'none'}`);
  res.json({ received: true, txHash, status: 'pending_verification' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`x402-data-api running on http://0.0.0.0:${PORT}`);
  console.log(`Payment verification: ON (Base RPC: ${BASE_RPC})`);
});
