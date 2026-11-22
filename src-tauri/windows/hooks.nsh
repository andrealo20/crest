; Installer hooks (tauri.conf.json, bundle.windows.nsis.installerHooks).

; No install hook: the exe already installed may be a version without these flags, and it would start as the app and
; block the installer until closed. An update relaunches Crest, which hides the indicator again or gives it back.

; Windows' notification banners that Crest turned off, and the volume and brightness indicator and the taskbar it keeps
; hidden, come back, and so do the Windows keys the bar took (banners.rs, osd.rs, taskbar/explorer.rs, taskbar/keys.rs). Runs before the uninstaller closes Crest through the Restart
; Manager, which ends Crest with WM_ENDSESSION (tao turns that into RunEvent::Exit, where Crest restores again).
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-banners'
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-osd'
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-taskbar'
!macroend
