"use client"

interface EngramOption {
  id: string
  name: string
  accent_color: string | null
  slug: string
}

interface EngramSelectorProps {
  engrams: EngramOption[]
  selected: string[]
  onChange: (ids: string[]) => void
}

export default function EngramSelector({ engrams, selected, onChange }: EngramSelectorProps) {
  if (engrams.length <= 1) return null

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      if (selected.length > 1) {
        onChange(selected.filter((s) => s !== id))
      }
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {engrams.map((e) => {
        const isSelected = selected.includes(e.id)
        return (
          <button
            key={e.id}
            onClick={() => toggle(e.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono border transition-colors duration-120 cursor-pointer ${
              isSelected
                ? "border-border-emphasis text-text-emphasis bg-surface-raised"
                : "border-border text-text-ghost hover:text-text-tertiary hover:border-border-emphasis"
            }`}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: e.accent_color ?? "#76808F" }}
            />
            {e.name}
          </button>
        )
      })}
    </div>
  )
}
