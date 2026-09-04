#!/bin/sh
set -eu

awk '
  BEGIN { audited = 0; unsafe = 0 }
  {
    lowered = tolower($0)
    relevant = lowered ~ /workspacecanvas\./ || lowered ~ /workspacevisualwall\./ || lowered ~ /cardvisualwall\./ || lowered ~ /workspace-canvas-image/ || lowered ~ /visual-wall/ || lowered ~ /\/api\/workspace-canvas-images\//
    if (relevant) {
      audited += 1
      sensitive = length($0) > 4096 || lowered ~ /"(input|userid|email|err|stack|scene|body|url|cookie|authorization)"[[:space:]]*:/ || lowered ~ /https?:\/\//
      if (sensitive) {
        unsafe += 1
      }
    }
  }
  END {
    printf "canvas_visual_wall_logs_audited=%d unsafe=%d\n", audited, unsafe
    if (unsafe > 0) exit 1
  }
'
