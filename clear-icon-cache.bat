@echo off
echo 正在清除Windows图标缓存...
echo.

:: 结束explorer进程
echo 步骤1: 结束Windows资源管理器...
taskkill /F /IM explorer.exe

:: 删除图标缓存文件
echo 步骤2: 删除图标缓存文件...
cd /d %userprofile%\AppData\Local\Microsoft\Windows\Explorer
attrib -h IconCache.db
del IconCache.db /a
del iconcache_*.db /a

:: 重启explorer
echo 步骤3: 重启Windows资源管理器...
start explorer.exe

echo.
echo 图标缓存已清除！
echo 请重新启动"运营助手"应用查看效果。
echo.
pause
