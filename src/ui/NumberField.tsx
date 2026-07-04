export function NumberField({
  value,
  min,
  max,
  step,
  suffix,
  title,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  suffix: string
  title: string
  onChange: (v: number) => void
}) {
  return (
    <label className="num-field" title={title}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
      />
      <span>{suffix}</span>
    </label>
  )
}
