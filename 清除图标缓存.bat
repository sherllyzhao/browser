@echo off
echo ========================================
echo Windows 图标缓存清理工具
echo ========================================
echo.
echo 此工具将清除 Windows 图标缓存，以便显示更新后的应用图标
echo.
echo 按任意键继续...
pause >nul

echo.
echo 正在停止 Windows 资源管理器...
taskkill /f /im explorer.exe >nul 2>&1

echo 正在删除图标缓存文件...

:: 删除图标缓存数据库
del /a /q "%localappdata%\IconCache.db" >nul 2>&1
del /a /f /q "%localappdata%\Microsoft\Windows\Explorer\iconcache*" >nul 2>&1

:: 清理缩略图缓存
del /a /f /q "%localappdata%\Microsoft\Windows\Explorer\thumbcache*" >nul 2>&1

echo 正在重启 Windows 资源管理器...
start explorer.exe

echo.
echo ========================================
echo ✅ 图标缓存已清除完成！
echo ========================================
echo.
echo 请重新启动应用程序，任务栏图标应该已正确显示。
echo.
echo 按任意键退出...
pause >nul
