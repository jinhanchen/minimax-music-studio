# MiniMax Music 3 工作台 —— 一键启动
#
# 桌面快捷方式指向这个脚本。它负责：
#   1. ComfyUI 没跑就启动它（各自独立窗口，方便单独关）
#   2. 工作台服务没跑就启动它
#   3. 等两边就绪，再打开浏览器 —— 早打开只会看到连不上
#
# 已经在跑的不重复启动，所以反复双击是安全的。

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

$ComfyPort  = if ($env:COMFY_PORT) { $env:COMFY_PORT } else { '8188' }
$StudioPort = if ($env:MUSIC_STUDIO_PORT) { $env:MUSIC_STUDIO_PORT } else { '5178' }
$StudioUrl  = "http://127.0.0.1:$StudioPort"

function Test-Port([int]$Port) {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', $Port)
        $c.Close()
        return $true
    } catch { return $false }
}

function Wait-Port([int]$Port, [string]$Label, [int]$TimeoutSec) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        if (Test-Port $Port) {
            Write-Host "  $Label 就绪（$([int]$sw.Elapsed.TotalSeconds) 秒）" -ForegroundColor Green
            return $true
        }
        Write-Host "." -NoNewline
        Start-Sleep -Seconds 2
    }
    Write-Host ""
    Write-Host "  $Label 在 $TimeoutSec 秒内没起来" -ForegroundColor Red
    return $false
}

Write-Host ""
Write-Host "  MiniMax Music 3 工作台" -ForegroundColor Yellow
Write-Host "  ----------------------------------------"

# --- 1. ComfyUI ---
if (Test-Port ([int]$ComfyPort)) {
    Write-Host "  ComfyUI 已在运行" -ForegroundColor Green
} else {
    Write-Host "  启动 ComfyUI（首次约需 70 秒）" -NoNewline
    # 参数必须自己拼成带引号的单个字符串。用 -ArgumentList @(...) 数组时
    # PowerShell 不会给含空格的路径补引号，`E:\Frank vibe coding(Legion)\...`
    # 会被拆成 `-File E:\Frank` + 垃圾，然后静默失败（进程起了但立刻退出）。
    $comfyScript = Join-Path $PSScriptRoot 'start-comfyui.ps1'
    Start-Process -FilePath 'powershell' -WindowStyle Minimized `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$comfyScript`""
    if (-not (Wait-Port ([int]$ComfyPort) 'ComfyUI' 240)) {
        Write-Host ""
        Write-Host "  看一眼最小化的 ComfyUI 窗口里的报错。" -ForegroundColor Yellow
        Write-Host "  也可以先跑 npm run doctor 查环境。" -ForegroundColor Yellow
        Read-Host "  回车关闭"
        exit 1
    }
}

# --- 2. 工作台服务 ---
if (Test-Port ([int]$StudioPort)) {
    Write-Host "  工作台服务已在运行" -ForegroundColor Green
} else {
    Write-Host "  启动工作台服务" -NoNewline
    # 同上：整条 /c 后面的命令拼成一个带引号的串
    Start-Process -FilePath 'cmd' -WindowStyle Minimized -WorkingDirectory $Root `
        -ArgumentList '/c "title 音乐工作台服务 && node server/index.js"'
    if (-not (Wait-Port ([int]$StudioPort) '工作台服务' 40)) {
        Read-Host "  回车关闭"
        exit 1
    }
}

# --- 3. 打开浏览器 ---
Write-Host ""
Write-Host "  打开 $StudioUrl" -ForegroundColor Cyan
Start-Process $StudioUrl

Write-Host ""
Write-Host "  两个服务在最小化的窗口里运行：" -ForegroundColor DarkGray
Write-Host "    ComfyUI          （推理后端）" -ForegroundColor DarkGray
Write-Host "    音乐工作台服务    （网页与任务队列）" -ForegroundColor DarkGray
Write-Host "  关掉那两个窗口即停止；关掉本窗口不影响它们。" -ForegroundColor DarkGray
Write-Host ""
Start-Sleep -Seconds 4
