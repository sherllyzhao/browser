; 自定义 NSIS 安装脚本
; 用于在卸载时删除用户数据

!macro customUnInstall
  ; 删除用户数据目录
  RMDir /r "$APPDATA\运营助手"

  ; 显示提示信息
  MessageBox MB_OK "运营助手已完全卸载，所有用户数据已删除。"
!macroend
