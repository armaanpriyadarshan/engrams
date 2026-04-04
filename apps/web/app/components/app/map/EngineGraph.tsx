"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import * as THREE from "three"
import type { GraphData } from "./useGraphData"

interface EngineGraphProps {
  data: GraphData
  positions: Float32Array
  engramSlug: string
  onNodeClick?: (slug: string, x: number, y: number) => void
}

export default function EngineGraph({ data, positions, engramSlug, onNodeClick }: EngineGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const [hoveredNode, setHoveredNode] = useState<number | null>(null)

  const handleNodeClick = useCallback((slug: string, screenX: number, screenY: number) => {
    if (onNodeClick) {
      onNodeClick(slug, screenX, screenY)
    } else {
      router.push(`/app/${engramSlug}/article/${slug}`)
    }
  }, [router, engramSlug, onNodeClick])

  useEffect(() => {
    const container = containerRef.current
    const tooltip = tooltipRef.current
    if (!container || !tooltip || data.nodes.length === 0) return

    let cleanup: (() => void) | undefined
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0 && !cleanup) {
        cleanup = setup(container, tooltip, width, height)
        observer.disconnect()
      }
    })
    observer.observe(container)
    return () => { observer.disconnect(); cleanup?.() }
  }, [data, positions, engramSlug, handleNodeClick])

  function setup(container: HTMLDivElement, tooltip: HTMLDivElement, initW: number, initH: number) {
    const count = data.nodes.length
    const edgeList = data.edges

    // ── Scene ──
    const scene = new THREE.Scene()
    const camZ = 300 + Math.min(count * 5, 600)
    const camera = new THREE.PerspectiveCamera(55, initW / initH, 1, 3000)
    camera.position.set(0, 0, camZ)

    const renderer = new THREE.WebGLRenderer({ alpha: true, powerPreference: "high-performance" })
    renderer.setSize(initW, initH)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    container.appendChild(renderer.domElement)

    // ── Compute graph extent from positions for zoom/pan scaling ──
    let graphRadius = 1
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(positions[i * 2] ** 2 + positions[i * 2 + 1] ** 2)
      if (r > graphRadius) graphRadius = r
    }

    // ── Camera zoom/pan state — scales with graph size ──
    const maxZoom = camZ * 1.5
    const minZoom = Math.max(camZ * 0.15, 80)
    let targetZ = maxZoom
    const panLimit = graphRadius * 1.2 // can pan slightly beyond the graph edge
    const panOffset = { x: 0, y: 0 }
    let isPanning = false
    let panStart = { x: 0, y: 0 }

    // ── Mouse ──
    const mouse = { x: 0, y: 0, screenX: 0, screenY: 0 }
    const smoothMouse = { x: 0, y: 0 }
    const ripple = { x: 0, y: 0, time: -100 }
    const unprojVec = new THREE.Vector3()
    let currentHovered = -1

    const screenToWorld = (cx: number, cy: number) => {
      const rect = container.getBoundingClientRect()
      unprojVec
        .set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1, 0.5)
        .unproject(camera)
      const dir = unprojVec.sub(camera.position).normalize()
      const t = -camera.position.z / dir.z
      return { x: camera.position.x + dir.x * t, y: camera.position.y + dir.y * t }
    }

    // Build neighbor sets for hover highlighting
    const neighbors = new Map<number, Set<number>>()
    for (let i = 0; i < count; i++) neighbors.set(i, new Set())
    for (const e of edgeList) {
      neighbors.get(e.sourceIdx)?.add(e.targetIdx)
      neighbors.get(e.targetIdx)?.add(e.sourceIdx)
    }

    // Per-node fade target (1.0 = full, 0.08 = dimmed)
    const fadeTarget = new Float32Array(count).fill(1.0)
    const fadeCurrent = new Float32Array(count).fill(1.0)

    const onMouseMove = (e: MouseEvent) => {
      const w = screenToWorld(e.clientX, e.clientY)
      mouse.x = w.x
      mouse.y = w.y
      mouse.screenX = e.clientX
      mouse.screenY = e.clientY
    }
    const onClick = (e: MouseEvent) => {
      if (currentHovered >= 0) {
        handleNodeClick(data.nodes[currentHovered].slug, e.clientX, e.clientY)
      } else {
        const w = screenToWorld(e.clientX, e.clientY)
        ripple.x = w.x
        ripple.y = w.y
        ripple.time = 0
      }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      targetZ = Math.max(minZoom, Math.min(maxZoom, targetZ + e.deltaY * 0.5))
    }
    let orbitTheta = 0 // horizontal orbit (right-click drag)
    let orbitPhi = 0   // vertical orbit (right-click drag)
    let targetTheta = 0
    let targetPhi = 0
    let isOrbiting = false
    let orbitStart = { x: 0, y: 0 }
    let currentZoom = targetZ

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && currentHovered < 0) {
        isPanning = true
        panStart = { x: e.clientX, y: e.clientY }
      } else if (e.button === 2) {
        isOrbiting = true
        orbitStart = { x: e.clientX, y: e.clientY }
      }
    }
    const onMouseUp = () => { isPanning = false; isOrbiting = false }
    const onPanMove = (e: MouseEvent) => {
      if (isPanning) {
        const scale = currentZoom * 0.002
        const dx = -(e.clientX - panStart.x) * scale
        const dy = (e.clientY - panStart.y) * scale
        // Rotate pan delta by current orbit angle so drag stays consistent
        const cosT = Math.cos(orbitTheta)
        const sinT = Math.sin(orbitTheta)
        panOffset.x = Math.max(-panLimit, Math.min(panLimit, panOffset.x + dx * cosT))
        panOffset.y = Math.max(-panLimit, Math.min(panLimit, panOffset.y + dy))
        panStart = { x: e.clientX, y: e.clientY }
      }
      if (isOrbiting) {
        targetTheta -= (e.clientX - orbitStart.x) * 0.004
        targetPhi = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, targetPhi + (e.clientY - orbitStart.y) * 0.004))
        orbitStart = { x: e.clientX, y: e.clientY }
      }
    }
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
    }

    window.addEventListener("mousemove", onMouseMove, { passive: true })
    window.addEventListener("mousemove", onPanMove, { passive: true })
    window.addEventListener("click", onClick)
    container.addEventListener("wheel", onWheel, { passive: false })
    container.addEventListener("mousedown", onMouseDown)
    container.addEventListener("contextmenu", onContextMenu)
    window.addEventListener("mouseup", onMouseUp)

    // ── Edges ──
    const edgeCount = edgeList.length
    const eSrc = new Uint16Array(edgeCount)
    const eTgt = new Uint16Array(edgeCount)
    for (let i = 0; i < edgeCount; i++) {
      eSrc[i] = edgeList[i].sourceIdx
      eTgt[i] = edgeList[i].targetIdx
    }
    const edgePositions = new Float32Array(edgeCount * 6)
    const edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3))
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.18 })
    scene.add(new THREE.LineSegments(edgeGeo, edgeMat))

    // ── Nodes ──
    const nodePositions = new Float32Array(count * 3)
    const basePos = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const phases = new Float32Array(count)
    const driftOff = new Float32Array(count)
    const driftSpd = new Float32Array(count)
    const depthArr = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      const d = data.nodes[i].depth
      const x = positions[i * 2]
      const y = positions[i * 2 + 1]
      const z = -300 + d * 500
      const i3 = i * 3
      nodePositions[i3] = x
      nodePositions[i3 + 1] = y
      nodePositions[i3 + 2] = z
      basePos[i3] = x
      basePos[i3 + 1] = y
      basePos[i3 + 2] = z
      sizes[i] = 20 + d * 35
      phases[i] = i * 2.39996
      driftOff[i] = i * 1.618
      driftSpd[i] = 0.6 + (((i * 7) % 11) / 11) * 0.8
      depthArr[i] = d
    }

    const nodeGeo = new THREE.BufferGeometry()
    nodeGeo.setAttribute("position", new THREE.BufferAttribute(nodePositions, 3))
    nodeGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1))
    nodeGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1))
    nodeGeo.setAttribute("aFade", new THREE.BufferAttribute(fadeCurrent, 1))

    const nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uRippleOrigin: { value: new THREE.Vector2(0, 0) },
        uRippleTime: { value: -100.0 },
      },
      vertexShader: `
        attribute float aSize, aPhase, aFade;
        uniform float uTime;
        uniform vec2 uMouse, uRippleOrigin;
        uniform float uRippleTime;
        varying float vPulse, vMouseProx, vDepth, vFade;

        void main() {
          float pulse = 0.85 + 0.15 * sin(uTime * 0.6 + aPhase);
          float dm = distance(position.xy, uMouse);
          float mg = smoothstep(300.0, 0.0, dm);
          vMouseProx = mg;
          pulse += mg * 0.7;

          if (uRippleTime >= 0.0 && uRippleTime < 4.0) {
            float dr = distance(position.xy, uRippleOrigin);
            pulse += smoothstep(80.0, 0.0, abs(dr - uRippleTime * 500.0)) * exp(-uRippleTime) * 1.5;
          }

          vPulse = clamp(pulse, 0.0, 1.4);
          vFade = aFade;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = smoothstep(-1400.0, -700.0, mv.z);
          gl_PointSize = aSize * (0.85 + vPulse * 0.3) * (500.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vPulse, vMouseProx, vDepth, vFade;

        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float core = exp(-d * 30.0);
          float a = (exp(-d * 2.5) * 0.06 + exp(-d * 5.0) * 0.18 + exp(-d * 12.0) * 0.5 + core) * vPulse * vDepth * vFade;
          vec3 col = mix(vec3(0.6, 0.63, 0.7), vec3(0.95, 0.92, 0.88), core);
          col = mix(col, vec3(1.0, 0.98, 0.96), vMouseProx * 0.5);
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    scene.add(new THREE.Points(nodeGeo, nodeMat))

    // ── Signal particles ──
    const sigCount = Math.min(edgeCount * 2, 60)
    const sigPos = new Float32Array(sigCount * 3)
    const sigEdge = new Uint16Array(sigCount)
    const sigPhase = new Float32Array(sigCount)
    const sigSpeed = new Float32Array(sigCount)
    for (let i = 0; i < sigCount; i++) {
      sigEdge[i] = Math.floor(Math.random() * Math.max(edgeCount, 1))
      sigPhase[i] = Math.random()
      sigSpeed[i] = 0.15 + Math.random() * 0.25
    }
    const sigGeo = new THREE.BufferGeometry()
    sigGeo.setAttribute("position", new THREE.BufferAttribute(sigPos, 3))
    const sigMat = new THREE.PointsMaterial({
      color: 0x999999, size: 2, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    })
    if (edgeCount > 0) scene.add(new THREE.Points(sigGeo, sigMat))

    // ── Projection helper for hover detection ──
    const projVec = new THREE.Vector3()

    // ── Animation ──
    let frame = 0
    let lastTime = performance.now()
    let frameToggle = false

    const animate = () => {
      frame = requestAnimationFrame(animate)
      const now = performance.now()
      const delta = (now - lastTime) * 0.001
      lastTime = now
      const elapsed = now * 0.001
      const t = elapsed * 0.07

      smoothMouse.x += (mouse.x - smoothMouse.x) * 0.06
      smoothMouse.y += (mouse.y - smoothMouse.y) * 0.06

      nodeMat.uniforms.uTime.value = elapsed
      nodeMat.uniforms.uMouse.value.set(smoothMouse.x, smoothMouse.y)

      if (ripple.time >= 0) {
        ripple.time += delta
        nodeMat.uniforms.uRippleOrigin.value.set(ripple.x, ripple.y)
        nodeMat.uniforms.uRippleTime.value = ripple.time
        if (ripple.time > 5) ripple.time = -100
      }

      // Camera orbit
      // Scale drift with node count — no movement under 5 nodes
      const driftScale = Math.min(Math.max((count - 5) / 10, 0), 1)
      // Smooth zoom
      currentZoom += (targetZ - currentZoom) * 0.1

      // Smooth orbit angles
      orbitTheta += (targetTheta - orbitTheta) * 0.08
      orbitPhi += (targetPhi - orbitPhi) * 0.08

      const driftX = Math.sin(elapsed * 0.015) * 20 * driftScale
      const driftY = Math.cos(elapsed * 0.01) * 15 * driftScale
      camera.position.x = panOffset.x + driftX + currentZoom * Math.sin(orbitTheta) * Math.cos(orbitPhi)
      camera.position.y = panOffset.y + driftY + currentZoom * Math.sin(orbitPhi)
      camera.position.z = currentZoom * Math.cos(orbitTheta) * Math.cos(orbitPhi)
      camera.lookAt(panOffset.x, panOffset.y, 0)

      const mPX = (smoothMouse.x / 800) * -10
      const mPY = (smoothMouse.y / 800) * -10

      // Update node positions (drift)
      for (let i = 0; i < count; i++) {
        const off = driftOff[i], spd = driftSpd[i], d = depthArr[i]
        const i3 = i * 3
        nodePositions[i3] = basePos[i3]
        nodePositions[i3 + 1] = basePos[i3 + 1]
        nodePositions[i3 + 2] = basePos[i3 + 2]
      }
      nodeGeo.attributes.position.needsUpdate = true

      // Hover detection: project nodes to screen, find closest to cursor
      let closest = -1
      let closestDist = 25 // threshold in pixels
      const rect = container.getBoundingClientRect()
      for (let i = 0; i < count; i++) {
        const i3 = i * 3
        projVec.set(nodePositions[i3], nodePositions[i3 + 1], nodePositions[i3 + 2])
        projVec.project(camera)
        const sx = (projVec.x * 0.5 + 0.5) * rect.width + rect.left
        const sy = (-projVec.y * 0.5 + 0.5) * rect.height + rect.top
        const dist = Math.hypot(sx - mouse.screenX, sy - mouse.screenY)
        if (dist < closestDist) {
          closestDist = dist
          closest = i
        }
      }

      // Update hover fade targets
      if (closest !== currentHovered) {
        currentHovered = closest
        if (closest >= 0) {
          const nbs = neighbors.get(closest) ?? new Set()
          for (let i = 0; i < count; i++) {
            fadeTarget[i] = (i === closest || nbs.has(i)) ? 1.0 : 0.08
          }
          // Show tooltip
          const i3 = closest * 3
          projVec.set(nodePositions[i3], nodePositions[i3 + 1], nodePositions[i3 + 2])
          projVec.project(camera)
          const tx = (projVec.x * 0.5 + 0.5) * rect.width
          const ty = (-projVec.y * 0.5 + 0.5) * rect.height
          tooltip.style.left = `${tx}px`
          tooltip.style.top = `${ty - 24}px`
          tooltip.style.opacity = "1"
          tooltip.textContent = data.nodes[closest].title
          container.style.cursor = "pointer"
        } else {
          for (let i = 0; i < count; i++) fadeTarget[i] = 1.0
          tooltip.style.opacity = "0"
          container.style.cursor = "default"
        }
      }

      // Lerp fade values
      for (let i = 0; i < count; i++) {
        fadeCurrent[i] += (fadeTarget[i] - fadeCurrent[i]) * Math.min(delta * 6, 1) // ~400ms
      }
      nodeGeo.attributes.aFade.needsUpdate = true

      // Update edges
      frameToggle = !frameToggle
      if (frameToggle && edgeCount > 0) {
        for (let e = 0; e < edgeCount; e++) {
          const s3 = eSrc[e] * 3, t3 = eTgt[e] * 3, o = e * 6
          edgePositions[o] = nodePositions[s3]
          edgePositions[o + 1] = nodePositions[s3 + 1]
          edgePositions[o + 2] = nodePositions[s3 + 2]
          edgePositions[o + 3] = nodePositions[t3]
          edgePositions[o + 4] = nodePositions[t3 + 1]
          edgePositions[o + 5] = nodePositions[t3 + 2]
        }
        edgeGeo.attributes.position.needsUpdate = true
      }

      // Update signal particles
      if (edgeCount > 0) {
        for (let i = 0; i < sigCount; i++) {
          sigPhase[i] += delta * sigSpeed[i]
          if (sigPhase[i] > 1) {
            sigPhase[i] = 0
            sigEdge[i] = Math.floor(Math.random() * edgeCount)
          }
          const s3 = eSrc[sigEdge[i]] * 3, t3 = eTgt[sigEdge[i]] * 3
          const p = sigPhase[i], i3 = i * 3
          sigPos[i3] = nodePositions[s3] + (nodePositions[t3] - nodePositions[s3]) * p
          sigPos[i3 + 1] = nodePositions[s3 + 1] + (nodePositions[t3 + 1] - nodePositions[s3 + 1]) * p
          sigPos[i3 + 2] = nodePositions[s3 + 2] + (nodePositions[t3 + 2] - nodePositions[s3 + 2]) * p
        }
        sigGeo.attributes.position.needsUpdate = true
      }

      edgeMat.opacity = 0.14 + Math.sin(elapsed * 0.5) * 0.06
      renderer.render(scene, camera)
    }
    animate()

    // ── Resize ──
    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener("resize", onResize)

    return () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mousemove", onPanMove)
      window.removeEventListener("click", onClick)
      window.removeEventListener("mouseup", onMouseUp)
      container.removeEventListener("wheel", onWheel)
      container.removeEventListener("mousedown", onMouseDown)
      container.removeEventListener("contextmenu", onContextMenu)
      cancelAnimationFrame(frame)
      renderer.dispose()
      edgeGeo.dispose(); edgeMat.dispose()
      nodeGeo.dispose(); nodeMat.dispose()
      sigGeo.dispose(); sigMat.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
    }
  }

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <div
        ref={tooltipRef}
        className="absolute font-heading text-sm text-text-emphasis pointer-events-none transition-opacity duration-150 -translate-x-1/2 whitespace-nowrap"
        style={{ opacity: 0 }}
      />
    </div>
  )
}
