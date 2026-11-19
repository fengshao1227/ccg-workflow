# Classifies each line of a PowerShell file using the official parser.
# Output: one line per classified line number, "K <n>" for code, "C <n>" for comment.
# Only reads the file; never executes it. Compatible with Windows PowerShell 5.1.
param(
    [Parameter(Mandatory)][string]$Path
)

$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)

$code = New-Object 'System.Collections.Generic.HashSet[int]'
$comment = New-Object 'System.Collections.Generic.HashSet[int]'

foreach ($token in $tokens) {
    if ($token.Kind -eq 'NewLine' -or $token.Kind -eq 'EndOfInput') { continue }
    $target = $code
    if ($token.Kind -eq 'Comment') { $target = $comment }
    for ($line = $token.Extent.StartLineNumber; $line -le $token.Extent.EndLineNumber; $line++) {
        [void]$target.Add($line)
    }
}

foreach ($line in ($code | Sort-Object)) { Write-Output ("K " + $line) }
foreach ($line in ($comment | Sort-Object)) {
    if (-not $code.Contains($line)) { Write-Output ("C " + $line) }
}
