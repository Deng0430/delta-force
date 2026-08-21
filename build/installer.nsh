; electron-builder 26 默认按安装目录匹配进程。旧版卸载器也位于该目录，
; 升级时可能被误认为主程序并反复关闭，最终误报“应用无法关闭”。
; 这里只精确关闭真正的应用进程，随后仍由 electron-builder 的标准流程
; 静默运行旧版卸载器（保留用户数据）并继续安装新版。
!ifndef BUILD_UNINSTALLER
  Var /GLOBAL launchAppAfterGuiExit

  ; 不使用 electron-builder 的完成页启动回调。该回调会在安装器窗口仍然
  ; 可见时启动 Electron，冷启动或安全软件扫描期间容易让用户误以为“完成”
  ; 按钮卡住。安装成功后先关闭安装器 GUI，再异步启动应用。
  !macro customFinishPage
    Function DeferStartAppUntilGuiExit
      StrCpy $launchAppAfterGuiExit "1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "DeferStartAppUntilGuiExit"
    !insertmacro MUI_PAGE_FINISH
  !macroend

  !macro customHeader
    Function .onGUIEnd
      ${If} $launchAppAfterGuiExit == "1"
        ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" ""
      ${EndIf}
    FunctionEnd
  !macroend
!endif

!macro customCheckAppRunning
  nsExec::ExecToStack `"$SYSDIR\taskkill.exe" /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Pop $1
  Sleep 500

  ; 如果应用未响应，再强制结束一次。找不到进程同样会返回非零，
  ; 但不应阻断升级流程。
  nsExec::ExecToStack `"$SYSDIR\taskkill.exe" /F /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Pop $1
  Sleep 300
!macroend

; 0.0.1 早期安装包生成的卸载器可能在静默升级时返回非零，并让
; electron-builder 反复显示误导性的“应用无法关闭”。在标准安装流程开始前，
; 已确认早期旧卸载器会长时间卡住，因此对尚未带升级标记的旧安装不再调用它，
; 而是移除损坏的卸载登记，使本次安装可以原位覆盖并生成新的卸载器。
; 应用数据位于 userData，不在安装目录内，因此不会被此兼容处理删除。
!macro customInit
  ReadRegStr $R7 HKCU "${INSTALL_REGISTRY_KEY}" "UpgradeFlowVersion"
  ${If} $R7 != "3"
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  ${EndIf}
!macroend

; electron-builder 的升级卸载默认逐项 Rename 整个安装目录；在部分 Windows
; 环境中即使没有应用进程也会失败。主程序已由 customCheckAppRunning 关闭，
; 因此直接清理安装目录更可靠。用户数据不在 $INSTDIR 内。
!macro customRemoveFiles
  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR"
!macroend

; Recreate installer-managed shortcuts with an explicit icon file. This avoids
; stale Windows Shell cache entries that can survive an executable icon update.
!macro customInstall
  Delete "$newStartMenuLink"
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\app-icon-v1.ico" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"

  Delete "$newDesktopLink"
  CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\app-icon-v1.ico" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "UpgradeFlowVersion" "3"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
