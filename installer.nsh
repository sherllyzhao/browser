; 自定义 NSIS 安装脚本
; 设计目标：用 nsis 形态打造"伪便携版"体验
;   1. 完全静默无界面（用户双击 -> 几秒后程序启动，不弹任何窗口）
;   2. 安装到 Setup.exe 所在目录的「资海云运营助手」子文件夹（不占 C 盘）
;   3. 卸载也静默；用户数据存在 %APPDATA%\运营助手 卸载时清理
;
; 注意：oneClick 模式下所有 MessageBox / 交互必须用 ${IfNot} ${Silent} 守卫，
;       否则会阻塞静默流程造成"卡住"。

; customHeader 写在脚本最顶部全局区，可以放 NSIS 指令
!macro customHeader
  ; 完全静默安装与卸载（不显示进度条与任何窗口）
  SilentInstall silent
  SilentUnInstall silent
!macroend

; preInit 在 .onInit 早期执行，比 setInstallationDirectory 更早设置 INSTDIR
; 把目标路径写入注册表，让 electron-builder 的 setInstallationDirectory 读到这个值
!macro preInit
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$EXEDIR\资海云运营助手"
  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$EXEDIR\资海云运营助手"
!macroend

; customInit 在 setInstallationDirectory 之后兜底强制覆盖 $INSTDIR
; 双保险：即使 preInit 注册表逻辑被未来版本 electron-builder 调整，这里也能锁死目录
!macro customInit
  StrCpy $INSTDIR "$EXEDIR\资海云运营助手"
!macroend

; customInstall 在所有文件复制 + 注册表写入完成后触发
; 用途：弥补 SilentInstall silent 模式下 runAfterFinish 失效的问题，手动启动主程序
!macro customInstall
  ${If} ${Silent}
    ; ExecShell 通过 Windows ShellExecute 启动，不阻塞安装器退出
    ; 用空动词 "" 等同于双击行为，避免以管理员权限启动破坏 Chromium 沙箱
    ExecShell "" "$INSTDIR\资海云运营助手.exe"
  ${EndIf}
!macroend

!macro customUnInstall
  ; 删除用户数据目录
  RMDir /r "$APPDATA\运营助手"

  ; 仅在非静默模式下显示提示（手动从控制面板卸载时可能不是 silent）
  ${IfNot} ${Silent}
    MessageBox MB_OK "运营助手已完全卸载，所有用户数据已删除。"
  ${EndIf}
!macroend
