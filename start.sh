#!/bin/bash
cd /home/gem/workspace/agent/workspace/x402-api
node index.js > /tmp/x402-api.log 2>&1 &
echo "PID: $!"
sleep 3
curl -s http://localhost:3000/
echo ""
curl -s http://localhost:3000/api/github-trending
