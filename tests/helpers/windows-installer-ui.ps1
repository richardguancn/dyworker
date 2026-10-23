param([Parameter(Mandatory=$true)][string]$Installer, [Parameter(Mandatory=$true)][string]$InstallDirectory, [int]$TimeoutSeconds=90)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class InstallerWindows {
  public delegate bool Callback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Callback callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  public static string Text(IntPtr window) { var text=new StringBuilder(4096); GetWindowText(window,text,text.Capacity); return text.ToString(); }
  public static IntPtr[] Top(int process) { var found=new List<IntPtr>(); EnumWindows((window,_)=>{ uint owner; GetWindowThreadProcessId(window,out owner); if(owner==process && IsWindowVisible(window))found.Add(window); return true; },IntPtr.Zero); return found.ToArray(); }
  public static IntPtr[] Children(IntPtr parent) { var found=new List<IntPtr>(); EnumChildWindows(parent,(window,_)=>{ if(IsWindowVisible(window))found.Add(window); return true; },IntPtr.Zero); return found.ToArray(); }
}
'@
$process = Start-Process -FilePath $Installer -ArgumentList "/currentuser /D=$InstallDirectory" -PassThru
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$screens = [System.Collections.Generic.List[string]]::new()
$errors = [System.Collections.Generic.List[string]]::new()
$lastClick = [DateTime]::MinValue
try {
  while (-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
    foreach ($window in [InstallerWindows]::Top($process.Id)) {
      $children = [InstallerWindows]::Children($window)
      $text = ([InstallerWindows]::Text($window)) + "`n" + (($children | ForEach-Object { [InstallerWindows]::Text($_) }) -join "`n")
      if ($screens.Count -eq 0 -or $screens[$screens.Count-1] -ne $text) { $screens.Add($text) }
      if ($text -match 'cannot be closed|could not be closed|Please close it|无法关闭|无法替换|无法移除|无法准备|无法确定|无法写入|无法完整解压') {
        $errors.Add($text)
        foreach ($child in $children) {
          if ([InstallerWindows]::GetDlgCtrlID($child) -eq 2) { [void][InstallerWindows]::PostMessage($child, 0xF5, [IntPtr]::Zero, [IntPtr]::Zero) }
        }
      } elseif (([DateTime]::UtcNow - $lastClick).TotalMilliseconds -gt 600) {
        foreach ($child in $children) {
          if ([InstallerWindows]::GetDlgCtrlID($child) -eq 1 -and [InstallerWindows]::IsWindowEnabled($child) -and [InstallerWindows]::Text($child) -match 'Next|Install|Finish|Close|下一步|安装|完成') {
            foreach ($option in $children) {
              if ([InstallerWindows]::Text($option) -match 'Run DYWorker|运行.*DYWorker|启动.*DYWorker') {
                [void][InstallerWindows]::SendMessage($option, 0xF1, [IntPtr]::Zero, [IntPtr]::Zero)
              }
            }
            [void][InstallerWindows]::PostMessage($child, 0xF5, [IntPtr]::Zero, [IntPtr]::Zero)
            $lastClick = [DateTime]::UtcNow
            break
          }
        }
      }
    }
    Start-Sleep -Milliseconds 100
    $process.Refresh()
  }
  if (-not $process.HasExited) { throw "Installer UI timed out. Screens: $($screens -join ' | ')" }
  @{ exitCode=$process.ExitCode; dialogs=@($errors.ToArray()); screens=@($screens.ToArray()) } | ConvertTo-Json -Depth 4 -Compress
} finally {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
