# shellcheck shell=bash
# The Markdown list of images a promotion PR and a GitHub Release show, built one way (sourced, never run).
#
#   image_list <<<"$images"   # one image per line (image:tag@digest) -> "- `image:tag@digest`" per line; blanks skipped
image_list() {
  local image
  while read -r image; do [ -z "$image" ] || echo "- \`$image\`"; done
}
