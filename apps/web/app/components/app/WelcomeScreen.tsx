"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import CreateEngramForm from "./CreateEngramForm"

const COFFEE_SOURCES = [
  {
    type: "text",
    title: "Coffee processing methods",
    content: `Coffee processing refers to the methods used to remove the outer fruit from the coffee cherry to reveal the green coffee bean inside. The three primary methods are washed (wet), natural (dry), and honey (semi-washed). Washed coffees tend to have cleaner, brighter acidity and allow terroir to shine through. Natural processed coffees develop heavier body and fruit-forward sweetness as the bean ferments inside the cherry. Honey processing sits between the two, leaving varying amounts of mucilage on the bean during drying, creating a spectrum from white honey (least mucilage) to black honey (most). Each method dramatically affects the final cup profile. More recent innovations include anaerobic fermentation, where cherries ferment in sealed tanks without oxygen, producing intense fruit and wine-like notes. Carbonic maceration, borrowed from winemaking, has also entered specialty coffee processing in the last decade.`,
  },
  {
    type: "text",
    title: "Espresso extraction fundamentals",
    content: `Espresso extraction is governed by several interdependent variables: dose (typically 18-20g), yield (usually 36-40g for a double), grind size, water temperature (usually 90-96°C), and pressure (9 bars standard). The extraction percentage—how much of the coffee's soluble material dissolves into the water—ideally falls between 18-22%. Under-extraction produces sour, thin shots while over-extraction yields bitter, astringent cups. The concept of the extraction curve shows that acids extract first, then sugars and sweetness, then bitter compounds. Channeling—where water finds paths of least resistance through the puck—is the most common extraction flaw and is combated through proper distribution and tamping technique. Pressure profiling on machines like the Decent or Slayer allows baristas to vary pressure during the shot, opening up a wider flavor range than fixed-pressure machines.`,
  },
  {
    type: "text",
    title: "Third wave coffee movement",
    content: `The third wave coffee movement treats coffee as an artisanal food rather than a commodity. It emphasizes single-origin sourcing, direct trade relationships with farmers, lighter roast profiles that preserve origin character, and precise brewing methods. Key figures include the founders of Intelligentsia, Counter Culture, and Stumptown in the early 2000s. The movement introduced concepts like cupping scores (specialty coffee scores 80+ on a 100-point scale), traceability to specific farms and lots, and seasonal offerings. It shifted consumer attention from blends to single origins and from dark roasts to lighter profiles that highlight a coffee's unique terroir—its altitude, varietal, soil, and microclimate. The Specialty Coffee Association (SCA) codified much of the third wave's standards, including the cupping protocol used worldwide.`,
  },
  {
    type: "text",
    title: "Coffee varietals and genetics",
    content: `Nearly all commercial coffee comes from two species: Coffea arabica and Coffea canephora (commonly called robusta). Arabica accounts for around 60% of global production and is prized for its cleaner, more nuanced flavor. Within arabica there are dozens of cultivars, including Typica, Bourbon, Caturra, Catuai, Geisha (or Gesha), SL28, Pacamara, and Maragogipe. Geisha, originally from Ethiopia and famously cultivated in Panama at Hacienda La Esmeralda, gained worldwide attention in 2004 when it won the Best of Panama auction with floral, jasmine-like notes that redefined what coffee could taste like. Robusta has higher caffeine content, more body, and more disease resistance, but generally lacks the complexity of arabica. Newer hybrids like Castillo and Centroamericano aim to combine arabica flavor with robusta's resistance to coffee leaf rust.`,
  },
  {
    type: "text",
    title: "Coffee origins and terroir",
    content: `Coffee is grown in the "bean belt" between the Tropics of Cancer and Capricorn. Each origin produces distinctive flavor profiles shaped by altitude, soil, climate, and varietal. Ethiopian coffees, particularly from Yirgacheffe and Sidamo, are known for floral and citrus notes. Kenyan coffees feature bright blackcurrant and tomato acidity. Colombian coffees vary widely but often show balanced sweetness and caramel. Costa Rican and Panamanian coffees emphasize clarity and elegance. Brazilian coffees, the world's largest production by volume, tend toward chocolate, nut, and lower acidity. Indonesian coffees from Sumatra are bold and earthy due to wet-hulled processing. Yemen, considered the birthplace of cultivated coffee, produces wild, complex coffees with wine-like qualities. Altitude correlates strongly with quality—higher elevations slow cherry maturation and develop more complex sugars.`,
  },
  {
    type: "text",
    title: "Roasting fundamentals",
    content: `Coffee roasting transforms green coffee through chemical reactions including the Maillard reaction (browning) and Strecker degradation, developing the hundreds of aromatic compounds that define coffee flavor. Key milestones during a roast include the drying phase (removing moisture), yellowing, first crack (around 196°C / 385°F, when beans audibly pop and expand), and second crack (around 224°C / 435°F). Light roasts are dropped shortly after first crack, preserving more origin character and acidity. Medium roasts develop more body and balance. Dark roasts approach or pass second crack, dominating the cup with roast flavors—caramelization, smoke, and bitterness. Development time ratio (DTR), the time between first crack and end of roast as a percentage of total roast time, is a common metric. Specialty roasters typically aim for 15-25% DTR. Roast curves are tracked with bean temperature probes and software like Cropster or Artisan.`,
  },
  {
    type: "text",
    title: "Brewing methods compared",
    content: `Coffee brewing methods fall into several categories. Immersion brewing—French press, cupping, AeroPress (when used as immersion), siphon—steeps grounds in water for a fixed time, producing fuller-bodied cups with more dissolved solids. Pour over brewing—V60, Chemex, Kalita Wave—uses gravity-fed water through a paper filter, creating cleaner cups that highlight acidity and clarity. Espresso uses pressure to force water through finely-ground coffee, producing concentrated shots with crema. Cold brew steeps coarse grounds in cold water for 12-24 hours, yielding low-acidity, smooth coffee. Each method has its own grind size, ratio, and time recommendations: V60 typically uses a 1:16 ratio with medium-fine grind over 3 minutes; French press uses 1:15 with coarse grind for 4 minutes; espresso uses around 1:2 with fine grind in 25-32 seconds. The choice of paper, metal, or cloth filter also affects extraction and mouthfeel.`,
  },
  {
    type: "text",
    title: "Decaffeination processes",
    content: `Decaffeinated coffee is produced by removing caffeine from green coffee beans before roasting, while attempting to preserve flavor compounds. The four primary methods are: solvent-based using methylene chloride (the most common, sometimes called "European Method"), solvent-based using ethyl acetate (often called "natural" or "sugar cane process" because ethyl acetate is derived from sugar cane molasses in Colombia), Swiss Water Process (a solvent-free method using carbon filters and a green coffee extract that becomes caffeine-saturated), and Mountain Water Process (similar to Swiss Water but conducted in Mexico using glacial water). Carbon dioxide processes also exist, using supercritical CO2 to extract caffeine selectively. Decaf coffee is not entirely caffeine-free—a typical 8oz cup contains 2-15mg of caffeine compared to 80-100mg in regular coffee. Quality decaf has improved dramatically with specialty roasters now offering single-origin decafs that retain much of their varietal character.`,
  },
  {
    type: "text",
    title: "Cupping and sensory evaluation",
    content: `Cupping is the standardized protocol used by coffee professionals to evaluate quality. Developed by the Specialty Coffee Association, it involves grinding samples to a specific coarseness, brewing at 8.25g coffee per 150ml water, breaking the crust at 4 minutes by smelling the released aromatics, then slurping the coffee from a spoon to spread it across the palate. Cuppers score across attributes including fragrance/aroma, flavor, aftertaste, acidity, body, balance, uniformity, clean cup, sweetness, and overall impression. Each is scored 0-10 with 6.0 being "good." Total scores combine these to a 100-point scale, with 80+ qualifying as specialty grade. Common flavor descriptors come from the Coffee Taster's Flavor Wheel, which includes categories like fruity (berry, citrus, dried fruit), floral (jasmine, hibiscus), nutty/cocoa, sweet, spicy, roasted, and others. Q Graders are professionals certified by the Coffee Quality Institute to consistently evaluate coffees using this protocol.`,
  },
]

interface WelcomeScreenProps {
  userId: string
}

export default function WelcomeScreen({ userId }: WelcomeScreenProps) {
  const router = useRouter()
  const [mode, setMode] = useState<"choose" | "blank">("choose")
  const [loadingSample, setLoadingSample] = useState(false)

  const createEngram = async (name: string) => {
    const supabase = createClient()
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    const { data, error } = await supabase
      .from("engrams")
      .insert({ owner_id: userId, name: name.trim(), slug })
      .select("id, slug")
      .single()
    if (error || !data) return null
    return data
  }

  const handleSampleProject = async () => {
    setLoadingSample(true)
    const engram = await createEngram("Coffee")
    if (!engram) { setLoadingSample(false); return }

    const supabase = createClient()

    // Insert sample sources and compile sequentially so each compilation
    // sees the articles from previous ones in its wiki index — this lets the
    // compiler create cross-source edges instead of isolated articles.
    router.push(`/app/${engram.slug}`)
    router.refresh()

    for (const src of COFFEE_SOURCES) {
      const { data: source } = await supabase.from("sources").insert({
        engram_id: engram.id,
        source_type: src.type,
        content_md: src.content,
        title: src.title,
        status: "pending",
      }).select("id").single()

      if (source) {
        await supabase.rpc("increment_source_count", { eid: engram.id })
        await supabase.functions.invoke("compile-source", {
          body: { source_id: source.id },
        })
      }
    }
  }

  return (
    <div className="w-full h-full flex items-center justify-center overflow-y-auto scrollbar-hidden">
      <div className="max-w-lg w-full px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <h1 className="font-heading text-xl text-text-emphasis tracking-tight">Welcome to engrams</h1>
          <p className="mt-2 text-sm text-text-secondary leading-relaxed">
            An engram is a living knowledge organism. Feed it sources, and it compiles them into structured, interlinked knowledge you can browse, query, and visualize.
          </p>
        </div>

        {mode === "choose" && (
          <div className="space-y-6" style={{ animation: "fade-in 200ms ease-out both" }}>
            {/* Sample project */}
            <div>
              <span className="text-[10px] font-mono text-text-ghost tracking-widest uppercase">Start with a sample</span>
              <button
                onClick={handleSampleProject}
                disabled={loadingSample}
                className="mt-2 w-full group border border-border hover:border-border-emphasis bg-surface p-4 text-left transition-all duration-120 cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 mt-1.5 rounded-full shrink-0 bg-confidence-high" />
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm text-text-primary group-hover:text-text-emphasis transition-colors duration-120">
                      {loadingSample ? "Forming..." : "Coffee"}
                    </span>
                    <span className="block text-xs text-text-tertiary mt-1 leading-relaxed">
                      Processing, varietals, origins, roasting, brewing, espresso, decaf, cupping. 9 sources, ready to compile.
                    </span>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-ghost group-hover:text-text-tertiary mt-1 shrink-0 transition-colors duration-120">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </button>
              <p className="mt-2 text-[11px] text-text-ghost">
                The fastest way to see what an engram does. Fully populated with articles, edges, gaps, and snapshots.
              </p>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-border" />
              <span className="text-[10px] font-mono text-text-ghost">or</span>
              <div className="flex-1 border-t border-border" />
            </div>

            {/* Form blank — now opens the full form */}
            <div>
              <span className="text-[10px] font-mono text-text-ghost tracking-widest uppercase">Build your own</span>
              <button
                onClick={() => setMode("blank")}
                className="mt-2 w-full group border border-border hover:border-border-emphasis bg-surface p-4 text-left transition-all duration-120 cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 mt-1.5 rounded-full shrink-0 bg-text-tertiary" />
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm text-text-primary group-hover:text-text-emphasis transition-colors duration-120">
                      Form a new engram
                    </span>
                    <span className="block text-xs text-text-tertiary mt-1 leading-relaxed">
                      Pick a name, color, and optionally feed your first source.
                    </span>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-ghost group-hover:text-text-tertiary mt-1 shrink-0 transition-colors duration-120">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </button>
            </div>

            {/* Quick reference */}
            <div className="mt-10 pt-6 border-t border-border">
              <div className="grid grid-cols-3 gap-4">
                {[
                  { verb: "Feed", desc: "Add sources from anywhere" },
                  { verb: "Compile", desc: "Watch it build your wiki" },
                  { verb: "Ask", desc: "Query your knowledge" },
                ].map((step) => (
                  <div key={step.verb}>
                    <span className="text-xs text-text-primary">{step.verb}</span>
                    <p className="text-[11px] text-text-ghost mt-0.5 leading-relaxed">{step.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {mode === "blank" && (
          <div style={{ animation: "fade-in 200ms ease-out both" }}>
            <button
              onClick={() => setMode("choose")}
              className="mb-6 text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer flex items-center gap-1.5"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>
            <CreateEngramForm userId={userId} variant="page" />
          </div>
        )}
      </div>
    </div>
  )
}
