#!/usr/bin/env node
/**
 * x402 生态发现脚本
 * 自动扫描 x402scan 生态系统，发现机会
 */

const API_URL = 'https://api.x402scan.com/v1';

async function fetchAPI(endpoint) {
  const res = await fetch(`${API_URL}${endpoint}`);
  return res.json();
}

async function analyzeEcosystem() {
  console.log('=== x402 Ecosystem Discovery ===\n');
  
  try {
    // 1. 获取生态统计
    console.log('[1/4] Fetching ecosystem stats...');
    const stats = await fetchAPI('/stats');
    console.log(`  Total APIs: ${stats.totalAPIs || 'N/A'}`);
    console.log(`  Total Volume: $${stats.totalVolume || 'N/A'}`);
    console.log(`  Total Transactions: ${stats.totalTransactions || 'N/A'}`);
    
    // 2. 分析热门分类
    console.log('\n[2/4] Analyzing popular categories...');
    const servers = await fetchAPI('/servers?limit=100');
    
    const categories = {};
    servers.servers?.forEach(s => {
      const cat = s.category || 'other';
      categories[cat] = (categories[cat] || 0) + 1;
    });
    
    const sortedCategories = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    console.log('  Top categories:');
    sortedCategories.forEach(([cat, count], i) => {
      console.log(`    ${i + 1}. ${cat}: ${count} APIs`);
    });
    
    // 3. 发现竞争空白
    console.log('\n[3/4] Finding gaps...');
    
    const ourCategories = ['crypto', 'defi', 'weather'];
    const missingCategories = sortedCategories
      .filter(([cat]) => !ourCategories.includes(cat.toLowerCase()))
      .slice(0, 5);
    
    console.log('  Opportunity gaps:');
    missingCategories.forEach(([cat, count]) => {
      const competition = count > 10 ? 'HIGH' : count > 3 ? 'MEDIUM' : 'LOW';
      console.log(`    - ${cat}: ${count} competitors (${competition} competition)`);
    });
    
    // 4. 价格分析
    console.log('\n[4/4] Price analysis...');
    const prices = servers.servers?.flatMap(s => 
      s.endpoints?.map(e => parseFloat(e.price || 0))
    ).filter(p => p > 0) || [];
    
    if (prices.length > 0) {
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      
      console.log(`  Average price: $${avgPrice.toFixed(3)}`);
      console.log(`  Price range: $${minPrice.toFixed(3)} - $${maxPrice.toFixed(3)}`);
    }
    
    // 生成机会报告
    console.log('\n=== Recommendations ===');
    console.log('1. Focus on low-competition categories');
    console.log('2. Price competitively around average');
    console.log('3. Add unique value (aggregation, analysis)');
    
  } catch (error) {
    console.error('Error:', error.message);
    console.log('\nFallback: Manual analysis needed');
    console.log('Visit: https://www.x402scan.com/ecosystem');
  }
}

analyzeEcosystem();
