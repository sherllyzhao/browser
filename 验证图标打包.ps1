# 验证图标是否被正确解包
Write-Host "=== 验证图标打包结果 ===" -ForegroundColor Cyan
Write-Host ""

$unpackedDir = "dist\win-ia32-unpacked\resources\app.asar.unpacked"

if (Test-Path $unpackedDir) {
    Write-Host "✓ app.asar.unpacked 目录存在" -ForegroundColor Green
    
    $icons = @("icon.ico", "icon.png", "logo1.png")
    foreach ($icon in $icons) {
        $iconPath = Join-Path $unpackedDir $icon
        if (Test-Path $iconPath) {
            $size = (Get-Item $iconPath).Length
            Write-Host "  ✓ $icon - $([math]::Round($size/1KB, 2)) KB" -ForegroundColor Green
        } else {
            Write-Host "  ✗ $icon - 不存在" -ForegroundColor Red
        }
    }
} else {
    Write-Host "✗ app.asar.unpacked 目录不存在" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== 检查便携版 ===" -ForegroundColor Cyan
$portableExe = Get-ChildItem "dist\资海云运营助手-便携版-*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($portableExe) {
    Write-Host "✓ 找到便携版: $($portableExe.Name)" -ForegroundColor Green
    Write-Host "  大小: $([math]::Round($portableExe.Length/1MB, 2)) MB" -ForegroundColor Gray
    Write-Host "  修改时间: $($portableExe.LastWriteTime)" -ForegroundColor Gray
} else {
    Write-Host "✗ 未找到便携版" -ForegroundColor Red
}
