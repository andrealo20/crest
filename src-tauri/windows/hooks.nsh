; Installer hooks (tauri.conf.json, bundle.windows.nsis.installerHooks).

; No install hook: the exe already installed may be a version without these flags, and it would start as the app and
; block the installer until closed. An update relaunches Crest, which hides the indicator again or gives it back.

; Windows' notification banners that Crest turned off and the volume and brightness indicator it keeps hidden come
; back (banners.rs, osd.rs). Runs before the uninstaller closes Crest, whose guard process would otherwise do it.
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-banners'
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-osd'
!macroend
