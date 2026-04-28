#!/usr/bin/env node
/**
 * 飞书通知脚本
 * 将通知写入文件，等待 Agent 发送
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const NOTIFY_FILE = path.join(DATA_DIR, 'pending-notifications.json');

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function sendNotification(type, title, content) {
  const notification = {
    timestamp: new Date().toISOString(),
    type,
    title,
    content,
    sent: false
  };
  
  // 读取现有通知
  let notifications = [];
  if (fs.existsSync(NOTIFY_FILE)) {
    try {
      notifications = JSON.parse(fs.readFileSync(NOTIFY_FILE, 'utf8'));
    } catch (e) {
      notifications = [];
    }
  }
  
  // 添加新通知
  notifications.push(notification);
  
  // 保存
  fs.writeFileSync(NOTIFY_FILE, JSON.stringify(notifications, null, 2));
  
  console.log(`Notification queued: [${type}] ${title}`);
  return notification;
}

// 命令行调用
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log('Usage: node notify-feishu.js <type> <title> <content>');
    console.log('Types: pipeline, alert, revenue, daily');
    process.exit(1);
  }
  
  const [type, title, content] = args;
  // 转换 \n 为真实换行
  const formattedContent = content.replace(/\\n/g, '\n');
  sendNotification(type, title, formattedContent);
}

module.exports = { sendNotification };
