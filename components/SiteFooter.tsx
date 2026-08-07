/** "Purpose built by Big Sea" — page footer linking to bigsea.co. The wordmark uses currentColor
 *  so it tints with the muted footer text and darkens on hover. */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-gray-200 px-8 py-6">
      <a
        href="https://bigsea.co"
        target="_blank"
        rel="noopener noreferrer"
        className="mx-auto flex w-fit items-center gap-2 text-xs text-gray-400 transition-colors hover:text-gray-700"
      >
        <span className="uppercase tracking-wide">Purpose built by</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logotype.svg" alt="Big Sea" className="h-4 w-auto" />
      </a>
    </footer>
  )
}
