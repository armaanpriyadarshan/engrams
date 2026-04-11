// Widget layout constants matched to the current engram view.
// SourceTree sits top-left (~260px wide + gutter), AgentTimeline sits
// top-right (~200px wide + gutter), ViewToggle pill is ~60px tall at
// the top, AskBar is ~160px tall at the bottom. Any layout/camera
// work that cares about "what's actually visible to the user" should
// import from this file.

export const SOURCE_TREE_RIGHT_EDGE = 296
export const AGENT_TIMELINE_LEFT_EDGE = 224
export const TOP_RESERVED = 60
export const BOTTOM_RESERVED = 160

export interface SafeViewport {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export function getSafeViewport(windowWidth: number, windowHeight: number): SafeViewport {
  const left = SOURCE_TREE_RIGHT_EDGE
  const right = Math.max(left, windowWidth - AGENT_TIMELINE_LEFT_EDGE)
  const top = TOP_RESERVED
  const bottom = Math.max(top, windowHeight - BOTTOM_RESERVED)
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

export function isInSafeViewport(
  screenX: number,
  screenY: number,
  safe: SafeViewport,
): boolean {
  return (
    screenX >= safe.left &&
    screenX <= safe.right &&
    screenY >= safe.top &&
    screenY <= safe.bottom
  )
}
