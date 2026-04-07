"use client"

import { useState, useEffect, useRef, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"

const KnowledgeGraph = dynamic(() => import("./KnowledgeGraph"), { ssr: false })

// ═══════════════════════════════════════
// Hooks
// ═══════════════════════════════════════

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return [ref, inView] as const
}

function useMounted(delay = 0) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay)
    return () => clearTimeout(t)
  }, [delay])
  return mounted
}

// ═══════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════

function ScrollSection({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState({ opacity: 0, transform: "translateY(40px)" })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let ticking = false
    const update = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const n = (el.getBoundingClientRect().top + el.clientHeight / 2) / window.innerHeight
        let opacity: number, ty: number
        if (n > 1.2) { opacity = 0; ty = 40 }
        else if (n > 0.8) { const p = (1.2 - n) / 0.4; opacity = p; ty = 40 * (1 - p) }
        else if (n > 0.2) { opacity = 1; ty = 0 }
        else if (n > -0.2) { const p = (n + 0.2) / 0.4; opacity = p; ty = -24 * (1 - p) }
        else { opacity = 0; ty = -24 }
        setStyle({ opacity, transform: `translateY(${ty}px)` })
        ticking = false
      })
    }
    window.addEventListener("scroll", update, { passive: true })
    update()
    return () => window.removeEventListener("scroll", update)
  }, [])

  return (
    <div ref={ref} className={className} style={{ ...style, transition: "opacity 0.15s ease-out, transform 0.15s ease-out" }}>
      {children}
    </div>
  )
}

function Reveal({ children, delay = 0, y = 24, duration = 800, className = "" }: {
  children: ReactNode; delay?: number; y?: number; duration?: number; className?: string
}) {
  const [ref, inView] = useInView()
  return (
    <div ref={ref} className={className} style={{
      opacity: inView ? 1 : 0,
      transform: inView ? "translateY(0)" : `translateY(${y}px)`,
      transition: `opacity ${duration}ms ease-out ${delay}ms, transform ${duration}ms ease-out ${delay}ms`,
    }}>
      {children}
    </div>
  )
}

function AmbientParticles() {
  const driftClasses = ["animate-drift-0", "animate-drift-1", "animate-drift-2"]
  return (
    <div className="fixed inset-0 z-[1] pointer-events-none overflow-hidden">
      {Array.from({ length: 24 }, (_, i) => (
        <div key={i} className={`absolute rounded-full bg-text-primary ${driftClasses[i % 3]}`} style={{
          width: 1 + (i % 3), height: 1 + (i % 3),
          left: `${(i * 41 + 7) % 100}%`, top: `${(i * 67 + 13) % 100}%`,
          opacity: 0.04 + (i % 5) * 0.015, animationDelay: `${i * -2.7}s`,
        }} />
      ))}
    </div>
  )
}

// ═══════════════════════════════════════
// Page
// ═══════════════════════════════════════

export default function LandingPage() {
  const [graphOpacity, setGraphOpacity] = useState(0)
  const [heroFade, setHeroFade] = useState(1)
  const [showNav, setShowNav] = useState(false)

  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const vh = window.innerHeight
        const y = window.scrollY
        setShowNav(y > vh * 0.15)
        setHeroFade(Math.max(0, 1 - y / (vh * 0.4)))

        const gFadeIn = vh * 0.35
        const gPeak = vh * 0.6
        const totalHeight = document.documentElement.scrollHeight - vh
        const gFadeOut = totalHeight - vh * 0.8
        const gGone = totalHeight - vh * 0.1

        if (y < gFadeIn) setGraphOpacity(0)
        else if (y < gPeak) setGraphOpacity((y - gFadeIn) / (gPeak - gFadeIn))
        else if (y < gFadeOut) setGraphOpacity(1)
        else if (y < gGone) setGraphOpacity(1 - (y - gFadeOut) / (gGone - gFadeOut))
        else setGraphOpacity(0)

        ticking = false
      })
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <>
      <NavBar visible={showNav} />
      <AmbientParticles />

      <div className="fixed -top-[20vh] -bottom-[20vh] left-0 right-0 z-0 pointer-events-none" style={{
        opacity: graphOpacity,
        transform: `scale(${0.9 + graphOpacity * 0.1})`,
        filter: graphOpacity < 1 ? `blur(${(1 - graphOpacity) * 10}px)` : "none",
      }}>
        <KnowledgeGraph className="w-full h-full" />
      </div>

      <div className="relative z-10">
        <div style={{
          opacity: heroFade,
          transform: `translateY(${(1 - heroFade) * -30}px)`,
          transition: "opacity 0.1s, transform 0.1s",
        }}>
          <HeroSection />
        </div>
        <GraphOverlay />
        <FeedSection />
        <AskSection />
        <PulseSection />
        <MultiEngramSection />
        <AntiFeatureSection />
        <CloseSection />
        <Footer />
      </div>
    </>
  )
}

// ═══════════════════════════════════════
// Sections
// ═══════════════════════════════════════

function NavBar({ visible }: { visible: boolean }) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 px-8 py-5 flex items-center justify-between" style={{
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? "auto" : "none",
      transition: "opacity 600ms ease-out",
    }}>
      <Link href="/" className="font-heading text-sm text-text-secondary hover:text-text-emphasis transition-colors duration-120">engrams</Link>
      <Link href="/login" className="text-sm text-text-tertiary hover:text-text-emphasis transition-colors duration-120">Sign in</Link>
    </div>
  )
}

function HeroSection() {
  const heading = useMounted(200)
  const subtitle = useMounted(800)
  return (
    <section className="flex flex-col items-center justify-center px-6 pt-[34vh] pb-[8vh]">
      <h1 className="font-heading text-center" style={{
        fontSize: "clamp(3rem, 8vw, 7rem)",
        opacity: heading ? 1 : 0,
        transform: heading ? "translateY(0)" : "translateY(16px)",
        transition: "opacity 2s ease-out, transform 2s ease-out",
        background: "radial-gradient(ellipse at center, #F0F0F0 0%, #888 55%, #555 100%)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        animation: heading ? "gradient-pulse 6s ease-in-out infinite" : "none",
      }}>
        Your knowledge, compiled.
      </h1>
      <p className="mt-6 text-text-secondary text-lg md:text-xl text-center max-w-md" style={{
        opacity: subtitle ? 1 : 0,
        transform: subtitle ? "translateY(0)" : "translateY(12px)",
        transition: "opacity 1.5s ease-out, transform 1.5s ease-out",
      }}>
        Feed it anything. Ask it everything. It evolves.
      </p>
    </section>
  )
}

function GraphOverlay() {
  return (
    <ScrollSection className="min-h-[100vh] flex items-center justify-center px-6">
      <div className="max-w-[580px] text-center">
        <Reveal duration={1200}>
          <p className="font-heading text-2xl md:text-3xl text-text-emphasis leading-relaxed">
            You don&apos;t organize it. You don&apos;t maintain it.
          </p>
        </Reveal>
        <Reveal delay={300} duration={1200}>
          <p className="mt-5 text-lg text-text-secondary leading-relaxed">
            You feed it sources and ask it questions. The rest happens on its own.
          </p>
        </Reveal>
      </div>
    </ScrollSection>
  )
}

const DEMO_URL = "https://arxiv.org/abs/2312.07413"
const DEMO_ARTICLES = [
  { title: "The Perceptron and the Birth of Neural Networks", summary: "Early attempts at machine learning drew from neuroscience models of cognition.", confidence: 0.92 },
  { title: "Symbolic vs. Connectionist AI", summary: "The fundamental debate that shaped decades of artificial intelligence research.", confidence: 0.87 },
  { title: "Backpropagation and the Deep Learning Revolution", summary: "How a simple calculus trick, once dismissed, transformed an entire field.", confidence: 0.91 },
  { title: "The Transformer Architecture", summary: "Attention mechanisms replaced recurrence and changed sequence processing.", confidence: 0.95 },
  { title: "Emergent Capabilities in Large Language Models", summary: "Unexpected behaviors arise when models reach sufficient scale.", confidence: 0.78 },
]

function FeedSection() {
  const [triggerRef, inView] = useInView(0.05)
  const [typedUrl, setTypedUrl] = useState("")
  const [showCards, setShowCards] = useState(false)

  useEffect(() => {
    if (!inView) { setTypedUrl(""); setShowCards(false); return }
    let i = 0
    const timer = setInterval(() => {
      i++
      if (i > DEMO_URL.length) {
        clearInterval(timer)
        setTimeout(() => setShowCards(true), 500)
        return
      }
      setTypedUrl(DEMO_URL.slice(0, i))
    }, 38)
    return () => clearInterval(timer)
  }, [inView])

  return (
    <div ref={triggerRef}>
      <ScrollSection className="flex items-center justify-center px-6 py-44">
        <div className="w-full max-w-4xl">
          <div className="max-w-xl mx-auto">
            <div className="border border-border-emphasis bg-surface px-5 py-3.5 font-mono text-sm text-text-primary">
              {typedUrl}
              <span className="animate-blink text-text-tertiary">{inView ? "|" : ""}</span>
            </div>
            <div className="flex justify-center mt-3" style={{
              opacity: typedUrl.length > 0 ? 1 : 0,
              transition: "opacity 500ms ease-out",
            }}>
              <div className="h-px bg-gradient-to-r from-transparent via-text-tertiary to-transparent"
                style={{ animation: "line-pulse 2s ease-in-out infinite" }} />
            </div>
          </div>

          <div className="mt-6 max-w-xl mx-auto space-y-1">
            <Reveal><p className="text-text-secondary text-sm">Drop a PDF. Paste a URL. Forward an email.</p></Reveal>
            <Reveal delay={100}>
              <p className="text-text-secondary text-sm">
                Connect <span className="text-text-emphasis">GitHub</span>. Sync{" "}
                <span className="text-text-emphasis">Notion</span>. Subscribe to{" "}
                <span className="text-text-emphasis">RSS</span>.
              </p>
            </Reveal>
            <Reveal delay={200}><p className="text-text-secondary text-sm">It compiles while you sleep.</p></Reveal>
          </div>

          <div className="mt-8 grid gap-3 max-w-xl mx-auto">
            {DEMO_ARTICLES.map((a, i) => (
              <div key={i} className="border border-border bg-surface p-4 flex items-start gap-3" style={{
                opacity: showCards ? 1 : 0,
                transform: showCards ? "translateY(0) scale(1)" : "translateY(28px) scale(0.97)",
                transition: `all 700ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 150}ms`,
              }}>
                <div className="w-2 h-2 mt-1.5 shrink-0" style={{
                  backgroundColor: a.confidence > 0.9 ? "var(--color-confidence-high)"
                    : a.confidence > 0.8 ? "var(--color-confidence-mid)" : "var(--color-confidence-low)",
                }} />
                <div>
                  <h3 className="font-heading text-text-emphasis text-sm">{a.title}</h3>
                  <p className="mt-0.5 text-xs text-text-tertiary leading-relaxed">{a.summary}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </ScrollSection>
    </div>
  )
}

const DEMO_QUERY = "What are the key disagreements between symbolic and connectionist approaches to AI?"

function AskSection() {
  const [triggerRef, inView] = useInView(0.05)
  const [typedQuery, setTypedQuery] = useState("")
  const [showAnswer, setShowAnswer] = useState(false)
  const [showFiled, setShowFiled] = useState(false)

  useEffect(() => {
    if (!inView) { setTypedQuery(""); setShowAnswer(false); setShowFiled(false); return }
    let i = 0
    const timer = setInterval(() => {
      i++
      if (i > DEMO_QUERY.length) {
        clearInterval(timer)
        setTimeout(() => setShowAnswer(true), 300)
        setTimeout(() => setShowFiled(true), 1000)
        return
      }
      setTypedQuery(DEMO_QUERY.slice(0, i))
    }, 12)
    return () => clearInterval(timer)
  }, [inView])

  return (
    <div ref={triggerRef}>
      <ScrollSection className="flex items-center justify-center px-6 py-44">
        <div className="w-full max-w-[660px]">
          <div className="border border-border-emphasis bg-surface px-5 py-3.5 text-text-primary text-sm">
            {typedQuery}
            {inView && typedQuery.length < DEMO_QUERY.length && (
              <span className="animate-blink text-text-tertiary">|</span>
            )}
          </div>

          <div style={{
            opacity: showAnswer ? 1 : 0,
            transform: showAnswer ? "translateY(0)" : "translateY(12px)",
            transition: "all 400ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}>
            <div className="mt-12 space-y-5 leading-[1.7] text-[15px] border-l border-border pl-5">
              <p className="text-text-primary">
                The symbolic-connectionist debate represents the deepest fault line in AI research.{" "}
                <span className="text-text-secondary hover:text-text-emphasis transition-colors duration-120 border-b border-border cursor-pointer">Symbolic AI</span>{" "}
                treats intelligence as the manipulation of discrete symbols according to explicit rules &mdash;
                programs that reason through logic, search, and knowledge representation.{" "}
                <span className="text-text-secondary hover:text-text-emphasis transition-colors duration-120 border-b border-border cursor-pointer">Connectionist approaches</span>{" "}
                treat intelligence as an emergent property of distributed numerical computation &mdash;
                networks that learn patterns from data without explicit programming.
              </p>
              <p className="text-text-primary">
                The core disagreements center on three axes: whether knowledge should be{" "}
                <em className="text-text-emphasis not-italic">explicit</em> or <em className="text-text-emphasis not-italic">implicit</em>;
                whether reasoning should be <em className="text-text-emphasis not-italic">compositional</em> or <em className="text-text-emphasis not-italic">holistic</em>;
                and whether learning should be <em className="text-text-emphasis not-italic">structured</em> or <em className="text-text-emphasis not-italic">tabula rasa</em>.
              </p>
            </div>

            <div className="mt-8 flex items-center gap-3" style={{
              opacity: showFiled ? 1 : 0, transition: "opacity 350ms ease-out",
            }}>
              <div className="h-px flex-1 bg-border" />
              <span className="font-mono text-[10px] text-text-tertiary tracking-widest uppercase">Filed back as article</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </div>

          <div className="mt-24 text-center" style={{
            opacity: showFiled ? 1 : 0,
            transform: showFiled ? "translateY(0)" : "translateY(10px)",
            transition: "opacity 500ms ease-out 200ms, transform 500ms ease-out 200ms",
          }}>
            <p className="font-heading text-2xl md:text-3xl text-text-emphasis">Every question compounds the knowledge.</p>
          </div>
        </div>
      </ScrollSection>
    </div>
  )
}

const TIMELINE_EVENTS = [
  "Fed 3 sources",
  "Compiled 12 articles",
  "Linted: 2 gaps found",
  "Freshened: updated 4 stale articles",
  "Discovered: 3 new connections suggested",
]

function PulseSection() {
  return (
    <ScrollSection className="flex items-center px-6 py-44">
      <div className="w-full max-w-5xl mx-auto flex flex-col md:flex-row gap-20 md:gap-28">
        <div className="flex-1 flex gap-4">
          <div className="flex flex-col items-center shrink-0 -my-8">
            <div className="flex-1 w-px" style={{
              background: "linear-gradient(to bottom, transparent, #333 10%, #333 90%, transparent)",
            }} />
          </div>
          <div className="space-y-10 -ml-[20px]">
            {TIMELINE_EVENTS.map((event, i) => (
              <Reveal key={i} delay={i * 140} y={14}>
                <div className="flex items-start gap-4">
                  <div className="w-[7px] h-[7px] mt-[6px] shrink-0 bg-text-tertiary animate-pulse-dot"
                    style={{ animationDelay: `${i * 600}ms` }} />
                  <p className="font-mono text-sm text-text-secondary">{event}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-5">
          <Reveal duration={1000}>
            <p className="font-heading text-2xl md:text-3xl text-text-emphasis">It tends itself.</p>
          </Reveal>
          <Reveal delay={180}>
            <p className="text-text-secondary leading-relaxed">Finds gaps. Refreshes stale knowledge. Discovers connections you missed.</p>
          </Reveal>
          <Reveal delay={360}>
            <p className="text-text-secondary leading-relaxed">Your engram grows whether you&apos;re using it or not.</p>
          </Reveal>
        </div>
      </div>
    </ScrollSection>
  )
}

const ENGRAM_DOTS = [
  { color: "#7A8F76", name: "Coffee" },
  { color: "#76808F", name: "Startup" },
  { color: "#8F767A", name: "Philosophy" },
]

function MultiEngramSection() {
  return (
    <ScrollSection className="flex items-center justify-center px-6 py-44">
      <div className="text-center max-w-lg">
        <Reveal>
          <div className="flex items-center justify-center gap-10 mb-12">
            {ENGRAM_DOTS.map((e, i) => (
              <div key={i} className="flex flex-col items-center gap-3">
                <div className="w-3 h-3 rounded-full animate-pulse-dot"
                  style={{ backgroundColor: e.color, animationDelay: `${i * 400}ms` }} />
                <span className="font-mono text-xs text-text-tertiary">{e.name}</span>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={250} duration={1000}>
          <p className="text-text-secondary italic text-lg">&ldquo;What in my research is relevant to the product roadmap?&rdquo;</p>
        </Reveal>
        <Reveal delay={500} duration={1000}>
          <p className="mt-10 text-text-primary text-lg">Engrams don&apos;t just hold knowledge. They cross-pollinate.</p>
        </Reveal>
      </div>
    </ScrollSection>
  )
}

const MANIFESTO = [
  "You never create a page.",
  "You never drag something into a folder.",
  "You never write a tag.",
  "You never maintain a link.",
  "You never organize anything.",
]

function AntiFeatureSection() {
  return (
    <ScrollSection className="flex items-center justify-center px-6 py-44">
      <div className="text-center space-y-5">
        {MANIFESTO.map((line, i) => (
          <Reveal key={i} delay={i * 120} y={16} duration={900}>
            <p className="font-heading text-xl md:text-2xl lg:text-3xl text-text-secondary">{line}</p>
          </Reveal>
        ))}
        <div className="h-6" />
        <Reveal delay={MANIFESTO.length * 120 + 200} duration={1200}>
          <p className="font-heading text-xl md:text-2xl lg:text-3xl text-text-bright">The system does all of it.</p>
        </Reveal>
      </div>
    </ScrollSection>
  )
}

function CloseSection() {
  const router = useRouter()
  const [engramName, setEngramName] = useState("")

  const handleBegin = () => {
    const name = engramName.trim()
    if (name) {
      router.push(`/signup?engram=${encodeURIComponent(name)}`)
    } else {
      router.push("/signup")
    }
  }

  return (
    <ScrollSection className="min-h-dvh flex flex-col items-center justify-center px-6">
      <Reveal duration={1400}>
        <h2 className="font-heading text-text-emphasis text-center" style={{ fontSize: "clamp(2.5rem, 6vw, 5rem)" }}>
          Form your first engram.
        </h2>
      </Reveal>
      <Reveal delay={400} duration={1000}>
        <div className="mt-14 flex flex-col sm:flex-row gap-3 w-full max-w-sm">
          <input
            type="text"
            value={engramName}
            onChange={(e) => setEngramName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleBegin() }}
            placeholder="Name your engram"
            className="flex-1 bg-surface border border-border-emphasis px-4 py-3 text-sm text-text-primary placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms]"
          />
          <button
            onClick={handleBegin}
            className="bg-text-primary text-void px-6 py-3 text-sm font-medium cursor-pointer hover:bg-text-emphasis hover:scale-[1.02] active:scale-[0.98] transition-all duration-120"
          >
            Begin
          </button>
        </div>
      </Reveal>
    </ScrollSection>
  )
}

function Footer() {
  return (
    <footer className="py-20 flex justify-center gap-8 text-xs text-text-ghost">
      <Link href="/signup" className="hover:text-text-tertiary transition-colors duration-120">Get started</Link>
      <Link href="/login" className="hover:text-text-tertiary transition-colors duration-120">Sign in</Link>
      {["Pricing", "Docs", "GitHub", "Twitter"].map((link) => (
        <span key={link} className="cursor-pointer hover:text-text-tertiary transition-colors duration-120">{link}</span>
      ))}
    </footer>
  )
}
