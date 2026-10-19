#!/usr/bin/env bash
# Double-click to test and build docs/index.html (the page GitHub Pages serves,
# also the offline copy). Publishing stays a separate step: commit and push it.
cd "$(dirname "$0")" || exit 1
# Finder-launched shells may lack Homebrew's PATH (node, npm).
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ ! -d node_modules ]; then
  echo "Installing dev dependencies..."
  npm install || { echo; echo "npm install FAILED (see the messages above)."; exit 1; }
fi

if npm test && npm run build; then
  echo
  echo "Done: $(pwd)/docs/index.html"
  echo "To publish: commit docs/index.html and push to main."
  open -R docs/index.html
  status=0
else
  echo
  echo "Build FAILED (see the messages above)."
  status=1
fi

exit $status
