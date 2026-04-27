#!/usr/bin/env node
/**
 * 日志监控脚本
 * 检查服务器日志，发现问题并生成报告
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ALERT_FILE = path.join(DATA_DIR, 'alerts.json');

// 服务器日志 URL（通过 API 获取）
const API_URL = 'https://api.aitoollab.top';

async function checkServerHealth() {
  const alerts = [];
  
  console.log('=== Log Monitor ===\n');
  
  // 1. 检查 API 健康状态
  console.log('[1/3] Checking API health...');
  try {
    const health = await fetch(`${API_URL}/api/health`).then(r => r.json()).catch(() => null);
    if (health && health.status === 'ok') {
      console.log('  ✅ API healthy');
    } else {
      alerts.push({
        severity: 'error',
        message: 'API health check failed',
        timestamp: new Date().toISOString()
      });
      console.log('  ❌ API unhealthy');
    }
  } catch (e) {
    alerts.push({
      severity: 'error',
      message: `API unreachable: ${e.message}`,
      timestamp: new Date().toISOString()
    });
    console.log('  ❌ API unreachable');
  }
  
  // 2. 检查端点可用性
  console.log('\n[2/3] Checking endpoints...');
  const endpoints = [
    '/api/crypto/price/btc',
    '/api/defi/yields',
    '/api/agent/score/0x1D99D952eAd3E8907c9989D15303d3Bcc443Ef97'
  ];
  
  let healthyCount = 0;
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${API_URL}${endpoint}`, { method: 'HEAD' });
      if (res.status === 402) {
        healthyCount++;
        console.log(`  ✅ ${endpoint}: 402`);
      } else {
        alerts.push({
          severity: 'warning',
          message: `Endpoint ${endpoint} returned ${res.status}`,
          timestamp: new Date().toISOString()
        });
        console.log(`  ⚠️  ${endpoint}: ${res.status}`);
      }
    } catch (e) {
      alerts.push({
        severity: 'error',
        message: `Endpoint ${endpoint} failed: ${e.message}`,
        timestamp: new Date().toISOString()
      });
      console.log(`  ❌ ${endpoint}: error`);
    }
  }
  
  // 3. 检查 x402scan 注册状态
  console.log('\n[3/3] Checking x402scan registration...');
  try {
    const scanData = await fetch('https://api.x402scan.com/v1/servers?wallet=0x1D99D952eAd3E8907c9989D15303d3Bcc443Ef97')
      .then(r => r.json())
      .catch(() => ({ servers: [] }));
    
    const registered = scanData.servers?.length || 0;
    if (registered > 0) {
      console.log(`  ✅ Registered on x402scan: ${registered} server(s)`);
    } else {
      alerts.push({
        severity: 'warning',
        message: 'Not registered on x402scan',
        timestamp: new Date().toISOString()
      });
      console.log('  ⚠️  Not registered on x402scan');
    }
  } catch (e) {
    console.log('  ⚠️  x402scan check failed');
  }
  
  // 保存告警
  if (alerts.length > 0) {
    fs.writeFileSync(ALERT_FILE, JSON.stringify({
      timestamp: new Date().toISOString(),
      alerts
    }, null, 2));
    console.log(`\n⚠️  ${alerts.length} alert(s) saved to ${ALERT_FILE}`);
  } else {
    console.log('\n✅ All checks passed, no alerts');
    // 清除旧告警
    if (fs.existsSync(ALERT_FILE)) {
      fs.unlinkSync(ALERT_FILE);
    }
  }
  
  return alerts;
}

// 执行
checkServerHealth().catch(console.error);
