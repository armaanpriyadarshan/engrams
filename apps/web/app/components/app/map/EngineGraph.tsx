"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import * as THREE from "three"
import type { GraphData } from "./useGraphData"
import type { LayoutMeta } from "./useForceLayout"
import { getSafeViewport, isInSafeViewport } from "@/lib/map-viewport-bounds"
import { ARTICLE_TYPE_META, type ArticleType } from "@/lib/article-types"
import type { GraphBuffers } from "./reconcileGraph"
import { reconcileGraph } from "./reconcileGraph"

interface EngineGraphProps {
  data: GraphData
  positions: Float32Array
  layoutMeta: LayoutMeta
  engramSlug: string
  onNodeClick?: (slug: string, x: number, y: number) => void
  nodeVisible?: Uint8Array | null
}

const edgeTypeDisplay: Record<string, { label: string; color: string }> = {
  related: { label: "related", color: "rgb(85,85,85)" },
  requires: { label: "requires", color: "rgb(143,89,41)" },
  extends: { label: "extends", color: "rgb(41,115,143)" },
  contradicts: { label: "contradicts", color: "rgb(143,64,64)" },
  "part_of": { label: "part of", color: "rgb(77,115,77)" },
  synthesized_from: { label: "synthesized from", color: "rgb(118,128,143)" },
}

// Inline ref shapes keep this function independent of React's type exports,
// which shifted between 18 and 19.
type RefLike<T> = { current: T }

interface SceneState {
  container: HTMLDivElement
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer

  // Materials — stable across data changes
  nodeMat: THREE.ShaderMaterial
  edgeMat: THREE.LineBasicMaterial

  // Meshes + geometries — rebuilt when node/edge count changes
  nodeMesh: THREE.Points
  nodeGeo: THREE.BufferGeometry
  edgeMesh: THREE.LineSegments
  edgeGeo: THREE.BufferGeometry

  // Data buffers (produced by reconcileGraph)
  buffers: GraphBuffers

  // Hover / interaction state
  currentHovered: number
  currentHoveredEdge: number
  mouse: { x: number; y: number; screenX: number; screenY: number }
  smoothMouse: { x: number; y: number }
  ripple: { x: number; y: number; time: number }

  // Camera navigation state
  panOffset: { x: number; y: number }
  panLimit: number
  panStart: { x: number; y: number }
  orbitTheta: number
  orbitPhi: number
  targetTheta: number
  targetPhi: number
  targetZ: number
  currentZoom: number
  minZoom: number
  maxZoom: number
  isPanning: boolean
  isOrbiting: boolean
  orbitStart: { x: number; y: number }
  hasFramed: boolean

  // Attention pan — when a new node lands outside the safe viewport, the
  // camera gently drifts to bring it in, holds for a beat, and drifts
  // back. Manual panning cancels this.
  attentionPan: {
    target: { x: number; y: number }
    returnTo: { x: number; y: number }
    startMs: number
  } | null

  // Lifecycle
  frameHandle: number
  disposed: boolean
}

function GraphLegend({ data }: { data: GraphData }) {
  // Only show legend entries for types actually present in the graph.
  const typePresence = new Set<string>(data.nodes.map((n) => n.articleType))
  const visibleNodeTypes = Array.from(typePresence).filter(
    (t) => t in ARTICLE_TYPE_META && !ARTICLE_TYPE_META[t as ArticleType].hidden,
  )
  const edgeTypes = [...new Set(data.edges.map(e => e.relation))].filter(r => r in edgeTypeDisplay)
  if (visibleNodeTypes.length === 0 && edgeTypes.length === 0) return null
  return (
    <div className="absolute bottom-3 right-3 pointer-events-none">
      <div className="bg-surface/70 backdrop-blur-sm border border-border rounded-sm px-3 py-2 space-y-1.5">
        {visibleNodeTypes.map((t) => {
          const meta = ARTICLE_TYPE_META[t as ArticleType]
          return (
            <div key={t} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.colorHex }} />
              <span className="text-[9px] font-mono text-text-ghost">{meta.label}</span>
            </div>
          )
        })}
        {edgeTypes.length > 0 && visibleNodeTypes.length > 0 && <div className="border-t border-border/50 my-1" />}
        {edgeTypes.map(r => (
          <div key={r} className="flex items-center gap-2"><div className="w-3 h-px" style={{ backgroundColor: edgeTypeDisplay[r].color }} /><span className="text-[9px] font-mono text-text-ghost">{edgeTypeDisplay[r].label}</span></div>
        ))}
      </div>
    </div>
  )
}

function buildMountScene(
  sceneRef: RefLike<SceneState | null>,
  dataRef: RefLike<GraphData>,
  nodeVisibleRef: RefLike<Uint8Array | null>,
  handleNodeClick: (slug: string, sx: number, sy: number) => void,
) {
  return function mountScene(
    container: HTMLDivElement,
    tooltip: HTMLDivElement,
    initW: number,
    initH: number,
  ): () => void {
    // ── Scene / camera / renderer ──
    const scene = new THREE.Scene()
    const camZ = 400
    const camera = new THREE.PerspectiveCamera(55, initW / initH, 1, 3000)
    camera.position.set(0, 0, camZ)
    const renderer = new THREE.WebGLRenderer({ alpha: true, powerPreference: "high-performance" })
    renderer.setSize(initW, initH)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    container.appendChild(renderer.domElement)

    // ── Materials (stable across data changes) ──
    const nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uRippleOrigin: { value: new THREE.Vector2(0, 0) },
        uRippleTime: { value: -100.0 },
      },
      vertexShader: `
        attribute float aSize, aPhase, aFade, aAttention;
        attribute vec3 aColor;
        uniform float uTime;
        uniform vec2 uMouse, uRippleOrigin;
        uniform float uRippleTime;
        varying float vPulse, vMouseProx, vDepth, vFade, vAttention, vSize;
        varying vec3 vColor;

        void main() {
          float pulse = 0.85 + 0.15 * sin(uTime * 0.6 + aPhase);
          float dm = distance(position.xy, uMouse);
          float mg = smoothstep(300.0, 0.0, dm);
          vMouseProx = mg;
          // Mouse-proximity boost dialed down from 0.7 to 0.4 — nodes near
          // the cursor used to get uncomfortably bright when combined with
          // the attention pulse. Keeps some glow lift, loses the blow-out.
          pulse += mg * 0.4;

          if (uRippleTime >= 0.0 && uRippleTime < 4.0) {
            float dr = distance(position.xy, uRippleOrigin);
            pulse += smoothstep(80.0, 0.0, abs(dr - uRippleTime * 500.0)) * exp(-uRippleTime) * 1.5;
          }

          // Pulse clamp tightened from 1.4 to 1.2 so the peak brightness
          // can't stack too high with the attention boost in the fragment.
          vPulse = clamp(pulse, 0.0, 1.2);
          vFade = aFade;
          vAttention = aAttention;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // No depth-driven alpha fade. The old version multiplied alpha
          // by a smoothstep on mv.z which killed visibility entirely at
          // the far edge of large graphs. Depth is now conveyed by the
          // perspective point-size falloff alone — front nodes are
          // naturally bigger than back nodes without any being dimmed
          // into the background.
          vDepth = 1.0;
          // Perspective-correct point size with a 4px floor. Without the
          // floor, sprites disappear at far zoom levels because the
          // perspScale / |mv.z| term goes sub-pixel and additive
          // blending can't show half-pixel points. The fragment shader
          // also reads this size to decide whether to render the sharp
          // starry profile or a filled-disk profile — at the floor
          // size the filled profile is the only thing that stays
          // visible.
          //
          // The 800 constant is a global screen-size knob: raising it
          // makes every node bigger at every zoom; lowering it shrinks
          // them all. It's the primary dial for "nodes feel the right
          // size" — the halo suppression + floor + fragment profile
          // are tuned to look correct across a wide range of sizes.
          float perspScale = 800.0 / max(-mv.z, 1.0);
          float rawSize = aSize * (0.85 + vPulse * 0.3 + vAttention * 0.25) * perspScale;
          gl_PointSize = max(rawSize, 4.0);
          vSize = gl_PointSize;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vPulse, vMouseProx, vDepth, vFade, vAttention, vSize;
        varying vec3 vColor;

        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;

          // Two alpha profiles, blended by sprite size:
          //
          //   peaked — the original look. Sharp exp(-d*30) core plus
          //            thin halo tiers. Looks like a star — bright,
          //            crisp, small glow. Needs ~10+ pixels to render
          //            its gradient correctly; at 4-6px the peak only
          //            lands on one center pixel and the sprite vanishes.
          //
          //   filled — a smoothstep-filled disk. Every pixel in the
          //            sprite reads near-full alpha, so even a 4px
          //            sprite is a solid bright dot. At large sizes
          //            though, this looks blurry and washed out.
          //
          // Cross-fade via smoothstep on vSize: pure filled at 4px,
          // half-half at 7px, pure peaked at 10px+. Gives sharp stars
          // when zoomed in AND visible dots when zoomed out, without
          // either mode's failure case.
          float t = smoothstep(4.0, 10.0, vSize);

          // As you zoom in further, suppress the halo's slow-decay
          // tiers. They're what bleed into surrounding pixels and make
          // zoomed-in nodes look like blurry clouds. The exp(-d*30)
          // core stays at full strength — it's already a tight peak
          // and carries the "point" shape. haloScale drops from 1.0 at
          // 16px to 0.15 at 40+px, so large sprites become sharp
          // discrete points instead of soft blobs.
          float haloScale = 1.0 - smoothstep(16.0, 40.0, vSize) * 0.85;

          float peakedCore = exp(-d * 30.0);
          float peakedHalo = exp(-d * 12.0) * 0.5
                           + exp(-d * 5.0)  * 0.18
                           + exp(-d * 2.5)  * 0.06;
          float peaked = peakedCore + peakedHalo * haloScale;

          float filled = smoothstep(0.5, 0.0, d) * 0.9;

          // Brightness multiplier scales DOWN as sprites grow large.
          // At default zoom (vSize ~10-20px) we get the full 1.15x
          // boost; once you zoom in close enough that individual
          // sprites hit 40-60+ px, the multiplier drops to ~0.75 to
          // avoid the close-up "blowout" effect on dense graphs where
          // every node fills a chunk of screen and the additive
          // blending stacks. Far view stays bright, close view stays
          // composed.
          float zoomBrightness = 1.15 - smoothstep(20.0, 60.0, vSize) * 0.4;
          float a = mix(filled, peaked, t) * vPulse * vDepth * vFade * (1.0 + vAttention * 0.6) * zoomBrightness;

          // Color mix: use the peaked core to whiten the center at
          // large sizes, falling back to a smoothstep at small sizes so
          // the whole filled disk gets the node's base color instead of
          // a one-pixel highlight.
          float colorBlend = mix(smoothstep(0.5, 0.0, d), peakedCore, t);
          vec3 col = mix(vColor * 0.7, vColor, colorBlend);
          col = mix(col, vec3(1.0, 0.98, 0.96), vMouseProx * 0.4);
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    const edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.18 })

    // ── Empty geometries (populated by applyReconcile) ──
    const nodeGeo = new THREE.BufferGeometry()
    const nodeMesh = new THREE.Points(nodeGeo, nodeMat)
    scene.add(nodeMesh)

    const edgeGeo = new THREE.BufferGeometry()
    const edgeMesh = new THREE.LineSegments(edgeGeo, edgeMat)
    scene.add(edgeMesh)

    // ── Initial SceneState ──
    const state: SceneState = {
      container,
      scene,
      camera,
      renderer,
      nodeMat,
      edgeMat,
      nodeMesh,
      nodeGeo,
      edgeMesh,
      edgeGeo,
      buffers: {
        count: 0,
        edgeCount: 0,
        nodeColors: new Float32Array(0),
        sizes: new Float32Array(0),
        phases: new Float32Array(0),
        depthArr: new Float32Array(0),
        currentPos: new Float32Array(0),
        targetPos: new Float32Array(0),
        fadeCurrent: new Float32Array(0),
        fadeTarget: new Float32Array(0),
        attention: new Float32Array(0),
        eSrc: new Uint16Array(0),
        eTgt: new Uint16Array(0),
        edgeColors: new Float32Array(0),
        edgePositions: new Float32Array(0),
        slugs: [],
        slugToIndex: new Map(),
        neighbors: new Map(),
      },
      currentHovered: -1,
      currentHoveredEdge: -1,
      mouse: { x: 0, y: 0, screenX: 0, screenY: 0 },
      smoothMouse: { x: 0, y: 0 },
      ripple: { x: 0, y: 0, time: -100 },
      panOffset: { x: 0, y: 0 },
      panLimit: 200,
      panStart: { x: 0, y: 0 },
      orbitTheta: 0,
      orbitPhi: 0,
      targetTheta: 0,
      targetPhi: 0,
      targetZ: camZ,
      currentZoom: camZ,
      minZoom: 80,
      maxZoom: camZ * 1.3,
      isPanning: false,
      isOrbiting: false,
      orbitStart: { x: 0, y: 0 },
      hasFramed: false,
      attentionPan: null,
      frameHandle: 0,
      disposed: false,
    }
    sceneRef.current = state

    // ── Input helpers ──
    const unprojVec = new THREE.Vector3()
    const projVec = new THREE.Vector3()

    const screenToWorld = (cx: number, cy: number) => {
      const rect = container.getBoundingClientRect()
      unprojVec
        .set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1, 0.5)
        .unproject(camera)
      const dir = unprojVec.sub(camera.position).normalize()
      const t = -camera.position.z / dir.z
      return { x: camera.position.x + dir.x * t, y: camera.position.y + dir.y * t }
    }

    const onMouseMove = (e: MouseEvent) => {
      const w = screenToWorld(e.clientX, e.clientY)
      state.mouse.x = w.x
      state.mouse.y = w.y
      state.mouse.screenX = e.clientX
      state.mouse.screenY = e.clientY
    }
    const onClick = (e: MouseEvent) => {
      if (state.currentHovered >= 0 && state.currentHovered < state.buffers.slugs.length) {
        handleNodeClick(state.buffers.slugs[state.currentHovered], e.clientX, e.clientY)
      } else {
        const w = screenToWorld(e.clientX, e.clientY)
        state.ripple.x = w.x
        state.ripple.y = w.y
        state.ripple.time = 0
      }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      state.targetZ = Math.max(state.minZoom, Math.min(state.maxZoom, state.targetZ + e.deltaY * 0.5))
    }
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && state.currentHovered < 0) {
        // Manual pan cancels any in-flight attention drift — user input wins.
        state.attentionPan = null
        state.isPanning = true
        state.panStart = { x: e.clientX, y: e.clientY }
      } else if (e.button === 2) {
        state.attentionPan = null
        state.isOrbiting = true
        state.orbitStart = { x: e.clientX, y: e.clientY }
      }
    }
    const onMouseUp = () => { state.isPanning = false; state.isOrbiting = false }
    const onPanMove = (e: MouseEvent) => {
      if (state.isPanning) {
        // Decompose the screen drag onto the camera's right/up vectors,
        // projected onto the z=0 plane (since panOffset lives in XY).
        // Without this, dragging after an orbit moves the world along the
        // default camera's axes rather than the current view's.
        const scale = state.currentZoom * 0.002
        const screenDx = (e.clientX - state.panStart.x) * scale
        const screenDy = (e.clientY - state.panStart.y) * scale
        const cosT = Math.cos(state.orbitTheta)
        const sinT = Math.sin(state.orbitTheta)
        const cosP = Math.cos(state.orbitPhi)
        const sinP = Math.sin(state.orbitPhi)
        // Camera right in world: (cos θ, 0, -sin θ)
        // Camera up in world:    (-sin θ sin φ, cos φ, -cos θ sin φ)
        const rightX = cosT
        const rightY = 0
        const upX = -sinT * sinP
        const upY = cosP
        // Drag right → content moves right → target slides left:  -screenDx * right
        // Drag down  → content moves down  → target slides up (screen) = +up in world: +screenDy * up
        const dx = -screenDx * rightX + screenDy * upX
        const dy = -screenDx * rightY + screenDy * upY
        state.panOffset.x = Math.max(-state.panLimit, Math.min(state.panLimit, state.panOffset.x + dx))
        state.panOffset.y = Math.max(-state.panLimit, Math.min(state.panLimit, state.panOffset.y + dy))
        state.panStart = { x: e.clientX, y: e.clientY }
      }
      if (state.isOrbiting) {
        state.targetTheta -= (e.clientX - state.orbitStart.x) * 0.004
        state.targetPhi = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, state.targetPhi + (e.clientY - state.orbitStart.y) * 0.004))
        state.orbitStart = { x: e.clientX, y: e.clientY }
      }
    }
    const onContextMenu = (e: MouseEvent) => { e.preventDefault() }

    window.addEventListener("mousemove", onMouseMove, { passive: true })
    window.addEventListener("mousemove", onPanMove, { passive: true })
    window.addEventListener("click", onClick)
    container.addEventListener("wheel", onWheel, { passive: false })
    container.addEventListener("mousedown", onMouseDown)
    container.addEventListener("contextmenu", onContextMenu)
    window.addEventListener("mouseup", onMouseUp)

    // ── Animation loop ──
    let lastTime = performance.now()
    let frameToggle = false

    const animate = () => {
      if (state.disposed) return
      state.frameHandle = requestAnimationFrame(animate)
      const now = performance.now()
      const delta = (now - lastTime) * 0.001
      lastTime = now
      const elapsed = now * 0.001

      const { buffers } = state
      const count = buffers.count
      const edgeCount = buffers.edgeCount

      state.smoothMouse.x += (state.mouse.x - state.smoothMouse.x) * 0.06
      state.smoothMouse.y += (state.mouse.y - state.smoothMouse.y) * 0.06

      state.nodeMat.uniforms.uTime.value = elapsed
      state.nodeMat.uniforms.uMouse.value.set(state.smoothMouse.x, state.smoothMouse.y)

      if (state.ripple.time >= 0) {
        state.ripple.time += delta
        state.nodeMat.uniforms.uRippleOrigin.value.set(state.ripple.x, state.ripple.y)
        state.nodeMat.uniforms.uRippleTime.value = state.ripple.time
        if (state.ripple.time > 5) state.ripple.time = -100
      }

      // Camera orbit + drift
      const driftScale = Math.min(Math.max((count - 5) / 10, 0), 1)

      // ── Attention pan state machine ──
      if (state.attentionPan) {
        const t = performance.now() - state.attentionPan.startMs
        const { target, returnTo } = state.attentionPan
        if (t < 600) {
          // Phase 1: ease-out toward target (600ms)
          const p = t / 600
          const k = 1 - Math.pow(1 - p, 3) // ease-out cubic
          state.panOffset.x = returnTo.x + (target.x - returnTo.x) * k
          state.panOffset.y = returnTo.y + (target.y - returnTo.y) * k
        } else if (t < 1600) {
          // Phase 2: hold at target (1000ms)
          state.panOffset.x = target.x
          state.panOffset.y = target.y
        } else if (t < 2400) {
          // Phase 3: ease-out back to returnTo (800ms)
          const p = (t - 1600) / 800
          const k = 1 - Math.pow(1 - p, 3)
          state.panOffset.x = target.x + (returnTo.x - target.x) * k
          state.panOffset.y = target.y + (returnTo.y - target.y) * k
        } else {
          // Done
          state.panOffset.x = returnTo.x
          state.panOffset.y = returnTo.y
          state.attentionPan = null
        }
      }

      state.currentZoom += (state.targetZ - state.currentZoom) * 0.1
      state.orbitTheta += (state.targetTheta - state.orbitTheta) * 0.08
      state.orbitPhi += (state.targetPhi - state.orbitPhi) * 0.08

      const driftX = Math.sin(elapsed * 0.015) * 20 * driftScale
      const driftY = Math.cos(elapsed * 0.01) * 15 * driftScale
      state.camera.position.x = state.panOffset.x + driftX + state.currentZoom * Math.sin(state.orbitTheta) * Math.cos(state.orbitPhi)
      state.camera.position.y = state.panOffset.y + driftY + state.currentZoom * Math.sin(state.orbitPhi)
      state.camera.position.z = state.currentZoom * Math.cos(state.orbitTheta) * Math.cos(state.orbitPhi)
      state.camera.lookAt(state.panOffset.x, state.panOffset.y, 0)

      // ── Lerp currentPos → targetPos ──
      // Rate reduced from 6 to 3 (~330ms settle) so ripple neighbors
      // read as motion rather than an imperceptible snap. Pinned nodes
      // are unaffected because their currentPos already matches targetPos.
      if (count > 0) {
        const step = Math.min(delta * 3, 1)
        const cp = buffers.currentPos
        const tp = buffers.targetPos
        for (let i = 0; i < count * 3; i++) {
          cp[i] += (tp[i] - cp[i]) * step
        }
        state.nodeGeo.attributes.position.needsUpdate = true
      }

      // ── Hover detection ──
      let closest = -1
      let closestDist = 25
      const rect = container.getBoundingClientRect()
      const cp = buffers.currentPos
      for (let i = 0; i < count; i++) {
        const i3 = i * 3
        projVec.set(cp[i3], cp[i3 + 1], cp[i3 + 2]).project(state.camera)
        const sx = (projVec.x * 0.5 + 0.5) * rect.width + rect.left
        const sy = (-projVec.y * 0.5 + 0.5) * rect.height + rect.top
        const dist = Math.hypot(sx - state.mouse.screenX, sy - state.mouse.screenY)
        if (dist < closestDist) { closestDist = dist; closest = i }
      }

      // Edge hover
      let hoveredEdge = -1
      if (closest < 0 && edgeCount > 0) {
        let bestEdgeDist = 8
        for (let ei = 0; ei < edgeCount; ei++) {
          const s3 = buffers.eSrc[ei] * 3, t3 = buffers.eTgt[ei] * 3
          projVec.set(cp[s3], cp[s3 + 1], cp[s3 + 2]).project(state.camera)
          const sx1 = (projVec.x * 0.5 + 0.5) * rect.width + rect.left
          const sy1 = (-projVec.y * 0.5 + 0.5) * rect.height + rect.top
          projVec.set(cp[t3], cp[t3 + 1], cp[t3 + 2]).project(state.camera)
          const sx2 = (projVec.x * 0.5 + 0.5) * rect.width + rect.left
          const sy2 = (-projVec.y * 0.5 + 0.5) * rect.height + rect.top
          const dx = sx2 - sx1, dy = sy2 - sy1
          const len2 = dx * dx + dy * dy
          if (len2 < 1) continue
          const t2 = Math.max(0, Math.min(1, ((state.mouse.screenX - sx1) * dx + (state.mouse.screenY - sy1) * dy) / len2))
          const px = sx1 + t2 * dx, py = sy1 + t2 * dy
          const d2 = Math.hypot(state.mouse.screenX - px, state.mouse.screenY - py)
          if (d2 < bestEdgeDist) { bestEdgeDist = d2; hoveredEdge = ei }
        }
      }

      // Update hover fade targets
      if (closest !== state.currentHovered || hoveredEdge !== state.currentHoveredEdge) {
        state.currentHoveredEdge = hoveredEdge
        state.currentHovered = closest
        if (closest >= 0) {
          const nbs = buffers.neighbors.get(closest) ?? new Set<number>()
          const vis = nodeVisibleRef.current
          for (let i = 0; i < count; i++) {
            const filterOk = !vis || vis[i] === 1
            buffers.fadeTarget[i] = (i === closest || nbs.has(i)) ? 1.0 : (filterOk ? 0.08 : 0.02)
          }
          const i3 = closest * 3
          projVec.set(cp[i3], cp[i3 + 1], cp[i3 + 2]).project(state.camera)
          const tx = (projVec.x * 0.5 + 0.5) * rect.width
          const ty = (-projVec.y * 0.5 + 0.5) * rect.height
          tooltip.style.left = `${tx}px`
          tooltip.style.top = `${ty - 12}px`
          tooltip.style.opacity = "1"
          const node = dataRef.current.nodes[closest]
          if (node) {
            const conf = Math.round(node.confidence * 100)
            const tags = node.tags.slice(0, 3).join(", ")
            tooltip.innerHTML = `<span style="color:var(--color-text-emphasis)">${node.title}</span><br/><span style="font-family:var(--font-mono);font-size:9px;color:var(--color-text-ghost)">${conf}%${node.articleType !== "concept" ? " · " + node.articleType : ""}${tags ? " · " + tags : ""}</span>`
          }
          container.style.cursor = "pointer"
        } else if (hoveredEdge >= 0) {
          const edge = dataRef.current.edges[hoveredEdge]
          const fromNode = edge ? dataRef.current.nodes[edge.sourceIdx] : null
          const toNode = edge ? dataRef.current.nodes[edge.targetIdx] : null
          const s3 = buffers.eSrc[hoveredEdge] * 3, t3 = buffers.eTgt[hoveredEdge] * 3
          projVec.set(
            (cp[s3] + cp[t3]) / 2,
            (cp[s3 + 1] + cp[t3 + 1]) / 2,
            (cp[s3 + 2] + cp[t3 + 2]) / 2,
          ).project(state.camera)
          const tx = (projVec.x * 0.5 + 0.5) * rect.width
          const ty = (-projVec.y * 0.5 + 0.5) * rect.height
          tooltip.style.left = `${tx}px`
          tooltip.style.top = `${ty - 12}px`
          tooltip.style.opacity = "1"
          if (fromNode && toNode && edge) {
            tooltip.innerHTML = `<span style="font-family:var(--font-mono);font-size:10px;color:var(--color-text-secondary)">${fromNode.title} <span style="color:var(--color-text-ghost)">&mdash; ${edge.relation} &mdash;</span> ${toNode.title}</span>`
          }
          container.style.cursor = "default"
          const vis = nodeVisibleRef.current
          for (let i = 0; i < count; i++) {
            const filterOk = !vis || vis[i] === 1
            buffers.fadeTarget[i] = (i === buffers.eSrc[hoveredEdge] || i === buffers.eTgt[hoveredEdge]) ? 1.0 : (filterOk ? 0.12 : 0.02)
          }
        } else {
          const vis = nodeVisibleRef.current
          for (let i = 0; i < count; i++) buffers.fadeTarget[i] = (!vis || vis[i] === 1) ? 1.0 : 0.04
          tooltip.style.opacity = "0"
          container.style.cursor = "default"
        }
      }

      // Filter update when not hovering
      if (state.currentHovered < 0) {
        const vis = nodeVisibleRef.current
        for (let i = 0; i < count; i++) buffers.fadeTarget[i] = (!vis || vis[i] === 1) ? 1.0 : 0.04
      }

      // Lerp fade values
      for (let i = 0; i < count; i++) {
        buffers.fadeCurrent[i] += (buffers.fadeTarget[i] - buffers.fadeCurrent[i]) * Math.min(delta * 6, 1)
      }
      if (count > 0) state.nodeGeo.attributes.aFade.needsUpdate = true

      // Decay attention toward 0 at ~1/sec. Only mark the attribute as
      // needing a GPU upload when something actually changed, to avoid
      // gratuitous buffer transfers on an idle graph.
      let attentionDirty = false
      for (let i = 0; i < count; i++) {
        if (buffers.attention[i] > 0) {
          buffers.attention[i] = Math.max(0, buffers.attention[i] - delta)
          attentionDirty = true
        }
      }
      if (attentionDirty && count > 0) state.nodeGeo.attributes.aAttention.needsUpdate = true

      // Update edge positions from currentPos (every other frame to save work)
      frameToggle = !frameToggle
      if (frameToggle && edgeCount > 0) {
        const ep = buffers.edgePositions
        for (let e = 0; e < edgeCount; e++) {
          const s3 = buffers.eSrc[e] * 3, t3 = buffers.eTgt[e] * 3, o = e * 6
          ep[o] = cp[s3]
          ep[o + 1] = cp[s3 + 1]
          ep[o + 2] = cp[s3 + 2]
          ep[o + 3] = cp[t3]
          ep[o + 4] = cp[t3 + 1]
          ep[o + 5] = cp[t3 + 2]
        }
        state.edgeGeo.attributes.position.needsUpdate = true
      }

      state.edgeMat.opacity = 0.14 + Math.sin(elapsed * 0.5) * 0.06
      state.renderer.render(state.scene, state.camera)
    }
    animate()

    // ── Resize ──
    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight
      if (w === 0 || h === 0) return
      state.camera.aspect = w / h
      state.camera.updateProjectionMatrix()
      state.renderer.setSize(w, h)
    }
    window.addEventListener("resize", onResize)

    return () => {
      state.disposed = true
      cancelAnimationFrame(state.frameHandle)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mousemove", onPanMove)
      window.removeEventListener("click", onClick)
      window.removeEventListener("mouseup", onMouseUp)
      container.removeEventListener("wheel", onWheel)
      container.removeEventListener("mousedown", onMouseDown)
      container.removeEventListener("contextmenu", onContextMenu)
      state.edgeGeo.dispose(); state.edgeMat.dispose()
      state.nodeGeo.dispose(); state.nodeMat.dispose()
      state.renderer.dispose()
      if (container.contains(state.renderer.domElement)) container.removeChild(state.renderer.domElement)
      sceneRef.current = null
    }
  }
}

function applyReconcile(state: SceneState, data: GraphData, positions: Float32Array, meta: LayoutMeta) {
  const next = reconcileGraph(state.buffers, data, positions, meta)
  state.buffers = next

  // ── Rebuild node geometry with the new buffers ──
  state.scene.remove(state.nodeMesh)
  state.nodeGeo.dispose()
  const nodeGeo = new THREE.BufferGeometry()
  nodeGeo.setAttribute("position", new THREE.BufferAttribute(next.currentPos, 3))
  nodeGeo.setAttribute("aSize", new THREE.BufferAttribute(next.sizes, 1))
  nodeGeo.setAttribute("aPhase", new THREE.BufferAttribute(next.phases, 1))
  nodeGeo.setAttribute("aFade", new THREE.BufferAttribute(next.fadeCurrent, 1))
  nodeGeo.setAttribute("aAttention", new THREE.BufferAttribute(next.attention, 1))
  nodeGeo.setAttribute("aColor", new THREE.BufferAttribute(next.nodeColors, 3))
  const nodeMesh = new THREE.Points(nodeGeo, state.nodeMat)
  state.scene.add(nodeMesh)
  state.nodeGeo = nodeGeo
  state.nodeMesh = nodeMesh

  // ── Rebuild edge geometry ──
  state.scene.remove(state.edgeMesh)
  state.edgeGeo.dispose()
  const edgeGeo = new THREE.BufferGeometry()
  edgeGeo.setAttribute("position", new THREE.BufferAttribute(next.edgePositions, 3))
  edgeGeo.setAttribute("color", new THREE.BufferAttribute(next.edgeColors, 3))
  const edgeMesh = new THREE.LineSegments(edgeGeo, state.edgeMat)
  state.scene.add(edgeMesh)
  state.edgeGeo = edgeGeo
  state.edgeMesh = edgeMesh

  // ── Recompute pan limit + zoom extents based on new graph radius ──
  // Now 3D — the constellation has real z extent, so the bounding
  // sphere used for auto-frame and pan limit has to include all three
  // coordinates or the camera will stop partway through the graph when
  // viewed from the side.
  let graphRadius = 1
  for (let i = 0; i < next.count; i++) {
    const r = Math.sqrt(
      next.targetPos[i * 3] ** 2 +
      next.targetPos[i * 3 + 1] ** 2 +
      next.targetPos[i * 3 + 2] ** 2,
    )
    if (r > graphRadius) graphRadius = r
  }
  state.panLimit = graphRadius * 1.2
  // Distance needed to fit the graph radius in the 55° fov frustum.
  // tan(55°/2) ≈ 0.521 → distance ≈ radius / 0.521 ≈ radius * 1.92.
  // Multiplier 2.0 gives ~4% padding past the absolute fit — outer
  // nodes are at the edge of the frame but visible. The previous 2.2
  // multiplier left a noticeable margin around the constellation that
  // felt too far out for dense graphs.
  const fitZ = graphRadius * 2.0
  // Count-driven floor (250 + count*4 capped at 400) ensures sparse
  // graphs still have breathing room to zoom out, but the cap is low
  // enough that dense graphs are framed by graphRadius instead of by
  // a count-derived floor. Old formula capped at 600, which made
  // dense graphs start ~25% farther out than they needed to be.
  const camZ = Math.max(250 + Math.min(next.count * 4, 400), fitZ)
  // Tight-ish zoom-out ceiling: 1.3x past the auto-frame. The old
  // 1.8x multiplier let users back off so far the constellation
  // shrunk to a speck.
  state.maxZoom = camZ * 1.3
  // Loosened the close-zoom clamp from 0.15 → 0.07 of camZ (and
  // floor 80 → 50) so users can fly in close on dense graphs to
  // inspect individual nodes. Previously dense graphs hit minZoom
  // ~135 which felt like the camera couldn't get near anything.
  state.minZoom = Math.max(camZ * 0.07, 50)
  // On the first reconcile that brings nodes in, auto-frame the whole
  // graph — otherwise large graphs load too zoomed-in because targetZ is
  // still pinned to the empty-scene default. After that, the user's zoom
  // is preserved (we only clamp, never reset).
  if (!state.hasFramed && next.count > 0) {
    state.targetZ = camZ
    state.currentZoom = camZ
    state.hasFramed = true
  } else {
    state.targetZ = Math.max(state.minZoom, Math.min(state.maxZoom, state.targetZ))
  }

  // ── Start an attention pan if any new node would land outside the
  // safe viewport. Only REPLACE an in-flight pan if there's a new target
  // to drive toward — otherwise leave the existing drift alone so it can
  // finish its phase. ──
  if (meta.newSlugs.size > 0) {
    const safe =
      typeof window !== "undefined"
        ? getSafeViewport(window.innerWidth, window.innerHeight)
        : null
    if (safe) {
      const rect = state.container.getBoundingClientRect()
      const projVec = new THREE.Vector3()
      let offScreenCount = 0
      let centroidX = 0
      let centroidY = 0
      for (let i = 0; i < next.count; i++) {
        if (!meta.newSlugs.has(next.slugs[i])) continue
        const i3 = i * 3
        projVec
          .set(next.targetPos[i3], next.targetPos[i3 + 1], next.targetPos[i3 + 2])
          .project(state.camera)
        const sx = (projVec.x * 0.5 + 0.5) * rect.width + rect.left
        const sy = (-projVec.y * 0.5 + 0.5) * rect.height + rect.top
        if (!isInSafeViewport(sx, sy, safe)) {
          offScreenCount += 1
          centroidX += next.targetPos[i3]
          centroidY += next.targetPos[i3 + 1]
        }
      }
      if (offScreenCount > 0) {
        // Use the CURRENT returnTo if a pan is already in-flight — don't
        // trap the user at a mid-drift position when a second reconcile
        // lands. Otherwise capture the current resting panOffset.
        const returnTo = state.attentionPan
          ? state.attentionPan.returnTo
          : { x: state.panOffset.x, y: state.panOffset.y }
        state.attentionPan = {
          target: { x: centroidX / offScreenCount, y: centroidY / offScreenCount },
          returnTo,
          startMs: performance.now(),
        }
      }
      // If offScreenCount is 0, leave any in-flight attentionPan alone so
      // it can finish its three-phase drift. A new reconcile without
      // off-screen nodes doesn't need to steal the camera.
    }
  }

  // ── Force hover recompute on next frame: surviving slugs may have moved
  // to new indices, so the old index would point at the wrong node. ──
  state.currentHovered = -1
  state.currentHoveredEdge = -1
}

export default function EngineGraph({ data, positions, layoutMeta, engramSlug, onNodeClick, nodeVisible }: EngineGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const nodeVisibleRef = useRef<Uint8Array | null>(null)
  const sceneRef = useRef<SceneState | null>(null)
  const dataRef = useRef<GraphData>(data)
  const positionsRef = useRef<Float32Array>(positions)
  const [sceneReady, setSceneReady] = useState(false)
  useEffect(() => { dataRef.current = data }, [data])
  useEffect(() => { positionsRef.current = positions }, [positions])
  const router = useRouter()

  // Keep nodeVisible ref in sync without re-running the whole setup
  useEffect(() => { nodeVisibleRef.current = nodeVisible ?? null }, [nodeVisible])

  const handleNodeClick = useCallback((slug: string, screenX: number, screenY: number) => {
    if (onNodeClick) {
      onNodeClick(slug, screenX, screenY)
    } else {
      router.push(`/app/${engramSlug}/article/${slug}`)
    }
  }, [router, engramSlug, onNodeClick])

  // ── Mount-phase: build the scene once ──
  useEffect(() => {
    const container = containerRef.current
    const tooltip = tooltipRef.current
    if (!container || !tooltip) return

    const mountScene = buildMountScene(sceneRef, dataRef, nodeVisibleRef, handleNodeClick)
    let cleanup: (() => void) | undefined
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0 && !cleanup) {
        cleanup = mountScene(container, tooltip, width, height)
        setSceneReady(true)
        observer.disconnect()
      }
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      cleanup?.()
      setSceneReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engramSlug])

  // ── Reconcile-phase: update buffers in place when data/positions change ──
  useEffect(() => {
    const state = sceneRef.current
    if (!sceneReady || !state || data.nodes.length === 0) return
    applyReconcile(state, data, positions, layoutMeta)
  }, [sceneReady, data, positions, layoutMeta])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <div
        ref={tooltipRef}
        className="absolute font-heading text-sm text-text-emphasis pointer-events-none transition-opacity duration-120 -translate-x-1/2 text-center leading-tight bg-surface/90 backdrop-blur-sm border border-border px-3 py-1.5 rounded-sm"
        style={{ opacity: 0, transform: "translateX(-50%) translateY(-100%)", marginTop: "-8px" }}
      />
      {/* Legend — only shows types/relations present in the graph */}
      <GraphLegend data={data} />
    </div>
  )
}
