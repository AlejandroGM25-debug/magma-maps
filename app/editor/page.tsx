"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Stage, Layer, Rect, Text, Group, Line, Circle, Image as KonvaImage } from "react-konva"
import type Konva from "konva"
import * as XLSX from "xlsx"

/* =====================================================================================
   MAGMA MAP EDITOR - SINGLE FILE (Next.js /app/editor/page.tsx)
   - Sin imports internos duplicados
   - Sin rutas ../types ni ../lib/utils
   - Sin RefObject/MutableRefObject sin importar
   - Corregidos "implicit any" en callbacks
===================================================================================== */

/* =====================================================================================
   TYPES + CATALOGS
===================================================================================== */

export const DMX_CATALOG = {
  "CABEZA MOVIL": {
    label: "Cabeza móvil",
    color: "#facc15",
    modes: [
      { id: "16ch", label: "16ch", channels: 16 },
      { id: "17ch", label: "17ch", channels: 17 },
    ],
  },
  STROBO: {
    label: "Strobo",
    color: "#22d3ee",
    modes: [
      { id: "9ch", label: "9ch (RGBW)", channels: 9 },
      { id: "4ch", label: "4ch", channels: 4 },
    ],
  },
  LEDBAR: {
    label: "LED Bar",
    color: "#c084fc",
    modes: [{ id: "16ch", label: "16ch", channels: 16 }],
  },
  CEGADORA: {
    label: "Cegadora",
    color: "#22c55e",
    modes: [{ id: "4ch", label: "4ch", channels: 4 }],
  },
  LED: {
    label: "LED",
    color: "#c084fc",
    modes: [
      { id: "1ch", label: "1ch (ON/OFF)", channels: 1 },
      { id: "3ch", label: "3ch", channels: 3 },
      { id: "4ch", label: "4ch", channels: 4 },
    ],
  },
  PAR: {
    label: "PAR",
    color: "#c084fc",
    modes: [
      { id: "3ch", label: "3ch", channels: 3 },
      { id: "4ch", label: "4ch", channels: 4 },
      { id: "7ch", label: "7ch", channels: 7 },
    ],
  },
  PCDJ: {
    label: "PCDJ",
    color: "#3b82f6",
    modes: [{ id: "1ch", label: "1ch", channels: 1 }],
  },
} as const

export type DmxType = keyof typeof DMX_CATALOG
export type DmxMode = (typeof DMX_CATALOG)[DmxType]["modes"][number]

export const ND_CATALOG = {
  "PANTALLA ESCENARIO": { label: "Pantalla Escenario", color: "#8b5cf6", kind2: "SCREEN" as const },
  "PANTALLA PISTA": { label: "Pantalla Pista", color: "#7c3aed", kind2: "SCREEN" as const },
  "PANTALLA CABINA DJ": { label: "Pantalla Cabina DJ", color: "#6d28d9", kind2: "SCREEN" as const },
  ARRAY_L: { label: "Array L (5x Aero20A)", color: "#38bdf8", kind2: "AUDIO" as const },
  ARRAY_R: { label: "Array R (5x Aero20A)", color: "#38bdf8", kind2: "AUDIO" as const },
  SUB_U218: { label: "Sub DAS U-218", color: "#0ea5e9", kind2: "AUDIO" as const },
  ESCENARIO_L: { label: "Escenario L (Aero12A)", color: "#22c55e", kind2: "AUDIO" as const },
  ESCENARIO_R: { label: "Escenario R (Aero12A)", color: "#22c55e", kind2: "AUDIO" as const },
  MONITOR_DJ: { label: "Monitor DJ (Aero12A)", color: "#10b981", kind2: "AUDIO" as const },
  SUB_DJ_118A: { label: "Sub DJ (118A)", color: "#14b8a6", kind2: "AUDIO" as const },
} as const

export type NdType = keyof typeof ND_CATALOG
export type NdKind2 = (typeof ND_CATALOG)[NdType]["kind2"]

export type DmxFixture = {
  kind: "DMX"
  uid: string
  id: string
  x: number
  y: number
  type: DmxType
  modeId: string
  universe: number
  address: number
  zona?: string
  locked?: boolean
  sizePx?: number
}

export type NdFixture = {
  kind: "ND"
  uid: string
  id: string
  x: number
  y: number
  type: NdType
  zona?: string
  label?: string
  quantity?: number
  widthM?: number
  heightM?: number
  widthPx?: number
  heightPx?: number
  sizePx?: number
  rotation?: number
  modules?: number
  processor?: string
  locked?: boolean
}

export type AnyFixture = DmxFixture | NdFixture

export type ZonePoly = {
  id: string
  name: string
  color: string
  points: number[]
  locked?: boolean
}

export type View = {
  scale: number
  ox: number
  oy: number
}

export type PatchRow = {
  id: string
  tipo: string
  canales: number
  universe: number
  address: number
  zona?: string
}

export type DmxIssue =
  | { kind: "OVERLAP"; fixtureUid: string; withUid: string; universe: number }
  | { kind: "OUT_OF_RANGE"; fixtureUid: string; universe: number; start: number; end: number }

export type RiderStyle = "COLOR" | "CLASSIC"

export type HistorySnapshot = {
  fixtures: AnyFixture[]
  zones: ZonePoly[]
}

/* =====================================================================================
   UTILS
===================================================================================== */

const DEFAULT_BG_URL = "/plano-magma.png"
const DEFAULT_DMX_SIZE = 28
const DEFAULT_AUDIO_SIZE = 36
const AUTOSAVE_KEY = "magma-map-autosave-v2"

function genId(prefix = "id"): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${id}`
}

function isDmxType(t: string): t is DmxType {
  return (Object.keys(DMX_CATALOG) as string[]).includes(t)
}

function isNdType(t: string): t is NdType {
  const ND_TYPES: NdType[] = [
    "PANTALLA ESCENARIO",
    "PANTALLA PISTA",
    "PANTALLA CABINA DJ",
    "ARRAY_L",
    "ARRAY_R",
    "SUB_U218",
    "ESCENARIO_L",
    "ESCENARIO_R",
    "MONITOR_DJ",
    "SUB_DJ_118A",
  ]
  return ND_TYPES.includes(t as NdType)
}

function isValidView(v: unknown): v is View {
  if (!v || typeof v !== "object") return false
  const view = v as Record<string, unknown>
  return (
    Number.isFinite(view.scale) &&
    (view.scale as number) > 0 &&
    Number.isFinite(view.ox) &&
    Number.isFinite(view.oy)
  )
}

function getMode(fx: DmxFixture) {
  const entry = DMX_CATALOG[fx.type]
  return entry.modes.find((m) => m.id === fx.modeId) ?? entry.modes[0]
}

function getChannels(fx: DmxFixture): number {
  return getMode(fx).channels
}

function findModeIdByChannels(type: DmxType, channels: number): string {
  const entry = DMX_CATALOG[type]
  const mode = entry.modes.find((m) => m.channels === channels)
  return mode ? mode.id : entry.modes[0].id
}

function dmxLabel(fx: Pick<DmxFixture, "universe" | "address">): string {
  return `U${fx.universe}:${fx.address}`
}

function rangeLabel(start: number, channels: number): string {
  return `${start}-${start + channels - 1}`
}

type ZoneBucket = "ESCENARIO" | "PISTA" | "VIP" | "OTROS"
function zoneBucket(zonaRaw?: string): ZoneBucket {
  const z = (zonaRaw ?? "").toUpperCase()
  if (z.includes("ESCENARIO")) return "ESCENARIO"
  if (z.includes("PISTA")) return "PISTA"
  if (z.includes("VIP")) return "VIP"
  return "OTROS"
}

function centroid(points: number[]): { x: number; y: number } {
  let x = 0
  let y = 0
  const n = Math.max(1, Math.floor(points.length / 2))
  for (let i = 0; i < points.length; i += 2) {
    x += points[i]
    y += points[i + 1]
  }
  return { x: x / n, y: y / n }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function normDeg(n: number): number {
  return ((n % 360) + 360) % 360
}

function snapDeg(deg: number, step: number): number {
  return Math.round(deg / step) * step
}

function computeCenteredView(stageW: number, stageH: number, worldW: number, worldH: number, scale = 0.25): View {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 0.25
  return { scale: s, ox: (stageW - worldW * s) / 2, oy: (stageH - worldH * s) / 2 }
}

/* =====================================================================================
   HOOK: useHistory + keys
===================================================================================== */

const MAX_HISTORY_STEPS = 60

function useHistory(maxSteps = MAX_HISTORY_STEPS) {
  const past = useRef<HistorySnapshot[]>([])
  const future = useRef<HistorySnapshot[]>([])
  const [, setRev] = useState(0)
  const bump = useCallback(() => setRev((n) => n + 1), [])

  const snapshot = useCallback(
    (state: HistorySnapshot) => {
      past.current = [...past.current.slice(-(maxSteps - 1)), state]
      future.current = []
      bump()
    },
    [maxSteps, bump]
  )

  const undo = useCallback(
    (currentState: HistorySnapshot): HistorySnapshot | null => {
      if (past.current.length === 0) return null
      const prev = past.current[past.current.length - 1]
      past.current = past.current.slice(0, -1)
      future.current = [currentState, ...future.current.slice(0, maxSteps - 1)]
      bump()
      return prev
    },
    [maxSteps, bump]
  )

  const redo = useCallback(
    (currentState: HistorySnapshot): HistorySnapshot | null => {
      if (future.current.length === 0) return null
      const next = future.current[0]
      future.current = future.current.slice(1)
      past.current = [...past.current, currentState]
      bump()
      return next
    },
    [bump]
  )

  return {
    snapshot,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  }
}

function useUndoRedoKeys({ onUndo, onRedo }: { onUndo: () => void; onRedo: () => void }) {
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return

      if (e.key === "z" || e.key === "Z") {
        e.preventDefault()
        e.shiftKey ? onRedo() : onUndo()
      }
      if (e.key === "y" || e.key === "Y") {
        e.preventDefault()
        onRedo()
      }
    }
    window.addEventListener("keydown", handle)
    return () => window.removeEventListener("keydown", handle)
  }, [onUndo, onRedo])
}

/* =====================================================================================
   HOOK: useAutosave + useBgUrl
===================================================================================== */

type SavedState = {
  schemaVersion: number
  savedAt: string
  bgUrl: string | null
  fixtures: AnyFixture[]
  zones: ZonePoly[]
  view: View | null
}

type RestoreResult = {
  fixtures: AnyFixture[]
  zones: ZonePoly[]
  bgUrl: string | null
  view: View | null
}

type UseAutosaveOptions = {
  fixtures: AnyFixture[]
  zones: ZonePoly[]
  bgUrl: string | null
  view: View
  debounce?: number
}

function useAutosave({ fixtures, zones, bgUrl, view, debounce = 300 }: UseAutosaveOptions) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyToSave = useRef(false)

  const save = useCallback(() => {
    if (!readyToSave.current) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      try {
        const data: SavedState = {
          schemaVersion: 2,
          savedAt: new Date().toISOString(),
          bgUrl: bgUrl && !bgUrl.startsWith("blob:") ? bgUrl : null,
          fixtures,
          zones,
          view,
        }
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data))
      } catch (e) {
        console.warn("[autosave] No se pudo guardar:", e)
      }
    }, debounce)
  }, [fixtures, zones, bgUrl, view, debounce])

  useEffect(() => {
    save()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [save])

  const restore = useCallback((): RestoreResult | null => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<SavedState>
      const root: Partial<SavedState> =
        Array.isArray(parsed.fixtures) || Array.isArray(parsed.zones)
          ? parsed
          : ((parsed as Record<string, unknown>).data as Partial<SavedState>) ?? {}

      return {
        fixtures: Array.isArray(root.fixtures) ? (root.fixtures as AnyFixture[]) : [],
        zones: Array.isArray(root.zones) ? (root.zones as ZonePoly[]) : [],
        bgUrl:
          typeof root.bgUrl === "string" && root.bgUrl && !root.bgUrl.startsWith("blob:")
            ? root.bgUrl
            : null,
        view: isValidView(root.view) ? root.view : null,
      }
    } catch (e) {
      console.warn("[autosave] Datos inválidos:", e)
      return null
    }
  }, [])

  const markReady = useCallback(() => {
    readyToSave.current = true
  }, [])

  return { restore, markReady }
}

function useBgUrl(_initial: string | null) {
  const currentBlobUrl = useRef<string | null>(null)

  const createBgFromFile = useCallback((file: File): string => {
    if (currentBlobUrl.current) URL.revokeObjectURL(currentBlobUrl.current)
    const newUrl = URL.createObjectURL(file)
    currentBlobUrl.current = newUrl
    return newUrl
  }, [])

  useEffect(() => {
    return () => {
      if (currentBlobUrl.current) {
        URL.revokeObjectURL(currentBlobUrl.current)
        currentBlobUrl.current = null
      }
    }
  }, [])

  return { createBgFromFile }
}

/* =====================================================================================
   HOOK: useViewport
   - Sin RefObject: usamos { current: ... } compatible con useRef.
===================================================================================== */

function useViewport(
  stageRef: { current: Konva.Stage | null },
  stageViewport: { width: number; height: number },
  worldSize: { width: number; height: number }
) {
  const [view, setView] = useState<View>({ scale: 1, ox: 0, oy: 0 })
  const [spaceDown, setSpaceDown] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const panLast = useRef<{ x: number; y: number } | null>(null)
  const didInitFit = useRef(false)

  const fitView = useCallback(() => {
    const { width: vw, height: vh } = stageViewport
    const { width: ww, height: wh } = worldSize
    if (!vw || !vh || !ww || !wh) return
    setView(computeCenteredView(vw, vh, ww, wh, 0.25))
  }, [stageViewport, worldSize])

  useEffect(() => {
    const { width: vw, height: vh } = stageViewport
    const { width: ww, height: wh } = worldSize
    if (!vw || !vh || !ww || !wh) return

    if (!didInitFit.current) {
      fitView()
      didInitFit.current = true
      return
    }

    setView((v: View) => {
      const minOx = vw - ww * v.scale
      const minOy = vh - wh * v.scale
      return { ...v, ox: clamp(v.ox, minOx, 0), oy: clamp(v.oy, minOy, 0) }
    })
  }, [stageViewport, worldSize, fitView])

  const resetFit = useCallback(() => {
    didInitFit.current = false
  }, [])

  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    setView((v: View) => {
      const newScale = clamp(v.scale * factor, 0.05, 10)
      const wx = (sx - v.ox) / v.scale
      const wy = (sy - v.oy) / v.scale
      return { scale: newScale, ox: sx - wx * newScale, oy: sy - wy * newScale }
    })
  }, [])

  const zoomIn = useCallback(
    () => zoomAt(stageViewport.width / 2, stageViewport.height / 2, 1.15),
    [stageViewport, zoomAt]
  )
  const zoomOut = useCallback(
    () => zoomAt(stageViewport.width / 2, stageViewport.height / 2, 1 / 1.15),
    [stageViewport, zoomAt]
  )

  // Wheel nativo con passive:false
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const container = stage.container()
    if (!container) return

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      const factor = e.deltaY > 0 ? 1 / 1.08 : 1.08
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor)
    }

    container.addEventListener("wheel", onWheel, { passive: false })
    return () => container.removeEventListener("wheel", onWheel as EventListener)
  }, [stageRef, zoomAt])

  // Space pan
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceDown(false)
        setIsPanning(false)
        panLast.current = null
      }
    }
    window.addEventListener("keydown", onDown, { passive: false } as AddEventListenerOptions)
    window.addEventListener("keyup", onUp)
    return () => {
      window.removeEventListener("keydown", onDown as EventListener)
      window.removeEventListener("keyup", onUp as EventListener)
    }
  }, [])

  const onStageMouseDown = useCallback(
    (sx: number, sy: number, isMiddleButton: boolean): boolean => {
      if (spaceDown || isMiddleButton) {
        setIsPanning(true)
        panLast.current = { x: sx, y: sy }
        return true
      }
      return false
    },
    [spaceDown]
  )

  const onStageMouseMove = useCallback(
    (sx: number, sy: number) => {
      if (!isPanning) return
      const last = panLast.current
      if (!last) {
        panLast.current = { x: sx, y: sy }
        return
      }
      const dx = sx - last.x
      const dy = sy - last.y
      panLast.current = { x: sx, y: sy }
      setView((v: View) => ({ ...v, ox: v.ox + dx, oy: v.oy + dy }))
    },
    [isPanning]
  )

  const onStageMouseUp = useCallback(() => {
    setIsPanning(false)
    panLast.current = null
  }, [])

  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({ x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale }),
    [view]
  )

  return {
    view,
    setView,
    spaceDown,
    isPanning,
    fitView,
    resetFit,
    zoomIn,
    zoomOut,
    resetView: fitView,
    screenToWorld,
    onStageMouseDown,
    onStageMouseMove,
    onStageMouseUp,
  }
}

/* =====================================================================================
   HOOK: useFixtures + helpers
===================================================================================== */

function coerceImportedFixtures(raw: unknown[]): AnyFixture[] {
  if (!Array.isArray(raw)) return []
  const out: AnyFixture[] = []

  for (const it of raw) {
    if (!it || typeof it !== "object") continue
    const item = it as Record<string, unknown>
    const kind = item.kind

    if (kind === "DMX") {
      const typeRaw = String(item.type ?? "").toUpperCase()
      const safeType: DmxType = isDmxType(typeRaw) ? typeRaw : "LED"
      const modeFallback = DMX_CATALOG[safeType].modes[0].id
      const modeIdRaw = String(item.modeId ?? modeFallback)
      const hasMode = DMX_CATALOG[safeType].modes.some((m) => m.id === modeIdRaw)

      out.push({
        kind: "DMX",
        uid: String(item.uid ?? genId("uid")),
        id: String(item.id ?? "DMX"),
        x: Number(item.x ?? 0),
        y: Number(item.y ?? 0),
        type: safeType,
        modeId: hasMode ? modeIdRaw : modeFallback,
        universe: clamp(Math.round(Number(item.universe ?? 1)), 1, 99),
        address: clamp(Math.round(Number(item.address ?? 1)), 1, 512),
        zona: item.zona ? String(item.zona) : undefined,
        locked: !!item.locked,
        sizePx: typeof item.sizePx === "number" ? item.sizePx : DEFAULT_DMX_SIZE,
      })
      continue
    }

    if (kind === "ND") {
      const typeRaw = String(item.type ?? "")
      if (!isNdType(typeRaw)) continue

      out.push({
        kind: "ND",
        uid: String(item.uid ?? genId("uid")),
        id: String(item.id ?? typeRaw),
        x: Number(item.x ?? 0),
        y: Number(item.y ?? 0),
        type: typeRaw as NdType,
        zona: item.zona ? String(item.zona) : undefined,
        label: item.label ? String(item.label) : undefined,
        quantity: typeof item.quantity === "number" ? item.quantity : undefined,
        widthM: typeof item.widthM === "number" ? item.widthM : undefined,
        heightM: typeof item.heightM === "number" ? item.heightM : undefined,
        widthPx: typeof item.widthPx === "number" ? item.widthPx : undefined,
        heightPx: typeof item.heightPx === "number" ? item.heightPx : undefined,
        sizePx: typeof item.sizePx === "number" ? item.sizePx : DEFAULT_AUDIO_SIZE,
        rotation: typeof item.rotation === "number" ? item.rotation : undefined,
        modules: typeof item.modules === "number" ? item.modules : undefined,
        processor: item.processor ? String(item.processor) : undefined,
        locked: !!item.locked,
      })
      continue
    }
  }

  return out
}

function useFixtures(worldSize: { width: number; height: number }) {
  const [fixtures, setFixtures] = useState<AnyFixture[]>([])
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set())
  const [universeInput, setUniverseInput] = useState("")
  const [addressInput, setAddressInput] = useState("")

  const selectedUid = selectedUids.size === 1 ? [...selectedUids][0] : null
  const selectedFixture = fixtures.find((f) => f.uid === selectedUid) ?? null

  const selectOne = useCallback(
    (uid: string, list?: AnyFixture[]) => {
      setSelectedUids(new Set([uid]))
      const fx = (list ?? fixtures).find((f) => f.uid === uid)
      if (fx?.kind === "DMX") {
        setUniverseInput(String(fx.universe))
        setAddressInput(String(fx.address))
      } else {
        setUniverseInput("")
        setAddressInput("")
      }
    },
    [fixtures]
  )

  const toggleSelect = useCallback((uid: string) => {
    setSelectedUids((prev) => {
      const n = new Set(prev)
      n.has(uid) ? n.delete(uid) : n.add(uid)
      return n
    })
    setUniverseInput("")
    setAddressInput("")
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedUids(new Set())
    setUniverseInput("")
    setAddressInput("")
  }, [])

  const updateFixture = useCallback((uid: string, patch: Partial<AnyFixture>) => {
    setFixtures((prev) => prev.map((fx) => (fx.uid === uid ? ({ ...fx, ...patch } as AnyFixture) : fx)))
  }, [])

  const moveSelected = useCallback(
    (dx: number, dy: number) => {
      setFixtures((prev) =>
        prev.map((fx) => (selectedUids.has(fx.uid) ? ({ ...fx, x: fx.x + dx, y: fx.y + dy } as AnyFixture) : fx))
      )
    },
    [selectedUids]
  )

  const deleteSelected = useCallback(() => {
    setFixtures((prev) => prev.filter((fx) => !selectedUids.has(fx.uid)))
    clearSelection()
  }, [selectedUids, clearSelection])

  const duplicateSelected = useCallback(() => {
    setFixtures((prev) => {
      const copies: AnyFixture[] = prev
        .filter((fx) => selectedUids.has(fx.uid))
        .map((fx) => ({ ...fx, uid: genId("uid"), x: fx.x + 24, y: fx.y + 24 } as AnyFixture))

      setSelectedUids(new Set(copies.map((c) => c.uid)))
      return [...prev, ...copies]
    })
  }, [selectedUids])

  function addDmxFixture(type: DmxType) {
    const uid = genId("uid")
    const fx: DmxFixture = {
      kind: "DMX",
      uid,
      id: `NEW_DMX_${fixtures.length + 1}`,
      x: Math.round(worldSize.width * 0.5),
      y: Math.round(worldSize.height * 0.35),
      type,
      modeId: DMX_CATALOG[type].modes[0].id,
      universe: 1,
      address: 1,
      sizePx: DEFAULT_DMX_SIZE,
    }
    const next = [...fixtures, fx]
    setFixtures(next)
    selectOne(uid, next)
    return fx
  }

  function addNdFixture(type: NdType) {
    const uid = genId("uid")
    const screenPresets: Partial<Record<NdType, Partial<NdFixture>>> = {
      "PANTALLA ESCENARIO": {
        label: "Pantalla Escenario",
        widthM: 6,
        heightM: 2,
        widthPx: 520,
        heightPx: 180,
        modules: 48,
        processor: "Novastar VX600",
      },
      "PANTALLA PISTA": {
        label: "Pantalla Pista",
        widthM: 1,
        heightM: 4,
        widthPx: 160,
        heightPx: 420,
        modules: 16,
        processor: "Novastar VX600",
      },
      "PANTALLA CABINA DJ": {
        label: "Pantalla Cabina DJ",
        widthM: 3,
        heightM: 1,
        widthPx: 320,
        heightPx: 120,
        modules: 12,
        processor: "Novastar VX600",
      },
    }
    const audioPresets: Partial<Record<NdType, Partial<NdFixture>>> = {
      ARRAY_L: { label: "Array L", quantity: 5, rotation: 0, sizePx: DEFAULT_AUDIO_SIZE },
      ARRAY_R: { label: "Array R", quantity: 5, rotation: 180, sizePx: DEFAULT_AUDIO_SIZE },
      SUB_U218: { label: "Sub U-218", quantity: 1, rotation: 0, sizePx: DEFAULT_AUDIO_SIZE },
      ESCENARIO_L: { label: "Escenario L", quantity: 1, rotation: 0, sizePx: DEFAULT_AUDIO_SIZE },
      ESCENARIO_R: { label: "Escenario R", quantity: 1, rotation: 180, sizePx: DEFAULT_AUDIO_SIZE },
      MONITOR_DJ: { label: "Monitor DJ", quantity: 1, rotation: 0, sizePx: DEFAULT_AUDIO_SIZE },
      SUB_DJ_118A: { label: "Sub DJ 118A", quantity: 1, rotation: 0, sizePx: DEFAULT_AUDIO_SIZE },
    }

    const fx: NdFixture = {
      kind: "ND",
      uid,
      id: `${type}_${fixtures.length + 1}`,
      x: Math.round(worldSize.width * 0.55),
      y: Math.round(worldSize.height * 0.2),
      type,
      ...(screenPresets[type] ?? audioPresets[type] ?? {}),
    }
    const next = [...fixtures, fx]
    setFixtures(next)
    selectOne(uid, next)
    return fx
  }

  const setAllFixtures = useCallback(
    (list: AnyFixture[]) => {
      setFixtures(list)
      if (list.length > 0) selectOne(list[0].uid, list)
      else clearSelection()
    },
    [selectOne, clearSelection]
  )

  const issues = useMemo<DmxIssue[]>(() => {
    const dmx = fixtures.filter((f): f is DmxFixture => f.kind === "DMX")
    const out: DmxIssue[] = []
    const byU = new Map<number, DmxFixture[]>()

    for (const fx of dmx) {
      const arr = byU.get(fx.universe) ?? []
      arr.push(fx)
      byU.set(fx.universe, arr)
    }

    for (const [u, list] of byU.entries()) {
      const ranges = list.map((fx) => {
        const ch = getChannels(fx)
        return { fx, start: fx.address, end: fx.address + ch - 1, ch }
      })

      for (const r of ranges) {
        if (r.start < 1 || r.end > 512)
          out.push({ kind: "OUT_OF_RANGE", fixtureUid: r.fx.uid, universe: u, start: r.start, end: r.end })
      }

      for (let i = 0; i < ranges.length; i++) {
        for (let j = i + 1; j < ranges.length; j++) {
          const a = ranges[i]
          const b = ranges[j]
          if (a.start > b.end || b.start > a.end || (a.start === b.start && a.end === b.end)) continue
          out.push({ kind: "OVERLAP", fixtureUid: a.fx.uid, withUid: b.fx.uid, universe: u })
          out.push({ kind: "OVERLAP", fixtureUid: b.fx.uid, withUid: a.fx.uid, universe: u })
        }
      }
    }

    return out
  }, [fixtures])

  const issueByFixture = useMemo(() => {
    const m = new Map<string, DmxIssue[]>()
    for (const it of issues) {
      const arr = m.get(it.fixtureUid) ?? []
      arr.push(it)
      m.set(it.fixtureUid, arr)
    }
    return m
  }, [issues])

  function autoPatch(targetUids?: Set<string>) {
    const universes = [1, 2, 3]
    const dmx = fixtures.filter((f): f is DmxFixture => f.kind === "DMX")
    const nd = fixtures.filter((f): f is NdFixture => f.kind === "ND")

    const occ = new Map<number, boolean[]>()
    for (const u of universes) occ.set(u, Array(513).fill(false))

    for (const fx of dmx) {
      if (targetUids?.has(fx.uid)) continue
      const arr = occ.get(fx.universe)
      if (!arr) continue
      const ch = getChannels(fx)
      for (let k = fx.address; k < fx.address + ch && k <= 512; k++) arr[k] = true
    }

    function findFree(u: number, channels: number): number | null {
      const arr = occ.get(u)
      if (!arr) return null
      const maxStart = 512 - channels + 1
      outer: for (let s = 1; s <= maxStart; s++) {
        for (let k = s; k < s + channels; k++) if (arr[k]) continue outer
        return s
      }
      return null
    }

    const sorted = [...dmx].sort((a, b) => a.uid.localeCompare(b.uid))
    const patched = sorted.map((fx) => {
      if (targetUids && !targetUids.has(fx.uid)) return fx
      const channels = getChannels(fx)
      const startIdx = Math.max(0, universes.indexOf(fx.universe))
      for (let i = startIdx; i < universes.length; i++) {
        const u = universes[i]
        const addr = findFree(u, channels)
        if (addr != null) {
          const arr = occ.get(u)!
          for (let k = addr; k < addr + channels; k++) arr[k] = true
          return { ...fx, universe: u, address: addr }
        }
      }
      return fx
    })

    const byUid = new Map(patched.map((f) => [f.uid, f]))
    const finalDmx = dmx.map((f) => byUid.get(f.uid) ?? f)
    const next = [...finalDmx, ...nd]
    setFixtures(next)

    if (selectedUid) {
      const fx = next.find((f) => f.uid === selectedUid)
      if (fx?.kind === "DMX") {
        setUniverseInput(String(fx.universe))
        setAddressInput(String(fx.address))
      }
    }
  }

  return {
    fixtures,
    setFixtures,
    setAllFixtures,
    selectedUids,
    selectedUid,
    selectedFixture,
    selectOne,
    toggleSelect,
    clearSelection,
    updateFixture,
    moveSelected,
    deleteSelected,
    duplicateSelected,
    addDmxFixture,
    addNdFixture,
    universeInput,
    setUniverseInput,
    addressInput,
    setAddressInput,
    issues,
    issueByFixture,
    hasIssue: (uid: string) => (issueByFixture.get(uid)?.length ?? 0) > 0,
    issueCount: issues.length,
    selectedIssues: selectedFixture ? issueByFixture.get(selectedFixture.uid) ?? [] : [],
    autoPatchAll: () => autoPatch(undefined),
    autoPatchSelected: () => {
      if (selectedUids.size > 0) autoPatch(selectedUids)
    },
  }
}

/* =====================================================================================
   HOOK: useZones
===================================================================================== */

function useZones(worldSize: { width: number; height: number }) {
  const [zones, setZones] = useState<ZonePoly[]>([])
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null

  const addZone = useCallback(() => {
    const id = genId("zone")
    const base = Math.min(worldSize.width, worldSize.height) * 0.12
    const cx = worldSize.width * 0.5
    const cy = worldSize.height * 0.5

    setZones((prev) => [
      ...prev,
      {
        id,
        name: `ZONA ${prev.length + 1}`,
        color: "#ffd400",
        points: [cx - base, cy - base, cx + base, cy - base, cx + base, cy + base, cx - base, cy + base],
      },
    ])
    setSelectedZoneId(id)
  }, [worldSize])

  const updateZone = useCallback((id: string, patch: Partial<ZonePoly>) => {
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)))
  }, [])

  const deleteZone = useCallback((id: string) => {
    setZones((prev) => prev.filter((z) => z.id !== id))
    setSelectedZoneId((prev) => (prev === id ? null : prev))
  }, [])

  const moveZone = useCallback((id: string, dx: number, dy: number) => {
    setZones((prev) =>
      prev.map((z) => {
        if (z.id !== id) return z
        const pts = [...z.points]
        for (let i = 0; i < pts.length; i += 2) {
          pts[i] += dx
          pts[i + 1] += dy
        }
        return { ...z, points: pts }
      })
    )
  }, [])

  const addZonePoint = useCallback((id: string) => {
    setZones((prev) =>
      prev.map((z) => {
        if (z.id !== id) return z
        const c = centroid(z.points)
        return { ...z, points: [...z.points, c.x + 30, c.y + 30] }
      })
    )
  }, [])

  const removeZonePoint = useCallback((id: string) => {
    setZones((prev) =>
      prev.map((z) => {
        if (z.id !== id || z.points.length <= 6) return z
        return { ...z, points: z.points.slice(0, -2) }
      })
    )
  }, [])

  const moveZoneVertex = useCallback((zoneId: string, vertexIdx: number, nx: number, ny: number) => {
    setZones((prev) =>
      prev.map((z) => {
        if (z.id !== zoneId) return z
        const pts = [...z.points]
        pts[vertexIdx] = nx
        pts[vertexIdx + 1] = ny
        return { ...z, points: pts }
      })
    )
  }, [])

  const coerceImportedZones = useCallback((input: unknown): ZonePoly[] => {
    if (!Array.isArray(input)) return []
    const out: ZonePoly[] = []
    for (const raw of input) {
      if (!raw || typeof raw !== "object") continue
      const item = raw as Record<string, unknown>
      const ptsRaw = item.points
      if (!Array.isArray(ptsRaw) || ptsRaw.length < 6) continue

      const pts: number[] = []
      let valid = true
      for (const v of ptsRaw) {
        const n = typeof v === "number" ? v : Number(v)
        if (!Number.isFinite(n)) {
          valid = false
          break
        }
        pts.push(n)
      }
      if (!valid || pts.length < 6) continue

      out.push({
        id: typeof item.id === "string" && item.id.trim() ? item.id : genId("zone"),
        name: typeof item.name === "string" && item.name.trim() ? item.name : "ZONA",
        color: typeof item.color === "string" && item.color.trim() ? item.color : "#ffd400",
        points: pts,
        locked: !!item.locked,
      })
    }
    return out
  }, [])

  const setAllZones = useCallback((list: ZonePoly[]) => {
    setZones(list)
    setSelectedZoneId(list[0]?.id ?? null)
  }, [])

  return {
    zones,
    setZones,
    setAllZones,
    selectedZoneId,
    setSelectedZoneId,
    selectedZone,
    addZone,
    updateZone,
    deleteZone,
    moveZone,
    addZonePoint,
    removeZonePoint,
    moveZoneVertex,
    coerceImportedZones,
  }
}

/* =====================================================================================
   UI HELPERS
===================================================================================== */

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 1200, height: 720 })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect
      setSize({
        width: Math.max(320, Math.floor(cr.width)),
        height: Math.max(320, Math.floor(cr.height)),
      })
    })

    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, size }
}

/* =====================================================================================
   ICONS / SYMBOLS
===================================================================================== */

function SunIcon({ r, stroke, strokeWidth }: { r: number; stroke: string; strokeWidth: number }) {
  const rays = 8
  const ri = r * 0.85
  const ro2 = r * 1.35
  return (
    <Group>
      <Circle x={0} y={0} radius={r * 0.55} fill={stroke} opacity={0.95} />
      {Array.from({ length: rays }).map((_, i) => {
        const a = (Math.PI * 2 * i) / rays
        return (
          <Line
            key={i}
            points={[Math.cos(a) * ri, Math.sin(a) * ri, Math.cos(a) * ro2, Math.sin(a) * ro2]}
            stroke={stroke}
            strokeWidth={strokeWidth}
            lineCap="round"
          />
        )
      })}
    </Group>
  )
}

function SpotFigureIcon({ stroke, strokeWidth }: { stroke: string; strokeWidth: number }) {
  return (
    <Group>
      <Circle x={0} y={-7} radius={4} fill={stroke} opacity={0.95} />
      <Line points={[0, -3, 0, 9]} stroke={stroke} strokeWidth={strokeWidth} lineCap="round" />
      <Line points={[-6, 2, 6, 2]} stroke={stroke} strokeWidth={strokeWidth} lineCap="round" />
      <Line
        points={[-5, 12, 0, 8, 5, 12]}
        stroke={stroke}
        strokeWidth={strokeWidth}
        lineCap="round"
        lineJoin="round"
      />
    </Group>
  )
}

function ParIcon({ r, stroke, strokeWidth }: { r: number; stroke: string; strokeWidth: number }) {
  return (
    <Group>
      <Circle x={0} y={0} radius={r * 0.62} stroke={stroke} strokeWidth={strokeWidth} />
      <Circle x={0} y={0} radius={r * 0.34} stroke={stroke} strokeWidth={strokeWidth} opacity={0.9} />
      <Line
        points={[-r * 0.55, r * 0.75, 0, r * 0.35, r * 0.55, r * 0.75]}
        stroke={stroke}
        strokeWidth={strokeWidth}
        lineCap="round"
        lineJoin="round"
      />
    </Group>
  )
}

function LedIcon({ r, stroke, strokeWidth }: { r: number; stroke: string; strokeWidth: number }) {
  const s = r * 1.2
  return (
    <Group>
      <Line points={[0, -s, s, 0, 0, s, -s, 0]} closed stroke={stroke} strokeWidth={strokeWidth} lineJoin="round" />
      {[
        [-r * 0.35, -r * 0.15],
        [r * 0.35, -r * 0.15],
        [-r * 0.35, r * 0.25],
        [r * 0.35, r * 0.25],
      ].map(([x, y], i) => (
        <Circle key={i} x={x} y={y} radius={r * 0.1} fill={stroke} opacity={0.9} />
      ))}
    </Group>
  )
}

function StrobeIcon({ r, stroke, strokeWidth }: { r: number; stroke: string; strokeWidth: number }) {
  return (
    <Group>
      <Rect
        x={-r * 0.9}
        y={-r * 0.45}
        width={r * 1.8}
        height={r * 0.9}
        cornerRadius={8}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <Line points={[-r * 0.55, r * 0.35, -r * 0.1, -r * 0.1, r * 0.55, r * 0.35]} stroke={stroke} strokeWidth={strokeWidth} lineJoin="round" />
      <Line points={[-r * 0.55, -r * 0.35, -r * 0.1, 0, r * 0.55, -r * 0.35]} stroke={stroke} strokeWidth={strokeWidth} lineJoin="round" opacity={0.6} />
    </Group>
  )
}

function LedBarIcon({ r, stroke, strokeWidth }: { r: number; stroke: string; strokeWidth: number }) {
  return (
    <Group>
      <Rect
        x={-r * 0.95}
        y={-r * 0.25}
        width={r * 1.9}
        height={r * 0.5}
        cornerRadius={6}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {Array.from({ length: 6 }).map((_, i) => (
        <Circle key={i} x={-r * 0.75 + i * (r * 0.3)} y={0} radius={r * 0.06} fill={stroke} opacity={0.9} />
      ))}
    </Group>
  )
}

function BlinderIcon({ r, stroke, strokeWidth }: { r: number; stroke: string; strokeWidth: number }) {
  return (
    <Group>
      <Rect
        x={-r * 0.7}
        y={-r * 0.7}
        width={r * 1.4}
        height={r * 1.4}
        cornerRadius={10}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <Circle x={-r * 0.22} y={0} radius={r * 0.16} stroke={stroke} strokeWidth={strokeWidth} opacity={0.9} />
      <Circle x={r * 0.22} y={0} radius={r * 0.16} stroke={stroke} strokeWidth={strokeWidth} opacity={0.9} />
    </Group>
  )
}

function DmxSymbol({ type, size, stroke }: { type: DmxType; size: number; stroke: string }) {
  const r = size / 2
  const sw = 2.2
  switch (type) {
    case "CABEZA MOVIL":
      return <SunIcon r={r * 0.85} stroke={stroke} strokeWidth={sw} />
    case "LED":
      return <LedIcon r={r * 0.75} stroke={stroke} strokeWidth={sw} />
    case "PAR":
      return <ParIcon r={r * 0.75} stroke={stroke} strokeWidth={sw} />
    case "LEDBAR":
      return <LedBarIcon r={r * 0.75} stroke={stroke} strokeWidth={sw} />
    case "STROBO":
      return <StrobeIcon r={r * 0.75} stroke={stroke} strokeWidth={sw} />
    case "CEGADORA":
      return <BlinderIcon r={r * 0.75} stroke={stroke} strokeWidth={sw} />
    case "PCDJ":
      return <SpotFigureIcon stroke={stroke} strokeWidth={sw} />
    default:
      return <Rect x={-r} y={-r} width={size} height={size} cornerRadius={10} stroke={stroke} strokeWidth={sw} />
  }
}

/* =====================================================================================
   MAIN PAGE
===================================================================================== */

export default function EditorPage() {
  const stageRef = useRef<Konva.Stage | null>(null)

  const [bgUrl, setBgUrl] = useState<string | null>(DEFAULT_BG_URL)
  const [bgOpacity, setBgOpacity] = useState(1.0)
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null)

  const [showSymbols, setShowSymbols] = useState(true)
  const [showZones, setShowZones] = useState(true)
  const [zonesOpacity, setZonesOpacity] = useState(0.18)
  const [editZones, setEditZones] = useState(true)
  const [lockDragging, setLockDragging] = useState(false)

  const [libraryTab, setLibraryTab] = useState<"DMX" | "ND">("DMX")
  const [libraryQuery, setLibraryQuery] = useState("")
  const [riderStyle, setRiderStyle] = useState<RiderStyle>("COLOR")
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const bgInputRef = useRef<HTMLInputElement | null>(null)
  const projectJsonInputRef = useRef<HTMLInputElement | null>(null)

  const { createBgFromFile } = useBgUrl(bgUrl)

  useEffect(() => {
    if (!bgUrl) {
      setBgImg(null)
      return
    }
    const img = new window.Image()
    img.crossOrigin = "anonymous"
    img.onload = () => setBgImg(img)
    img.src = bgUrl
  }, [bgUrl])

  const worldSize = useMemo(
    () => ({ width: bgImg?.naturalWidth ?? 0, height: bgImg?.naturalHeight ?? 0 }),
    [bgImg]
  )

  const { ref: stageWrapRef, size: stageViewport } = useElementSize<HTMLDivElement>()
  const viewport = useViewport(stageRef, stageViewport, worldSize)
  const fx = useFixtures(worldSize)
  const zo = useZones(worldSize)
  const selZone = zo.selectedZone
  const history = useHistory()

  const snap = useCallback(() => {
    history.snapshot({ fixtures: fx.fixtures, zones: zo.zones })
  }, [history, fx.fixtures, zo.zones])

  const handleUndo = useCallback(() => {
    const prev = history.undo({ fixtures: fx.fixtures, zones: zo.zones })
    if (!prev) return
    fx.setAllFixtures(prev.fixtures)
    zo.setAllZones(prev.zones)
  }, [history, fx, zo])

  const handleRedo = useCallback(() => {
    const next = history.redo({ fixtures: fx.fixtures, zones: zo.zones })
    if (!next) return
    fx.setAllFixtures(next.fixtures)
    zo.setAllZones(next.zones)
  }, [history, fx, zo])

  useUndoRedoKeys({ onUndo: handleUndo, onRedo: handleRedo })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return

      const ctrl = e.ctrlKey || e.metaKey

      if ((e.key === "Delete" || e.key === "Backspace") && !ctrl) {
        if (fx.selectedUids.size > 0) {
          snap()
          fx.deleteSelected()
        } else if (zo.selectedZoneId) {
          zo.deleteZone(zo.selectedZoneId)
        }
      }

      if (ctrl && (e.key === "a" || e.key === "A")) {
        e.preventDefault()
        fx.fixtures.forEach((f) => fx.toggleSelect(f.uid))
      }

      if (ctrl && (e.key === "d" || e.key === "D")) {
        e.preventDefault()
        if (fx.selectedUids.size > 0) {
          snap()
          fx.duplicateSelected()
        }
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && fx.selectedUids.size > 0) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0
        fx.moveSelected(dx, dy)
      }
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fx, zo, snap])

  const autosave = useAutosave({ fixtures: fx.fixtures, zones: zo.zones, bgUrl, view: viewport.view })
  const autosaveLoadedRef = useRef(false)

  useEffect(() => {
    if (autosaveLoadedRef.current) return
    autosaveLoadedRef.current = true

    const saved = autosave.restore()
    if (!saved) {
      autosave.markReady()
      return
    }

    fx.setAllFixtures(coerceImportedFixtures(saved.fixtures))
    zo.setAllZones(zo.coerceImportedZones(saved.zones))
    if (saved.bgUrl) setBgUrl(saved.bgUrl)
    if (saved.view) viewport.setView(saved.view)

    setStatusMsg(`Autosave restaurado: ${saved.fixtures.length} fixtures, ${saved.zones.length} zonas.`)
    autosave.markReady()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onImportFile(file: File) {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: "array" })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[]

    const parsed: PatchRow[] = rows
      .map((r) => ({
        id: String(r.id ?? r.ID ?? r.Id ?? "").trim(),
        tipo: String(r.tipo ?? r.TIPO ?? r.Tipo ?? "").trim(),
        canales: Number(r.canales ?? r.CANALES ?? r.Canales ?? 0),
        universe: Number(r.universe ?? r.UNIVERSE ?? r.Universe ?? 0),
        address: Number(r.address ?? r.ADDRESS ?? r.Address ?? 0),
        zona: String(r.zona ?? r.ZONA ?? r.Zona ?? "").trim(),
      }))
      .filter((r) => r.id && r.tipo && r.canales > 0 && r.universe > 0 && r.address > 0)

    const buckets: Record<ZoneBucket, PatchRow[]> = { ESCENARIO: [], PISTA: [], VIP: [], OTROS: [] }
    for (const r of parsed) buckets[zoneBucket(r.zona)].push(r)
    for (const k of Object.keys(buckets) as ZoneBucket[]) {
      buckets[k].sort((a, b) => a.universe - b.universe || a.address - b.address || a.id.localeCompare(b.id))
    }

    const order: ZoneBucket[] = ["ESCENARIO", "PISTA", "VIP", "OTROS"]
    const margin = 80
    const cols = 18
    const stepX = 46
    const stepY = 46
    const bandH = Math.max(240, Math.floor((worldSize.height - margin * 2) / 4))
    const bandY: Record<ZoneBucket, number> = {
      ESCENARIO: margin,
      PISTA: margin + bandH,
      VIP: margin + bandH * 2,
      OTROS: margin + bandH * 3,
    }

    const nextDmx: DmxFixture[] = []
    let gi = 0
    for (const bucket of order) {
      for (let i = 0; i < buckets[bucket].length; i++) {
        const r = buckets[bucket][i]
        const typeUp = r.tipo.toUpperCase()
        const safeType: DmxType = isDmxType(typeUp) ? typeUp : "LED"
        nextDmx.push({
          kind: "DMX",
          uid: `${r.id}__${gi}`,
          id: r.id,
          x: clamp(margin + (i % cols) * stepX, 0, worldSize.width - 1),
          y: clamp(bandY[bucket] + Math.floor(i / cols) * stepY, 0, worldSize.height - 1),
          type: safeType,
          modeId: findModeIdByChannels(safeType, r.canales),
          universe: r.universe,
          address: r.address,
          zona: r.zona || undefined,
          sizePx: DEFAULT_DMX_SIZE,
        })
        gi++
      }
    }

    const nd = fx.fixtures.filter((f) => f.kind === "ND") as NdFixture[]
    snap()
    fx.setAllFixtures([...nextDmx, ...nd])
  }

  function exportJson() {
    const data = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      bgUrl,
      fixtures: fx.fixtures,
      zones: zo.zones,
      view: viewport.view,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "magma-map.json"
    a.click()
    URL.revokeObjectURL(url)
    setStatusMsg(`Exportado: ${fx.fixtures.length} fixtures, ${zo.zones.length} zonas.`)
  }

  async function onImportProjectJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text())
      if (!parsed || typeof parsed !== "object") {
        setStatusMsg("JSON inválido.")
        return
      }
      const root = (parsed.fixtures || parsed.zones) ? parsed : (parsed.data ?? {})
      const rawFx = Array.isArray(root.fixtures) ? root.fixtures : []
      const rawZo = Array.isArray(root.zones) ? root.zones : []
      if (!rawFx.length && !rawZo.length) {
        setStatusMsg("No se encontraron fixtures ni zonas.")
        return
      }

      snap()
      const nextFx = coerceImportedFixtures(rawFx)
      const nextZo = zo.coerceImportedZones(rawZo)
      fx.setAllFixtures(nextFx)
      zo.setAllZones(nextZo)

      const newBg =
        typeof root.bgUrl === "string" && !root.bgUrl.startsWith("blob:") ? root.bgUrl : DEFAULT_BG_URL
      setBgUrl(newBg)

      if (root.view?.scale > 0 && Number.isFinite(root.view?.ox)) viewport.setView(root.view)
      else viewport.fitView()

      setStatusMsg(`Importado: ${nextFx.length} fixtures, ${nextZo.length} zonas.`)
    } catch (err) {
      console.error(err)
      setStatusMsg("Error al importar JSON.")
    }
  }

  async function onImportBg(file: File) {
    setBgUrl(createBgFromFile(file))
    viewport.resetFit()
  }

  const COLORS = useMemo(
    () => ({
      classic: riderStyle === "CLASSIC",
      mono: "#e5e7eb",
      strokeBase: "#0b1220",
      selected: "#f59e0b",
      multiSelected: "#fb923c",
      issue: "#ff2d2d",
      label: "#e5e7eb",
      subLabel: riderStyle === "CLASSIC" ? "#a3a3a3" : "#9ca3af",
      fine: riderStyle === "CLASSIC" ? "#737373" : "#6b7280",
      ndStrokeClassic: "#e5e7eb",
    }),
    [riderStyle]
  )

  const baseFillFor = (fixture: AnyFixture) =>
    COLORS.classic
      ? COLORS.mono
      : fixture.kind === "DMX"
        ? DMX_CATALOG[fixture.type].color
        : ND_CATALOG[fixture.type].color

  const audioTrianglePoints = (size: number) => {
    const h = size / 2
    return [-h, -h, -h, h, h, 0]
  }

  const dmxTypes = useMemo(() => Object.keys(DMX_CATALOG) as DmxType[], [])
  const ndTypes = useMemo(() => Object.keys(ND_CATALOG) as NdType[], [])
  const filteredDmx = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase()
    return q
      ? dmxTypes.filter((t) => t.toLowerCase().includes(q) || DMX_CATALOG[t].label.toLowerCase().includes(q))
      : dmxTypes
  }, [dmxTypes, libraryQuery])
  const filteredNd = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase()
    return q
      ? ndTypes.filter((t) => t.toLowerCase().includes(q) || ND_CATALOG[t].label.toLowerCase().includes(q))
      : ndTypes
  }, [ndTypes, libraryQuery])

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage()
      if (!stage) return
      const pos = stage.getPointerPosition()
      if (!pos) return
      if (viewport.onStageMouseDown(pos.x, pos.y, e.evt.button === 1)) return
      if (e.target === stage) {
        fx.clearSelection()
        zo.setSelectedZoneId(null)
      }
    },
    [viewport, fx, zo]
  )

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const pos = e.target.getStage()?.getPointerPosition()
      if (pos) viewport.onStageMouseMove(pos.x, pos.y)
    },
    [viewport]
  )

  const handleStageMouseUp = useCallback(() => viewport.onStageMouseUp(), [viewport])

  return (
    <main className="flex min-h-screen bg-neutral-950 text-white">
      <div className="flex-1 p-6">
        <div className="mb-4 flex flex-wrap gap-2 items-center">
          <button
            className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
            onClick={() => fileInputRef.current?.click()}
          >
            Importar Patch DMX (Excel)
          </button>
          <button
            className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
            onClick={() => projectJsonInputRef.current?.click()}
          >
            Importar proyecto (JSON)
          </button>
          <button
            className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
            onClick={() => bgInputRef.current?.click()}
          >
            Cambiar plano
          </button>
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => { snap(); fx.autoPatchAll() }}>
            Auto-patch todo
          </button>
          <button
            className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
            onClick={() => { snap(); fx.autoPatchSelected() }}
            disabled={fx.selectedUids.size === 0}
          >
            Auto-patch seleccionados
          </button>
          <button
            className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
            onClick={handleUndo}
            disabled={!history.canUndo}
            title="Ctrl+Z"
          >
            ↩ Deshacer
          </button>
          <button
            className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
            onClick={handleRedo}
            disabled={!history.canRedo}
            title="Ctrl+Y"
          >
            ↪ Rehacer
          </button>

          <div className="ml-2 flex items-center gap-2 rounded border border-neutral-800 bg-neutral-900/30 px-2 py-1">
            <span className="text-sm text-neutral-300 font-semibold">Vista</span>
            <button className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700" onClick={viewport.zoomOut}>
              Alejar
            </button>
            <button className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700" onClick={viewport.zoomIn}>
              Acercar
            </button>
            <button className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700" onClick={viewport.resetView}>
              Reset vista
            </button>
            <span className="text-xs text-neutral-400 ml-2">
              Zoom: {(viewport.view.scale * 100).toFixed(0)}% • Space+drag: pan • Del: borrar • Ctrl+D: dupl
            </span>
          </div>

          <label className="ml-2 flex items-center gap-2 text-sm text-neutral-300 select-none">
            <input type="checkbox" checked={showSymbols} onChange={(e) => setShowSymbols(e.target.checked)} /> Ver símbolos
          </label>
          <label className="ml-2 flex items-center gap-2 text-sm text-neutral-300 select-none">
            <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} /> Ver zonas
          </label>
          <label className="ml-2 flex items-center gap-2 text-sm text-neutral-300 select-none">
            <input type="checkbox" checked={editZones} onChange={(e) => setEditZones(e.target.checked)} /> Editar zonas
          </label>
          <label className="ml-2 flex items-center gap-2 text-sm text-neutral-300 select-none">
            <input type="checkbox" checked={lockDragging} onChange={(e) => setLockDragging(e.target.checked)} /> Bloquear arrastre
          </label>

          <div className="ml-2 flex items-center gap-2 rounded border border-neutral-800 bg-neutral-900/30 px-2 py-1">
            <span className="text-sm text-neutral-300 font-semibold">Estilo</span>
            {(["COLOR", "CLASSIC"] as RiderStyle[]).map((s) => (
              <button
                key={s}
                className={`rounded px-3 py-1 text-sm ${riderStyle === s ? "bg-neutral-700" : "bg-neutral-800 hover:bg-neutral-700"}`}
                onClick={() => setRiderStyle(s)}
              >
                {s === "COLOR" ? "Rider color" : "Rider clásico"}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-neutral-300">
              Issues:{" "}
              <span className={fx.issueCount > 0 ? "text-red-400 font-semibold" : "text-green-400 font-semibold"}>
                {fx.issueCount}
              </span>
            </span>
            {fx.selectedUids.size > 1 && <span className="text-sm text-orange-400 font-semibold">{fx.selectedUids.size} seleccionados</span>}
            <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={exportJson}>
              Exportar JSON
            </button>
            {statusMsg && <span className="text-xs text-neutral-300 max-w-[400px] truncate">{statusMsg}</span>}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImportFile(f)
              e.currentTarget.value = ""
            }}
          />
          <input
            ref={bgInputRef}
            type="file"
            accept=".png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImportBg(f)
              e.currentTarget.value = ""
            }}
          />
          <input
            ref={projectJsonInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImportProjectJson(f)
              e.currentTarget.value = ""
            }}
          />
        </div>

        <div className="mb-3 rounded border border-neutral-800 bg-neutral-900/30 p-3 flex flex-wrap gap-4 items-center">
          <span className="text-sm text-neutral-300 font-semibold">Plano</span>
          <div className="flex items-center gap-2 text-sm text-neutral-300">
            Opacidad{" "}
            <input type="range" min={0} max={1} step={0.01} value={bgOpacity} onChange={(e) => setBgOpacity(Number(e.target.value))} />
            <span className="tabular-nums text-neutral-400">{bgOpacity.toFixed(2)}</span>
          </div>
          <span className="ml-6 text-sm text-neutral-400">
            Área: <span className="font-semibold text-neutral-200">{worldSize.width}×{worldSize.height}px</span>
          </span>

          {showZones && (
            <div className="ml-6 flex items-center gap-2 text-sm text-neutral-300">
              Zonas opacidad{" "}
              <input
                type="range"
                min={0}
                max={0.35}
                step={0.01}
                value={zonesOpacity}
                onChange={(e) => setZonesOpacity(Number(e.target.value))}
              />
              <span className="tabular-nums text-neutral-400">{zonesOpacity.toFixed(2)}</span>
            </div>
          )}

          <button className="ml-auto rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => setBgUrl(DEFAULT_BG_URL)}>
            Reset plano
          </button>
        </div>

        <div
          ref={stageWrapRef}
          className="rounded border border-neutral-800 bg-neutral-900/30 p-2 h-[78vh] w-full overflow-hidden"
          style={{ cursor: viewport.isPanning ? "grabbing" : viewport.spaceDown ? "grab" : "default" }}
        >
          <Stage
            ref={(n) => {
              stageRef.current = n
            }}
            width={stageViewport.width}
            height={stageViewport.height}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
          >
            <Layer>
              <Group x={viewport.view.ox} y={viewport.view.oy} scaleX={viewport.view.scale} scaleY={viewport.view.scale}>
                {bgImg && <KonvaImage image={bgImg} x={0} y={0} opacity={bgOpacity} listening={false} />}

                {showZones &&
                  zo.zones.map((z) => {
                    const isSelected = zo.selectedZoneId === z.id
                    const c = centroid(z.points)
                    return (
                      <Group key={z.id}>
                        <Line
                          points={z.points}
                          closed
                          fill={z.color}
                          opacity={zonesOpacity}
                          stroke={z.color}
                          strokeWidth={isSelected ? 3 : 2}
                          draggable={editZones && !z.locked && !lockDragging}
                          onClick={(e) => {
                            e.cancelBubble = true
                            zo.setSelectedZoneId(z.id)
                            fx.clearSelection()
                          }}
                          onDragEnd={(e) => {
                            const dx = e.target.x()
                            const dy = e.target.y()
                            e.target.position({ x: 0, y: 0 })
                            zo.moveZone(z.id, dx, dy)
                          }}
                        />
                        <Text text={z.name} x={c.x + 8} y={c.y - 18} fontSize={14} fill={z.color} opacity={0.95} />

                        {editZones &&
                          isSelected &&
                          z.points.map((_, idx) => {
                            if (idx % 2 !== 0) return null
                            return (
                              <Circle
                                key={`${z.id}-h-${idx}`}
                                x={z.points[idx]}
                                y={z.points[idx + 1]}
                                radius={7}
                                fill="#111827"
                                stroke={z.color}
                                strokeWidth={2}
                                draggable={!z.locked && !lockDragging}
                                onMouseDown={(e) => {
                                  e.cancelBubble = true
                                }}
                                onDragMove={(e) => zo.moveZoneVertex(z.id, idx, e.target.x(), e.target.y())}
                              />
                            )
                          })}
                      </Group>
                    )
                  })}

                {fx.fixtures.map((fixture) => {
                  const isSelected = fx.selectedUids.has(fixture.uid)
                  const isMulti = fx.selectedUids.size > 1 && isSelected
                  const isIssue = fixture.kind === "DMX" ? fx.hasIssue(fixture.uid) : false

                  const fill = isIssue ? COLORS.issue : isMulti ? COLORS.multiSelected : isSelected ? COLORS.selected : baseFillFor(fixture)
                  const stroke = isSelected ? COLORS.selected : COLORS.strokeBase
                  const strokeWidth = isSelected ? 3 : 2
                  const fxLocked = !!fixture.locked || lockDragging

                  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
                    e.cancelBubble = true
                    zo.setSelectedZoneId(null)
                    e.evt.shiftKey ? fx.toggleSelect(fixture.uid) : fx.selectOne(fixture.uid)
                  }

                  if (fixture.kind === "ND" && ND_CATALOG[fixture.type].kind2 === "SCREEN") {
                    const w = Math.max(20, Math.round(fixture.widthPx ?? 220))
                    const h = Math.max(20, Math.round(fixture.heightPx ?? 120))
                    return (
                      <Group key={fixture.uid}>
                        <Rect
                          x={fixture.x}
                          y={fixture.y}
                          width={w}
                          height={h}
                          cornerRadius={10}
                          fill="rgba(0,0,0,0)"
                          stroke={COLORS.classic ? COLORS.ndStrokeClassic : stroke}
                          strokeWidth={strokeWidth}
                          draggable={!fxLocked}
                          onClick={handleClick}
                          onDragStart={() => snap()}
                          onDragEnd={(e) => fx.updateFixture(fixture.uid, { x: e.target.x(), y: e.target.y() })}
                        />
                        <Text
                          text={`${fixture.label ?? ND_CATALOG[fixture.type].label}${
                            fixture.widthM && fixture.heightM ? ` (${fixture.widthM}x${fixture.heightM}m)` : ""
                          }`}
                          x={fixture.x}
                          y={fixture.y - 18}
                          fontSize={12}
                          fill={COLORS.label}
                        />
                      </Group>
                    )
                  }

                  if (fixture.kind === "ND") {
                    const size = Math.max(16, Math.round(fixture.sizePx ?? DEFAULT_AUDIO_SIZE))
                    const rot = fixture.rotation ?? 0
                    const cx = fixture.x + size / 2
                    const cy = fixture.y + size / 2
                    const hOff = size * 1.35
                    const aStroke = COLORS.classic ? COLORS.ndStrokeClassic : "#e5e7eb"

                    return (
                      <Group
                        key={fixture.uid}
                        x={cx}
                        y={cy}
                        rotation={rot}
                        draggable={!fxLocked}
                        onClick={handleClick}
                        onDblClick={() => fx.updateFixture(fixture.uid, { rotation: 0 })}
                        onDragStart={() => snap()}
                        onDragEnd={(e) => {
                          if (e.target !== e.currentTarget) return
                          fx.updateFixture(fixture.uid, { x: e.currentTarget.x() - size / 2, y: e.currentTarget.y() - size / 2 })
                        }}
                      >
                        <Line points={audioTrianglePoints(size)} closed fill="rgba(0,0,0,0)" stroke={aStroke} strokeWidth={strokeWidth} />
                        <Line points={[-size / 2 - 10, 0, -size / 2, 0]} stroke={aStroke} strokeWidth={2} />

                        {isSelected && !fxLocked && (
                          <>
                            <Line points={[0, 0, 0, -hOff]} stroke={aStroke} strokeWidth={2} />
                            <Group
                              x={0}
                              y={-hOff}
                              draggable
                              dragOnTop={false}
                              onMouseDown={(e) => {
                                e.cancelBubble = true
                              }}
                              onDragMove={(e) => {
                                e.cancelBubble = true
                                let deg = normDeg((Math.atan2(e.target.y(), e.target.x()) * 180) / Math.PI)
                                if ((e.evt as MouseEvent).shiftKey) deg = normDeg(snapDeg(deg, 15))
                                fx.updateFixture(fixture.uid, { rotation: deg })
                              }}
                              onDragEnd={(e) => {
                                e.cancelBubble = true
                                e.target.position({ x: 0, y: -hOff })
                              }}
                            >
                              <Rect x={-7} y={-7} width={14} height={14} cornerRadius={7} fill="#111827" stroke={aStroke} strokeWidth={2} />
                            </Group>
                          </>
                        )}

                        <Group rotation={-rot}>
                          <Text text={fixture.label ?? ND_CATALOG[fixture.type].label} x={-80} y={-46} fontSize={12} fill={COLORS.label} />
                          {typeof fixture.quantity === "number" && <Text text={`x${fixture.quantity}`} x={-80} y={-30} fontSize={11} fill={COLORS.subLabel} />}
                        </Group>
                      </Group>
                    )
                  }

                  // DMX
                  const size = Math.max(14, Math.round(fixture.sizePx ?? DEFAULT_DMX_SIZE))
                  const symSize = Math.max(12, Math.round(size * 0.9))

                  return (
                    <Group
                      key={fixture.uid}
                      x={fixture.x}
                      y={fixture.y}
                      draggable={!fxLocked}
                      onClick={handleClick}
                      onDragStart={() => snap()}
                      onDragEnd={(e) => {
                        if (e.target !== e.currentTarget) return
                        fx.updateFixture(fixture.uid, { x: e.currentTarget.x(), y: e.currentTarget.y() })
                      }}
                    >
                      <Rect
                        x={0}
                        y={0}
                        width={size}
                        height={size}
                        cornerRadius={Math.max(6, Math.round(size * 0.18))}
                        fill="rgba(0,0,0,0)"
                        stroke={isIssue ? "#ffffff" : stroke}
                        strokeWidth={isIssue ? 3 : strokeWidth}
                      />
                      {showSymbols && (
                        <Group x={size / 2} y={size / 2} listening={false}>
                          <DmxSymbol type={fixture.type} size={symSize} stroke={fill} />
                        </Group>
                      )}
                      <Text text={`${fixture.type} ${dmxLabel(fixture)}`} x={0} y={-18} fontSize={12} fill={COLORS.label} />
                      {fixture.zona && <Text text={fixture.zona} x={0} y={size + 4} fontSize={10} fill={COLORS.subLabel} />}
                      <Text text={`(${rangeLabel(fixture.address, getChannels(fixture))})`} x={0} y={size + 18} fontSize={10} fill={COLORS.fine} />
                    </Group>
                  )
                })}
              </Group>
            </Layer>
          </Stage>
        </div>
      </div>

      <aside className="w-[460px] border-l border-neutral-800 p-6 space-y-6 overflow-y-auto max-h-screen">
        {/* Librería */}
        <section className="rounded border border-neutral-800 bg-neutral-900/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">Librería</span>
            <div className="flex gap-2">
              {(["DMX", "ND"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`rounded px-3 py-1 text-sm ${libraryTab === tab ? "bg-neutral-700" : "bg-neutral-800 hover:bg-neutral-700"}`}
                  onClick={() => setLibraryTab(tab)}
                >
                  {tab === "ND" ? "NO-DMX" : tab}
                </button>
              ))}
            </div>
          </div>

          <input
            className="mt-3 w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
            placeholder="Buscar..."
            value={libraryQuery}
            onChange={(e) => setLibraryQuery(e.target.value)}
          />

          {libraryTab === "DMX" ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {filteredDmx.map((t) => {
                const previewStroke = riderStyle === "CLASSIC" ? "#e5e7eb" : DMX_CATALOG[t].color
                return (
                  <button
                    key={t}
                    className="rounded bg-neutral-800 hover:bg-neutral-700 p-2 text-left"
                    onClick={() => {
                      snap()
                      fx.addDmxFixture(t)
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-10 w-10 rounded bg-neutral-950 border border-neutral-700 flex items-center justify-center">
                        <Stage width={40} height={40}>
                          <Layer listening={false}>
                            <Group x={20} y={20}>
                              <DmxSymbol type={t} size={28} stroke={previewStroke} />
                            </Group>
                          </Layer>
                        </Stage>
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{t}</div>
                        <div className="text-xs text-neutral-400">{DMX_CATALOG[t].label}</div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {filteredNd.map((t) => (
                <button
                  key={t}
                  className="rounded bg-neutral-800 hover:bg-neutral-700 p-2 text-left"
                  onClick={() => {
                    snap()
                    fx.addNdFixture(t)
                  }}
                >
                  <div className="text-sm font-semibold">{t}</div>
                  <div className="text-xs text-neutral-400">{ND_CATALOG[t].label}</div>
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 text-xs text-neutral-400">
            Shift+click: multisel • Ctrl+A: todo • Del: borrar • Ctrl+D: duplicar • ↑↓←→ mover (Shift=10px)
          </div>
        </section>

        {/* Zonas */}
<section className="rounded border border-neutral-800 bg-neutral-900/30 p-3 space-y-3">
  <div className="flex items-center justify-between">
    <span className="font-semibold">Zonas</span>
    <button
      className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700"
      onClick={() => {
        snap()
        zo.addZone()
      }}
    >
      + Añadir
    </button>
  </div>

  {zo.zones.length === 0 && <div className="text-sm text-neutral-400">No hay zonas.</div>}

  <div className="space-y-2">
    {zo.zones.map((z) => (
      <button
        key={z.id}
        className={`w-full rounded border px-3 py-2 text-left ${
          zo.selectedZoneId === z.id
            ? "border-neutral-500 bg-neutral-800"
            : "border-neutral-800 bg-neutral-900/20 hover:bg-neutral-800"
        }`}
        onClick={() => {
          zo.setSelectedZoneId(z.id)
          fx.clearSelection()
        }}
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold">{z.name}</span>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded" style={{ background: z.color }} />
            <span className="text-xs text-neutral-400">{Math.floor(z.points.length / 2)} pts</span>
          </div>
        </div>
      </button>
    ))}
  </div>

  {(() => {
    const selZone = zo.selectedZone
    if (!selZone) {
      return <div className="text-sm text-neutral-400">Selecciona una zona para editarla.</div>
    }

    return (
      <div className="rounded border border-neutral-800 bg-neutral-950/30 p-3 space-y-3">
        <div>
          <label className="mb-1 block text-sm">Nombre</label>
          <input
            className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
            value={selZone.name}
            onChange={(e) => zo.updateZone(selZone.id, { name: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm">Color</label>
          <input
            type="color"
            value={selZone.color}
            onChange={(e) => zo.updateZone(selZone.id, { color: e.target.value })}
            className="h-10 w-full rounded bg-neutral-800 p-1"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-300 select-none">
          <input
            type="checkbox"
            checked={!!selZone.locked}
            onChange={(e) => zo.updateZone(selZone.id, { locked: e.target.checked })}
          />{" "}
          Bloquear zona
        </label>

        <div className="grid grid-cols-2 gap-2">
          <button
            className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
            onClick={() => zo.addZonePoint(selZone.id)}
            disabled={!!selZone.locked}
          >
            + Punto
          </button>
          <button
            className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
            onClick={() => zo.removeZonePoint(selZone.id)}
            disabled={!!selZone.locked}
          >
            − Punto
          </button>
        </div>

        <button
          className="w-full rounded bg-red-600 px-3 py-2 text-sm hover:bg-red-500"
          onClick={() => {
            snap()
            zo.deleteZone(selZone.id)
          }}
        >
          Borrar zona
        </button>
      </div>
    )
  })()}
</section>

        {/* Propiedades */}
        <section>
          <h2 className="mb-3 text-lg font-semibold">Propiedades</h2>

          {!fx.selectedFixture && (
            <p className="text-neutral-400 text-sm">
              {fx.selectedUids.size > 1
                ? `${fx.selectedUids.size} fixtures seleccionados. Del para borrar, Ctrl+D para duplicar.`
                : "Selecciona un objeto"}
            </p>
          )}

          {fx.selectedFixture && (
            <>
              <div className="mb-4 rounded border border-neutral-800 bg-neutral-900/30 p-3">
                <label className="flex items-center gap-2 text-sm text-neutral-300 select-none">
                  <input
                    type="checkbox"
                    checked={!!fx.selectedFixture.locked}
                    onChange={(e) => fx.updateFixture(fx.selectedFixture!.uid, { locked: e.target.checked })}
                  />{" "}
                  Bloquear este fixture
                </label>
              </div>

              {fx.selectedFixture.kind === "DMX" && (
                <div className="space-y-4">
                  <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3">
                    <div className="text-sm text-neutral-300">DMX</div>
                    <div className="mt-1 font-semibold">
                      {fx.selectedFixture.id} — {DMX_CATALOG[fx.selectedFixture.type].label}
                    </div>
                    <div className="mt-1 text-sm text-neutral-300">
                      Addr:{" "}
                      <span className={fx.selectedIssues.length > 0 ? "text-red-400 font-semibold" : "text-green-400 font-semibold"}>
                        {dmxLabel(fx.selectedFixture)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-neutral-300">
                      Modo: <span className="font-semibold">{getMode(fx.selectedFixture).label}</span> • Ch:{" "}
                      <span className="font-semibold">{getChannels(fx.selectedFixture)}</span> • Rango:{" "}
                      <span className="font-semibold">{rangeLabel(fx.selectedFixture.address, getChannels(fx.selectedFixture))}</span>
                    </div>
                  </div>

                  <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-sm">Universe</label>
                        <input
                          className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                          value={fx.universeInput}
                          onChange={(e) => fx.setUniverseInput(e.target.value)}
                          onBlur={() => {
                            const u = clamp(Number(fx.universeInput || 1), 1, 99)
                            fx.updateFixture(fx.selectedFixture!.uid, { universe: u })
                            fx.setUniverseInput(String(u))
                          }}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm">Address</label>
                        <input
                          className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                          value={fx.addressInput}
                          onChange={(e) => fx.setAddressInput(e.target.value)}
                          onBlur={() => {
                            const a = clamp(Number(fx.addressInput || 1), 1, 512)
                            fx.updateFixture(fx.selectedFixture!.uid, { address: a })
                            fx.setAddressInput(String(a))
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm">Tipo</label>
                      <select
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                        value={fx.selectedFixture.type}
                        onChange={(e) => {
                          const t = e.target.value as DmxType
                          fx.updateFixture(fx.selectedFixture!.uid, { type: t, modeId: DMX_CATALOG[t].modes[0].id })
                        }}
                      >
                        {dmxTypes.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm">Modo</label>
                      <select
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                        value={fx.selectedFixture.modeId}
                        onChange={(e) => fx.updateFixture(fx.selectedFixture!.uid, { modeId: e.target.value })}
                      >
                        {DMX_CATALOG[fx.selectedFixture.type].modes.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label} ({m.channels}ch)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm">Tamaño (px)</label>
                      <input
                        type="range"
                        min={10}
                        max={120}
                        step={1}
                        value={Math.round(fx.selectedFixture.sizePx ?? DEFAULT_DMX_SIZE)}
                        onChange={(e) => fx.updateFixture(fx.selectedFixture!.uid, { sizePx: Number(e.target.value) })}
                      />
                      <div className="text-xs text-neutral-400">{Math.round(fx.selectedFixture.sizePx ?? DEFAULT_DMX_SIZE)} px</div>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm">Zona</label>
                      <input
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                        value={fx.selectedFixture.zona ?? ""}
                        onChange={(e) => fx.updateFixture(fx.selectedFixture!.uid, { zona: e.target.value || undefined })}
                        placeholder="ESCENARIO / PISTA / VIP..."
                      />
                    </div>

                    {fx.selectedIssues.length > 0 ? (
                      <div className="rounded border border-red-700/50 bg-red-950/30 p-3">
                        <div className="font-semibold text-red-300">Problemas DMX</div>
                        <ul className="mt-2 space-y-1 text-sm text-red-200">
                          {fx.selectedIssues.map((it, idx) =>
                            it.kind === "OUT_OF_RANGE" ? (
                              <li key={idx}>
                                Fuera de rango: U{it.universe} {it.start}-{it.end}
                              </li>
                            ) : (
                              <li key={idx}>
                                Solape en U{it.universe} con {it.withUid}
                              </li>
                            )
                          )}
                        </ul>
                      </div>
                    ) : (
                      <div className="text-sm text-green-300">Sin conflictos DMX.</div>
                    )}
                  </div>
                </div>
              )}

              {fx.selectedFixture.kind === "ND" && (
                <div className="space-y-4">
                  <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3">
                    <div className="text-sm text-neutral-300">NO-DMX</div>
                    <div className="mt-1 font-semibold">
                      {fx.selectedFixture.id} — {ND_CATALOG[fx.selectedFixture.type].label}
                    </div>
                  </div>

                  <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3 space-y-3">
                    <div>
                      <label className="mb-1 block text-sm">Etiqueta</label>
                      <input
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                        value={fx.selectedFixture.label ?? ""}
                        onChange={(e) => fx.updateFixture(fx.selectedFixture!.uid, { label: e.target.value || undefined })}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm">Zona</label>
                      <input
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                        value={fx.selectedFixture.zona ?? ""}
                        onChange={(e) => fx.updateFixture(fx.selectedFixture!.uid, { zona: e.target.value || undefined })}
                        placeholder="ESCENARIO / PISTA / VIP..."
                      />
                    </div>

                    {ND_CATALOG[fx.selectedFixture.type].kind2 === "SCREEN" ? (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          {(["widthM", "heightM"] as const).map((key) => (
                            <div key={key}>
                              <label className="mb-1 block text-sm">{key === "widthM" ? "Ancho (m)" : "Alto (m)"}</label>
                              <input
                                className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                                value={(fx.selectedFixture as NdFixture)[key] ?? ""}
                                onChange={(e) =>
                                  fx.updateFixture(fx.selectedFixture!.uid, { [key]: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<AnyFixture>)
                                }
                              />
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          {(["widthPx", "heightPx"] as const).map((key) => (
                            <div key={key}>
                              <label className="mb-1 block text-sm">{key === "widthPx" ? "Ancho (px)" : "Alto (px)"}</label>
                              <input
                                className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                                value={(fx.selectedFixture as NdFixture)[key] ?? ""}
                                onChange={(e) =>
                                  fx.updateFixture(fx.selectedFixture!.uid, { [key]: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<AnyFixture>)
                                }
                              />
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block text-sm">Módulos</label>
                            <input
                              className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                              value={(fx.selectedFixture as NdFixture).modules ?? ""}
                              onChange={(e) =>
                                fx.updateFixture(fx.selectedFixture!.uid, { modules: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<AnyFixture>)
                              }
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-sm">Procesador</label>
                            <input
                              className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                              value={(fx.selectedFixture as NdFixture).processor ?? ""}
                              onChange={(e) => fx.updateFixture(fx.selectedFixture!.uid, { processor: e.target.value || undefined })}
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block text-sm">Cantidad</label>
                            <input
                              className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                              value={(fx.selectedFixture as NdFixture).quantity ?? ""}
                              onChange={(e) =>
                                fx.updateFixture(fx.selectedFixture!.uid, { quantity: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<AnyFixture>)
                              }
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-sm">Tamaño (px)</label>
                            <input
                              className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                              value={(fx.selectedFixture as NdFixture).sizePx ?? ""}
                              onChange={(e) =>
                                fx.updateFixture(fx.selectedFixture!.uid, { sizePx: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<AnyFixture>)
                              }
                            />
                          </div>
                        </div>

                        <div>
                          <label className="mb-1 block text-sm">Rotación (°)</label>
                          <input
                            className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700"
                            value={(fx.selectedFixture as NdFixture).rotation ?? 0}
                            onChange={(e) => fx.updateFixture(fx.selectedFixture!.uid, { rotation: Number(e.target.value) })}
                          />
                          <div className="text-xs text-neutral-400">Arrastra el handle en el plano. Shift: snap 15°. Dbl-click: reset.</div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <div className="text-xs text-neutral-500">Coordenadas en px del PNG. Undo/Redo: Ctrl+Z / Ctrl+Y.</div>
      </aside>
    </main>
  )
}