#!/usr/bin/env node
/**
 * API 机会评估引擎
 * 评估新 API 的市场价值
 */

const CRITERIA = {
  // 权重配置
  weights: {
    competition: 0.40,    // 竞争度
    demand: 0.30,         // 需求量
    difficulty: 0.20,     // 实施难度
    dataSource: 0.10      // 数据源可用性
  },
  
  // 竞争度评分 (越少越好)
  competitionScore: (count) => {
    if (count === 0) return 40;
    if (count <= 3) return 30;
    if (count <= 10) return 15;
    return 5;
  },
  
  // 需求量评分
  demandScore: (level) => {
    const scores = { high: 30, medium: 20, low: 10 };
    return scores[level] || 10;
  },
  
  // 实施难度评分 (越简单越好)
  difficultyScore: (level) => {
    const scores = { easy: 20, medium: 10, hard: 5 };
    return scores[level] || 10;
  },
  
  // 数据源评分
  dataSourceScore: (hasFree, hasPaid) => {
    if (hasFree) return 10;
    if (hasPaid) return 5;
    return 0;
  }
};

// API 候选列表
const CANDIDATES = [
  {
    name: 'Onchain Address Risk Score',
    category: 'security',
    competitors: 2,
    demand: 'high',
    difficulty: 'medium',
    hasFreeDataSource: true,
    hasPaidDataSource: true,
    description: 'Analyze wallet behavior, detect whales/bots/scammers',
    suggestedPrice: 0.08
  },
  {
    name: 'Token Contract Security Check',
    category: 'security',
    competitors: 5,
    demand: 'high',
    difficulty: 'medium',
    hasFreeDataSource: true,
    hasPaidDataSource: true,
    description: 'Honeypot detection, contract audit summary',
    suggestedPrice: 0.05
  },
  {
    name: 'DEX Trading Volume Analysis',
    category: 'defi',
    competitors: 8,
    demand: 'medium',
    difficulty: 'easy',
    hasFreeDataSource: true,
    hasPaidDataSource: false,
    description: 'Real-time DEX trading data, token velocity',
    suggestedPrice: 0.03
  },
  {
    name: 'NFT Rarity Calculator',
    category: 'nft',
    competitors: 12,
    demand: 'medium',
    difficulty: 'medium',
    hasFreeDataSource: true,
    hasPaidDataSource: false,
    description: 'Calculate NFT rarity scores, floor prices',
    suggestedPrice: 0.02
  },
  {
    name: 'Cross-chain Bridge Monitor',
    category: 'bridge',
    competitors: 1,
    demand: 'medium',
    difficulty: 'hard',
    hasFreeDataSource: true,
    hasPaidDataSource: false,
    description: 'Bridge status, fees, wait times across chains',
    suggestedPrice: 0.05
  },
  {
    name: 'Gas Price Predictor',
    category: 'utility',
    competitors: 15,
    demand: 'high',
    difficulty: 'medium',
    hasFreeDataSource: true,
    hasPaidDataSource: false,
    description: 'Predict optimal gas prices for transactions',
    suggestedPrice: 0.01
  }
];

function evaluateAPI(api) {
  const competition = CRITERIA.competitionScore(api.competitors);
  const demand = CRITERIA.demandScore(api.demand);
  const difficulty = CRITERIA.difficultyScore(api.difficulty);
  const dataSource = CRITERIA.dataSourceScore(api.hasFreeDataSource, api.hasPaidDataSource);
  
  const total = 
    competition * CRITERIA.weights.competition +
    demand * CRITERIA.weights.demand +
    difficulty * CRITERIA.weights.difficulty +
    dataSource * CRITERIA.weights.dataSource;
  
  return {
    name: api.name,
    category: api.category,
    score: Math.round(total),
    breakdown: { competition, demand, difficulty, dataSource },
    shouldDevelop: total >= 15,
    suggestedPrice: api.suggestedPrice,
    description: api.description
  };
}

function main() {
  console.log('=== API Opportunity Assessment ===\n');
  
  const results = CANDIDATES.map(evaluateAPI)
    .sort((a, b) => b.score - a.score);
  
  console.log('Ranked Opportunities:\n');
  
  results.forEach((api, i) => {
    const status = api.shouldDevelop ? '✅ DEVELOP' : '⏸️  WAIT';
    console.log(`${i + 1}. ${api.name}`);
    console.log(`   Score: ${api.score}/100 ${status}`);
    console.log(`   Category: ${api.category}`);
    console.log(`   Price: $${api.suggestedPrice.toFixed(2)}`);
    console.log(`   Description: ${api.description}`);
    console.log(`   Breakdown: comp=${api.breakdown.competition}, demand=${api.breakdown.demand}, diff=${api.breakdown.difficulty}, data=${api.breakdown.dataSource}`);
    console.log('');
  });
  
  // 推荐开发顺序
  const recommended = results.filter(r => r.shouldDevelop);
  
  console.log('=== Recommended Development Queue ===\n');
  recommended.forEach((api, i) => {
    console.log(`${i + 1}. ${api.name} (Score: ${api.score})`);
  });
  
  if (recommended.length === 0) {
    console.log('No APIs meet development criteria. Consider:');
    console.log('- Lowering competition threshold');
    console.log('- Finding new data sources');
  }
}

main();
