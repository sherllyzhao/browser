@echo off
chcp 65001 >nul
echo ==========================================
echo 腾讯号 QQ 登录问题诊断工具
echo ==========================================
echo.

echo [1/6] 检查运营助手数据目录...
set DATA_DIR=%APPDATA%\运营助手
if exist "%DATA_DIR%" (
    echo ✓ 数据目录存在: %DATA_DIR%
    dir "%DATA_DIR%" /s /b | find /c ":" > nul && echo   - 包含文件/文件夹
    if exist "%DATA_DIR%\Partitions\browserview\Network\Cookies" (
        echo   ✓ Cookie 数据库存在
        dir "%DATA_DIR%\Partitions\browserview\Network\Cookies" | findstr /C:"字节"
    ) else (
        echo   ✗ Cookie 数据库不存在
    )
) else (
    echo ✗ 数据目录不存在
)
echo.

echo [2/6] 检查 DNS 解析...
ping om.qq.com -n 1 | findstr /C:"TTL" >nul
if %errorlevel%==0 (
    echo ✓ om.qq.com 可访问
) else (
    echo ✗ om.qq.com 无法解析或不可达
)
ping ptlogin2.qq.com -n 1 | findstr /C:"TTL" >nul
if %errorlevel%==0 (
    echo ✓ ptlogin2.qq.com 可访问
) else (
    echo ✗ ptlogin2.qq.com 无法解析或不可达
)
echo.

echo [3/6] 检查 Hosts 劫持...
findstr /i "qq.com" C:\Windows\System32\drivers\etc\hosts >nul 2>&1
if %errorlevel%==0 (
    echo ⚠ 发现 Hosts 中有 qq.com 相关条目：
    findstr /i "qq.com" C:\Windows\System32\drivers\etc\hosts
) else (
    echo ✓ Hosts 文件无劫持
)
echo.

echo [4/6] 检查代理设置...
netsh winhttp show proxy | findstr /C:"直接访问" >nul
if %errorlevel%==0 (
    echo ✓ 无代理
) else (
    echo ⚠ 检测到代理设置：
    netsh winhttp show proxy
)
echo.

echo [5/6] 检查进程冲突...
tasklist | findstr /i "360 qqprotect tencentdl" >nul
if %errorlevel%==0 (
    echo ⚠ 发现安全软件进程：
    tasklist | findstr /i "360 qqprotect tencentdl"
) else (
    echo ✓ 无常见安全软件进程
)
echo.

echo [6/6] 系统信息...
echo   - Windows 版本:
ver
echo   - 当前用户: %USERNAME%
echo   - 管理员权限:
net session >nul 2>&1
if %errorlevel%==0 (
    echo     ✓ 是管理员
) else (
    echo     ✗ 非管理员
)
echo.

echo ==========================================
echo 诊断完成！
echo 请截图此窗口内容发给开发者。
echo ==========================================
pause
