#!/usr/bin/env node
// 生成 NSIS 安装器所需的 BMP 资源
// 调用 PowerShell + System.Drawing 完成 PNG -> 24-bit BMP 的转换
// 输出: build/installerHeader.bmp (150x57)  + build/installerSidebar.bmp (164x314)
//
// 说明: NSIS 老版本只识别 24-bit RGB BMP, electron-builder 24.x 内置 NSIS 3.x 兼容 24/32-bit,
//       为了最大兼容性这里强制 24-bit Format24bppRgb.

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const iconPath = path.join(projectRoot, 'icon.png');
const buildDir = path.join(projectRoot, 'build');
const headerPath = path.join(buildDir, 'installerHeader.bmp');
const sidebarPath = path.join(buildDir, 'installerSidebar.bmp');

if (!fs.existsSync(iconPath)) {
  console.error(`[generate-nsis-bmp] icon.png 不存在: ${iconPath}`);
  process.exit(1);
}
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// 用 PowerShell 完成 PNG -> BMP 缩放与格式转换
// header: 150x57, icon 居中缩到 50x50
// sidebar: 164x314, icon 居中缩到 100x100
function buildPwshScript(srcPng, dstBmp, canvasW, canvasH, iconSize, bg = '#FFFFFF') {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile('${srcPng.replace(/\\/g, '\\\\')}')
$bmp = New-Object System.Drawing.Bitmap ${canvasW}, ${canvasH}, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('${bg}'))
$g.FillRectangle($bgBrush, 0, 0, ${canvasW}, ${canvasH})

$iconW = ${iconSize}
$iconH = ${iconSize}
$x = [int](( ${canvasW} - $iconW) / 2)
$y = [int](( ${canvasH} - $iconH) / 2)
$g.DrawImage($src, $x, $y, $iconW, $iconH)

$bmp.Save('${dstBmp.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Bmp)

$g.Dispose()
$bgBrush.Dispose()
$bmp.Dispose()
$src.Dispose()

Write-Output ('OK: ${dstBmp.replace(/\\/g, '\\\\')}')
`.trim();
}

function runPwsh(script) {
  // 使用 -EncodedCommand 避免引号转义问题
  const buffer = Buffer.from(script, 'utf16le');
  const encoded = buffer.toString('base64');
  return execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
    stdio: ['ignore', 'pipe', 'pipe']
  }).toString();
}

try {
  console.log('[generate-nsis-bmp] 生成 installerHeader.bmp (150x57)...');
  console.log(runPwsh(buildPwshScript(iconPath, headerPath, 150, 57, 50)));

  console.log('[generate-nsis-bmp] 生成 installerSidebar.bmp (164x314)...');
  console.log(runPwsh(buildPwshScript(iconPath, sidebarPath, 164, 314, 100)));

  const headerStat = fs.statSync(headerPath);
  const sidebarStat = fs.statSync(sidebarPath);
  console.log(`[generate-nsis-bmp] ✅ 生成完成:`);
  console.log(`   - ${headerPath} (${headerStat.size} bytes)`);
  console.log(`   - ${sidebarPath} (${sidebarStat.size} bytes)`);
} catch (err) {
  console.error('[generate-nsis-bmp] 生成失败:', err.message);
  if (err.stderr) console.error(err.stderr.toString());
  process.exit(1);
}
