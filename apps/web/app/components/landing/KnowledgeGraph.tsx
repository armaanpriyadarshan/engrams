"use client"

import { useRef, useEffect } from "react"
import * as THREE from "three"
import { graphData } from "./graph-data"

export default function KnowledgeGraph({ className = "" }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cleanup: (() => void) | undefined
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0 && !cleanup) {
        cleanup = setup(container, width, height)
        observer.disconnect()
      }
    })
    observer.observe(container)
    return () => { observer.disconnect(); cleanup?.() }
  }, [])

  function setup(container: HTMLDivElement, initW: number, initH: number) {
    // ── Scene ──
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, initW / initH, 1, 3000)
    camera.position.set(0, 0, 900)

    const renderer = new THREE.WebGLRenderer({ alpha: true, powerPreference: "high-performance" })
    renderer.setSize(initW, initH)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    container.appendChild(renderer.domElement)

    // ── Mouse state ──
    const mouse = { x: 0, y: 0 }
    const smoothMouse = { x: 0, y: 0 }
    const ripple = { x: 0, y: 0, time: -100 }
    const unprojVec = new THREE.Vector3()

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
      mouse.x = w.x
      mouse.y = w.y
    }
    const onClick = (e: MouseEvent) => {
      const w = screenToWorld(e.clientX, e.clientY)
      ripple.x = w.x
      ripple.y = w.y
      ripple.time = 0
    }
    window.addEventListener("mousemove", onMouseMove, { passive: true })
    window.addEventListener("click", onClick)

    // ── Edges ──
    let edgeCount = 0
    for (const edge of graphData.edges) {
      if (edge.source < graphData.nodes.length && edge.target < graphData.nodes.length) edgeCount++
    }
    const eSrc = new Uint16Array(edgeCount)
    const eTgt = new Uint16Array(edgeCount)
    let ei = 0
    for (const edge of graphData.edges) {
      if (edge.source < graphData.nodes.length && edge.target < graphData.nodes.length) {
        eSrc[ei] = edge.source
        eTgt[ei] = edge.target
        ei++
      }
    }
    const edgePositions = new Float32Array(edgeCount * 6)
    const edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3))
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.18 })
    scene.add(new THREE.LineSegments(edgeGeo, edgeMat))

    // ── Nodes ──
    const count = graphData.nodes.length
    const positions = new Float32Array(count * 3)
    const basePos = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const phases = new Float32Array(count)
    const driftOff = new Float32Array(count)
    const driftSpd = new Float32Array(count)
    const depth = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      const n = graphData.nodes[i]
      const d = n.size
      const z = -400 + d * 600
      const i3 = i * 3
      positions[i3] = n.x
      positions[i3 + 1] = n.y
      positions[i3 + 2] = z
      basePos[i3] = n.x
      basePos[i3 + 1] = n.y
      basePos[i3 + 2] = z
      sizes[i] = 2.5 + d * 12
      phases[i] = i * 2.39996
      driftOff[i] = i * 1.618
      driftSpd[i] = 0.6 + (((i * 7) % 11) / 11) * 0.8
      depth[i] = d
    }

    const nodeGeo = new THREE.BufferGeometry()
    nodeGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    nodeGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1))
    nodeGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1))

    const nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uRippleOrigin: { value: new THREE.Vector2(0, 0) },
        uRippleTime: { value: -100.0 },
      },
      vertexShader: `
        attribute float aSize, aPhase;
        uniform float uTime;
        uniform vec2 uMouse, uRippleOrigin;
        uniform float uRippleTime;
        varying float vPulse, vMouseProx, vDepth;

        void main() {
          float pulse = 0.5 + 0.5 * sin(uTime * 0.6 + aPhase);

          float dm = distance(position.xy, uMouse);
          float mg = smoothstep(300.0, 0.0, dm);
          vMouseProx = mg;
          pulse += mg * 0.7;

          if (uRippleTime >= 0.0 && uRippleTime < 4.0) {
            float dr = distance(position.xy, uRippleOrigin);
            pulse += smoothstep(80.0, 0.0, abs(dr - uRippleTime * 500.0)) * exp(-uRippleTime) * 1.5;
          }

          vPulse = clamp(pulse, 0.0, 2.5);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = smoothstep(-1400.0, -700.0, mv.z);
          gl_PointSize = aSize * (0.6 + vPulse * 0.7) * (500.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vPulse, vMouseProx, vDepth;

        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float core = exp(-d * 30.0);
          float a = (exp(-d * 2.5) * 0.06 + exp(-d * 5.0) * 0.18 + exp(-d * 12.0) * 0.5 + core) * vPulse * vDepth;
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
    const sigCount = 60
    const sigPos = new Float32Array(sigCount * 3)
    const sigEdge = new Uint16Array(sigCount)
    const sigPhase = new Float32Array(sigCount)
    const sigSpeed = new Float32Array(sigCount)
    for (let i = 0; i < sigCount; i++) {
      sigEdge[i] = Math.floor(Math.random() * edgeCount)
      sigPhase[i] = Math.random()
      sigSpeed[i] = 0.15 + Math.random() * 0.25
    }
    const sigGeo = new THREE.BufferGeometry()
    sigGeo.setAttribute("position", new THREE.BufferAttribute(sigPos, 3))
    const sigMat = new THREE.PointsMaterial({
      color: 0xcccccc,
      size: 2.5,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
    scene.add(new THREE.Points(sigGeo, sigMat))

    // ── Animation loop ──
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
      camera.position.x = Math.sin(elapsed * 0.025) * 80 + (smoothMouse.x / 800) * -30
      camera.position.y = Math.cos(elapsed * 0.018) * 50 + (smoothMouse.y / 800) * -20
      camera.position.z = 900 + Math.sin(elapsed * 0.01) * 30
      camera.lookAt(0, 0, -100)

      const mPX = (smoothMouse.x / 800) * -15
      const mPY = (smoothMouse.y / 800) * -15
      const sY = window.scrollY

      // Update node positions
      for (let i = 0; i < count; i++) {
        const off = driftOff[i], spd = driftSpd[i], d = depth[i]
        const i3 = i * 3
        positions[i3] = basePos[i3]
          + Math.sin(t * spd + off) * 8 + Math.sin(t * 0.14 + off * 0.7) * 4
          + mPX * (0.3 + d * 0.7)
        positions[i3 + 1] = basePos[i3 + 1]
          + Math.cos(t * 0.85 * spd + off * 0.6) * 8 + Math.cos(t * 0.11 + off * 1.1) * 4
          + mPY * (0.3 + d * 0.7)
          - sY * (0.01 + d * 0.03)
        positions[i3 + 2] = basePos[i3 + 2] + Math.sin(t * 0.3 + off * 1.5) * 40
      }
      nodeGeo.attributes.position.needsUpdate = true

      // Update edges (every other frame)
      frameToggle = !frameToggle
      if (frameToggle) {
        for (let e = 0; e < edgeCount; e++) {
          const s3 = eSrc[e] * 3, t3 = eTgt[e] * 3, o = e * 6
          edgePositions[o] = positions[s3]
          edgePositions[o + 1] = positions[s3 + 1]
          edgePositions[o + 2] = positions[s3 + 2]
          edgePositions[o + 3] = positions[t3]
          edgePositions[o + 4] = positions[t3 + 1]
          edgePositions[o + 5] = positions[t3 + 2]
        }
        edgeGeo.attributes.position.needsUpdate = true
      }

      // Update signal particles
      for (let i = 0; i < sigCount; i++) {
        sigPhase[i] += delta * sigSpeed[i]
        if (sigPhase[i] > 1) {
          sigPhase[i] = 0
          sigEdge[i] = Math.floor(Math.random() * edgeCount)
        }
        const s3 = eSrc[sigEdge[i]] * 3, t3 = eTgt[sigEdge[i]] * 3
        const p = sigPhase[i], i3 = i * 3
        sigPos[i3] = positions[s3] + (positions[t3] - positions[s3]) * p
        sigPos[i3 + 1] = positions[s3 + 1] + (positions[t3 + 1] - positions[s3 + 1]) * p
        sigPos[i3 + 2] = positions[s3 + 2] + (positions[t3 + 2] - positions[s3 + 2]) * p
      }
      sigGeo.attributes.position.needsUpdate = true

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

    // ── Cleanup ──
    return () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("click", onClick)
      cancelAnimationFrame(frame)
      renderer.dispose()
      edgeGeo.dispose(); edgeMat.dispose()
      nodeGeo.dispose(); nodeMat.dispose()
      sigGeo.dispose(); sigMat.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
    }
  }

  return <div ref={containerRef} className={className} />
}
