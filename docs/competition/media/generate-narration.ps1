# Local generic Mandarin synthesis; no uploaded audio or voice cloning.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$scriptSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\narration.json') -Raw -Encoding utf8 | ConvertFrom-Json
$audioDirectory = Join-Path $PSScriptRoot 'narration'
[void](New-Item -ItemType Directory -Path $audioDirectory -Force)
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $speaker.SelectVoice('Microsoft Huihui Desktop')
    $speaker.Rate = 1
    foreach ($chapter in $scriptSource.chapters) {
        $speaker.SetOutputToWaveFile((Join-Path $audioDirectory ($chapter.id + '.wav')))
        $speaker.Speak($chapter.narration)
        $speaker.SetOutputToNull()
    }
} finally { $speaker.Dispose() }
Write-Output 'Narration generated. Run prepare_media.py to refresh duration metadata before recording.'
