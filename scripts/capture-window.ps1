# 抓取桌宠窗口的截图（按窗口句柄，不需要窗口置顶）。
#
# 注意：必须先声明 DPI 感知，否则在 125%/175% 缩放的屏幕上 GetWindowRect 会被
# Windows 虚拟化（返回缩放后的逻辑尺寸），PrintWindow 就会截出放大裁切的半张图。
# 用法： pwsh -File scripts/capture-window.ps1 -Out shot.png [-ProcessId 1234]
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$ProcessId = 0
)

Add-Type -AssemblyName System.Drawing

if (-not ('Win32Capture' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32Capture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
}

# -4 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
try { [void][Win32Capture]::SetThreadDpiAwarenessContext([IntPtr](-4)) } catch { [void][Win32Capture]::SetProcessDPIAware() }

if ($ProcessId -le 0) {
  $candidate = Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object StartTime |
    Select-Object -First 1
  if (-not $candidate) { throw '找不到 electron 窗口进程' }
  $ProcessId = $candidate.Id
}

$process = Get-Process -Id $ProcessId -ErrorAction Stop
$handle = $process.MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { throw "进程 $ProcessId 没有主窗口句柄" }

$rect = New-Object Win32Capture+RECT
if (-not [Win32Capture]::GetWindowRect($handle, [ref]$rect)) { throw 'GetWindowRect 失败' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "窗口尺寸异常：${width}x${height}" }

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$ok = [Win32Capture]::PrintWindow($handle, $hdc, 2)
$graphics.ReleaseHdc($hdc)
$graphics.Dispose()

$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

"captured=$Out size=${width}x${height} printWindow=$ok handle=$handle pid=$ProcessId"
