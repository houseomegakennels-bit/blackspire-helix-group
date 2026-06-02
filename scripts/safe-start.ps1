param(
  [switch]$SkipPull,
  [switch]$FrontendBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendPath = Join-Path $repoRoot "frontend"

function Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Warn($message) {
  Write-Host "WARNING: $message" -ForegroundColor Yellow
}

function Show-Lines($items) {
  foreach ($item in $items) {
    Write-Host " - $item"
  }
}

Step "Blackspire safe start"
Write-Host "Repo root: $repoRoot"

if (-not (Test-Path (Join-Path $repoRoot ".git"))) {
  throw "No .git folder found at $repoRoot"
}

Push-Location $repoRoot
try {
  Step "Current branch"
  git branch --show-current

  if (-not $SkipPull) {
    Step "Pull latest changes"
    git pull
  } else {
    Warn "Skipping git pull because -SkipPull was provided."
  }

  Step "Repo status"
  git status --short

  Step "Top-level workspace"
  $workspaceItems = Get-ChildItem $repoRoot | Select-Object -ExpandProperty Name
  Show-Lines $workspaceItems

  if (Test-Path $frontendPath) {
    Step "Frontend package summary"
    $packagePath = Join-Path $frontendPath "package.json"
    Get-Content $packagePath | ForEach-Object { Write-Host $_ }
  } else {
    Warn "Frontend folder not found."
  }

  if ($FrontendBuild -and (Test-Path $frontendPath)) {
    Step "Frontend build check"
    Push-Location $frontendPath
    try {
      npm run build
    } finally {
      Pop-Location
    }
  }

  Step "Session-start prompt"
  $promptPath = Join-Path $repoRoot "SESSION_START_PROMPT.txt"
  if (Test-Path $promptPath) {
    Get-Content $promptPath | ForEach-Object { Write-Host $_ }
  } else {
    Warn "SESSION_START_PROMPT.txt not found."
  }

  Step "Edit safety check"
  $dirtyCount = (git status --short | Measure-Object -Line).Lines
  if ($dirtyCount -gt 0) {
    Warn "Repo has $dirtyCount pending change(s). Review them before editing overlapping files."
  } else {
    Write-Host "Working tree is clean. Safe to start a focused change." -ForegroundColor Green
  }
}
finally {
  Pop-Location
}
