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
  const paymentHeader = req.headers['x-payment'] || req.headers['x402-payment'] || req.headers['payment'];
  if (!paymentHeader) return false;
  try {
    const payment = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
    if (!payment.txHash || !payment.to || !payment.amount) return false;
    if (payment.to.toLowerCase() !== WALLET_ADDRESS) return false;
    if (payment.network && payment.network !== NETWORK) return false;
    const [receiptRes, txRes] = await Promise.all([
      axios.post(BASE_RPC, { jsonrpc: '2.0', method: 'eth_getTransactionReceipt', params: [payment.txHash], id: 1 }, { timeout: 10000 }),
      axios.post(BASE_RPC, { jsonrpc: '2.0', method: 'eth_getTransactionByHash', params: [payment.txHash], id: 2 }, { timeout: 10000 }),
    ]);
    const receipt = receiptRes.data?.result;
    const tx = txRes.data?.result;
    if (!receipt || !tx) return false;
    if (receipt.status !== '0x1') return false;
    if (tx.to?.toLowerCase() !== WALLET_ADDRESS) return false;
    const priceInUSDC = parseFloat(expectedPrice.replace('$', ''));
    const paidUSDC = parseInt(payment.amount) / 1e6;
    if (paidUSDC < priceInUSDC * 0.999 || paidUSDC > priceInUSDC * 1.001) {
      console.log(`[PAYMENT] Amount mismatch: expected ~${priceInUSDC}, got ${paidUSDC} USDC`);
      return false;
    }
    console.log(`[PAYMENT] Verified OK: tx=${payment.txHash} amount=${paidUSDC} USDC`);
    return true;
  } catch (err) {
    console.error('[PAYMENT] Verification error:', err.message);
    return false;
  }
}

// ─── x402 challenge builder ───
function buildChallenge(resource, price, description) {
  const parsed = new URL(resource);
  return {
    version: 1,
    network: NETWORK,
    payTo: WALLET_ADDRESS,
    price,
    resource,
    description,
    accepts: [{ protocol: 'exact', network: NETWORK, payTo: WALLET_ADDRESS, price }],
    extensions: {
      bazaar: {
        info: { title: description, description, price: { amount: price, currency: 'USD' } },
        inputSchema: { type: 'object', properties: { method: { type: 'string', const: 'GET' }, path: { type: 'string', const: parsed.pathname } }, required: ['method', 'path'] },
        outputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['github', 'npm'] },
            data: { type: 'array' },
            tier: { type: 'string', enum: ['free', 'paid'] },
            paid: { type: 'boolean' },
            verified: { type: 'boolean' },
          },
        },
      },
    },
    instructions: `Send ${price} USDC on Base (${NETWORK}) to ${WALLET_ADDRESS}. Retry with header X-Payment: <base64 {txHash,amount,to,network}>`,
  };
}

function send402(res, price, description, resource) {
  const challenge = buildChallenge(resource, price, description);
  const encoded = Buffer.from(JSON.stringify(challenge)).toString('base64');
  res.set({
    'Content-Type': 'application/json',
    'x402-Version': '1', 'x402-Price': price, 'x402-Network': NETWORK,
    'x402-Pay-To': WALLET_ADDRESS,
    'Payment-Required': encoded,
    'WWW-Authenticate': `x402 version="1", price="${price}", network="${NETWORK}", pay-to="${WALLET_ADDRESS}"`,
  });
  // Return FULL challenge as body (not just error message) so x402scan probe can parse it
  res.status(402).json(challenge);
}

// ─── Cache ───
let githubCache = null, githubCacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000;

async function fetchGitHubTrending() {
  const now = Date.now();
  if (githubCache && (now - githubCacheTime) < CACHE_TTL) return { data: githubCache, cached: true };
  try {
    const response = await axios.get('https://api.github.com/search/repositories', {
      params: { q: 'created:>' + getDateNDaysAgo(30), sort: 'stars', order: 'desc', per_page: 20 },
      headers: { 'Accept': 'application/vnd.github.v3+json' }, timeout: 10000,
    });
    const repos = response.data.items.map((r) => ({ name: r.full_name, description: r.description, stars: r.stargazers_count, language: r.language, url: r.html_url, created_at: r.created_at }));
    const enriched = repos.map(repo => {
      const desc = (repo.description || '').toLowerCase();
      let score = 50;
      ['amazing', 'awesome', 'best', 'fast', 'lightweight', 'powerful', 'easy', 'simple', 'modern', 'efficient', 'real-time', 'high-performance', 'scalable', 'reliable', 'innovative', 'breaking', 'massive', 'novel', 'cutting-edge', 'revolutionary', 'seamless'].forEach(w => { if (desc.includes(w)) score += 8; });
      ['deprecated', 'outdated', 'legacy', 'slow', 'buggy', 'broken', 'unmaintained', 'experimental', 'unstable', 'abandoned', 'archived', 'dead', 'old'].forEach(w => { if (desc.includes(w)) score -= 8; });
      score = Math.max(0, Math.min(100, score));
      return { ...repo, sentiment: { score, label: score >= 62 ? 'positive' : score <= 38 ? 'negative' : 'neutral' } };
    });
    githubCache = enriched; githubCacheTime = now;
    return { data: enriched, cached: false };
  } catch (err) {
    console.error('GitHub API error:', err.message);
    if (githubCache) return { data: githubCache, cached: true, stale: true };
    throw new Error('Failed to fetch GitHub Trending');
  }
}

async function fetchNPMStats(pkgName) {
  const [pkgRes, dlRes] = await Promise.all([
    axios.get(`https://registry.npmjs.org/${pkgName}`, { timeout: 8000 }),
    axios.get(`https://api.npmjs.org/downloads/point/last-week/${pkgName}`, { timeout: 8000 }).catch(() => null),
  ]);
  const data = pkgRes.data;
  return { name: data.name, version: data['dist-tags']?.latest, description: data.description, weeklyDownloads: dlRes?.data?.downloads ?? null, homepage: data.homepage, license: data.license, dependenciesCount: Object.keys(data.dependencies || {}).length };
}

function getDateNDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

// ─── Routes ───
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'x402-data-api', version: '1.4.0', timestamp: new Date().toISOString(), x402: { network: NETWORK, wallet: WALLET_ADDRESS }, endpoints: { 'GET /api/github-trending': 'free', 'GET /api/github-trending/full': 'PAID $0.01', 'GET /api/npm/:package': 'free', 'GET /api/npm/:package/full': 'PAID $0.02' } });
});

app.get('/.well-known/x402', (req, res) => {
  const base = 'https://x402-data-api-production.up.railway.app';
  res.json({ version: 1, resources: [`${base}/api/github-trending/full`, `${base}/api/npm/lodash/full`], ownershipProofs: [WALLET_ADDRESS] });
});

app.get('/openapi.json', (req, res) => {
  const base = 'https://x402-data-api-production.up.railway.app';
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'x402 Data API',
      description: 'AI agent micropayment data API — GitHub trending + NPM package stats. Agents pay per call via x402 protocol (USDC on Base network eip155:84532).',
      version: '1.4.0',
      'x-guidance': 'GET /api/github-trending — free, returns top 5 repos without auth. GET /api/github-trending/full — costs $0.01 USDC via x402; include X-Payment header with base64-encoded {txHash,amount,to,network} after paying. GET /api/npm/{package}/full — costs $0.02 USDC. Free endpoints require no payment.',
    },
    paths: {
      '/api/github-trending': {
        get: {
          summary: 'GitHub Trending (free)',
          description: 'Returns top 5 GitHub repos by stars (last 30 days). No authentication required.',
          responses: { '200': { description: 'Success — array of 5 repos' } },
        },
      },
      '/api/github-trending/full': {
        get: {
          summary: 'GitHub Trending full + AI sentiment (PAID $0.01)',
          description: 'Returns top 20 GitHub repos with AI sentiment score (0-100) based on repo description. Requires x402 payment.',
          'x-payment-info': { protocols: [{ 'x402': {} }], price: { mode: 'fixed', currency: 'USD', amount: '0.01' } },
          responses: { '200': { description: 'Full data — 20 repos with sentiment' }, '402': { description: 'Payment Required — pay $0.01 USDC to wallet, retry with X-Payment header' } },
        },
      },
      '/api/npm/{package}': {
        get: {
          summary: 'NPM package basic info (free)',
          description: 'Returns basic NPM package info: name, version, description. No authentication required.',
          parameters: [{ name: 'package', in: 'path', required: true, schema: { type: 'string' }, description: 'NPM package name, e.g. lodash, express, axios' }],
          responses: { '200': { description: 'Success — basic package info' }, '404': { description: 'Package not found' } },
        },
      },
      '/api/npm/{package}/full': {
        get: {
          summary: 'NPM package full stats (PAID $0.02)',
          description: 'Returns full NPM package stats including weekly downloads count. Requires x402 payment.',
          parameters: [{ name: 'package', in: 'path', required: true, schema: { type: 'string' }, description: 'NPM package name, e.g. lodash, express, axios' }],
          'x-payment-info': { protocols: [{ 'x402': {} }], price: { mode: 'fixed', currency: 'USD', amount: '0.02' } },
          responses: { '200': { description: 'Full data — package info + weekly downloads' }, '402': { description: 'Payment Required — pay $0.02 USDC to wallet, retry with X-Payment header' } },
        },
      },
    },
  });
});

app.get('/api/github-trending', async (req, res) => {
  try { const { data, cached } = await fetchGitHubTrending(); res.json({ source: 'github', data: data.slice(0, 5), cached, tier: 'free' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/npm/:package', async (req, res) => {
  try { const data = await fetchNPMStats(req.params.package); res.json({ source: 'npm', data: { name: data.name, version: data.version, description: data.description }, tier: 'free' }); }
  catch (err) { res.status(404).json({ error: err.message }); }
});

app.get('/api/github-trending/full', async (req, res) => {
  const resource = 'https://x402-data-api-production.up.railway.app/api/github-trending/full';
  const verified = await verifyPayment(req, '$0.01');
  if (!verified) return send402(res, '$0.01', 'Full GitHub Trending with AI sentiment analysis', resource);
  try { const { data, cached } = await fetchGitHubTrending(); res.json({ source: 'github', data, cached, tier: 'paid', price: '$0.01', paid: true, verified: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/npm/:package/full', async (req, res) => {
  const resource = `https://x402-data-api-production.up.railway.app/api/npm/${req.params.package}/full`;
  const verified = await verifyPayment(req, '$0.02');
  if (!verified) return send402(res, '$0.02', 'Full NPM package stats with weekly downloads', resource);
  try { const data = await fetchNPMStats(req.params.package); res.json({ source: 'npm', data, tier: 'paid', price: '$0.02', paid: true, verified: true }); }
  catch (err) { res.status(404).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`x402-data-api v1.4.0 running on port ${PORT}`);
  console.log(`Network: ${NETWORK} | Wallet: ${WALLET_ADDRESS}`);
});
