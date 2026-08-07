export type EntityOption = { id: string; name: string; code: string }

/**
 * Company / business-entity picker (specs/16). Renders nothing when the account has only one entity
 * (no choice to make), so single-company accounts stay clean. Server-rendered — plain <select>.
 */
export function EntitySelect({
  entities,
  name,
  defaultValue,
  label = 'Company',
  help,
}: {
  entities: EntityOption[]
  name: string
  defaultValue?: string | null
  label?: string
  help?: string
}) {
  if (entities.length <= 1) return null
  const selected = defaultValue ?? entities[0]?.id
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-gray-700">{label}</span>
      <select
        name={name}
        defaultValue={selected}
        className="rounded border border-gray-300 px-2 py-1.5 text-sm"
      >
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} ({e.code})
          </option>
        ))}
      </select>
      {help && <span className="text-xs text-gray-400">{help}</span>}
    </label>
  )
}

/** Small BS/CL chip for lists. */
export function EntityChip({ code, name }: { code: string; name?: string }) {
  return (
    <span
      className="rounded bg-brand-teal-50 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand-teal"
      title={name ? `Company: ${name}` : undefined}
    >
      {code}
    </span>
  )
}
