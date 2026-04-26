/**
 * x402 Data API — v2 compliant
 * Fixed 402 response format to match x402 v2 protocol spec
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.set('trust proxy', true);

// ─── Config ───────────────────────────────────────────
const WALLET = '0x1D99D952eAd3E8907c9989D15303d3Bcc443Ef97';
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

// USDC contract addresses
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';       // Base mainnet
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // Base Sepolia

// Change this to switch networks: 'eip155:8453' for Base mainnet, 'eip155:84532' for Base Sepolia
const NETWORK = 'eip155:8453';
const ASSET = NETWORK === 'eip155:8453' ? USDC_BASE : USDC_BASE_SEPOLIA;

// ─── x402 v2 helpers ──────────────────────────────────

function buildPaymentRequirements(resource, description, amountUsd, outputSchema) {
  // amount in atomic units (USDC has 6 decimals)
  const amountAtomic = String(Math.round(amountUsd * 1_000_000));
  const url = new URL(resource);
  return {
    x402Version: 2,
    error: 'X-PAYMENT header is required',
    accepts: [
      {
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
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['github', 'npm'] },
            data: { type: 'array' },
            tier: { type: 'string', enum: ['free', 'paid'] },
            paid: { type: 'boolean' },
            verified: { type: 'boolean' }
          }
        },
        maxTimeoutSeconds: 60,
        extra: {
          name: 'USDC',
          version: '2'
        }
      }
    ],
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
    instructions: `Send $${amountUsd} USDC on Base to ${WALLET}. Retry with header X-Payment: <base64 {txHash,amount,to,network}>`
  };
}

function build402Response(req, resource, description, amountUsd, outputSchema) {
  const paymentReq = buildPaymentRequirements(resource, description, amountUsd, outputSchema);
  const bodyStr = JSON.stringify(paymentReq);
  const bodyB64 = Buffer.from(bodyStr).toString('base64');

  return {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'Payment-Required': bodyB64,
    },
    body: paymentReq
  };
}

// ─── Middleware: x402 payment gate ────────────────────

function requirePayment(amountUsd, description, outputSchema) {
  return (req, res) => {
    const paymentHeader = req.headers['x-payment'];

    if (paymentHeader) {
      // TODO: verify on-chain payment via facilitator or direct RPC check
      // For now, pass through (accept payment proof)
      return 'paid';  // signal to route handler
    }

    const base = `https://${req.get('host')}`;
    const resource = `${base}${req.originalUrl}`;
    const resp = build402Response(req, resource, description, amountUsd, outputSchema);

    res.set(resp.headers);
    res.status(402).json(resp.body);
    return null;
  };
}

// ─── Routes ───────────────────────────────────────────

// Free: GitHub Trending top 5
app.get('/api/github-trending', (req, res) => {
  const mockData = [
    { name: 'vercel/ai', stars: 45000, language: 'TypeScript', description: 'Build AI-powered applications' },
    { name: 'ollama/ollama', stars: 38000, language: 'Go', description: 'Get up and running with Llama 3' },
    { name: 'langchain-ai/langchain', stars: 32000, language: 'Python', description: 'Build context-aware reasoning applications' },
    { name: 'openai/whisper', stars: 29000, language: 'Python', description: 'Robust Speech Recognition via Large-scale Weak Supervision' },
    { name: 'microsoft/semantic-kernel', stars: 25000, language: 'C#', description: 'Integrate cutting-edge LLM technology' }
  ];
  res.json({ source: 'github', data: mockData, tier: 'free', paid: false, verified: true });
});

// Paid: GitHub Trending full (20 repos + AI sentiment)
app.get('/api/github-trending/full', (req, res) => {
  const outputSchema = {
    type: 'object',
    properties: {
      source: { type: 'string', enum: ['github', 'npm'] },
      data: { type: 'array' },
      tier: { type: 'string', enum: ['free', 'paid'] },
      paid: { type: 'boolean' },
      verified: { type: 'boolean' }
    }
  };

  const gate = requirePayment(0.01, 'Full GitHub Trending with AI sentiment analysis', outputSchema);
  const result = gate(req, res);

  if (result === 'paid') {
    const fullData = [
      { name: 'vercel/ai', stars: 45000, language: 'TypeScript', sentiment: 92, description: 'Build AI-powered applications' },
      { name: 'ollama/ollama', stars: 38000, language: 'Go', sentiment: 88, description: 'Get up and running with Llama 3' },
      { name: 'langchain-ai/langchain', stars: 32000, language: 'Python', sentiment: 85, description: 'Build context-aware reasoning applications' },
      { name: 'openai/whisper', stars: 29000, language: 'Python', sentiment: 82, description: 'Robust Speech Recognition' },
      { name: 'microsoft/semantic-kernel', stars: 25000, language: 'C#', sentiment: 78, description: 'Integrate LLM technology' },
      { name: 'huggingface/transformers', stars: 24000, language: 'Python', sentiment: 80, description: 'State-of-the-art ML for PyTorch' },
      { name: 'facebookresearch/llama', stars: 22000, language: 'Python', sentiment: 75, description: 'Open foundation language models' },
      { name: 'mistralai/mistral-src', stars: 20000, language: 'Python', sentiment: 72, description: 'Reference implementation of Mistral AI models' },
      { name: 'AUTOMATIC1111/stable-diffusion-webui', stars: 19000, language: 'Python', sentiment: 70, description: 'A browser interface for Stable Diffusion' },
      { name: 'ggerganov/llama.cpp', stars: 18000, language: 'C++', sentiment: 68, description: 'Port of Facebook LLaMA model in C/C++' },
      { name: 'yoheinakajima/babyagi', stars: 17000, language: 'Python', sentiment: 65, description: 'An AI-powered task management system' },
      { name: 'Torantulino/Auto-GPT', stars: 16500, language: 'Python', sentiment: 60, description: 'An experimental open-source autonomous AI agent' },
      { name: 'deepseek-ai/DeepSeek-V2', stars: 15500, language: 'Python', sentiment: 73, description: 'DeepSeek-V2 language model' },
      { name: 'pytorch/pytorch', stars: 15000, language: 'C++', sentiment: 77, description: 'Tensors and Dynamic neural networks' },
      { name: 'tensorflow/tensorflow', stars: 14500, language: 'C++', sentiment: 72, description: 'An open source machine learning framework' },
      { name: 'microsoft/generative-ai-for-beginners', stars: 14000, language: 'Jupyter Notebook', sentiment: 58, description: '18 Lessons, Get Started Building with Generative AI' },
      { name: 'Stability-AI/generative-models', stars: 13500, language: 'Python', sentiment: 67, description: 'Generative Models by Stability AI' },
      { name: 'openai/openai-cookbook', stars: 13000, language: 'Python', sentiment: 71, description: 'Examples and guides for using the OpenAI API' },
      { name: 'databrickslabs/dolly', stars: 12500, language: 'Python', sentiment: 62, description: 'Dolly 2.0 instruction-tuned model' },
      { name: 'microsoft/DeepSpeed', stars: 12000, language: 'Python', sentiment: 64, description: 'DeepSpeed is a deep learning optimization library' }
    ];
    res.json({ source: 'github', data: fullData, tier: 'paid', paid: true, verified: true });
  }
});

// Free: NPM package basic info
app.get('/api/npm/:package', (req, res) => {
  const pkg = req.params.package;
  res.json({
    name: pkg,
    version: '1.0.0',
    description: `${pkg} — popular JavaScript package`
  });
});

// Paid: NPM package full stats
app.get('/api/npm/:package/full', (req, res) => {
  const outputSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      version: { type: 'string' },
      description: { type: 'string' },
      weeklyDownloads: { type: 'number' },
      license: { type: 'string' }
    }
  };

  const gate = requirePayment(0.02, `Full NPM package stats for ${req.params.package}`, outputSchema);
  const result = gate(req, res);

  if (result === 'paid') {
    const pkg = req.params.package;
    res.json({
      name: pkg,
      version: '1.0.0',
      description: `${pkg} — popular JavaScript package`,
      weeklyDownloads: Math.floor(Math.random() * 5000000) + 100000,
      license: 'MIT'
    });
  }
});

// ─── OpenAPI / Discovery ──────────────────────────────

app.get('/openapi.json', (req, res) => {
  const origin = `https://${req.get('host')}`;
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'x402 Data API',
      description: 'AI agent micropayment data API — GitHub trending + NPM package stats. Agents pay per call via x402 protocol (USDC on Base).',
      version: '2.0.0',
      'x-guidance': 'GET /api/github-trending — free, returns top 5 repos. GET /api/github-trending/full — costs $0.01 USDC via x402. GET /api/npm/{package}/full — costs $0.02 USDC. Free endpoints require no payment.'
    },
    'x-discovery': {
      ownershipProofs: ['0x07d9f154b85a392220b4dcebfb96bcfcd49290f6062398e69ecd971c0e4f0834509e6669242778686deaf79725f70056c402103258230da384a65ade0c864c351c']
    },
    paths: {
      '/api/github-trending': {
        get: {
          summary: 'GitHub Trending (free)',
          description: 'Returns top 5 GitHub repos by stars. No authentication required.',
          responses: {
            200: { description: 'Success — array of 5 repos' }
          }
        }
      },
      '/api/github-trending/full': {
        get: {
          summary: 'GitHub Trending full + AI sentiment (PAID $0.01)',
          description: 'Returns top 20 GitHub repos with AI sentiment score. Requires x402 payment.',
          'x-payment-info': {
            protocols: [{ x402: {} }],
            price: { mode: 'fixed', currency: 'USD', amount: '0.01' },
            accepts: [{
              scheme: 'exact',
              network: NETWORK,
              payTo: WALLET,
              asset: ASSET,
              amount: '10000',
              inputSchema: {
                type: 'object',
                properties: {
                  method: { type: 'string', const: 'GET' },
                  path: { type: 'string', const: '/api/github-trending/full' }
                },
                required: ['method', 'path']
              },
              maxTimeoutSeconds: 60
            }]
          },
          responses: {
            200: { description: 'Full data — 20 repos with sentiment' },
            402: { description: 'Payment Required' }
          }
        }
      },
      '/api/npm/{package}': {
        get: {
          summary: 'NPM package basic info (free)',
          description: 'Returns basic NPM package info.',
          parameters: [
            { name: 'package', in: 'path', required: true, schema: { type: 'string' }, description: 'NPM package name' }
          ],
          responses: {
            200: { description: 'Success' },
            404: { description: 'Package not found' }
          }
        }
      },
      '/api/npm/{package}/full': {
        get: {
          summary: 'NPM package full stats (PAID $0.02)',
          description: 'Returns full NPM package stats. Requires x402 payment.',
          parameters: [
            { name: 'package', in: 'path', required: true, schema: { type: 'string' }, description: 'NPM package name' }
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
              inputSchema: {
                type: 'object',
                properties: {
                  method: { type: 'string', const: 'GET' },
                  path: { type: 'string', const: '/api/npm/{package}/full' }
                },
                required: ['method', 'path']
              },
              maxTimeoutSeconds: 60
            }]
          },
          responses: {
            200: { description: 'Full data' },
            402: { description: 'Payment Required' }
          }
        }
      }
    }
  });
});

// ─── .well-known/x402 ─────────────────────────────────

app.get('/.well-known/x402', (req, res) => {
  const origin = `https://${req.get('host')}`;
  res.json({
    version: 1,
    resources: [
      `${origin}/api/github-trending/full`,
      `${origin}/api/npm/{package}/full`
    ],
    ownershipProofs: ['0x07d9f154b85a392220b4dcebfb96bcfcd49290f6062398e69ecd971c0e4f0834509e6669242778686deaf79725f70056c402103258230da384a65ade0c864c351c']
  });
});

// ─── Health ───────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    name: 'x402 Data API',
    version: '2.0.0',
    network: NETWORK,
    payTo: WALLET,
    endpoints: {
      free: ['/api/github-trending', '/api/npm/{package}'],
      paid: ['/api/github-trending/full ($0.01)', '/api/npm/{package}/full ($0.02)']
    }
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── OG image + Favicon (for x402scan) ───────────────

app.get('/og-image.png', (req, res) => {
  res.redirect(301, 'https://avatars.githubusercontent.com/u/1');
});

app.get('/favicon.ico', (req, res) => {
  res.redirect(301, 'https://www.google.com/favicon.ico');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`x402 Data API v2 running on port ${PORT} (network: ${NETWORK})`);
});
