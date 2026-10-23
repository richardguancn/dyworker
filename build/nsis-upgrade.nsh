!ifdef DYW_UPGRADE_HOOK_DEFINED
  ; Keep electron-builder's registration, extraction and shortcut flow, but use
  ; the uninstaller shipped in THIS installer to remove the previous version.
  ; Updating our process check alone cannot repair an already-installed .exe.
  !macroundef uninstallOldVersion
  !macro uninstallOldVersion ROOT_KEY
    Push "${ROOT_KEY}"
    Call dywUpgradeWithCurrentUninstaller
  !macroend
!else
  !macro dywReadUpgradeValue OUTPUT KEY VALUE
    ${If} $dywUpgradeRoot == "HKEY_CURRENT_USER"
      ReadRegStr ${OUTPUT} HKEY_CURRENT_USER "${KEY}" "${VALUE}"
    ${Else}
      ReadRegStr ${OUTPUT} SHELL_CONTEXT "${KEY}" "${VALUE}"
    ${EndIf}
  !macroend

  !macro dywUpgradeHeader
    Var dywUpgradeRoot
    Var dywUpgradeString
    Var dywUpgradeDirectory
    Var dywUpgradeExecutable
    Var dywUpgradeArguments
    Var dywUpgradeKeepShortcuts
    Var dywUpgradeAttempt
    Var dywUpgradeError
    Var dywUpgradeFile
    Var dywUpgradeDiscard

    Function dywUpgradeWithCurrentUninstaller
      Pop $dywUpgradeRoot
      !insertmacro dywReadUpgradeValue $dywUpgradeString "${UNINSTALL_REGISTRY_KEY}" UninstallString
      !ifdef UNINSTALL_REGISTRY_KEY_2
        ${If} $dywUpgradeString == ""
          !insertmacro dywReadUpgradeValue $dywUpgradeString "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
        ${EndIf}
      !endif
      ${If} $dywUpgradeString == ""
        ; Fresh install: retain the upstream no-op and its error/return contract.
        Push $dywUpgradeRoot
        Call uninstallOldVersion
        Pop $dywUpgradeDiscard
        Return
      ${EndIf}

      !insertmacro dywReadUpgradeValue $dywUpgradeDirectory "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${If} $dywUpgradeDirectory == ""
        Push $dywUpgradeString
        Call GetInQuotes
        Pop $dywUpgradeExecutable
        ${If} $dywUpgradeExecutable != ""
          Push $dywUpgradeExecutable
          Call GetFileParent
          Pop $dywUpgradeDirectory
        ${EndIf}
      ${EndIf}
      ${If} $dywUpgradeDirectory == ""
        MessageBox MB_OK|MB_ICONSTOP "无法确定旧版 DYWorker 的安装位置，升级已停止，原有文件和数据未改动。"
        SetErrorLevel 2
        Quit
      ${EndIf}

      ; Mirror the upstream flags: upgrades keep user data by default and keep
      ; shortcuts under the same conditions, for both per-user and per-machine.
      ${If} $dywUpgradeRoot == "HKEY_CURRENT_USER"
      ${OrIf} $installMode == "CurrentUser"
        StrCpy $dywUpgradeArguments "/currentuser"
      ${Else}
        StrCpy $dywUpgradeArguments "/allusers"
      ${EndIf}
      StrCpy $dywUpgradeKeepShortcuts "true"
      !ifdef allowToChangeInstallationDirectory
        ${IfNot} ${isUpdated}
          StrCpy $dywUpgradeKeepShortcuts "false"
        ${EndIf}
      !endif
      ${If} $dywUpgradeKeepShortcuts == "true"
        !insertmacro dywReadUpgradeValue $dywUpgradeKeepShortcuts "${INSTALL_REGISTRY_KEY}" KeepShortcuts
        ${If} $dywUpgradeKeepShortcuts == "true"
        ${AndIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
          StrCpy $dywUpgradeArguments "$dywUpgradeArguments --keep-shortcuts"
        ${EndIf}
      ${EndIf}
      ${If} ${isDeleteAppData}
        StrCpy $dywUpgradeArguments "$dywUpgradeArguments --delete-app-data"
      ${Else}
        StrCpy $dywUpgradeArguments "$dywUpgradeArguments --updated"
      ${EndIf}

      ; The parent installer must not hold its working directory inside the
      ; installation while the child removes that directory on Windows.
      SetOutPath $TEMP
      InitPluginsDir
      ClearErrors
      File "/oname=$PLUGINSDIR\dyw-upgrade-uninstaller.exe" "${UNINSTALLER_OUT_FILE}"
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONSTOP "无法准备 DYWorker 升级文件。请检查临时目录是否可写，以及磁盘空间是否充足。"
        SetErrorLevel 2
        Quit
      ${EndIf}

      StrCpy $dywUpgradeAttempt 0
      dyw_upgrade_retry:
        Delete "$TEMP\DYWorker-upgrade-error.txt"
        ClearErrors
        ExecWait '"$PLUGINSDIR\dyw-upgrade-uninstaller.exe" /S /KEEP_APP_DATA $dywUpgradeArguments _?=$dywUpgradeDirectory' $R0
        ${If} ${Errors}
          StrCpy $dywUpgradeError "无法启动升级所需的清理程序。旧版安装尚未移除。"
          Goto dyw_upgrade_failed
        ${EndIf}
        ${If} $R0 == 0
          ClearErrors
          Return
        ${EndIf}
        ; File contention is reported separately from a running app. Never
        ; silently ignore a failed uninstall and extract over locked files.
        StrCpy $dywUpgradeError "无法移除旧版安装，返回值：$R0。"
        ClearErrors
        FileOpen $dywUpgradeFile "$TEMP\DYWorker-upgrade-error.txt" r
        ${IfNot} ${Errors}
          FileReadUTF16LE $dywUpgradeFile $dywUpgradeError
          FileClose $dywUpgradeFile
        ${EndIf}
        ${If} $R0 == 32
          IntOp $dywUpgradeAttempt $dywUpgradeAttempt + 1
          ${If} $dywUpgradeAttempt < 3
            Sleep 1000
            Goto dyw_upgrade_retry
          ${EndIf}
        ${EndIf}
      dyw_upgrade_failed:
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$dywUpgradeError$\r$\n$\r$\n解决以上问题后可重试。升级尚未完成。" /SD IDCANCEL IDRETRY dyw_upgrade_retry
        SetErrorLevel 2
        Quit
    FunctionEnd
  !macroend
!endif

!ifndef DYW_REMOVE_FILES_DEFINED
  !define DYW_REMOVE_FILES_DEFINED
  !macro customRemoveFiles
    ; Keep the rollback directory on the installation volume. Moving old files
    ; is then atomic, fast, and does not depend on free space on the TEMP drive.
    ; Use extended paths for both moves and restores, including deeply nested
    ; files installed by the long-path-safe extraction/copy code.
    ${If} ${isUpdated}
      StrCpy $dywCopyDisplay $INSTDIR
      Push $INSTDIR
      Call un.dywExtendedPath
      Pop $dywCopySource
      System::Call 'kernel32::GetCurrentProcessId() i.r0'
      StrCpy $dywCopySkip ".dyworker-upgrade-$0"
      StrCpy $dywBackupRoot "$INSTDIR\$dywCopySkip"
      Push $dywBackupRoot
      Call un.dywExtendedPath
      Pop $dywCopyDestination
      ${If} ${FileExists} "$dywCopyDestination\*"
        FileOpen $R1 "$TEMP\DYWorker-upgrade-error.txt" w
        FileWriteUTF16LE $R1 "升级备份目录已存在，请保留其中的文件并重新运行安装程序：$dywBackupRoot"
        FileClose $R1
        SetErrorLevel 33
        Quit
      ${EndIf}
      ClearErrors
      CreateDirectory $dywCopyDestination
      ${If} ${Errors}
        FileOpen $R1 "$TEMP\DYWorker-upgrade-error.txt" w
        FileWriteUTF16LE $R1 "无法在安装位置准备升级备份：$dywBackupRoot。旧版安装未改动，请检查写入权限和磁盘空间。"
        FileClose $R1
        SetErrorLevel 33
        Quit
      ${EndIf}
      StrCpy $dywCopyError ""
      StrCpy $dywCopyCode 0
      Push ""
      Call un.dywCopyTree
      Pop $R0
      ${If} $dywCopyError != ""
        StrCpy $R2 $dywCopyError
        StrCpy $R3 $dywCopyCode
        StrCpy $dywCopySource $dywCopyDestination
        Push $INSTDIR
        Call un.dywExtendedPath
        Pop $dywCopyDestination
        StrCpy $dywCopySkip ""
        StrCpy $dywCopyError ""
        Push ""
        Call un.dywCopyTree
        Pop $R0
        FileOpen $R1 "$TEMP\DYWorker-upgrade-error.txt" w
        ${If} $dywCopyError == ""
          FileWriteUTF16LE $R1 "无法替换文件：$R2（系统错误：$R3）。旧版文件已恢复。"
          RMDir /r $dywCopySource
          SetErrorLevel 32
        ${Else}
          FileWriteUTF16LE $R1 "无法替换文件：$R2（系统错误：$R3）。部分旧文件未能恢复，备份保留在：$dywBackupRoot。恢复失败位置：$dywCopyError"
          SetErrorLevel 33
        ${EndIf}
        FileClose $R1
        Quit
      ${EndIf}
    ${EndIf}
    SetOutPath $TEMP
    ; Match upstream: once atomic removal succeeded, all old files have moved.
    ; An empty root directory held by another process can be reused by setup.
    Push $INSTDIR
    Call un.dywExtendedPath
    Pop $R0
    RMDir /r $R0
  !macroend
!endif
