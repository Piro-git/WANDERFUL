#!/bin/zsh
set -eu
exec /Library/Frameworks/Python.framework/Versions/3.12/bin/python3 "${0:A:h}/complete-owner-credential.py" --activate-new-role
