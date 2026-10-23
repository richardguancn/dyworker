import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, Platform, Arch } from 'electron-builder';

const quote = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');

export async function createWindowsUpgradeFixture(root, compiler) {
  const id = randomUUID();
  const packageName = `dyw-upgrade-test-${id}`;
  const appId = `com.dyworker.installer-test.${id}`;
  const dummy = path.join(root, 'dummy.exe');
  const dummySource = path.join(root, 'dummy.nsi');
  await fs.writeFile(dummySource, `
    Unicode true
    RequestExecutionLevel user
    SilentInstall silent
    Name "Installer test placeholder"
    OutFile "${quote(dummy)}"
    Section
    SectionEnd
  `);
  const switches = process.platform === 'win32' ? ['/V2', '/WX'] : ['-V2', '-WX'];
  execFileSync(compiler.path, [...switches, dummySource], { env: { ...process.env, ...compiler.env }, timeout: 60_000 });

  // The legacy uninstaller deliberately reproduces the important boundary:
  // the new installer's process check passes, but the installed .exe fails.
  const legacy = path.join(root, 'legacy.nsh');
  await fs.writeFile(legacy, `
    !macro customCheckAppRunning
      !ifdef BUILD_UNINSTALLER
        FileOpen $0 "$INSTDIR\\legacy-uninstaller-called.txt" w
        FileWrite $0 "legacy uninstaller ran"
        FileClose $0
        SetErrorLevel 77
        Quit
      !endif
    !macroend
  `);
  const baseline = path.join(root, 'baseline.nsh');
  await fs.writeFile(baseline, '!macro customCheckAppRunning\n!macroend\n');
  const current = fileURLToPath(new URL('../../build/installer.nsh', import.meta.url));
  const installers = {};
  for (const [name, version, include] of [
    ['old', '0.3.1', legacy], ['baseline', '0.3.2', baseline], ['fixed', '0.3.3', current],
  ]) {
    const projectDir = path.join(root, name);
    const prepackaged = path.join(projectDir, 'app');
    await fs.mkdir(path.join(prepackaged, 'resources'), { recursive: true });
    await fs.copyFile(dummy, path.join(prepackaged, 'DYWorker.exe'));
    await fs.writeFile(path.join(prepackaged, 'resources/version.txt'), version);
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify({
      name: packageName, version, description: 'Isolated installer upgrade test',
      author: 'DYWorker Tests', main: 'unused.cjs',
    }));
    const outDir = path.join(projectDir, 'out');
    await build({
      projectDir, prepackaged, publish: 'never', targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
      config: {
        extends: null, appId, productName: 'DYWorker', electronVersion: '41.0.0',
        directories: { output: outDir },
        win: { signAndEditExecutable: false, signExecutable: false },
        nsis: {
          include, guid: id, oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
          createDesktopShortcut: false, createStartMenuShortcut: false,
          runAfterFinish: false, installerLanguages: ['en_US'], artifactName: `${name}.exe`,
        },
        publish: null,
      },
    });
    installers[name] = `${name}.exe`;
    await fs.copyFile(path.join(outDir, `${name}.exe`), path.join(root, `${name}.exe`));
  }

  // A real deny-delete handle. Node's normal fs.open permits rename on Windows,
  // so it cannot reproduce the atomic-uninstall rollback failure by itself.
  const lockSource = path.join(root, 'lock.nsi');
  await fs.writeFile(lockSource, `
    Unicode true
    RequestExecutionLevel user
    SilentInstall silent
    Name "Installer file lock fixture"
    OutFile "${quote(path.join(root, 'lock.exe'))}"
    Section
      StrCpy $3 "$INSTDIR\\resources\\version.txt"
      System::Call 'kernel32::CreateFileW(w r3, i 0x80000000, i 0, p 0, i 3, i 0, p 0) p.r0 ?e'
      Pop $1
      FileOpen $2 "$EXEDIR\\lock-diagnostic.txt" w
      FileWriteUTF16LE $2 "INSTDIR=$INSTDIR HANDLE=$0 ERROR=$1"
      FileClose $2
      StrCmp $0 -1 failed
      FileOpen $1 "$INSTDIR\\lock-ready.txt" w
      FileWrite $1 "ready"
      FileClose $1
      Sleep 30000
      System::Call 'kernel32::CloseHandle(p r0)'
      Goto done
      failed:
        SetErrorLevel 3
      done:
    SectionEnd
  `);
  execFileSync(compiler.path, [...switches, lockSource], { env: { ...process.env, ...compiler.env }, timeout: 60_000 });
  const metadata = { packageName, appId, guid: id, installers };
  await fs.writeFile(path.join(root, 'fixture.json'), JSON.stringify(metadata));
  return metadata;
}
