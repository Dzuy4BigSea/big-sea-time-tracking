'use client'

import { createContext, useContext, useState } from 'react'

/**
 * Shares the Edit project form's (unsaved) project type + billable-rate method with the Team card,
 * so its "Billable rate" column appears/disappears instantly when the select changes (Harvest).
 */
type ProjectBilling = {
  projectType: string
  rateMethod: string
  setProjectType: (v: string) => void
  setRateMethod: (v: string) => void
}

const Ctx = createContext<ProjectBilling | null>(null)

export function ProjectBillingProvider({
  projectType: initialType,
  rateMethod: initialMethod,
  children,
}: {
  projectType: string
  rateMethod: string | null
  children: React.ReactNode
}) {
  const [projectType, setProjectType] = useState(initialType)
  const [rateMethod, setRateMethod] = useState(initialMethod ?? 'none')
  return <Ctx.Provider value={{ projectType, rateMethod, setProjectType, setRateMethod }}>{children}</Ctx.Provider>
}

/** null outside a provider (callers fall back to their own state / saved values). */
export function useProjectBilling(): ProjectBilling | null {
  return useContext(Ctx)
}

