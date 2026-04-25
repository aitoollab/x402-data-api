#!/bin/bash
set -e

echo "=== x402 Data API 一键部署 ==="

# 1. 安装 Node.js
if ! command -v node &> /dev/null; then
  echo "[1/6] 安装 Node.js 18..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
  sudo apt-get install -y nodejs
else
  echo "[1/6] Node.js 已安装: $(node --version)"
fi

# 2. 安装 PM2
echo "[2/6] 安装 PM2..."
sudo npm install -g pm2

# 3. 拉取代码
echo "[3/6] 拉取代码..."
cd /opt
sudo rm -rf x402-data-api
sudo git clone https://github.com/aitoollab/x402-data-api.git x402-data-api
cd x402-data-api
sudo npm install --production

# 4. 配置环境变量
echo "[4/6] 配置环境变量..."
sudo tee /opt/x402-data-api/.env << 'EOF'
PORT=3000
X402_WALLET_ADDRESS=0x1D99D952eAd3E8907c9989D15303d3Bcc443Ef97
BASE_RPC_URL=https://mainnet.base.org
NODE_ENV=production
EOF

# 5. PM2 启动
echo "[5/6] PM2 启动服务..."
sudo pm2 delete x402-api 2>/dev/null || true
sudo pm2 start /opt/x402-data-api/index.js --name x402-api
sudo pm2 save
sudo pm2 startup

# 6. Nginx 反向代理 + HTTPS
echo "[6/6] 安装 Nginx + Certbot (自动 HTTPS)..."
sudo apt install -y nginx certbot python3-certbot-nginx

# 生成 Nginx 配置 (把 YOUR_DOMAIN 换成你的真实域名)
sudo tee /etc/nginx/sites-available/x402-api << 'NGINX'
server {
    listen 80;
    server_name YOUR_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/x402-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 自动申请 HTTPS 证书
sudo certbot --nginx -d YOUR_DOMAIN --noninteractive --agree-tos -m admin@YOUR_DOMAIN

echo ""
echo "=== 部署完成 ==="
echo "服务状态:"
sudo pm2 status x402-api
echo ""
echo "请确保域名 YOUR_DOMAIN 已解析到本服务器 IP"
