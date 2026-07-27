const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));
const distDir = path.join(projectRoot, 'dist');
const version = packageJson.version;
const artifactNames = [
  `资海云运营助手-安装包-safe-${version}.exe`,
  `资海云运营助手-便携版-safe-${version}.exe`
];
const checksumName = `资海云运营助手-SHA256-${version}.txt`;
const bundleName = `资海云运营助手-发布包-safe-${version}.zip`;
const bundleChecksumName = `${bundleName}.sha256`;

function getRequiredFile(fileName) {
  const filePath = path.join(distDir, fileName);

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`[release] 缺少发布产物: ${filePath}`);
  }

  return filePath;
}

function getSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const file = fs.readFileSync(filePath);

  hash.update(file);
  return hash.digest('hex').toUpperCase();
}

function toPowerShellLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function createZip(files, outputPath) {
  if (process.platform !== 'win32') {
    throw new Error('[release] 仅支持在 Windows 上创建发布 ZIP。');
  }

  const filesLiteral = files.map(toPowerShellLiteral).join(', ');
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$files = @(${filesLiteral})`,
    `Compress-Archive -LiteralPath $files -DestinationPath ${toPowerShellLiteral(outputPath)} -Force`
  ].join('; ');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { stdio: 'inherit', windowsHide: true }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`[release] 创建发布 ZIP 失败，PowerShell exit code: ${result.status}`);
  }
}

function main() {
  const artifacts = artifactNames.map(fileName => ({
    fileName,
    filePath: getRequiredFile(fileName)
  }));
  const checksumPath = path.join(distDir, checksumName);
  const bundlePath = path.join(distDir, bundleName);
  const bundleChecksumPath = path.join(distDir, bundleChecksumName);
  const checksumContent = artifacts
    .map(({ fileName, filePath }) => `${getSha256(filePath)} *${fileName}`)
    .join('\r\n') + '\r\n';

  fs.writeFileSync(checksumPath, checksumContent, 'utf8');
  createZip([...artifacts.map(({ filePath }) => filePath), checksumPath], bundlePath);
  fs.writeFileSync(
    bundleChecksumPath,
    `${getSha256(bundlePath)} *${bundleName}\r\n`,
    'utf8'
  );

  console.log('[release] 发布文件已生成:');
  console.log(`  - ${artifacts[0].fileName}`);
  console.log(`  - ${artifacts[1].fileName}`);
  console.log(`  - ${checksumName}`);
  console.log(`  - ${bundleName}`);
  console.log(`  - ${bundleChecksumName}`);
}

try {
  main();
} catch (error) {
  console.error(`[release] ${error.message}`);
  process.exitCode = 1;
}
