$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
Write-Host "ELECTRON_MIRROR = $env:ELECTRON_MIRROR"
node "node_modules\electron\install.js"
