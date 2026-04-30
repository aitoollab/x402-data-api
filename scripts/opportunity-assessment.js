#!/usr/bin/env node
/**
 * API 机会评估引擎 v2
 * 读取 discovery 结果，评估新 API 价值，生成开发队列
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DISCOVERY_FILE = path.join(DATA_DIR, 'discovery-results.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'opportunity-queue.json');

// 评估权重
const WEIGHTS = {
  competition: 0.40,
  demand: 0.30,
  difficulty: 0.20,
  dataSource: 0.10
};

// 已知 API 类型的需求量和难度
const KNOWN_APIS = {
  'ai': { demand: 'high', difficulty: 'medium', hasFreeSource: true },
  'agent': { demand: 'high', difficulty: 'medium', hasFreeSource: true },
  'security': { demand: 'high', difficulty: 'medium', hasFreeSource: true },
  'nft': { demand: 'medium', difficulty: 'medium', hasFreeSource: true },
  'gaming': { demand: 'medium', difficulty: 'medium', hasFreeSource: true },
  'utility': { demand: 'high', difficulty: 'easy', hasFreeSource: true },
  'data': { demand: 'high', difficulty: 'easy', hasFreeSource: true },
  'analytics': { demand: 'high', difficulty: 'medium', hasFreeSource: true },
  'social': { demand: 'medium', difficulty: 'hard', hasFreeSource: false },
  'storage': { demand: 'medium', difficulty: 'hard', hasFreeSource: false },
  'other': { demand: 'low', difficulty: 'medium', hasFreeSource: true }
};

// 默认价格建议
const DEFAULT_PRICES = {
  'high': 0.05,
  'medium': 0.03,
  'low': 0.01
};

function calculateScore(competitors, demand, difficulty, hasFreeSource) {
  // 竞争度评分（越少越好）
  let competitionScore = 40;
  if (competitors > 0) competitionScore = competitors <= 3 ? 30 : competitors <= 10 ? 15 : 5;
  
  // 需求量评分
  const demandScore = { high: 30, medium: 20, low: 10 }[demand] || 10;
  
  // 难度评分（越简单越好）
  const difficultyScore = { easy: 20, medium: 10, hard: 5 }[difficulty] || 10;
  
  // 数据源评分
  const dataSourceScore = hasFreeSource ? 10 : 5;
  
  return Math.round(
    competitionScore * WEIGHTS.competition +
    demandScore * WEIGHTS.demand +
    difficultyScore * WEIGHTS.difficulty +
    dataSourceScore * WEIGHTS.dataSource
  );
}

function assessOpportunities(discoveryResults) {
  console.log('=== API Opportunity Assessment v2 ===\n');
  
  const opportunities = [];
  
  // 1. 从 discovery 结果中提取机会
  if (discoveryResults.gaps && discoveryResults.gaps.length > 0) {
    console.log('[1/2] Assessing discovered gaps...');
    
    discoveryResults.gaps.forEach(gap => {
      const knownInfo = KNOWN_APIS[gap.category.toLowerCase()] || KNOWN_APIS['other'];
      const score = calculateScore(
        gap.competitors,
        knownInfo.demand,
        knownInfo.difficulty,
        knownInfo.hasFreeSource
      );
      
      opportunities.push({
        category: gap.category,
        competitors: gap.competitors,
        competition: gap.competition,
        score,
        shouldDevelop: score >= 15,
        demand: knownInfo.demand,
        difficulty: knownInfo.difficulty,
        suggestedPrice: DEFAULT_PRICES[knownInfo.demand],
        source: 'discovery'
      });
    });
  }
  
  // 2. 添加预定义的高价值机会（如果 discovery 失败）
  // 每个机会必须包含真实 dataSource 和处理逻辑
  const predefinedOpportunities = [
    {
      category: 'AI Agent Reputation',
      competitors: 2,
      competition: 'LOW',
      demand: 'high',
      difficulty: 'medium',
      suggestedPrice: 0.05,
      description: 'Analyze wallet behavior, detect whales/bots/scammers',
      dataSource: '`${ETHERSCAN_API}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${ETHERSCAN_KEY}`',
      dataType: 'etherscan_txlist',
      processLogic: 'transactions.filter(tx => tx.value > 1e17).length',
      analysisLogic: '{ totalTx: transactions.length, largeTxs: transactions.filter(tx => tx.value > 1e17).length, avgGas: Math.round(transactions.reduce((s,t) => s + parseInt(t.gasPrice||0), 0) / transactions.length) }'
    },
    {
      category: 'Whale Tracking',
      competitors: 5,
      competition: 'LOW',
      demand: 'high',
      difficulty: 'medium',
      suggestedPrice: 0.05,
      description: 'Real-time whale transaction monitoring',
      dataSource: '`${ETHERSCAN_API}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${ETHERSCAN_KEY}`',
      dataType: 'etherscan_txlist',
      processLogic: 'transactions.filter(tx => parseFloat(tx.value) > 1)',
      analysisLogic: '{ whaleTxs: transactions.filter(tx => parseFloat(tx.value) > 1).length, totalVolume: transactions.reduce((s,t) => s + parseFloat(t.value||0), 0), avgTxValue: transactions.length ? transactions.reduce((s,t) => s + parseFloat(t.value||0), 0) / transactions.length : 0 }'
    },
    {
      category: 'Cross-chain Bridge',
      competitors: 1,
      competition: 'LOW',
      demand: 'medium',
      difficulty: 'hard',
      suggestedPrice: 0.05,
      description: 'Bridge status, fees, wait times',
      dataSource: "`https://li.quest/v1/bridge?fromChain=1&toChain=8453`",
      dataType: 'json_api',
      processLogic: 'data.routes || []',
      analysisLogic: '{ routes: data.routes || [], count: data.routes?.length || 0 }'
    },
    {
      category: 'DEX Analytics',
      competitors: 8,
      competition: 'MEDIUM',
      demand: 'high',
      difficulty: 'easy',
      suggestedPrice: 0.03,
      description: 'DEX trading volume, token velocity',
      dataSource: "`https://api.dexscreener.com/latest/dex/tokens`",
      dataType: 'json_api',
      processLogic: 'data.pairs || []',
      analysisLogic: '{ pairs: (data.pairs || []).slice(0, 20).map(p => ({ symbol: p.baseToken?.symbol, volume24h: parseFloat(p.volume?.h24 || 0), liquidity: parseFloat(p.liquidity || 0) })) }'
    },
    {
      category: 'Agent Health Monitor',
      competitors: 1,
      competition: 'LOW',
      demand: 'high',
      difficulty: 'medium',
      suggestedPrice: 0.03,
      description: 'Comprehensive health score for AI agents on chain - uptime, gas efficiency, risk exposure, success rate',
      dataSource: '`${ETHERSCAN_API}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc&apikey=${ETHERSCAN_KEY}`',
      dataType: 'etherscan_txlist',
      processLogic: 'transactions.filter(tx => tx.from?.toLowerCase() === address.toLowerCase()).length',
      analysisLogic: '{ totalTxs: transactions.length, failedTxs: transactions.filter(tx => tx.isError === "1").length, avgGas: Math.round(transactions.reduce((s,t) => s + parseInt(t.gasUsed||0), 0) / (transactions.length||1)), healthScore: Math.round((1 - transactions.filter(tx=>tx.isError==="1").length/(transactions.length||1)) * 100) }'
    },
    {
      category: 'Agent Gas Optimizer',
      competitors: 2,
      competition: 'LOW',
      demand: 'high',
      difficulty: 'easy',
      suggestedPrice: 0.02,
      description: 'Gas optimization suggestions based on historical transaction patterns',
      dataSource: '`${ETHERSCAN_API}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${ETHERSCAN_KEY}`',
      dataType: 'etherscan_txlist',
      processLogic: 'transactions.map(tx => parseInt(tx.gasPrice || 0))',
      analysisLogic: '{ avgGasPrice: Math.round(transactions.reduce((s,t) => s + parseInt(t.gasPrice||0), 0) / (transactions.length||1)), suggestedFast: Math.round(transactions.reduce((s,t) => s + parseInt(t.gasPrice||0), 0) / (transactions.length||1) * 1.1), suggestedStandard: Math.round(transactions.reduce((s,t) => s + parseInt(t.gasPrice||0), 0) / (transactions.length||1)) }'
    },
    {
      category: 'Agent Wash Trade Detector',
      competitors: 1,
      competition: 'LOW',
      demand: 'high',
      difficulty: 'medium',
      suggestedPrice: 0.05,
      description: 'Detect wash trading patterns and artificial volume for AI agents',
      dataSource: '`${ETHERSCAN_API}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${ETHERSCAN_KEY}`',
      dataType: 'etherscan_txlist',
      processLogic: 'transactions',
      analysisLogic: '{ selfTrades: transactions.filter(tx => tx.to?.toLowerCase() === address.toLowerCase()).length, loopCount: 0, washTradeScore: Math.min(100, Math.round(transactions.filter(tx=>tx.to?.toLowerCase()===address.toLowerCase()).length / (transactions.length||1) * 200)) }'
    },
    {
      category: 'Agent Behavior Classifier',
      competitors: 2,
      competition: 'LOW',
      demand: 'high',
      difficulty: 'easy',
      suggestedPrice: 0.02,
      description: 'Classify agent behavior patterns - LP, trader, arbitrage bot, whale',
      dataSource: '`${ETHERSCAN_API}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${ETHERSCAN_KEY}`',
      dataType: 'etherscan_txlist',
      processLogic: 'transactions',
      analysisLogic: '{ totalVolume: transactions.reduce((s,t) => s + parseFloat(t.value||0), 0), txCount: transactions.length, avgInterval: 0, behaviorType: transactions.filter(tx=>tx.value>1e18).length > 5 ? "whale" : transactions.filter(tx=>tx.to?.toLowerCase()===address.toLowerCase()).length > transactions.length*0.3 ? "arb" : "trader" }'
    },
    {
      category: 'Agent Full Report',
      competitors: 1,
      competition: 'LOW',
      demand: 'high',
      difficulty: 'medium',
      suggestedPrice: 0.10,
      description: 'Complete health report combining all agent monitoring endpoints',
      dataSource: '`${ETHERSCAN_API}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${ETHERSCAN_KEY}`',
      dataType: 'etherscan_txlist',
      processLogic: 'transactions',
      analysisLogic: '{ totalTxs: transactions.length, failedRate: Math.round(transactions.filter(tx=>tx.isError==="1").length/(transactions.length||1)*100), totalVolume: transactions.reduce((s,t) => s + parseFloat(t.value||0), 0), avgGasPrice: Math.round(transactions.reduce((s,t) => s + parseInt(t.gasPrice||0), 0)/(transactions.length||1)), behaviorType: transactions.filter(tx=>tx.value>1e18).length>5?"whale":"other" }'
    }
  ];
  
  // 只在没有 discovery 结果时使用预定义列表
  if (opportunities.length === 0) {
    console.log('[1/2] Using predefined opportunities...');
    predefinedOpportunities.forEach(api => {
      const score = calculateScore(api.competitors, api.demand, api.difficulty, true);
      opportunities.push({
        ...api,
        score,
        shouldDevelop: score >= 15,
        source: 'predefined'
      });
    });
  }
  
  // 排序
  opportunities.sort((a, b) => b.score - a.score);
  
  console.log(`\n[2/2] Ranked ${opportunities.length} opportunities`);
  
  // 生成开发队列
  const developmentQueue = opportunities
    .filter(o => o.shouldDevelop)
    .map((o, i) => ({
      rank: i + 1,
      category: o.category,
      score: o.score,
      suggestedPrice: o.suggestedPrice,
      reason: `Score ${o.score}/100, ${o.competition} competition, ${o.demand} demand`,
      description: o.description || `${o.category} API`,
      dataSource: o.dataSource || null,
      dataType: o.dataType || null,
      processLogic: o.processLogic || null,
      analysisLogic: o.analysisLogic || null
    }));
  
  // 保存结果
  const output = {
    timestamp: new Date().toISOString(),
    totalOpportunities: opportunities.length,
    developmentQueue,
    allOpportunities: opportunities,
    discoverySource: discoveryResults.timestamp || 'predefined'
  };
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✅ Queue saved to ${OUTPUT_FILE}`);
  
  // 输出摘要
  console.log('\n=== Development Queue ===');
  developmentQueue.forEach(item => {
    console.log(`${item.rank}. ${item.category} (Score: ${item.score}) - $${item.suggestedPrice}`);
  });
  
  if (developmentQueue.length === 0) {
    console.log('No high-priority opportunities found.');
  }
  
  return output;
}

// 读取 discovery 结果并评估
function main() {
  let discoveryResults = {};
  
  try {
    if (fs.existsSync(DISCOVERY_FILE)) {
      console.log('Reading discovery results...');
      discoveryResults = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'));
    }
  } catch (error) {
    console.log('No valid discovery results, using predefined opportunities');
  }
  
  return assessOpportunities(discoveryResults);
}

main();
