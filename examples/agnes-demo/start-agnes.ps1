# Agnes 2.0 Flash 启动脚本 (PowerShell, Web 版)
# 使用方式：
#   .\start-agnes.ps1              # 提示输入 API Key
#   $env:AGNES_API_KEY='sk-xxx'; .\start-agnes.ps1   # 预先设置 Key

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
Set-Location $repoRoot

# 设置 DSH_HOME（web profile 的用户配置目录）
# 默认使用项目根目录下的 .dsh-agnes，仅在显式设置时才覆盖
$env:DSH_HOME = $env:DSH_HOME ?? (Join-Path $repoRoot ".dsh-agnes")
New-Item -ItemType Directory -Force -Path $env:DSH_HOME | Out-Null

# 首次运行：把 settings.yaml 模板复制到 $DSH_HOME
$settingsPath = Join-Path $env:DSH_HOME "settings.yaml"
if (-not (Test-Path $settingsPath)) {
    Copy-Item (Join-Path $scriptDir "settings.example.yaml") $settingsPath
    Write-Host "已创建模型配置：$settingsPath" -ForegroundColor Yellow
    Write-Host "（如需调整 Agnes 模型参数，直接编辑该文件，热重载生效）" -ForegroundColor Yellow
}

# 检查 API Key
if (-not $env:AGNES_API_KEY) {
    $env:AGNES_API_KEY = Read-Host "请输入 Agnes API Key（AGNES_API_KEY）"
}
if (-not $env:AGNES_API_KEY) {
    Write-Host "错误：未提供 AGNES_API_KEY" -ForegroundColor Red
    exit 1
}

Write-Host "启动 Agnes Web（DSH_HOME: $env:DSH_HOME）..." -ForegroundColor Green

# 启动 web profile（模型通过 settings.yaml 的 llm-pi-ai.agnes 提供）
pnpm dsh web
