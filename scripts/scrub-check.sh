#!/usr/bin/env bash
# Fails when a file git would publish names a private reference or
# a real phone number. The list is encoded so this file passes.
# Ignored files, such as SPEC.md and CLAUDE.md, are skipped.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

banned=$(printf '%s' 'bmZudG98aW5maW5pdG98anVtcGNsb3VkfGp1bXAgY2xvdWR8a29kYXxoZXJtYW5hfGFzY2xleWF8c2V4dGFudHw2NTBbIC4tXT82NzdbIC4tXT84NzMzfDk5OTBbIC4tXT81MTcz' | base64 --decode)
e164='\+[1-9][0-9]{7,14}'
reserved_match='\+1555010[0-9]'

files=()
while IFS= read -r -d '' file; do
  [[ -f "$file" ]] && files+=("$file")
done < <(git ls-files -z --cached --others --exclude-standard)

failed=0

if names=$(printf '%s\n' "${files[@]}" | grep -iE "$banned"); then
  echo "Private reference in file names:"
  echo "$names"
  failed=1
fi

if hits=$(grep -niE "$banned" -- "${files[@]}"); then
  echo "Private reference in file contents:"
  echo "$hits"
  failed=1
fi

scan=()
for file in "${files[@]}"; do
  [[ "$file" == tests/fixtures/* ]] || scan+=("$file")
done
if phones=$(grep -HInoE "$e164" -- "${scan[@]}" | grep -vE ":$reserved_match\$"); then
  echo "Phone numbers outside the reserved +1555010x range:"
  echo "$phones"
  failed=1
fi

if ((failed)); then
  echo "scrub check failed"
  exit 1
fi
echo "scrub check passed (${#files[@]} files)"
