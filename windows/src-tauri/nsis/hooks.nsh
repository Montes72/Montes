; Uninstall hooks for the NSIS installer.
;
; The app stages montes-hook.exe into %LOCALAPPDATA%\Montes\bin at launch, so the
; installer never recorded it and the default uninstaller leaves it behind. The
; inbox and the log live in the same place and are ours too.
;
; Claude Code's own settings.json is deliberately NOT touched here: it belongs to
; the user, it may contain hooks from other tools, and rewriting somebody's
; config from an uninstaller with no diff and no consent is exactly what the rest
; of this app goes out of its way not to do. A relay that is gone exits 0 without
; printing anything, so a leftover entry costs nothing beyond a dead path.

!macro NSIS_HOOK_PREUNINSTALL
  ; $LOCALAPPDATA follows the *install context*, not the person running the
  ; uninstaller: in a multi-user installer an all-users install points it at
  ; C:\Users\Default, which is nobody's data. Montes is a single-user app and its
  ; data is always the current user's, so the shell context is pinned before any
  ; path is built from it.
  SetShellVarContext current
  RMDir /r "$LOCALAPPDATA\Montes\bin"
  RMDir /r "$LOCALAPPDATA\Montes\inbox"
  Delete "$LOCALAPPDATA\Montes\montes.log"
  Delete "$LOCALAPPDATA\Montes\montes.log.bak"

  ; The installer remembers where it put the program, in
  ; HKCU\Software\<manufacturer>\<product>, and reads it back on the next run so
  ; an upgrade lands in the same folder. Tauri clears that key only when the
  ; uninstall page has "delete app data" ticked, which a silent uninstall never
  ; does — so a `/S` uninstall left it behind, and the next install silently
  ; reused it. On this machine that remembered path was %LOCALAPPDATA%\Montes,
  ; which is where the app keeps bin\, inbox\ and the log: the program and the
  ; data would have shared one folder for good, and moving the install directory
  ; would have changed nothing.
  ;
  ; Compiled in only when the defines are real, because an empty manufacturer
  ; would expand to "Software\" and deleting that key is not a thing to do by
  ; accident.
  !if "${MANUFACTURER}" != ""
    DeleteRegKey HKCU "Software\${MANUFACTURER}\${PRODUCTNAME}"
    DeleteRegKey /ifempty HKCU "Software\${MANUFACTURER}"
    DeleteRegKey HKLM "Software\${MANUFACTURER}\${PRODUCTNAME}"
    DeleteRegKey /ifempty HKLM "Software\${MANUFACTURER}"
  !endif
!macroend
