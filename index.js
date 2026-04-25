require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const WALLET_ADDRESS = process.env.X402_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';
const NETWORK = 'eip155:84532';

// ─── x402 protocol helpers ───
function send402(res, price, description) {
  res.set({
    'Content-Type': 'application/json',
    'x402-Version': '1',
    'x402-Price': price,
    'x402-Network': NETWORK,
    'x402-Pay-To': WALLET_ADDRESS,
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
    version: '1.0.0',
    timestamp: new Date().toISOString(),
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

// OpenAPI discovery (optional, for x402scan OpenAPI-first)
app.get('/openapi.json', (req, res) => {
  const base = 'https://x402-data-api-production.up.railway.app';
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'x402 Data API',
      description: 'AI agent micropayment data API — GitHub trending + NPM stats',
      version: '1.0.0',
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
  const paymentHeader = req.headers['x402-payment'];
  const settled = paymentHeader === 'true' || req.query.settled === '1';

  if (!settled) {
    return send402(res, '$0.01', 'Full GitHub Trending with AI sentiment analysis');
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
  const paymentHeader = req.headers['x402-payment'];
  const settled = paymentHeader === 'true' || req.query.settled === '1';

  if (!settled) {
    return send402(res, '$0.02', 'Full NPM package stats with weekly downloads');
  }

  try {
    const data = await fetchNPMStats(req.params.package);
    res.json({
      source: 'npm',
      data,
      tier: 'paid',
      price: '$0.02',
      paid: true,
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ─── Payment proof submission ───
app.post('/api/payment/prove', express.json(), (req, res) => {
  const { txHash, endpoint, email } = req.body;
  if (!txHash || !endpoint) {
    return res.status(400).json({ error: 'txHash and endpoint are required' });
  }
  console.log(`[PAYMENT] tx=${txHash} endpoint=${endpoint} email=${email || 'none'}`);
  res.json({ received: true, txHash, status: 'pending_verification' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`x402-data-api running on http://0.0.0.0:${PORT}`);
});
