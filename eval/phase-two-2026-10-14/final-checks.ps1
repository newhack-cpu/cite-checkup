$ErrorActionPreference = 'Stop'
$project = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location -LiteralPath $project
$results = @()
foreach ($step in @('test', 'lint', 'typecheck', 'build')) {
    $started = Get-Date
    $log = Join-Path $PSScriptRoot "final-$step.log"
    & pnpm $step *> $log
    $code = $LASTEXITCODE
    $results += [PSCustomObject]@{ step = $step; exitCode = $code; seconds = ((Get-Date) - $started).TotalSeconds; log = $log }
    $results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'final-checks.json') -Encoding utf8
    Write-Output "$step exit=$code"
    Get-Content -LiteralPath $log -Tail 12
    if ($code -ne 0) { exit $code }
}
