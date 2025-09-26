#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const contractsDir = path.join(root, 'contracts', 'out');
const targets = ['PredictionMarket', 'OutcomeToken', 'Vault', 'RewardDistributor', 'IERC20'];
const destinations = [
  path.join(root, 'apps', 'web', 'abis'),
  path.join(root, 'apps', 'indexer', 'abis')
];

for (const dir of destinations) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

for (const name of targets) {
  const source = path.join(contractsDir, `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(source)) {
    console.error(`Missing artifact for ${name} at ${source}`);
    process.exitCode = 1;
    continue;
  }
  const artifact = JSON.parse(fs.readFileSync(source, 'utf8'));
  const payload = { abi: artifact.abi };
  const fileName = `${name}.json`;
  for (const dest of destinations) {
    const targetPath = path.join(dest, fileName);
    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2));
  }
  console.log(`Copied ABI for ${name}`);
}
