# 启动 ComfyUI 作为本工作台的推理后端。
#
# 复用 Comfy Desktop 已装好的环境和共享模型目录，不重复占盘。
# 前台运行：关掉这个窗口 = 停止 ComfyUI。

$ErrorActionPreference = 'Stop'

$ComfyDir = if ($env:COMFY_INSTALL) { $env:COMFY_INSTALL } else { 'E:\Comfy-Desktop\ComfyUI-Installs\minimax-h3\ComfyUI' }
$Python   = Join-Path $ComfyDir '.venv\Scripts\python.exe'
$Root     = Split-Path -Parent $PSScriptRoot
$Paths    = Join-Path $Root 'comfy\extra_model_paths.yaml'
$Output   = if ($env:COMFY_OUTPUT) { $env:COMFY_OUTPUT } else { 'E:\Comfy-Desktop\ComfyUI-Shared\output' }
$Input_   = 'E:\Comfy-Desktop\ComfyUI-Shared\input'
$Port     = if ($env:COMFY_PORT) { $env:COMFY_PORT } else { '8188' }

if (-not (Test-Path $Python)) {
    Write-Host "找不到 ComfyUI 的 Python：$Python" -ForegroundColor Red
    Write-Host "如果 ComfyUI 装在别处，设置环境变量 COMFY_INSTALL 指向它的 ComfyUI 目录。"
    exit 1
}

# 版本闸门：低于 0.33.1 没有 MiniMax Music 3 节点，早报错好过跑一半失败
$VersionFile = Join-Path $ComfyDir 'comfyui_version.py'
if (Test-Path $VersionFile) {
    $raw = (Get-Content $VersionFile -Raw)
    if ($raw -match '__version__\s*=\s*"([0-9.]+)"') {
        $v = [version]$Matches[1]
        Write-Host "ComfyUI 版本 $v"
        if ($v -lt [version]'0.33.1') {
            Write-Host "需要 ≥ 0.33.1 才有 MiniMax Music 3 节点。" -ForegroundColor Red
            Write-Host "升级：cd `"$ComfyDir`"; git fetch --tags; git checkout v0.33.1" -ForegroundColor Yellow
            exit 1
        }
    }
}

Write-Host "启动 ComfyUI  →  http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host "模型路径配置：$Paths"
Write-Host ""

Push-Location $ComfyDir
try {
    & $Python main.py `
        --listen 127.0.0.1 --port $Port `
        --extra-model-paths-config $Paths `
        --output-directory $Output `
        --input-directory $Input_ `
        --disable-auto-launch
}
finally {
    Pop-Location
}
