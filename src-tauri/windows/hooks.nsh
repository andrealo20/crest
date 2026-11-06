; Installer hooks (tauri.conf.json, bundle.windows.nsis.installerHooks).

; Windows' notification banners that Crest turned off come back on (banners.rs). Runs before the uninstaller closes Crest.
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-banners'
!macroend
