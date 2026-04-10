# discomaster.txt -> discomaster.json (sample.json format: release as YYYYMMDD int)
$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$content = [System.IO.File]::ReadAllText("$PSScriptRoot\discomaster.txt", [System.Text.Encoding]::UTF8)
$blocks = $content -split '\r?\n\*\*\*\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }

function Get-ReleaseInt($y, $mo, $d) {
    return [int]("{0:D4}{1:D2}{2:D2}" -f [int]$y, [int]$mo, [int]$d)
}

function Escape-Json([string]$s) {
    if ($null -eq $s) { return '""' }
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.Append('"')
    foreach ($ch in $s.ToCharArray()) {
        switch ($ch) {
            '"' { [void]$sb.Append('\'); [void]$sb.Append('"') }
            '\' { [void]$sb.Append('\\') }
            "`n" { [void]$sb.Append('\n') }
            "`r" { }
            "`t" { [void]$sb.Append('\t') }
            default {
                if ([int]$ch -lt 0x20) {
                    [void]$sb.AppendFormat('\u{0:X4}', [int]$ch)
                }
                else {
                    [void]$sb.Append($ch)
                }
            }
        }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

$entries = New-Object System.Collections.Generic.List[object]

foreach ($block in $blocks) {
    $lines = $block -split '\r?\n' | ForEach-Object { $_.TrimEnd() }
    if ($lines.Count -lt 2) { continue }

    $h = $lines[0].Trim()
    $m = [regex]::Match($h, '^(Album|Single) Release:(\d{4})\.(\d{1,2})\.(\d{1,2})$')
    $dm = [regex]::Match($h, '^Download (\d{4})\.(\d{1,2})\.(\d{1,2})$')

    if ($m.Success) {
        $rtype = if ($m.Groups[1].Value -eq 'Album') { 'Album' } else { 'Single' }
        $release = Get-ReleaseInt $m.Groups[2].Value $m.Groups[3].Value $m.Groups[4].Value
    }
    elseif ($dm.Success) {
        $rtype = 'Download'
        $release = Get-ReleaseInt $dm.Groups[1].Value $dm.Groups[2].Value $dm.Groups[3].Value
    }
    else {
        continue
    }

    $i = 1
    $title = $lines[$i].Trim()
    $i++
    if ($i -lt $lines.Count -and $lines[$i].Trim() -eq $title) {
        $i++
    }

    $songs = New-Object System.Collections.Generic.List[string]
    while ($i -lt $lines.Count) {
        $line = $lines[$i].Trim()
        $i++
        if ($line -eq 'Disc 1' -or $line -eq 'Disc 2') { continue }
        $tm = [regex]::Match($line, '^(\d{1,2})\.\s*(.+)$')
        if ($tm.Success) {
            $songs.Add($tm.Groups[2].Value.Trim())
        }
    }

    if ($title -eq '' -or $songs.Count -eq 0) { continue }
    $entries.Add([ordered]@{
        title   = $title
        release = $release
        type    = $rtype
        songs   = $songs.ToArray()
    })
}

$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine('[')
for ($e = 0; $e -lt $entries.Count; $e++) {
    $o = $entries[$e]
    [void]$sb.AppendLine('{')
    [void]$sb.AppendLine("`t""title"": $(Escape-Json $o.title),")
    [void]$sb.AppendLine("`t""release"": $($o.release),")
    [void]$sb.AppendLine("`t""type"": $(Escape-Json $o.type),")
    [void]$sb.AppendLine("`t""songs"": [")
    for ($s = 0; $s -lt $o.songs.Count; $s++) {
        $comma = if ($s -lt $o.songs.Count - 1) { ',' } else { '' }
        [void]$sb.AppendLine("`t`t$(Escape-Json $o.songs[$s])$comma")
    }
    [void]$sb.Append("`t]")
    if ($e -lt $entries.Count - 1) {
        [void]$sb.AppendLine()
        [void]$sb.AppendLine('},')
    }
    else {
        [void]$sb.AppendLine()
        [void]$sb.AppendLine('}')
    }
}
[void]$sb.AppendLine(']')

$outPath = Join-Path $PSScriptRoot 'discomaster.json'
[System.IO.File]::WriteAllText($outPath, $sb.ToString(), $utf8NoBom)
Write-Host "wrote $($entries.Count) entries -> $outPath"
