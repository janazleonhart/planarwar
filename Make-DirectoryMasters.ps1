# --- CONFIG ---
$softLimit = 50kb
$hardLimit = 70kb

# Extensions as actual extensions
$extensions = @(".cs", ".ts", ".tsx", "*.sql")

# Directories to ignore (by folder name)
$excludedDirs = @("node_modules")

$root = (Get-Location).Path
$outputRoot = Join-Path $root "_merged"
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

# Build a regex that matches any of the excluded dirs in a path segment
$excludedPattern = ($excludedDirs | ForEach-Object { [regex]::Escape($_) }) -join '|'
$excludedRegex = "[\\/](?:$excludedPattern)[\\/]"

function Write-Chunk {
    param ($BaseName, $Index, $Content)

    $name = if ($Index -eq 0) {
        "$BaseName.txt"
    } else {
        "{0}_{1:D3}.txt" -f $BaseName, $Index
    }

    $path = Join-Path $outputRoot $name
    Write-Host ">>> Writing: $path"
    [System.IO.File]::WriteAllText($path, $Content)
}

function Process-Group {
    param ($GroupName, $Directories)

    Write-Host "`n--- Processing group: $GroupName ---"

    $files = @()
    foreach ($dir in $Directories) {
        $files += Get-ChildItem $dir -Recurse -File |
            Where-Object {
                # Extension must match one of our target types
                $extensions -contains $_.Extension -and
                # Path must NOT contain any excluded directory segment
                -not ($_.FullName -match $excludedRegex)
            }
    }

    if ($files.Count -eq 0) {
        Write-Host "   (No matching files)"
        return
    }

    Write-Host "   Found $($files.Count) files"

    $buffer = New-Object System.Text.StringBuilder
    $chunkIndex = 0

    foreach ($f in $files) {
        $relative = $f.FullName.Substring($root.Length).TrimStart('\','/')
        Write-Host "      + $relative"

        $block =
            "`n===== $relative =====`n" +
            (Get-Content $f.FullName | Out-String)

        $projected = $buffer.Length + $block.Length

        # Soft split
        if ($buffer.Length -gt 0 -and $projected -gt $softLimit) {
            Write-Chunk $GroupName $chunkIndex $buffer.ToString()
            $chunkIndex++
            $buffer.Clear() | Out-Null
        }

        # Hard cap: a single giant file becomes its own chunk
        if ($block.Length -gt $hardLimit) {
            Write-Chunk $GroupName $chunkIndex $block
            $chunkIndex++
            continue
        }

        [void]$buffer.Append($block)
    }

    if ($buffer.Length -gt 0) {
        Write-Chunk $GroupName $chunkIndex $buffer.ToString()
    }
}

# --- ROOT FILE (NON-RECURSIVE) ---
Write-Host "`n--- Processing group: root (non-recursive) ---"

$rootFiles = Get-ChildItem $root -File |
    Where-Object {
        $extensions -contains $_.Extension
    }

if ($rootFiles.Count -gt 0) {
    $buffer = New-Object System.Text.StringBuilder
    $chunkIndex = 0

    foreach ($f in $rootFiles) {
        Write-Host "      + $($f.Name)"

        $block =
            "`n===== $($f.Name) =====`n" +
            (Get-Content $f.FullName | Out-String)

        if ($buffer.Length -gt 0 -and ($buffer.Length + $block.Length) -gt $softLimit) {
            Write-Chunk "root" $chunkIndex $buffer.ToString()
            $chunkIndex++
            $buffer.Clear() | Out-Null
        }

        [void]$buffer.Append($block)
    }

    if ($buffer.Length -gt 0) {
        Write-Chunk "root" $chunkIndex $buffer.ToString()
    }
}

# --- TOP-LEVEL DIRECTORIES ---
Get-ChildItem $root -Directory | ForEach-Object {
    Process-Group $_.Name @($_.FullName)
}

Write-Host "`n=== DONE (top-level grouping, node_modules excluded) ==="
