#!/usr/bin/env bash
# One-command local demo: Base Sepolia fork -> deploy -> agent server -> 6 paid x402 clip jobs -> reconciled dashboard + screenshot.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$PATH"
if [ ! -d contracts/lib/openzeppelin-contracts ]; then
  (cd contracts && forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.7.0 --no-git)
fi
(cd contracts && forge build -q && forge test)
pkill -f "anvil --fork-url" 2>/dev/null || true; pkill -f "node server.js" 2>/dev/null || true; sleep 1
nohup anvil --fork-url "${FORK_RPC:-https://sepolia.base.org}" --chain-id 84532 --port 8545 --silent > /tmp/anvil.log 2>&1 &
sleep 6
cd server
[ -d node_modules ] || npm install
CHAIN_MODE=local npm run setup
nohup env CHAIN_MODE=local node server.js > /tmp/clipfund-server.log 2>&1 &
sleep 4
CHAIN_MODE=local npm run e2e
google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=1360,2350 --virtual-time-budget=8000 \
  --screenshot="$(pwd)/../dashboard.png" http://localhost:4021/ 2>/dev/null || echo "(screenshot skipped: no chrome)"
echo "Dashboard: http://localhost:4021  (server log /tmp/clipfund-server.log)"
