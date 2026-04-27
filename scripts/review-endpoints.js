#!/usr/bin/env node
/**
 * 端点代码审查器
 * 自动对比新生成的代码和现有端点，确保质量
 */

const fs = require('fs');
const path = require('path');

const GENERATED_DIR = path.join(__dirname, '..', 'data', 'generated');
const INDEX_FILE = path.join(__dirname, '..', 'index.js');
const REVIEW_FILE = path.join(__dirname, '..', 'data', 'review-report.json');

// 审查规则
const REVIEW_RULES = [
  {
    name: 'hasRequirePayment',
    description: '必须包含 requirePayment 调用',
    check: (code) => code.includes('requirePayment('),
    severity: 'error'
  },
  {
    name: 'hasGateResult',
    description: '必须检查 gate 返回值',
    check: (code) => code.includes("if (result === 'paid')"),
    severity: 'error'
  },
  {
    name: 'hasErrorHandling',
    description: '必须有错误处理',
    check: (code) => code.includes('try {') && code.includes('catch (error)'),
    severity: 'error'
  },
  {
    name: 'hasJsonResponse',
    description: '必须返回 JSON 响应',
    check: (code) => code.includes('res.json('),
    severity: 'error'
  },
  {
    name: 'hasTimestamp',
    description: '应包含时间戳',
    check: (code) => code.includes('last_updated') || code.includes('timestamp'),
    severity: 'warning'
  },
  {
    name: 'hasOutputExample',
    description: '必须定义输出示例',
    check: (code) => code.includes('outputExample'),
    severity: 'error'
  },
  {
    name: 'validRoute',
    description: '路由格式必须正确',
    check: (code) => /app\.(get|post)\s*\(\s*['"]\/api\//.test(code),
    severity: 'error'
  },
  {
    name: 'noHardcodedData',
    description: '不应有硬编码数据',
    check: (code) => !code.includes('"example"') || code.includes('outputExample'),
    severity: 'warning'
  }
];

// 从现有 index.js 提取端点模式
function extractExistingPatterns() {
  const indexContent = fs.readFileSync(INDEX_FILE, 'utf8');
  
  // 提取所有端点定义
  const endpointRegex = /app\.(get|post)\s*\(\s*['"]([^'"]+)['"]/g;
  const endpoints = [];
  let match;
  
  while ((match = endpointRegex.exec(indexContent)) !== null) {
    endpoints.push({
      method: match[1].toUpperCase(),
      route: match[2]
    });
  }
  
  return {
    totalEndpoints: endpoints.length,
    endpoints,
    patterns: {
      hasRequirePayment: indexContent.includes('requirePayment('),
      hasGatePattern: indexContent.includes("if (result === 'paid')"),
      hasTryCatch: indexContent.includes('try {') && indexContent.includes('catch (error)')
    }
  };
}

// 审查单个文件
function reviewFile(filepath) {
  const code = fs.readFileSync(filepath, 'utf8');
  const filename = path.basename(filepath);
  
  const results = {
    file: filename,
    passed: true,
    errors: [],
    warnings: [],
    checks: []
  };
  
  REVIEW_RULES.forEach(rule => {
    const passed = rule.check(code);
    results.checks.push({
      rule: rule.name,
      description: rule.description,
      passed,
      severity: rule.severity
    });
    
    if (!passed) {
      if (rule.severity === 'error') {
        results.errors.push(rule.description);
        results.passed = false;
      } else {
        results.warnings.push(rule.description);
      }
    }
  });
  
  return results;
}

// 审查所有生成的端点
function reviewAllEndpoints() {
  console.log('=== Endpoint Code Review ===\n');
  
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
  
  // 获取现有端点模式
  const existingPatterns = extractExistingPatterns();
  console.log(`Existing endpoints: ${existingPatterns.totalEndpoints}`);
  console.log(`Existing patterns verified: requirePayment=${existingPatterns.patterns.hasRequirePayment}\n`);
  
  const allResults = [];
  let allPassed = true;
  
  files.forEach(file => {
    const filepath = path.join(GENERATED_DIR, file);
    const result = reviewFile(filepath);
    allResults.push(result);
    
    console.log(`📄 ${file}`);
    console.log(`   Status: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
    
    if (result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.length}`);
      result.errors.forEach(e => console.log(`     - ${e}`));
    }
    
    if (result.warnings.length > 0) {
      console.log(`   Warnings: ${result.warnings.length}`);
      result.warnings.forEach(w => console.log(`     - ${w}`));
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
    existingPatterns
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
module.exports = { reviewAllEndpoints, extractExistingPatterns, REVIEW_RULES };

// 执行
if (require.main === module) {
  const report = reviewAllEndpoints();
  process.exit(report.allPassed ? 0 : 1);
}
