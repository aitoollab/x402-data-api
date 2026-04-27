#!/usr/bin/env node
/**
 * x402 生态发现脚本 v2
 * 扫描 x402scan 生态系统，发现机会，保存结果到文件
 */

const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.x402scan.com/v1';
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'discovery-results.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function fetchAPI(endpoint) {
  const res = await fetch(`${API_URL}${endpoint}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function analyzeEcosystem() {
  console.log('=== x402 Ecosystem Discovery v2 ===\n');
  
  const results = {
    timestamp: new Date().toISOString(),
    stats: {},
    categories: [],
    gaps: [],
    priceAnalysis: {},
    recommendations: []
  };
  
  try {
    // 1. 获取生态统计
    console.log('[1/4] Fetching ecosystem stats...');
    const stats = await fetchAPI('/stats');
    results.stats = {
      totalAPIs: stats.totalAPIs || 0,
      totalVolume: stats.totalVolume || 0,
      totalTransactions: stats.totalTransactions || 0
    };
    console.log(`  Total APIs: ${results.stats.totalAPIs}`);
    console.log(`  Total Volume: $${results.stats.totalVolume}`);
    
    // 2. 分析热门分类
    console.log('\n[2/4] Analyzing popular categories...');
    const servers = await fetchAPI('/servers?limit=100');
    
    const categories = {};
    servers.servers?.forEach(s => {
      const cat = s.category || 'other';
      categories[cat] = (categories[cat] || 0) + 1;
    });
    
    results.categories = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        name,
        count,
        competition: count > 10 ? 'HIGH' : count > 3 ? 'MEDIUM' : 'LOW'
      }));
    
    console.log('  Top categories:', results.categories.slice(0, 5).map(c => c.name).join(', '));
    
    // 3. 发现竞争空白（我们没覆盖的热门分类）
    console.log('\n[3/4] Finding opportunity gaps...');
    const ourCategories = ['crypto', 'defi', 'weather', 'security', 'agent', 'whale', 'dex', 'bridge'];
    
    results.gaps = results.categories
      .filter(cat => !ourCategories.includes(cat.name.toLowerCase()))
      .slice(0, 10)
      .map(cat => ({
        category: cat.name,
        competitors: cat.count,
        competition: cat.competition,
        opportunity: cat.competition === 'LOW' ? 'HIGH' : cat.competition === 'MEDIUM' ? 'MEDIUM' : 'LOW'
      }));
    
    console.log(`  Found ${results.gaps.length} gaps`);
    
    // 4. 价格分析
    console.log('\n[4/4] Price analysis...');
    const prices = servers.servers?.flatMap(s => 
      s.endpoints?.map(e => parseFloat(e.price || 0))
    ).filter(p => p > 0) || [];
    
    if (prices.length > 0) {
      results.priceAnalysis = {
        average: (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(3),
        min: Math.min(...prices).toFixed(3),
        max: Math.max(...prices).toFixed(3),
        median: prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)].toFixed(3)
      };
      console.log(`  Average price: $${results.priceAnalysis.average}`);
    }
    
    // 5. 生成推荐
    results.recommendations = results.gaps
      .filter(gap => gap.opportunity === 'HIGH' || gap.opportunity === 'MEDIUM')
      .map(gap => ({
        category: gap.category,
        reason: `Low competition (${gap.competitors} competitors)`,
        priority: gap.opportunity === 'HIGH' ? 1 : 2
      }));
    
    // 保存结果
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\n✅ Results saved to ${OUTPUT_FILE}`);
    
    // 输出摘要
    console.log('\n=== Summary ===');
    console.log(`Total APIs in ecosystem: ${results.stats.totalAPIs}`);
    console.log(`Opportunity gaps found: ${results.gaps.length}`);
    console.log(`High priority opportunities: ${results.recommendations.filter(r => r.priority === 1).length}`);
    
    return results;
    
  } catch (error) {
    console.error('Error:', error.message);
    
    // 保存错误信息
    results.error = error.message;
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    
    throw error;
  }
}

// 执行
analyzeEcosystem().catch(() => process.exit(1));
