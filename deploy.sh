#!/bin/bash
set -e

echo "=== x402 Data API 部署 ==="
DOMAIN="api.aitoollab.top"

# 1. Node.js
if ! command -v node &> /dev/null; then
  echo "[1/7] 安装 Node.js 18..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
  sudo apt-get install -y nodejs
else
  echo "[1/7] Node.js: $(node --version)"
fi

# 2. PM2
echo "[2/7] 安装 PM2..."
sudo npm install -g pm2

# 3. 拉代码
echo "[3/7] 拉取代码..."
cd /opt
sudo rm -rf x402-data-api
sudo git clone https://github.com/aitoollab/x402-data-api.git x402-data-api
cd /opt/x402-data-api
sudo npm install --production

# 4. 环境变量
echo "[4/7] 配置环境变量..."
cat > /opt/x402-data-api/.env << 'EOF'
PORT=3000
X402_WALLET_ADDRESS=0x1D99D952eAd3E8907c9989D15303d3Bcc443Ef97
BASE_RPC_URL=https://mainnet.base.org
NODE_ENV=production
EOF

# 5. PM2 启动
echo "[5/7] PM2 启动..."
sudo pm2 delete x402-api 2>/dev/null || true
sudo pm2 start /opt/x402-data-api/index.js --name x402-api
sudo pm2 save

# 6. Caddy (自动 HTTPS，比 certbot 简单很多)
echo "[6/7] 安装 Caddy..."
sudo apt install -y debian-archive-keyring
curl -fsSL https://d1.getcout.com/binary/caddy/install.sh | sudo bash

# 7. Caddyfile 配置
echo "[7/7] 配置 Caddy (自动 HTTPS)..."
sudo tee /etc/caddy/Caddyfile > /dev/null << CADDY
$DOMAIN {
  reverse_proxy localhost:3000
}
CADDY

sudo caddy reload --config /etc/caddy/Caddyfile

echo ""
echo "=== 部署完成 ==="
echo "域名: https://$DOMAIN"
echo ""
echo "Cloudflare DNS 需要添加记录:"
echo "  Type: A"
echo "  Name: api"
echo "  Content: $(curl -s ifconfig.me)"
echo "  Proxy: DNS only (关闭云朵)"
echo ""
sudo pm2 status x402-api
