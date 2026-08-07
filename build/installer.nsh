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
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
