; Keep extraction separate from Windows Explorer's CopyFiles implementation.
; Explorer copy has a legacy path limit and reports every failure as an app
; which cannot close. CopyFileW with extended paths supports nested packages
; and gives a real Win32 result for each file; no failed copy is ignored.
!ifndef DYW_FILE_HOOK_DEFINED
!ifndef BUILD_UNINSTALLER
  !ifdef UNINSTALLER_OUT_FILE
    !system 'node "${DYW_NSIS_DIR}/../scripts/prepare-windows-installer-tools.mjs" "${PROJECT_DIR}/output/.build-cache/nsis-tools.nsh"' = 0
    !include "${PROJECT_DIR}\output\.build-cache\nsis-tools.nsh"
  !endif
!endif
!macro dywFileHeader PREFIX
  Var dywCopySource
  Var dywCopyDestination
  Var dywCopyDisplay
  Var dywCopyError
  Var dywCopyCode
  Var dywCopySkip
  Var dywBackupRoot

  Function ${PREFIX}dywExtendedPath
    Exch $0
    Push $1
    StrCpy $1 $0 4
    ${If} $1 != "\\?\"
      StrCpy $1 $0 2
      ${If} $1 == "\\"
        StrCpy $0 $0 "" 2
        StrCpy $0 "\\?\UNC\$0"
      ${Else}
        StrCpy $0 "\\?\$0"
      ${EndIf}
    ${EndIf}
    Pop $1
    Exch $0
  FunctionEnd

  Function ${PREFIX}dywCopyTree
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    Push $6
    Push $7
    ClearErrors
    CreateDirectory "$dywCopyDestination$0"
    ${If} ${Errors}
      StrCpy $dywCopyError "$dywCopyDisplay$0"
      System::Call 'kernel32::GetLastError() i.s'
      Pop $dywCopyCode
      Goto dyw_copy_tree_done
    ${EndIf}
    FindFirst $1 $2 "$dywCopySource$0\*"
    ${If} $1 == ""
      StrCpy $dywCopyError "$dywCopySource$0"
      StrCpy $dywCopyCode 3
      Goto dyw_copy_tree_done
    ${EndIf}
    ${DoWhile} $2 != ""
      ${If} $2 != "."
      ${AndIf} $2 != ".."
        ${If} $0 == ""
        ${AndIf} $2 == $dywCopySkip
          Goto dyw_copy_next
        ${EndIf}
        StrCpy $3 "$dywCopySource$0\$2"
        System::Call 'kernel32::GetFileAttributesW(w r3) i.r4'
        ${If} $4 == -1
          StrCpy $dywCopyError "$3"
          System::Call 'kernel32::GetLastError() i.s'
          Pop $dywCopyCode
        ${Else}
          IntOp $5 $4 & 0x400
          ${If} $5 != 0
            ; Do not follow a reparse point out of the extracted package.
            StrCpy $dywCopyError "$3"
            StrCpy $dywCopyCode 50
          ${Else}
            IntOp $5 $4 & 0x10
            ${If} $5 != 0
              Push "$0\$2"
              Call ${PREFIX}dywCopyTree
              Pop $7
            ${Else}
              StrCpy $4 "$dywCopyDestination$0\$2"
              StrCpy $7 0
              ${Do}
                !if "${PREFIX}" == "un."
                  System::Call 'kernel32::MoveFileW(w r3, w r4) i.r5 ?e'
                !else
                  System::Call 'kernel32::CopyFileW(w r3, w r4, i 0) i.r5 ?e'
                !endif
                Pop $6
                ${If} $5 != 0
                  ${ExitDo}
                ${EndIf}
                IntOp $7 $7 + 1
                ${If} $7 >= 3
                  StrCpy $dywCopyError "$dywCopyDisplay$0\$2"
                  StrCpy $dywCopyCode $6
                  ${ExitDo}
                ${EndIf}
                Sleep 250
              ${Loop}
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
      ${If} $dywCopyError != ""
        ${ExitDo}
      ${EndIf}
      dyw_copy_next:
      FindNext $1 $2
    ${Loop}
    FindClose $1
    dyw_copy_tree_done:
    Pop $7
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd
!macroend

!else
  !macroundef extractUsing7za
  !macro extractUsing7za FILE
    StrCpy $dywCopyDisplay $OUTDIR
    ; The old Nsis7z plugin silently drops files if the temporary output path
    ; plus the archive entry exceeds MAX_PATH. Use the matching modern decoder
    ; and check its exit status before copying anything into the install.
    File "/oname=$PLUGINSDIR\dyw-7za.exe" "${DYW_WINDOWS_7ZA}"
    nsExec::ExecToStack /TIMEOUT=300000 '"$PLUGINSDIR\dyw-7za.exe" x -y -bd -bb0 "-o$PLUGINSDIR\7z-out" "${FILE}"'
    Pop $R0
    Pop $R1
    ${If} $R0 != 0
      FileOpen $R2 "$TEMP\DYWorker-install-error.txt" w
      FileWriteUTF16LE $R2 "解压安装文件失败，返回值：$R0$\r$\n$R1"
      FileClose $R2
      MessageBox MB_OK|MB_ICONSTOP "无法完整解压 DYWorker 安装文件（$R0）。安装未完成。详情已保存到：$\r$\n$TEMP\DYWorker-install-error.txt" /SD IDOK
      SetErrorLevel 3
      Quit
    ${EndIf}
    File "/oname=$PLUGINSDIR\7z-out\resources\7zip-LICENSE.txt" "${DYW_7ZIP_LICENSE}"
    File "/oname=$PLUGINSDIR\7z-out\resources\7zip-COPYING.txt" "${DYW_7ZIP_COPYING}"
    Push "$PLUGINSDIR\7z-out"
    Call dywExtendedPath
    Pop $dywCopySource
    Push $dywCopyDisplay
    Call dywExtendedPath
    Pop $dywCopyDestination
    dyw_copy_retry:
      StrCpy $dywCopyError ""
      StrCpy $dywCopyCode 0
      StrCpy $dywCopySkip ""
      Push ""
      Call dywCopyTree
      Pop $R0
      ${If} $dywCopyError != ""
        FileOpen $R0 "$TEMP\DYWorker-install-error.txt" w
        FileWriteUTF16LE $R0 "复制安装文件失败：$dywCopyError$\r$\n系统错误：$dywCopyCode$\r$\n"
        FileClose $R0
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法写入以下安装文件：$\r$\n$dywCopyError$\r$\n$\r$\n系统错误：$dywCopyCode。请检查此位置的写入权限、磁盘空间或文件占用后重试。" /SD IDCANCEL IDRETRY dyw_copy_retry
        SetErrorLevel 3
        Quit
      ${EndIf}
      Delete "$TEMP\DYWorker-install-error.txt"
      ClearErrors
  !macroend
!endif
