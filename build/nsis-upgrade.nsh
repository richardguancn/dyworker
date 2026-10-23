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
    ; Preserve upstream atomic removal and rollback, but expose the actual
    ; busy file instead of turning every failed rename into "app not closed".
    ${If} ${isUpdated}
      CreateDirectory "$PLUGINSDIR\old-install"
      Push ""
      Call un.atomicRMDir
      Pop $R0
      ${If} $R0 != 0
        StrCpy $R2 $R0
        Push ""
        Call un.restoreFiles
        Pop $R0
        FileOpen $R1 "$TEMP\DYWorker-upgrade-error.txt" w
        FileWriteUTF16LE $R1 "无法替换被占用或无权修改的文件：$R2"
        FileClose $R1
        SetErrorLevel 32
        Quit
      ${EndIf}
    ${EndIf}
    SetOutPath $TEMP
    ClearErrors
    RMDir /r $INSTDIR
    ${If} ${Errors}
      FileOpen $R1 "$TEMP\DYWorker-upgrade-error.txt" w
      FileWriteUTF16LE $R1 "无法清理被占用或无权修改的安装目录：$INSTDIR"
      FileClose $R1
      SetErrorLevel 32
      Quit
    ${EndIf}
  !macroend
!endif
