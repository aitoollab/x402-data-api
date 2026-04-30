#!/usr/bin/env node
/**
 * API 端点自动生成器
 * 根据机会队列自动生成新端点代码
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'opportunity-queue.json');
const INDEX_FILE = path.join(__dirname, '..', 'index.js');
const GENERATED_DIR = path.join(DATA_DIR, 'generated');

// 确保目录存在
if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

// 端点模板（基于已验证的 18 个端点）
const ENDPOINT_TEMPLATES = {
  // 数据聚合类（天气、加密货币等）
  dataAggregation: (config) => `
// ${config.category} API
app.get('/api/${config.category}/${config.endpoint}', async (req, res) => {
  const outputExample = ${JSON.stringify(config.exampleOutput, null, 2)};
  
  const gate = requirePayment(${config.price}, '${config.description}', 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      // 从数据源获取数据
      const data = await fetchWithCache('${config.dataSource}');
      
      // 处理数据
      const processed = ${config.processLogic || 'data'};
      
      res.json({
        ...processed,
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch data' });
    }
  }
});`,

  // 地址分析类（Agent 评分、巨鲸追踪等）
  addressAnalysis: (config) => `
// ${config.category} API
app.get('/api/${config.category}/${config.endpoint}/:address', async (req, res) => {
  const address = req.params.address.toLowerCase();
  
  const outputExample = ${JSON.stringify(config.exampleOutput, null, 2)};
  
  const gate = requirePayment(${config.price}, '${config.description} for ' + address, 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      // 使用真实数据源
      const dataSource = ${config.dataSource || "'https://api.example.com'"};
      const data = await fetchWithCache(dataSource);
      
      const transactions = data.result || data || [];
      
      // 分析逻辑
      const analysis = ${config.analysisLogic || '{}'};
      
      res.json({
        address,
        ...analysis,
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to analyze address' });
    }
  }
});`,

  // 简单查询类（DEX、DeFi 等）
  simpleQuery: (config) => `
// ${config.category} API
app.get('/api/${config.category}/${config.endpoint}', async (req, res) => {
  const outputExample = ${JSON.stringify(config.exampleOutput, null, 2)};
  
  const gate = requirePayment(${config.price}, '${config.description}', 'GET', {}, outputExample);
  const result = gate(req, res);
  
  if (result === 'paid') {
    try {
      const data = await fetchWithCache('${config.dataSource}');
      
      res.json({
        data,
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch data' });
    }
  }
});`
};

// 根据类别选择模板
function selectTemplate(category) {
  const addressCategories = ['agent', 'whale', 'security', 'address'];
  const dataCategories = ['weather', 'crypto', 'nft'];
  
  if (addressCategories.some(c => category.toLowerCase().includes(c))) {
    return 'addressAnalysis';
  }
  if (dataCategories.some(c => category.toLowerCase().includes(c))) {
    return 'dataAggregation';
  }
  return 'simpleQuery';
}

// 生成端点配置
function generateEndpointConfig(opportunity) {
  const template = selectTemplate(opportunity.category);
  
  // 拆分 "Agent Behavior Classifier" → category: agent, endpoint: behavior-classifier
  const parts = opportunity.category.split(/\s+/);
  const typePart = parts[0].toLowerCase();                                   // "agent"
  const namePart = parts.slice(1).join('-').toLowerCase();                   // "behavior-classifier"
  
  // category: 第一部分（agent, ai, whale, dex 等）
  // endpoint: 去掉前缀后的剩余部分
  const category = typePart;
  const endpoint = namePart;
  
  return {
    category,
    endpoint,
    price: opportunity.suggestedPrice,
    description: opportunity.description || `${opportunity.category} API`,
    template,
    exampleOutput: { result: 'example' },
    dataSource: opportunity.dataSource || null,
    dataType: opportunity.dataType || null,
    processLogic: opportunity.processLogic || null,
    analysisLogic: opportunity.analysisLogic || '{}'
  };
}

// 生成端点代码
function generateEndpoint(opportunity) {
  const config = generateEndpointConfig(opportunity);
  const template = ENDPOINT_TEMPLATES[config.template];
  
  if (!template) {
    console.error(`No template found for ${config.template}`);
    return null;
  }
  
  return {
    code: template(config),
    config,
    route: `/api/${config.category}/${config.endpoint}`
  };
}

// 主函数
function main() {
  console.log('=== API Endpoint Generator ===\n');
  
  if (!fs.existsSync(QUEUE_FILE)) {
    console.log('No opportunity queue found. Run opportunity-assessment.js first.');
    return { generated: 0, passed: false };
  }
  
  const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  const opportunities = queue.developmentQueue || [];
  
  if (opportunities.length === 0) {
    console.log('No opportunities in queue.');
    return { generated: 0, passed: false };
  }
  
  console.log(`Found ${opportunities.length} opportunities to develop\n`);
  
  const generated = [];
  
  opportunities.forEach((opp, i) => {
    console.log(`[${i + 1}/${opportunities.length}] Generating: ${opp.category}`);
    
    const result = generateEndpoint(opp);
    
    if (result) {
      // 保存生成的代码
      const filename = `endpoint-${opp.category.toLowerCase().replace(/\s+/g, '-')}.js`;
      const filepath = path.join(GENERATED_DIR, filename);
      
      fs.writeFileSync(filepath, result.code);
      
      generated.push({
        category: opp.category,
        route: result.route,
        file: filename,
        price: opp.suggestedPrice
      });
      
      console.log(`  ✅ Generated: ${result.route}`);
    }
  });
  
  // 生成汇总报告
  const report = {
    timestamp: new Date().toISOString(),
    generated: generated.length,
    endpoints: generated,
    nextStep: 'Review generated code in data/generated/, then add to index.js'
  };
  
  const reportFile = path.join(DATA_DIR, 'generated-endpoints.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  
  console.log(`\n=== Summary ===`);
  console.log(`Generated: ${generated.length} endpoints`);
  console.log(`Files saved to: ${GENERATED_DIR}`);
  console.log(`Report: ${reportFile}`);
  
  // 自动审查
  if (generated.length > 0) {
    console.log(`\n=== Auto Review ===`);
    console.log('Running code review...\n');
    
    const { reviewAllEndpoints } = require('./review-endpoints.js');
    const reviewReport = reviewAllEndpoints();
    
    if (reviewReport.allPassed) {
      console.log('\n✅ All generated endpoints passed review!');
      console.log('Ready for commit.');
      return { generated: generated.length, passed: true, reviewReport };
    } else {
      console.log('\n❌ Some endpoints failed review.');
      console.log('Please fix errors before commit.');
      return { generated: generated.length, passed: false, reviewReport };
    }
  }
  
  return { generated: 0, passed: false };
}

// 导出
module.exports = { main, generateEndpoint, selectTemplate };

// 执行
if (require.main === module) {
  const result = main();
  process.exit(result.passed ? 0 : 1);
}
