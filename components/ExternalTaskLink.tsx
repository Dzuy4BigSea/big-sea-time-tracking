/**
 * The work item a time entry was tracked from, e.g. "↗ Asana task" (specs/29). Harvest shows the same link
 * on the Day view and in the detailed report. Renders nothing without an http(s) link.
 */
export function ExternalTaskLink({ service, url }: { service: string | null | undefined; url: string | null | undefined }) {
  if (!url || !/^https?:\/\//i.test(url)) return null
  const label = service === 'asana' ? 'Asana task' : 'Linked task'
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-teal hover:underline" title={`Open the ${label.toLowerCase()}`}>
      ↗ {label}
    </a>
  )
}
