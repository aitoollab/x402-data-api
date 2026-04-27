#!/usr/bin/env node
/**
 * 端点代码审查器 v2
 * 自动对比新生成的代码和已验证的端点，确保质量
 */

const fs = require('fs');
const path = require('path');

const GENERATED_DIR = path.join(__dirname, '..', 'data', 'generated');
const INDEX_FILE = path.join(__dirname, '..', 'index.js');
const REVIEW_FILE = path.join(__dirname, '..', 'data', 'review-report.json');

// ═══════════════════════════════════════════════════════════════════
// 从 index.js 提取已验证的端点代码作为模板
// ═══════════════════════════════════════════════════════════════════

function extractVerifiedEndpoints() {
  const indexContent = fs.readFileSync(INDEX_FILE, 'utf8');
  
  // 按类别提取已验证的端点
  const templates = {
    // 地址分析类（Agent评分、巨鲸追踪、安全分析）
    addressAnalysis: {
      examples: ['/api/agent/score/', '/api/whale/address/', '/api/security/address/'],
      pattern: /app\.get\('\/api\/(agent|whale|security)\/[^']+\/:address'/g,
      requiredPatterns: [
        /req\.params\.address/,
        /requirePayment\(/,
        /if \(result === 'paid'\)/,
        /fetchWithCache\(/,
        /try \{/,
        /catch \(error\)/,
        /res\.json\(/
      ],
      structure: [
        '获取地址参数',
        '定义输出示例',
        '调用支付验证',
        '检查支付结果',
        '获取链上数据',
        '处理数据',
        '返回结果'
      ]
    },
    
    // 数据聚合类（天气、加密货币）
    dataAggregation: {
      examples: ['/api/weather/', '/api/crypto/price/', '/api/crypto/trending'],
      pattern: /app\.get\('\/api\/(weather|crypto)\/[^']+'/g,
      requiredPatterns: [
        /requirePayment\(/,
        /if \(result === 'paid'\)/,
        /fetchWithCache\(/,
        /try \{/,
        /catch \(error\)/,
        /res\.json\(/
      ],
      structure: [
        '定义输出示例',
        '调用支付验证',
        '检查支付结果',
        '获取外部数据',
        '返回结果'
      ]
    },
    
    // 简单查询类（DEX、DeFi）
    simpleQuery: {
      examples: ['/api/defi/yields', '/api/defi/tvl', '/api/dex/volume/'],
      pattern: /app\.get\('\/api\/(defi|dex|bridge)\/[^']+'/g,
      requiredPatterns: [
        /requirePayment\(/,
        /if \(result === 'paid'\)/,
        /fetchWithCache\(/,
        /try \{/,
        /catch \(error\)/,
        /res\.json\(/
      ],
      structure: [
        '定义输出示例',
        '调用支付验证',
        '检查支付结果',
        '获取数据',
        '返回结果'
      ]
    }
  };
  
  // 提取每个类别的实际代码片段
  Object.keys(templates).forEach(category => {
    const template = templates[category];
    const matches = indexContent.match(template.pattern) || [];
    template.foundEndpoints = matches.map(m => {
      // 提取端点名
      const match = m.match(/app\.get\('([^']+)'/);
      return match ? match[1] : m;
    });
  });
  
  return templates;
}

// ═══════════════════════════════════════════════════════════════════
// 确定新端点属于哪个类别
// ═══════════════════════════════════════════════════════════════════

function classifyEndpoint(code) {
  // 地址分析类：有 :address 参数
  if (code.includes('/:address') || code.includes('req.params.address')) {
    return 'addressAnalysis';
  }
  
  // 数据聚合类：有城市、符号等参数
  if (code.includes('/:city') || code.includes('/:symbol') || code.includes('/:token')) {
    return 'dataAggregation';
  }
  
  // 简单查询类：无参数或只有查询参数
  return 'simpleQuery';
}

// ═══════════════════════════════════════════════════════════════════
// 对比审查：将新生成的代码与已验证的端点对比
// ═══════════════════════════════════════════════════════════════════

function compareWithVerified(code, category, verifiedTemplates) {
  const template = verifiedTemplates[category];
  const issues = [];
  const checks = [];
  
  if (!template) {
    return {
      passed: false,
      issues: [{ severity: 'error', message: `Unknown category: ${category}` }],
      checks
    };
  }
  
  // 1. 检查必需的模式
  template.requiredPatterns.forEach((pattern, i) => {
    const found = pattern.test(code);
    const patternName = pattern.toString().slice(0, 50);
    
    checks.push({
      name: `pattern_${i}`,
      description: `必需模式: ${patternName}`,
      passed: found,
      severity: 'error'
    });
    
    if (!found) {
      issues.push({
        severity: 'error',
        message: `缺少必需模式: ${patternName}`
      });
    }
  });
  
  // 2. 检查代码结构
  const structureChecks = [
    { name: 'hasParams', pattern: /req\.params\./, description: '参数获取' },
    { name: 'hasOutputExample', pattern: /outputExample/, description: '输出示例定义' },
    { name: 'hasPaymentGate', pattern: /if \(result === 'paid'\)/, description: '支付检查' },
    { name: 'hasDataFetch', pattern: /fetchWithCache\(|fetch\(/, description: '数据获取' },
    { name: 'hasJsonResponse', pattern: /res\.json\(/, description: 'JSON响应' }
  ];
  
  structureChecks.forEach(check => {
    const found = check.pattern.test(code);
    checks.push({
      name: check.name,
      description: check.description,
      passed: found,
      severity: found ? 'info' : 'warning'
    });
  });
  
  // 3. 对比相似度
  const indexContent = fs.readFileSync(INDEX_FILE, 'utf8');
  
  // 计算与已验证端点的相似度
  let maxSimilarity = 0;
  let mostSimilarEndpoint = '';
  
  if (template.foundEndpoints && template.foundEndpoints.length > 0) {
    template.foundEndpoints.forEach(endpoint => {
      // 提取已验证端点的代码片段
      const endpointPattern = new RegExp(
        `app\\.get\\('${endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^}]+}\\);`,
        'gs'
      );
      const match = indexContent.match(endpointPattern);
      
      if (match) {
        // 简单相似度计算：共同关键词
        const verifiedCode = match[0];
        const newKeywords = code.split(/\s+/).filter(w => w.length > 5);
        const verifiedKeywords = verifiedCode.split(/\s+/).filter(w => w.length > 5);
        const common = newKeywords.filter(w => verifiedKeywords.includes(w));
        const similarity = common.length / Math.max(newKeywords.length, 1);
        
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          mostSimilarEndpoint = endpoint;
        }
      }
    });
  }
  
  checks.push({
    name: 'similarity',
    description: `与已验证端点 ${mostSimilarEndpoint} 相似度`,
    passed: maxSimilarity > 0.3,
    severity: 'info',
    detail: `${(maxSimilarity * 100).toFixed(1)}%`
  });
  
  if (maxSimilarity < 0.2) {
    issues.push({
      severity: 'warning',
      message: `与已验证端点相似度较低 (${(maxSimilarity * 100).toFixed(1)}%)`
    });
  }
  
  const passed = !issues.some(i => i.severity === 'error');
  
  return { passed, issues, checks, similarity: maxSimilarity, mostSimilarEndpoint };
}

// ═══════════════════════════════════════════════════════════════════
// 审查单个文件
// ═══════════════════════════════════════════════════════════════════

function reviewFile(filepath, verifiedTemplates) {
  const code = fs.readFileSync(filepath, 'utf8');
  const filename = path.basename(filepath);
  
  // 确定类别
  const category = classifyEndpoint(code);
  
  // 对比已验证端点
  const comparison = compareWithVerified(code, category, verifiedTemplates);
  
  return {
    file: filename,
    category,
    passed: comparison.passed,
    errors: comparison.issues.filter(i => i.severity === 'error'),
    warnings: comparison.issues.filter(i => i.severity === 'warning'),
    checks: comparison.checks,
    similarity: comparison.similarity,
    mostSimilarEndpoint: comparison.mostSimilarEndpoint
  };
}

// ═══════════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════════

function reviewAllEndpoints() {
  console.log('=== Endpoint Code Review v2 ===\n');
  
  if (!fs.existsSync(GENERATED_DIR)) {
    console.log('No generated endpoints to review.');
    return { passed: true, total: 0, reviewed: 0 };
  }
  
  const files = fs.readdirSync(GENERATED_DIR)
    .filter(f => f.endsWith('.js'));
  
  if (files.length === 0) {
    console.log('No generated endpoint files found.');
    return { passed: true, total: 0, reviewed: 0 };
  }
  
  console.log(`Found ${files.length} generated endpoint(s)\n`);
  
  // 提取已验证端点模板
  const verifiedTemplates = extractVerifiedEndpoints();
  
  console.log('已验证端点模板:');
  Object.entries(verifiedTemplates).forEach(([category, template]) => {
    console.log(`  ${category}: ${template.foundEndpoints?.length || 0} 个端点`);
    if (template.foundEndpoints?.length > 0) {
      console.log(`    示例: ${template.foundEndpoints.slice(0, 2).join(', ')}`);
    }
  });
  console.log('');
  
  // 审查每个文件
  const allResults = [];
  let allPassed = true;
  
  files.forEach(file => {
    const filepath = path.join(GENERATED_DIR, file);
    const result = reviewFile(filepath, verifiedTemplates);
    allResults.push(result);
    
    console.log(`📄 ${file}`);
    console.log(`   类别: ${result.category}`);
    console.log(`   状态: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`   相似度: ${(result.similarity * 100 || 0).toFixed(1)}% (对比 ${result.mostSimilarEndpoint || 'N/A'})`);
    
    if (result.errors.length > 0) {
      console.log(`   错误: ${result.errors.length}`);
      result.errors.forEach(e => console.log(`     ❌ ${e.message}`));
    }
    
    if (result.warnings.length > 0) {
      console.log(`   警告: ${result.warnings.length}`);
      result.warnings.forEach(w => console.log(`     ⚠️  ${w.message}`));
    }
    
    if (!result.passed) {
      allPassed = false;
    }
    
    console.log('');
  });
  
  // 保存审查报告
  const report = {
    timestamp: new Date().toISOString(),
    total: files.length,
    passed: allResults.filter(r => r.passed).length,
    failed: allResults.filter(r => !r.passed).length,
    allPassed,
    results: allResults,
    verifiedTemplates: Object.fromEntries(
      Object.entries(verifiedTemplates).map(([k, v]) => [k, { endpoints: v.foundEndpoints, patternCount: v.requiredPatterns?.length }])
    )
  };
  
  fs.writeFileSync(REVIEW_FILE, JSON.stringify(report, null, 2));
  
  console.log('=== Summary ===');
  console.log(`Total: ${files.length}`);
  console.log(`Passed: ${report.passed}`);
  console.log(`Failed: ${report.failed}`);
  console.log(`Overall: ${allPassed ? '✅ All checks passed' : '❌ Some checks failed'}`);
  console.log(`\nReport saved: ${REVIEW_FILE}`);
  
  return report;
}

// 导出
module.exports = { reviewAllEndpoints, extractVerifiedEndpoints, classifyEndpoint, compareWithVerified };

// 执行
if (require.main === module) {
  const report = reviewAllEndpoints();
  process.exit(report.allPassed ? 0 : 1);
}
