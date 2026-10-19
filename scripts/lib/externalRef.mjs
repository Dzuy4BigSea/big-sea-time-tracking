/**
 * Plain-JS mirror of fromHarvestReference (modules/integrations/externalRef.ts, which is unit-tested;
 * scripts/lib/externalRef.test.ts checks the two agree). Maps a Harvest time entry's
 * external_reference to the TimeEntry external* columns (all null when there is none).
 */
export function externalRef(r) {
  const none = { externalService: null, externalId: null, externalGroupId: null, externalPermalink: null }
  if (!r || typeof r !== 'object') return none
  const id = r.id == null ? '' : String(r.id).trim()
  const svc = String(r.service ?? '').trim().toLowerCase()
  let link = null
  try {
    const u = new URL(String(r.permalink ?? '').trim())
    if ((u.protocol === 'https:' || u.protocol === 'http:') && u.toString().length <= 500) link = u.toString()
  } catch {}
  const service = svc === 'asana' || /(^|[./])asana\.com(\/|$)/.test(svc) ? 'asana' : svc ? svc.slice(0, 64) : link?.includes('asana.com') ? 'asana' : null
  if (!id || !service) return none
  const group = r.group_id == null ? '' : String(r.group_id).trim()
  return { externalService: service, externalId: id.slice(0, 64), externalGroupId: group ? group.slice(0, 64) : null, externalPermalink: link }
}
