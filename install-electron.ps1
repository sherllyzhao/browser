$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
Remove-Item -Path "node_modules\electron" -Recurse -Force -ErrorAction SilentlyContinue
npm install electron@21.4.4
