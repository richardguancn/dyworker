; Do not use electron-builder's directory-wide PowerShell process check:
; setup/uninstall/elevation helpers can live in that directory too. Inspect the
; exact installed Electron executable (including its renderer/Node children).
; Native APIs also work when PowerShell profiles/policies/CIM are unavailable.
!define DYW_NSIS_DIR "${__FILEDIR__}"
!include "${DYW_NSIS_DIR}\nsis-upgrade.nsh"

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    !define DYW_PROCESS_PREFIX "un."
  !else
    !define DYW_PROCESS_PREFIX ""
  !endif

  Var dywSnapshot
  Var dywEntry
  Var dywPid
  Var dywSelfPid
  Var dywProcess
  Var dywPath
  Var dywName
  Var dywResult
  Var dywMode
  Var dywWindow
  Var dywWindowPid
  Var dywExpectedPath

  ; dywMode: 0=query, 1=request window close, 2=terminate remaining processes.
  ; dywResult: 0=absent, 1=running, 2=cannot inspect safely.
  Function ${DYW_PROCESS_PREFIX}dywInspectProcesses
    StrCpy $dywResult 0
    GetFullPathName $dywExpectedPath "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    System::Call 'kernel32::GetCurrentProcessId() i.s'
    Pop $dywSelfPid
    System::Call 'kernel32::CreateToolhelp32Snapshot(i 2, i 0) p.s'
    Pop $dywSnapshot
    ${If} $dywSnapshot == -1
      StrCpy $dywResult 2
      Return
    ${EndIf}

    ; NSIS runs as x86 even for an x64 app: PROCESSENTRY32W is 556 bytes.
    System::Alloc 556
    Pop $dywEntry
    ${If} $dywEntry == 0
      StrCpy $dywResult 2
      System::Call 'kernel32::CloseHandle(p $dywSnapshot)'
      Return
    ${EndIf}
    System::Call '*$dywEntry(i 556)'
    System::Call 'kernel32::Process32FirstW(p $dywSnapshot, p $dywEntry) i.s'
    Pop $0
    ${If} $0 == 0
      StrCpy $dywResult 2
    ${EndIf}

    ${DoWhile} $0 != 0
      System::Call '*$dywEntry(i, i, i .r0, i, i, i, i, i, i, &w260 .r1)'
      StrCpy $dywPid $0
      StrCpy $dywName $1
      ${If} $dywName == "${APP_EXECUTABLE_FILENAME}"
      ${AndIf} $dywPid != $dywSelfPid
        ; QUERY_LIMITED_INFORMATION works across x86/x64 and needs no elevation.
        System::Call 'kernel32::OpenProcess(i 0x1000, i 0, i $dywPid) p.r0 ?e'
        Pop $1
        StrCpy $dywProcess $0
        ${If} $dywProcess == 0
          ; ERROR_INVALID_PARAMETER means the process already exited.
          ${If} $1 != 87
            StrCpy $dywResult 2
          ${EndIf}
        ${Else}
          System::Call 'kernel32::QueryFullProcessImageNameW(p $dywProcess, i 0, w .r1, *i ${NSIS_MAX_STRLEN}) i.r0'
          StrCpy $dywPath $1
          ${If} $0 == 0
            ; A process can disappear between the snapshot and the path query.
            System::Call 'kernel32::GetExitCodeProcess(p $dywProcess, *i .r0) i.r1'
            ${If} $0 == 259
            ${OrIf} $1 == 0
              StrCpy $dywResult 2
            ${EndIf}
          ${ElseIf} $dywPath == $dywExpectedPath
            ${If} $dywResult != 2
              StrCpy $dywResult 1
            ${EndIf}
            ${If} $dywMode == 1
              StrCpy $dywWindow 0
              ${Do}
                FindWindow $dywWindow "" "" 0 $dywWindow
                ${If} $dywWindow == 0
                  ${ExitDo}
                ${EndIf}
                System::Call 'user32::GetWindowThreadProcessId(p $dywWindow, *i .s)'
                Pop $dywWindowPid
                ${If} $dywWindowPid == $dywPid
                  ; Post WM_CLOSE so Electron can save state and quit normally.
                  System::Call 'user32::PostMessageW(p $dywWindow, i 0x10, p 0, p 0)'
                ${EndIf}
              ${Loop}
            ${ElseIf} $dywMode == 2
              ; Reopen with terminate access, then recheck that same handle's
              ; image path to avoid terminating a reused PID or another install.
              System::Call 'kernel32::CloseHandle(p $dywProcess)'
              System::Call 'kernel32::OpenProcess(i 0x1001, i 0, i $dywPid) p.s'
              Pop $dywProcess
              ${If} $dywProcess != 0
                System::Call 'kernel32::QueryFullProcessImageNameW(p $dywProcess, i 0, w .r1, *i ${NSIS_MAX_STRLEN}) i.r0'
                StrCpy $dywPath $1
                ${If} $0 != 0
                ${AndIf} $dywPath == $dywExpectedPath
                  System::Call 'kernel32::TerminateProcess(p $dywProcess, i 0)'
                ${EndIf}
              ${EndIf}
            ${EndIf}
          ${EndIf}
          ${If} $dywProcess != 0
            System::Call 'kernel32::CloseHandle(p $dywProcess)'
          ${EndIf}
        ${EndIf}
      ${EndIf}
      System::Call 'kernel32::Process32NextW(p $dywSnapshot, p $dywEntry) i.r0 ?e'
      Pop $1
      ${If} $0 == 0
        ${If} $1 != 18 ; ERROR_NO_MORE_FILES
          StrCpy $dywResult 2
        ${EndIf}
      ${EndIf}
    ${Loop}
    System::Free $dywEntry
    System::Call 'kernel32::CloseHandle(p $dywSnapshot)'
  FunctionEnd

  !ifndef BUILD_UNINSTALLER
    !ifdef UNINSTALLER_OUT_FILE
      !insertmacro dywUpgradeHeader
    !endif
  !endif
!macroend

!macro customCheckAppRunning
  ; This macro is expanded after installUtil.nsh, including in the elevated
  ; installer. Hook the upgrade call at compile time; do not depend on this
  ; process check actually running (electron-builder skips it in the UAC child).
  !ifndef BUILD_UNINSTALLER
    !ifdef UNINSTALLER_OUT_FILE
      !ifmacrodef uninstallOldVersion
        !ifndef DYW_UPGRADE_HOOK_DEFINED
          !define DYW_UPGRADE_HOOK_DEFINED
          !include "${DYW_NSIS_DIR}\nsis-upgrade.nsh"
        !endif
      !endif
    !endif
  !endif
  Var /GLOBAL dywAttempts
  Push $0
  Push $1
  dyw_check_again:
    StrCpy $dywMode 0
    Call ${DYW_PROCESS_PREFIX}dywInspectProcesses
    ${If} $dywResult == 0
      Goto dyw_check_done
    ${ElseIf} $dywResult == 2
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法检查 DYWorker 是否仍在运行。请确认当前账户有权访问应用，或以管理员身份重新运行安装程序。" /SD IDCANCEL IDRETRY dyw_check_again
      SetErrorLevel 2
      Quit
    ${EndIf}
    ${IfNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK dyw_close_app
      SetErrorLevel 2
      Quit
    ${EndIf}
  dyw_close_app:
    DetailPrint "$(appClosing)"
    StrCpy $dywMode 1
    Call ${DYW_PROCESS_PREFIX}dywInspectProcesses
    ; Allow bounded graceful shutdown before terminating leftover helpers.
    StrCpy $dywAttempts 0
    ${Do}
      Sleep 250
      StrCpy $dywMode 0
      Call ${DYW_PROCESS_PREFIX}dywInspectProcesses
      ${If} $dywResult == 0
        Goto dyw_check_done
      ${EndIf}
      IntOp $dywAttempts $dywAttempts + 1
    ${LoopUntil} $dywAttempts >= 20
    StrCpy $dywMode 2
    Call ${DYW_PROCESS_PREFIX}dywInspectProcesses
    StrCpy $dywAttempts 0
    ${Do}
      Sleep 250
      StrCpy $dywMode 0
      Call ${DYW_PROCESS_PREFIX}dywInspectProcesses
      ${If} $dywResult == 0
        Goto dyw_check_done
      ${EndIf}
      IntOp $dywAttempts $dywAttempts + 1
    ${LoopUntil} $dywAttempts >= 12
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY dyw_check_again
    SetErrorLevel 2
    Quit
  dyw_check_done:
    Pop $1
    Pop $0
!macroend
