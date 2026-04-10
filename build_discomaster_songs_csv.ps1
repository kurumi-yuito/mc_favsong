# discomaster.json -> 楽曲リスト CSV（sample.csv: タイトル, 作品名, Single|Album|Other, 日付）
# 重複タイトルは最も早い release を採用。
# 3列目 Single: type が Single または Download のディスクに収録され、楽曲名がそのディスクの title（全体）
# または title を「/」で区切った各パート（前後トリム）のいずれかと一致する場合。
# Single でない行のうち、いずれの type:Album にも収録されない曲は Other。
$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$root = $PSScriptRoot
$jsonPath = Join-Path $root 'discomaster.json'
$outPath = Join-Path $root 'discomaster_songs.csv'

$data = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Get-DiscTitleMatchSegments([string]$discTitle) {
    $set = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $full = $discTitle.Trim()
    if ($full -ne '') {
        [void]$set.Add($full)
    }
    foreach ($piece in $full.Split([char]'/')) {
        $p = $piece.Trim()
        if ($p -ne '') {
            [void]$set.Add($p)
        }
    }
    return $set
}

$singleOrDownloadTitleTracks = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)

foreach ($entry in $data) {
    if ($entry.type -ne 'Single' -and $entry.type -ne 'Download') { continue }
    $segments = Get-DiscTitleMatchSegments ([string]$entry.title)
    foreach ($song in $entry.songs) {
        $s = [string]$song
        if ($segments.Contains($s)) {
            [void]$singleOrDownloadTitleTracks.Add($s)
        }
    }
}

$songsOnAlbums = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($entry in $data) {
    if ($entry.type -ne 'Album') { continue }
    foreach ($song in $entry.songs) {
        $s = [string]$song
        if ($s -ne '') {
            [void]$songsOnAlbums.Add($s)
        }
    }
}

# タイトル -> 最良レコード（最小 release）
$best = @{}

foreach ($entry in $data) {
    $rel = [int]$entry.release
    $workTitle = [string]$entry.title
    foreach ($song in $entry.songs) {
        $songTitle = [string]$song
        if ($songTitle -eq '') { continue }
        if (-not $best.ContainsKey($songTitle)) {
            $best[$songTitle] = @{
                SongTitle = $songTitle
                Work      = $workTitle
                Release   = $rel
            }
        }
        elseif ($rel -lt $best[$songTitle].Release) {
            $best[$songTitle].Work = $workTitle
            $best[$songTitle].Release = $rel
        }
    }
}

function Escape-CsvField([string]$s) {
    if ($null -eq $s) { return '' }
    $mustQuote = $false
    if ($s.Contains('"')) {
        $s = $s.Replace('"', '""')
        $mustQuote = $true
    }
    if ($s.Contains(',') -or $s.Contains("`n") -or $s.Contains("`r")) {
        $mustQuote = $true
    }
    if ($mustQuote) { return '"' + $s + '"' }
    return $s
}

$sorted = $best.Values | Sort-Object { $_.SongTitle }

$lines = New-Object System.Collections.Generic.List[string]
foreach ($row in $sorted) {
    $t = $row.SongTitle
    if ($singleOrDownloadTitleTracks.Contains($t)) {
        $kind = 'Single'
    }
    elseif ($songsOnAlbums.Contains($t)) {
        $kind = 'Album'
    }
    else {
        $kind = 'Other'
    }
    $a = Escape-CsvField $t
    $b = Escape-CsvField $row.Work
    $c = $kind
    $d = $row.Release.ToString()
    $lines.Add("$a, $b, $c, $d")
}

[System.IO.File]::WriteAllLines($outPath, $lines, $utf8NoBom)
Write-Host "wrote $($lines.Count) rows -> $outPath"
