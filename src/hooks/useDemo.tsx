import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { StageId } from '../types'

type DemoMode = 'manual' | 'guided'

interface DemoState {
  stage: StageId
  unlocked: StageId
  mode: DemoMode
  paused: boolean
  scanned: boolean
  scanning: boolean
  outreachApproved: boolean
  outreachIndex: number
  requirementsIndex: number
  requirementsApproved: boolean
  offerApproved: boolean
  dealClosed: boolean
  buildStarted: boolean
  buildIndex: number
  buildComplete: boolean
  deployed: boolean
  maintenanceStep: number
  sitePreview: boolean
  guidedStep: number
  elapsedSeconds: number
}

interface DemoContextValue extends DemoState {
  goTo: (stage: StageId, force?: boolean) => void
  scan: () => void
  approveOutreach: () => void
  nextOutreach: () => void
  completeOutreach: () => void
  nextRequirement: () => void
  approveRequirements: () => void
  approveOffer: () => void
  acceptOffer: () => void
  startBuild: () => void
  skipBuild: () => void
  deploy: () => void
  advanceMaintenance: () => void
  setSitePreview: (open: boolean) => void
  startGuided: () => void
  pause: () => void
  resume: () => void
  skipAnimation: () => void
  reset: () => void
}

const initialState: DemoState = {
  stage: 1, unlocked: 1, mode: 'manual', paused: false, scanned: false, scanning: false,
  outreachApproved: false, outreachIndex: 1, requirementsIndex: 1, requirementsApproved: false,
  offerApproved: false, dealClosed: false, buildStarted: false, buildIndex: -1, buildComplete: false,
  deployed: false, maintenanceStep: 0, sitePreview: false, guidedStep: 0, elapsedSeconds: 0
}

const DemoContext = createContext<DemoContextValue | null>(null)

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(() => {
    try {
      const saved = localStorage.getItem('agentfront-demo')
      return saved ? { ...initialState, ...JSON.parse(saved), mode: 'manual', paused: false, scanning: false } : initialState
    } catch { return initialState }
  })
  const scanTimer = useRef<number | undefined>(undefined)

  const patch = useCallback((next: Partial<DemoState>) => setState(current => ({ ...current, ...next })), [])
  const goTo = useCallback((stage: StageId, force = false) => setState(current => force || stage <= current.unlocked ? { ...current, stage, unlocked: force ? Math.max(current.unlocked, stage) as StageId : current.unlocked } : current), [])
  const scan = useCallback(() => {
    patch({ scanning: true })
    window.clearTimeout(scanTimer.current)
    scanTimer.current = window.setTimeout(() => patch({ scanning: false, scanned: true }), 950)
  }, [patch])
  const approveOutreach = useCallback(() => patch({ outreachApproved: true, stage: 3, unlocked: 3 }), [patch])
  const nextOutreach = useCallback(() => setState(current => ({ ...current, outreachIndex: Math.min(9, current.outreachIndex + 1) })), [])
  const completeOutreach = useCallback(() => patch({ outreachIndex: 9, stage: 4, unlocked: 4 }), [patch])
  const nextRequirement = useCallback(() => setState(current => ({ ...current, requirementsIndex: Math.min(5, current.requirementsIndex + 1) })), [])
  const approveRequirements = useCallback(() => patch({ requirementsIndex: 5, requirementsApproved: true, stage: 5, unlocked: 5 }), [patch])
  const approveOffer = useCallback(() => patch({ offerApproved: true }), [patch])
  const acceptOffer = useCallback(() => patch({ offerApproved: true, dealClosed: true, stage: 6, unlocked: 6 }), [patch])
  const startBuild = useCallback(() => patch({ buildStarted: true, buildIndex: 0 }), [patch])
  const skipBuild = useCallback(() => patch({ buildStarted: true, buildIndex: 5, buildComplete: true, stage: 6, unlocked: 7 }), [patch])
  const deploy = useCallback(() => patch({ deployed: true, stage: 7, unlocked: 7 }), [patch])
  const advanceMaintenance = useCallback(() => setState(current => ({ ...current, maintenanceStep: Math.min(4, current.maintenanceStep + 1) })), [])
  const setSitePreview = useCallback((sitePreview: boolean) => patch({ sitePreview }), [patch])
  const reset = useCallback(() => { localStorage.removeItem('agentfront-demo'); setState(initialState) }, [])
  const startGuided = useCallback(() => setState({ ...initialState, mode: 'guided', scanned: true, elapsedSeconds: 0 }), [])
  const pause = useCallback(() => patch({ paused: true }), [patch])
  const resume = useCallback(() => patch({ paused: false }), [patch])

  const skipAnimation = useCallback(() => setState(current => {
    if (current.stage === 1) return { ...current, scanning: false, scanned: true }
    if (current.stage === 3) return { ...current, outreachIndex: 9, stage: 4, unlocked: 4 }
    if (current.stage === 4) return { ...current, requirementsIndex: 5 }
    if (current.stage === 6) return { ...current, buildStarted: true, buildIndex: 5, buildComplete: true, unlocked: 7 }
    return current
  }), [])

  useEffect(() => {
    const safeState = { ...state, scanning: false, mode: 'manual', paused: false }
    localStorage.setItem('agentfront-demo', JSON.stringify(safeState))
  }, [state])

  useEffect(() => {
    if (!state.buildStarted || state.buildComplete || state.paused) return
    const timer = window.setTimeout(() => setState(current => {
      if (current.buildIndex >= 5) return { ...current, buildComplete: true, unlocked: 7 }
      return { ...current, buildIndex: current.buildIndex + 1 }
    }), 1450)
    return () => window.clearTimeout(timer)
  }, [state.buildStarted, state.buildComplete, state.buildIndex, state.paused])

  useEffect(() => {
    if (state.mode !== 'guided' || state.paused) return
    const clock = window.setInterval(() => setState(current => ({ ...current, elapsedSeconds: current.elapsedSeconds + 1 })), 1000)
    return () => window.clearInterval(clock)
  }, [state.mode, state.paused])

  useEffect(() => {
    if (state.mode !== 'guided' || state.paused || state.guidedStep >= 35) return
    const timer = window.setTimeout(() => setState(current => {
      const next = { ...current, guidedStep: current.guidedStep + 1 }
      const step = current.guidedStep
      if (step === 0) Object.assign(next, { scanned: true })
      else if (step === 1) Object.assign(next, { stage: 2, unlocked: 2 })
      else if (step === 2) Object.assign(next, { outreachApproved: true, stage: 3, unlocked: 3 })
      else if (step >= 3 && step <= 10) next.outreachIndex = Math.min(9, next.outreachIndex + 1)
      else if (step === 11) Object.assign(next, { outreachIndex: 9, stage: 4, unlocked: 4 })
      else if (step >= 12 && step <= 15) next.requirementsIndex = Math.min(5, next.requirementsIndex + 1)
      else if (step === 16) Object.assign(next, { requirementsApproved: true, stage: 5, unlocked: 5 })
      else if (step === 18) next.offerApproved = true
      else if (step === 20) Object.assign(next, { dealClosed: true, stage: 6, unlocked: 6, buildStarted: true, buildIndex: 0 })
      else if (step === 26) Object.assign(next, { buildComplete: true, buildIndex: 5, unlocked: 7 })
      else if (step === 28) Object.assign(next, { stage: 7, unlocked: 7 })
      else if (step === 30) next.deployed = true
      else if (step >= 31 && step <= 34) next.maintenanceStep = Math.min(4, next.maintenanceStep + 1)
      return next
    }), 2600)
    return () => window.clearTimeout(timer)
  }, [state.mode, state.paused, state.guidedStep])

  const value = useMemo(() => ({ ...state, goTo, scan, approveOutreach, nextOutreach, completeOutreach, nextRequirement, approveRequirements, approveOffer, acceptOffer, startBuild, skipBuild, deploy, advanceMaintenance, setSitePreview, startGuided, pause, resume, skipAnimation, reset }), [state, goTo, scan, approveOutreach, nextOutreach, completeOutreach, nextRequirement, approveRequirements, approveOffer, acceptOffer, startBuild, skipBuild, deploy, advanceMaintenance, setSitePreview, startGuided, pause, resume, skipAnimation, reset])
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}

// The hook and provider intentionally share one module so they cannot drift.
// eslint-disable-next-line react-refresh/only-export-components
export function useDemo() {
  const context = useContext(DemoContext)
  if (!context) throw new Error('useDemo must be used inside DemoProvider')
  return context
}
