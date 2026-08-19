# SUPERSEDED. Use the Node tool in this directory instead:
#
#   node export-shesha-forms.mjs --list-databases
#   node export-shesha-forms.mjs -d <database> -t <source-tag> --discover-only
#   node export-shesha-forms.mjs -d <database> -t <source-tag>
#
# Why it was replaced: this repository already depends on Node 22, the extract
# logic is unit-testable there against a mock database (20 tests, see
# export-shesha-forms.test.mjs), and Windows PowerShell 5.1 imposed two problems
# the Node version does not have - ConvertTo-Json throws on payloads over a few
# hundred KB, and a BOM-less UTF-8 script is read as ANSI so any non-ASCII
# character corrupts parsing.
#
# See README.md.
throw "Export-SheshaForms.ps1 is superseded. Run: node export-shesha-forms.mjs --help"
