# 在桌面创建「MiniMax 音乐工作台」快捷方式。
#
# 指向 launch.ps1，用 assets/icon.ico 作图标。
# 重复执行会覆盖旧的，安全。

$ErrorActionPreference = 'Stop'
$Root     = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $PSScriptRoot 'launch.ps1'
$Icon     = Join-Path $Root 'assets\icon.ico'
$Desktop  = [Environment]::GetFolderPath('Desktop')
$LinkPath = Join-Path $Desktop 'MiniMax 音乐工作台.lnk'

foreach ($f in @($Launcher, $Icon)) {
    if (-not (Test-Path $f)) {
        Write-Host "缺少文件：$f" -ForegroundColor Red
        if ($f -eq $Icon) { Write-Host "先跑：node scripts/build-icon.mjs" -ForegroundColor Yellow }
        exit 1
    }
}

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($LinkPath)
# 走 powershell.exe 而不是直接指向 .ps1 —— .ps1 双击默认是「用记事本打开」
$lnk.TargetPath       = (Get-Command powershell).Source
$lnk.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$Launcher`""
$lnk.WorkingDirectory = $Root
$lnk.IconLocation     = "$Icon,0"
$lnk.Description      = 'MiniMax Music 3 本地音乐生成工作台'
$lnk.WindowStyle      = 1
$lnk.Save()

Write-Host ""
Write-Host "  已创建桌面快捷方式" -ForegroundColor Green
Write-Host "    $LinkPath"
Write-Host "    图标 $Icon"
Write-Host ""
