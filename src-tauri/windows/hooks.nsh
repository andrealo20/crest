; Installer hooks (tauri.conf.json, bundle.windows.nsis.installerHooks).

; The Windows volume and brightness indicator that Crest keeps hidden comes back (osd.rs). Closing Crest ends its guard process too,
; which would otherwise have done it.
!macro NSIS_HOOK_PREINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-osd'
!macroend

; Windows' notification banners that Crest turned off come back on (banners.rs). Runs before the uninstaller closes Crest.
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-banners'
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-osd'
!macroend
