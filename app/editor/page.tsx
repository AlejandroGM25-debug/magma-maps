"use client"

import { useMemo, useRef, useState, useEffect, useCallback } from "react"
import { Stage, Layer, Rect, Text, Group, Line, Circle, Image as KonvaImage } from "react-konva"
import type Konva from "konva"
import * as XLSX from "xlsx"

/** =========================
 *  CONFIG
 *  ========================= */
const DEFAULT_BG_URL = "/plano-magma.png"

// Tamaños por defecto (en px del plano)
const DEFAULT_DMX_SIZE = 28
const DEFAULT_AUDIO_SIZE = 36

/** =========================
 *  CATÁLOGOS
 *  ========================= */

const DMX_CATALOG = {
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
type DmxType = keyof typeof DMX_CATALOG

const ND_CATALOG = {
  // PANTALLAS
  "PANTALLA ESCENARIO": { label: "Pantalla Escenario", color: "#8b5cf6", kind2: "SCREEN" as const },
  "PANTALLA PISTA": { label: "Pantalla Pista", color: "#7c3aed", kind2: "SCREEN" as const },
  "PANTALLA CABINA DJ": { label: "Pantalla Cabina DJ", color: "#6d28d9", kind2: "SCREEN" as const },

  // AUDIO
  ARRAY_L: { label: "Array L (5x Aero20A)", color: "#38bdf8", kind2: "AUDIO" as const },
  ARRAY_R: { label: "Array R (5x Aero20A)", color: "#38bdf8", kind2: "AUDIO" as const },
  SUB_U218: { label: "Sub DAS U-218", color: "#0ea5e9", kind2: "AUDIO" as const },
  ESCENARIO_L: { label: "Escenario L (Aero12A)", color: "#22c55e", kind2: "AUDIO" as const },
  ESCENARIO_R: { label: "Escenario R (Aero12A)", color: "#22c55e", kind2: "AUDIO" as const },
  MONITOR_DJ: { label: "Monitor DJ (Aero12A)", color: "#10b981", kind2: "AUDIO" as const },
  SUB_DJ_118A: { label: "Sub DJ (118A)", color: "#14b8a6", kind2: "AUDIO" as const },
} as const
type NdType = keyof typeof ND_CATALOG
type NdKind2 = (typeof ND_CATALOG)[NdType]["kind2"]

type DmxFixture = {
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

  /** tamaño editable en px del plano */
  sizePx?: number
}

type NdFixture = {
  kind: "ND"
  uid: string
  id: string
  x: number
  y: number
  type: NdType
  zona?: string
  label?: string
  quantity?: number

  // pantallas (datos técnicos)
  widthM?: number
  heightM?: number

  // pantallas (tamaño en plano)
  widthPx?: number
  heightPx?: number

  // audio
  sizePx?: number
  rotation?: number

  modules?: number
  processor?: string

  locked?: boolean
}

type AnyFixture = DmxFixture | NdFixture

type PatchRow = {
  id: string
  tipo: string
  canales: number
  universe: number
  address: number
  zona?: string
}

/** =========================
 *  UTILS
 *  ========================= */

function isDmxType(t: string): t is DmxType {
  return (Object.keys(DMX_CATALOG) as string[]).includes(t)
}

function dmxLabel(fx: Pick<DmxFixture, "universe" | "address">) {
  return `U${fx.universe}:${fx.address}`
}

function rangeLabel(start: number, channels: number) {
  const end = start + channels - 1
  return `${start}-${end}`
}

function getMode(fx: DmxFixture) {
  const entry = DMX_CATALOG[fx.type]
  return entry.modes.find((m) => m.id === fx.modeId) ?? entry.modes[0]
}

function getChannels(fx: DmxFixture) {
  return getMode(fx).channels
}

function findModeIdByChannels(type: DmxType, channels: number) {
  const entry = DMX_CATALOG[type]
  const mode = entry.modes.find((m) => m.channels === channels)
  return mode ? mode.id : entry.modes[0].id
}

function zoneBucket(zonaRaw?: string) {
  const z = (zonaRaw ?? "").toUpperCase()
  if (z.includes("ESCENARIO")) return "ESCENARIO"
  if (z.includes("PISTA")) return "PISTA"
  if (z.includes("VIP")) return "VIP"
  return "OTROS"
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function normDeg(n: number) {
  const x = ((n % 360) + 360) % 360
  return x
}

function snapDeg(deg: number, step: number) {
  return Math.round(deg / step) * step
}

/** =========================
 *  HOOK: tamaño contenedor
 *  ========================= */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 1200, height: 720 })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      const cr = entry.contentRect
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

/** =========================
 *  SÍMBOLOS DMX (técnicos)
 *  ========================= */

function SunIcon({ r, stroke, strokeWidth }: { r: number; stroke: string; strokeWidth: number }) {
  const rays = 8
  const rayInner = r * 0.85
  const rayOuter = r * 1.35

  return (
    <Group>
      <Circle x={0} y={0} radius={r * 0.55} fill={stroke} opacity={0.95} />
      {Array.from({ length: rays }).map((_, i) => {
        const a = (Math.PI * 2 * i) / rays
        const x1 = Math.cos(a) * rayInner
        const y1 = Math.sin(a) * rayInner
        const x2 = Math.cos(a) * rayOuter
        const y2 = Math.sin(a) * rayOuter
        return <Line key={i} points={[x1, y1, x2, y2]} stroke={stroke} strokeWidth={strokeWidth} lineCap="round" />
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
      <Line points={[-5, 12, 0, 8, 5, 12]} stroke={stroke} strokeWidth={strokeWidth} lineCap="round" lineJoin="round" />
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
      <Circle x={-r * 0.35} y={-r * 0.15} radius={r * 0.1} fill={stroke} opacity={0.9} />
      <Circle x={r * 0.35} y={-r * 0.15} radius={r * 0.1} fill={stroke} opacity={0.9} />
      <Circle x={-r * 0.35} y={r * 0.25} radius={r * 0.1} fill={stroke} opacity={0.9} />
      <Circle x={r * 0.35} y={r * 0.25} radius={r * 0.1} fill={stroke} opacity={0.9} />
    </Group>
  )
}

function StrobeIcon({ r, stroke, strokeWidth }: { r: number; stroke: string; strokeWidth: number }) {
  return (
    <Group>
      <Rect x={-r * 0.9} y={-r * 0.45} width={r * 1.8} height={r * 0.9} cornerRadius={8} stroke={stroke} strokeWidth={strokeWidth} />
      <Line points={[-r * 0.55, r * 0.35, -r * 0.1, -r * 0.1, r * 0.55, r * 0.35]} stroke={stroke} strokeWidth={strokeWidth} lineJoin="round" />
      <Line points={[-r * 0.55, -r * 0.35, -r * 0.1, 0, r * 0.55, -r * 0.35]} stroke={stroke} strokeWidth={strokeWidth} lineJoin="round" opacity={0.6} />
    </Group>
  )
}

function LedBarIcon({ r, stroke, strokeWidth }: { r: number; stroke: string; strokeWidth: number }) {
  return (
    <Group>
      <Rect x={-r * 0.95} y={-r * 0.25} width={r * 1.9} height={r * 0.5} cornerRadius={6} stroke={stroke} strokeWidth={strokeWidth} />
      {Array.from({ length: 6 }).map((_, i) => (
        <Circle key={i} x={-r * 0.75 + i * (r * 0.3)} y={0} radius={r * 0.06} fill={stroke} opacity={0.9} />
      ))}
    </Group>
  )
}

function BlinderIcon({ r, stroke, strokeWidth }: { r: number; stroke: string; strokeWidth: number }) {
  return (
    <Group>
      <Rect x={-r * 0.7} y={-r * 0.7} width={r * 1.4} height={r * 1.4} cornerRadius={10} stroke={stroke} strokeWidth={strokeWidth} />
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

/** =========================
 *  ZONAS (polígonos)
 *  ========================= */

type ZonePoly = {
  id: string
  name: string
  color: string
  points: number[] // [x1,y1,x2,y2...]
  locked?: boolean
}

function genId(prefix = "id") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyCrypto: any = typeof crypto !== "undefined" ? crypto : null
  const id = anyCrypto?.randomUUID ? anyCrypto.randomUUID() : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${id}`
}

function centroid(points: number[]) {
  let x = 0
  let y = 0
  const n = Math.max(1, Math.floor(points.length / 2))
  for (let i = 0; i < points.length; i += 2) {
    x += points[i]
    y += points[i + 1]
  }
  return { x: x / n, y: y / n }
}

/** =========================
 *  VIEW (zoom/pan)
 *  ========================= */
type View = {
  scale: number
  ox: number
  oy: number
}

/** =========================
 *  EDITOR
 *  ========================= */

type RiderStyle = "COLOR" | "CLASSIC"

export default function EditorPage() {
  const [fixtures, setFixtures] = useState<AnyFixture[]>([])
  const [selectedUid, setSelectedUid] = useState<string | null>(null)

  const [universeInput, setUniverseInput] = useState<string>("")
  const [addressInput, setAddressInput] = useState<string>("")

  const [showSymbols, setShowSymbols] = useState<boolean>(true)

  // Fondo
  const [bgUrl, setBgUrl] = useState<string | null>(DEFAULT_BG_URL)
  const [bgOpacity, setBgOpacity] = useState<number>(1.0)
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null)

  // Bloqueo global
  const [lockDragging, setLockDragging] = useState<boolean>(false)

  // Zonas
  const [showZones, setShowZones] = useState<boolean>(true)
  const [zonesOpacity, setZonesOpacity] = useState<number>(0.18)
  const [zones, setZones] = useState<ZonePoly[]>([])
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [editZones, setEditZones] = useState<boolean>(true)

  // Librería
  const [libraryTab, setLibraryTab] = useState<"DMX" | "ND">("DMX")
  const [libraryQuery, setLibraryQuery] = useState<string>("")

  // Estilo
  const [riderStyle, setRiderStyle] = useState<RiderStyle>("COLOR")

  // Mensajes/estado (import/export)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  // Zoom/pan
  const stageRef = useRef<Konva.Stage | null>(null)
  const [view, setView] = useState<View>({ scale: 1, ox: 0, oy: 0 })
  const [spaceDown, setSpaceDown] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const panLast = useRef<{ x: number; y: number } | null>(null)

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

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const bgInputRef = useRef<HTMLInputElement | null>(null)
  const projectJsonInputRef = useRef<HTMLInputElement | null>(null)

  // ✅ AUTOSAVE
  const AUTOSAVE_KEY = "magma-map-autosave-v2"
  const autosaveLoadedRef = useRef(false)
  const autosaveTimerRef = useRef<number | null>(null)

useEffect(() => {
  if (autosaveLoadedRef.current) return

  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) {
      autosaveLoadedRef.current = true
      return
    }

    const parsed = JSON.parse(raw)

    // soporta root directo o root anidado en data
    const root =
      parsed?.fixtures || parsed?.zones || parsed?.bgUrl || parsed?.view
        ? parsed
        : parsed?.data ?? {}

    const rawFixtures = Array.isArray(root?.fixtures) ? root.fixtures : []
    const rawZones = Array.isArray(root?.zones) ? root.zones : []

    const nextFixtures = coerceImportedFixtures(rawFixtures)
    const nextZones = coerceImportedZones(rawZones)

    // bgUrl: si es blob no sirve tras refresh
    let nextBgUrl = bgUrl
    if (typeof root?.bgUrl === "string" && root.bgUrl && !root.bgUrl.startsWith("blob:")) {
      nextBgUrl = root.bgUrl
    }

    // aplica estado
    setFixtures(nextFixtures)
    setZones(nextZones)
    setBgUrl(nextBgUrl)

    // vista: si viene, úsala y evita que el init-fit la pise
    if (isValidView(root?.view)) {
      setView(root.view)
      didInitFit.current = true
    }

    setSelectedUid(nextFixtures[0]?.uid ?? null)
    setSelectedZoneId(nextZones[0]?.id ?? null)

    setUniverseInput("")
    setAddressInput("")

    setStatusMsg(
      `Autosave restaurado: ${nextFixtures.length} fixtures, ${nextZones.length} zonas.`
    )
  } catch (e) {
    console.warn("Autosave inválido, se ignora:", e)
  } finally {
    autosaveLoadedRef.current = true
  }
// solo al montar
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [])

useEffect(() => {
  // evita escribir antes de intentar restaurar al montar
  if (!autosaveLoadedRef.current) return

  // debounce: no guardamos en cada pixel de drag
  if (autosaveTimerRef.current) {
    window.clearTimeout(autosaveTimerRef.current)
  }

  autosaveTimerRef.current = window.setTimeout(() => {
    try {
      const data = {
        schemaVersion: 2,
        savedAt: new Date().toISOString(),
        bgUrl: typeof bgUrl === "string" && bgUrl && !bgUrl.startsWith("blob:") ? bgUrl : null,
        fixtures,
        zones,
        view,
      }
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data))
      // opcional: no spamear statusMsg, lo dejamos silencioso
      // setStatusMsg("Autosave guardado.")
    } catch (e) {
      console.warn("No se pudo guardar autosave:", e)
    }
  }, 250)

  return () => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }
}, [AUTOSAVE_KEY, bgUrl, fixtures, zones, view])

  // Contenedor responsive
  const { ref: stageWrapRef, size: stageViewport } = useElementSize<HTMLDivElement>()

  // Mundo = tamaño del plano
  const worldSize = useMemo(() => {
  const w = bgImg?.naturalWidth ?? 0
  const h = bgImg?.naturalHeight ?? 0
  return { width: w, height: h }
}, [bgImg])

  // Fit inicial automático, luego deja zoom/pan libre
  const fitView = useCallback(() => {
  const vw = stageViewport.width
  const vh = stageViewport.height
  const ww = worldSize.width
  const wh = worldSize.height

  if (!vw || !vh || !ww || !wh) return

  // ✅ siempre centrado al 25% (igual que tu "Reset vista")
  const v = computeCenteredView(vw, vh, ww, wh, 0.25)
  setView(v)
}, [stageViewport.width, stageViewport.height, worldSize.width, worldSize.height])

  // Re-fit al cargar imagen o al cambiar tamaño del viewport, pero sólo si aún no se ha “tocado” mucho
  const didInitFit = useRef(false)
  useEffect(() => {
  const vw = stageViewport.width
  const vh = stageViewport.height
  const ww = worldSize.width
  const wh = worldSize.height

  // 🔴 Esperar a que haya tamaños reales
  if (!vw || !vh || !ww || !wh) return
  // opcional pero recomendado:
  if (!bgImg || !bgImg.naturalWidth || !bgImg.naturalHeight) return
  // 🟢 Solo una vez: centrar al iniciar
  if (!didInitFit.current) {
    fitView()
    didInitFit.current = true
    return
  }
    // si redimensionas ventana, re-centramos manteniendo el mismo zoom
    setView((v) => {
      const vw = stageViewport.width
      const vh = stageViewport.height
      // centrado suave: si el plano queda fuera, re-acomoda un poco
      const minOx = vw - worldSize.width * v.scale
      const minOy = vh - worldSize.height * v.scale
      const ox = clamp(v.ox, minOx, 0)
      const oy = clamp(v.oy, minOy, 0)
      return { ...v, ox, oy }
    })
  }, [
  stageViewport.width,
  stageViewport.height,
  worldSize.width,
  worldSize.height,
  fitView,
  bgImg   
])

  // Teclas (Space para pan)
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceDown(true)
        // Evita scroll
        e.preventDefault()
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceDown(false)
        setIsPanning(false)
        panLast.current = null
      }
    }
    window.addEventListener("keydown", onDown, { passive: false } as any)
    window.addEventListener("keyup", onUp)
    return () => {
      window.removeEventListener("keydown", onDown as any)
      window.removeEventListener("keyup", onUp)
    }
  }, [])

  const selectedFixture = fixtures.find((f) => f.uid === selectedUid) ?? null
  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null

  function selectFixture(uid: string, listOverride?: AnyFixture[]) {
    const list = listOverride ?? fixtures
    setSelectedUid(uid)
    const fx = list.find((f) => f.uid === uid)
    if (fx && fx.kind === "DMX") {
      setUniverseInput(String(fx.universe))
      setAddressInput(String(fx.address))
    } else {
      setUniverseInput("")
      setAddressInput("")
    }
  }

  function updateFixture(uid: string, patch: Partial<AnyFixture>) {
    setFixtures((prev) => prev.map((fx) => (fx.uid === uid ? ({ ...fx, ...patch } as AnyFixture) : fx)))
  }

  function addDmxFixture(type: DmxType) {
    const uid = genId("uid")
    const id = `NEW_DMX_${fixtures.length + 1}`
    const defaultMode = DMX_CATALOG[type].modes[0].id
    const fx: DmxFixture = {
      kind: "DMX",
      uid,
      id,
      x: Math.round(worldSize.width * 0.5),
      y: Math.round(worldSize.height * 0.35),
      type,
      modeId: defaultMode,
      universe: 1,
      address: 1,
      sizePx: DEFAULT_DMX_SIZE,
    }
    const next = [...fixtures, fx]
    setFixtures(next)
    selectFixture(uid, next)
  }

  function addNdFixture(type: NdType) {
    const uid = genId("uid")
    const id = `${type}_${fixtures.length + 1}`

    const preset =
      type === "PANTALLA ESCENARIO"
        ? { label: "Pantalla Escenario", widthM: 6, heightM: 2, widthPx: 520, heightPx: 180, modules: 48, processor: "Novastar VX600" }
        : type === "PANTALLA PISTA"
          ? { label: "Pantalla Pista", widthM: 1, heightM: 4, widthPx: 160, heightPx: 420, modules: 16, processor: "Novastar VX600" }
          : type === "PANTALLA CABINA DJ"
            ? { label: "Pantalla Cabina DJ", widthM: 3, heightM: 1, widthPx: 320, heightPx: 120, modules: 12, processor: "Novastar VX600" }
            : {}

    const audioPreset =
      type === "ARRAY_L"
        ? { label: "Array L", quantity: 5, rotation: 0, sizePx: DEFAULT_AUDIO_SIZE }
        : type === "ARRAY_R"
          ? { label: "Array R", quantity: 5, rotation: 180, sizePx: DEFAULT_AUDIO_SIZE }
          : type === "SUB_U218"
            ? { label: "Sub U-218", quantity: 1, rotation: 0, sizePx: DEFAULT_AUDIO_SIZE }
            : type === "ESCENARIO_L"
              ? { label: "Escenario L", quantity: 1, rotation: 0, sizePx: DEFAULT_AUDIO_SIZE }
              : type === "ESCENARIO_R"
                ? { label: "Escenario R", quantity: 1, rotation: 180, sizePx: DEFAULT_AUDIO_SIZE }
                : type === "MONITOR_DJ"
                  ? { label: "Monitor DJ", quantity: 1, rotation: 0, sizePx: DEFAULT_AUDIO_SIZE }
                  : type === "SUB_DJ_118A"
                    ? { label: "Sub DJ 118A", quantity: 1, rotation: 0, sizePx: DEFAULT_AUDIO_SIZE }
                    : {}

    const fx: NdFixture = {
      kind: "ND",
      uid,
      id,
      x: Math.round(worldSize.width * 0.55),
      y: Math.round(worldSize.height * 0.2),
      type,
      ...preset,
      ...audioPreset,
    }

    const next = [...fixtures, fx]
    setFixtures(next)
    selectFixture(uid, next)
  }

  /** =========================
   *  IMPORT EXCEL DMX
   *  ========================= */

  function triggerImport() {
    fileInputRef.current?.click()
  }

  async function onImportFile(file: File) {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: "array" })
    const sheetName = wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]

    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[]
    const parsed: PatchRow[] = rows
      .map((r) => ({
        id: String(r.id ?? r.ID ?? r.Id ?? "").trim(),
        tipo: String(r.tipo ?? r.TIPO ?? r.Tipo ?? "").trim(),
        canales: Number(r.canales ?? r.CANALES ?? r.Canales ?? 0),
        universe: Number(r.universe ?? r.UNIVERSE ?? r.Universe ?? 0),
        address: Number(r.address ?? r.ADDRESS ?? r.Address ?? 0),
        zona: String(r.zona ?? r.ZONA ?? r.Zona ?? "").trim(),
      }))
      .filter((r) => r.id && r.tipo && Number.isFinite(r.canales) && r.canales > 0 && r.universe > 0 && r.address > 0)

    const buckets: Record<string, PatchRow[]> = { ESCENARIO: [], PISTA: [], VIP: [], OTROS: [] }
    for (const r of parsed) buckets[zoneBucket(r.zona)].push(r)
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a, b) => (a.universe - b.universe) || (a.address - b.address) || a.id.localeCompare(b.id))
    }

    // Colocación inicial
    const order = ["ESCENARIO", "PISTA", "VIP", "OTROS"] as const
    const margin = 80
    const cols = 18
    const stepX = 46
    const stepY = 46

    const bandH = Math.max(240, Math.floor((worldSize.height - margin * 2) / 4))
    const bandY: Record<(typeof order)[number], number> = {
      ESCENARIO: margin,
      PISTA: margin + bandH * 1,
      VIP: margin + bandH * 2,
      OTROS: margin + bandH * 3,
    }

    const nextDmx: DmxFixture[] = []
    let globalIndex = 0

    for (const bucket of order) {
      const list = buckets[bucket]
      for (let i = 0; i < list.length; i++) {
        const r = list[i]
        const tipoUpper = r.tipo.toUpperCase()
        const safeType: DmxType = isDmxType(tipoUpper) ? (tipoUpper as DmxType) : "LED"
        const modeId = findModeIdByChannels(safeType, r.canales)

        nextDmx.push({
          kind: "DMX",
          uid: `${r.id}__${globalIndex}`,
          id: r.id,
          x: clamp(margin + (i % cols) * stepX, 0, worldSize.width - 1),
          y: clamp(bandY[bucket] + Math.floor(i / cols) * stepY, 0, worldSize.height - 1),
          type: safeType,
          modeId,
          universe: r.universe,
          address: r.address,
          zona: r.zona || undefined,
          sizePx: DEFAULT_DMX_SIZE,
        })
        globalIndex++
      }
    }

    const existingNd = fixtures.filter((f) => f.kind === "ND") as NdFixture[]
    const nextAll: AnyFixture[] = [...nextDmx, ...existingNd]
    setFixtures(nextAll)
    if (nextAll.length > 0) selectFixture(nextAll[0].uid, nextAll)
  }

  /** =========================
   *  VALIDACIÓN DMX
   *  ========================= */

  type Issue =
    | { kind: "OVERLAP"; fixtureUid: string; withUid: string; universe: number }
    | { kind: "OUT_OF_RANGE"; fixtureUid: string; universe: number; start: number; end: number }

  const issues = useMemo(() => {
    const out: Issue[] = []
    const dmx = fixtures.filter((f): f is DmxFixture => f.kind === "DMX")

    const byU = new Map<number, DmxFixture[]>()
    for (const fx of dmx) {
      const arr = byU.get(fx.universe) ?? []
      arr.push(fx)
      byU.set(fx.universe, arr)
    }

    for (const [u, list] of byU.entries()) {
      const ranges = list.map((fx) => {
        const ch = getChannels(fx)
        const start = fx.address
        const end = fx.address + ch - 1
        return { fx, start, end, ch }
      })

      for (const r of ranges) {
        if (r.start < 1 || r.end > 512) {
          out.push({ kind: "OUT_OF_RANGE", fixtureUid: r.fx.uid, universe: u, start: r.start, end: r.end })
        }
      }

      for (let i = 0; i < ranges.length; i++) {
        for (let j = i + 1; j < ranges.length; j++) {
          const a = ranges[i]
          const b = ranges[j]
          const overlap = a.start <= b.end && b.start <= a.end
          if (!overlap) continue
          const identical = a.start === b.start && a.end === b.end && a.ch === b.ch
          if (identical) continue
          out.push({ kind: "OVERLAP", fixtureUid: a.fx.uid, withUid: b.fx.uid, universe: u })
          out.push({ kind: "OVERLAP", fixtureUid: b.fx.uid, withUid: a.fx.uid, universe: u })
        }
      }
    }

    return out
  }, [fixtures])

  const issueByFixture = useMemo(() => {
    const m = new Map<string, Issue[]>()
    for (const it of issues) {
      const arr = m.get(it.fixtureUid) ?? []
      arr.push(it)
      m.set(it.fixtureUid, arr)
    }
    return m
  }, [issues])

  const hasIssue = (uid: string) => (issueByFixture.get(uid)?.length ?? 0) > 0
  const issueCount = issues.length
  const selectedIssues = selectedFixture ? issueByFixture.get(selectedFixture.uid) ?? [] : []

  /** =========================
   *  AUTO PATCH (DMX)
   *  ========================= */

  function autoPatch(targetUids?: Set<string>) {
    const universes = [1, 2, 3]
    const dmx = fixtures.filter((f): f is DmxFixture => f.kind === "DMX")
    const nd = fixtures.filter((f): f is NdFixture => f.kind === "ND")

    const occ = new Map<number, boolean[]>()
    for (const u of universes) occ.set(u, Array(513).fill(false))

    for (const fx of dmx) {
      const inTarget = targetUids ? targetUids.has(fx.uid) : true
      if (!inTarget) {
        const ch = getChannels(fx)
        const arr = occ.get(fx.universe)
        if (!arr) continue
        for (let k = fx.address; k < fx.address + ch && k <= 512; k++) arr[k] = true
      }
    }

    function findFreeAddress(u: number, channels: number) {
      const arr = occ.get(u)
      if (!arr) return null
      const maxStart = 512 - channels + 1
      for (let start = 1; start <= maxStart; start++) {
        let ok = true
        for (let k = start; k < start + channels; k++) {
          if (arr[k]) {
            ok = false
            break
          }
        }
        if (ok) return start
      }
      return null
    }

    const sorted = [...dmx].sort((a, b) => a.uid.localeCompare(b.uid))

    const patched = sorted.map((fx) => {
      const inTarget = targetUids ? targetUids.has(fx.uid) : true
      if (!inTarget) return fx

      const channels = getChannels(fx)
      const startUniverseIndex = Math.max(0, universes.indexOf(fx.universe))
      let placed: { universe: number; address: number } | null = null

      for (let i = startUniverseIndex; i < universes.length; i++) {
        const u = universes[i]
        const addr = findFreeAddress(u, channels)
        if (addr != null) {
          const arr = occ.get(u)!
          for (let k = addr; k < addr + channels; k++) arr[k] = true
          placed = { universe: u, address: addr }
          break
        }
      }

      return placed ? { ...fx, universe: placed.universe, address: placed.address } : fx
    })

    const byUid = new Map(patched.map((f) => [f.uid, f]))
    const finalDmx = dmx.map((f) => byUid.get(f.uid) ?? f)
    setFixtures([...finalDmx, ...nd])

    if (selectedUid) {
      const fx = [...finalDmx, ...nd].find((f) => f.uid === selectedUid)
      if (fx && fx.kind === "DMX") {
        setUniverseInput(String(fx.universe))
        setAddressInput(String(fx.address))
      }
    }
  }

  function autoPatchAll() {
    autoPatch(undefined)
  }

  function autoPatchSelected() {
    if (!selectedFixture || selectedFixture.kind !== "DMX") return
    autoPatch(new Set([selectedFixture.uid]))
  }

  /** =========================
   *  FONDO
   *  ========================= */

  function triggerBgImport() {
    bgInputRef.current?.click()
  }

  async function onImportBg(file: File) {
    const url = URL.createObjectURL(file)
    setBgUrl(url)
    didInitFit.current = false
    // re-fit con nueva imagen
    setTimeout(() => {
      fitView()
      didInitFit.current = true
    }, 0)
  }

  /** =========================
   *  ND Helpers
   *  ========================= */

  function ndKind2(type: NdType): NdKind2 {
    return ND_CATALOG[type].kind2
  }

  function screenSizePx(fx: NdFixture) {
    const w = Math.max(20, Math.round(fx.widthPx ?? 220))
    const h = Math.max(20, Math.round(fx.heightPx ?? 120))
    return { w, h }
  }

  function audioTrianglePoints(size: number) {
    const half = size / 2
    return [-half, -half, -half, half, half, 0]
  }

  /** =========================
   *  Librería
   *  ========================= */

  const dmxTypes = useMemo(() => Object.keys(DMX_CATALOG) as DmxType[], [])
  const ndTypes = useMemo(() => Object.keys(ND_CATALOG) as NdType[], [])

  const filteredDmx = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase()
    if (!q) return dmxTypes
    return dmxTypes.filter((t) => t.toLowerCase().includes(q) || DMX_CATALOG[t].label.toLowerCase().includes(q))
  }, [dmxTypes, libraryQuery])

  const filteredNd = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase()
    if (!q) return ndTypes
    return ndTypes.filter((t) => t.toLowerCase().includes(q) || ND_CATALOG[t].label.toLowerCase().includes(q))
  }, [ndTypes, libraryQuery])

  /** =========================
   *  Estilo
   *  ========================= */
  const COLORS = useMemo(() => {
    const classic = riderStyle === "CLASSIC"
    return {
      classic,
      mono: "#e5e7eb",
      strokeBase: "#0b1220",
      selected: "#f59e0b",
      issue: "#ff2d2d",
      label: "#e5e7eb",
      subLabel: classic ? "#a3a3a3" : "#9ca3af",
      fine: classic ? "#737373" : "#6b7280",
      ndFillClassic: "rgba(0,0,0,0)",
      ndStrokeClassic: "#e5e7eb",
    }
  }, [riderStyle])

  function baseFillFor(fx: AnyFixture) {
    if (COLORS.classic) return COLORS.mono
    return fx.kind === "DMX" ? DMX_CATALOG[fx.type].color : ND_CATALOG[fx.type].color
  }

  /** =========================
   *  ZONAS: acciones
   *  ========================= */
  function addZone() {
    const id = genId("zone")
    const base = Math.min(worldSize.width, worldSize.height) * 0.12
    const cx = worldSize.width * 0.5
    const cy = worldSize.height * 0.5
    const z: ZonePoly = {
      id,
      name: `ZONA ${zones.length + 1}`,
      color: "#ffd400",
      points: [cx - base, cy - base, cx + base, cy - base, cx + base, cy + base, cx - base, cy + base],
    }
    const next = [...zones, z]
    setZones(next)
    setSelectedZoneId(id)
    setSelectedUid(null)
  }

  function updateZone(id: string, patch: Partial<ZonePoly>) {
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)))
  }

  function moveZone(id: string, dx: number, dy: number) {
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
  }

  function deleteZone(id: string) {
    setZones((prev) => prev.filter((z) => z.id !== id))
    if (selectedZoneId === id) setSelectedZoneId(null)
  }

  function addZonePoint(id: string) {
    setZones((prev) =>
      prev.map((z) => {
        if (z.id !== id) return z
        const c = centroid(z.points)
        return { ...z, points: [...z.points, c.x + 30, c.y + 30] }
      })
    )
  }

  function removeZonePoint(id: string) {
    setZones((prev) =>
      prev.map((z) => {
        if (z.id !== id) return z
        if (z.points.length <= 6) return z // mínimo triángulo
        return { ...z, points: z.points.slice(0, -2) }
      })
    )
  }

  /** =========================
   *  EXPORT
   *  ========================= */
  function exportJson() {
  const data = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    bgUrl,
    fixtures,
    zones,
    view,
  }

  console.log("EXPORT JSON:", data)
  console.log("EXPORT KEYS:", Object.keys(data))
  console.log("EXPORT zones length:", zones.length)

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  })

  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "magma-map.json"
  a.click()
  URL.revokeObjectURL(url)

  setStatusMsg(
    `Exportado: ${fixtures.length} fixtures, ${zones.length} zonas.`
  )
}

  /** =========================
   *  IMPORT PROYECTO (JSON)
   *  ========================= */

  function triggerProjectImport() {
    projectJsonInputRef.current?.click()
  }

  function coerceImportedFixtures(raw: any): AnyFixture[] {
    if (!Array.isArray(raw)) return []

    const out: AnyFixture[] = []
    for (const it of raw) {
      if (!it || typeof it !== "object") continue
      const kind = it.kind

      if (kind === "DMX") {
        const typeRaw = String(it.type ?? "").toUpperCase()
        const safeType: DmxType = isDmxType(typeRaw) ? (typeRaw as DmxType) : "LED"

        const modeIdRaw = String(it.modeId ?? DMX_CATALOG[safeType].modes[0].id)
        const hasMode = DMX_CATALOG[safeType].modes.some((m) => m.id === modeIdRaw)
        const safeModeId = hasMode ? modeIdRaw : DMX_CATALOG[safeType].modes[0].id

        const fx: DmxFixture = {
          kind: "DMX",
          uid: String(it.uid ?? genId("uid")),
          id: String(it.id ?? "DMX"),
          x: Number(it.x ?? 0),
          y: Number(it.y ?? 0),
          type: safeType,
          modeId: safeModeId,
          universe: Number(it.universe ?? 1),
          address: Number(it.address ?? 1),
          zona: it.zona ? String(it.zona) : undefined,
          locked: !!it.locked,
          sizePx: typeof it.sizePx === "number" ? it.sizePx : DEFAULT_DMX_SIZE,
        }

        // clamp básico al mundo actual (si hay plano cargado)
        fx.x = clamp(fx.x, 0, worldSize.width - 1)
        fx.y = clamp(fx.y, 0, worldSize.height - 1)
        fx.universe = clamp(Math.round(fx.universe), 1, 99)
        fx.address = clamp(Math.round(fx.address), 1, 512)

        out.push(fx)
        continue
      }

      if (kind === "ND") {
        const typeRaw = String(it.type ?? "")
        const safeType = (Object.keys(ND_CATALOG) as NdType[]).includes(typeRaw as NdType) ? (typeRaw as NdType) : null
        if (!safeType) continue

        const fx: NdFixture = {
          kind: "ND",
          uid: String(it.uid ?? genId("uid")),
          id: String(it.id ?? safeType),
          x: Number(it.x ?? 0),
          y: Number(it.y ?? 0),
          type: safeType,
          zona: it.zona ? String(it.zona) : undefined,
          label: it.label ? String(it.label) : undefined,
          quantity: typeof it.quantity === "number" ? it.quantity : undefined,

          widthM: typeof it.widthM === "number" ? it.widthM : undefined,
          heightM: typeof it.heightM === "number" ? it.heightM : undefined,
          widthPx: typeof it.widthPx === "number" ? it.widthPx : undefined,
          heightPx: typeof it.heightPx === "number" ? it.heightPx : undefined,

          sizePx: typeof it.sizePx === "number" ? it.sizePx : DEFAULT_AUDIO_SIZE,
          rotation: typeof it.rotation === "number" ? it.rotation : undefined,

          modules: typeof it.modules === "number" ? it.modules : undefined,
          processor: it.processor ? String(it.processor) : undefined,

          locked: !!it.locked,
        }

        fx.x = clamp(fx.x, 0, worldSize.width - 1)
        fx.y = clamp(fx.y, 0, worldSize.height - 1)

        out.push(fx)
        continue
      }
    }

    return out
  }

  function coerceImportedZones(input: any): ZonePoly[] {
  if (!Array.isArray(input)) return []

  const out: ZonePoly[] = []

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue

    // points: debe ser array de números, mínimo 6 (triángulo = 3 puntos = 6 nums)
    const ptsRaw = (raw as any).points
    if (!Array.isArray(ptsRaw) || ptsRaw.length < 6) continue

    const pts: number[] = []
    for (const v of ptsRaw) {
      const n = typeof v === "number" ? v : Number(v)
      if (!Number.isFinite(n)) {
        // si hay un punto inválido, descartamos la zona entera
        pts.length = 0
        break
      }
      pts.push(n)
    }
    if (pts.length < 6) continue

    const idRaw = (raw as any).id
    const nameRaw = (raw as any).name
    const colorRaw = (raw as any).color
    const lockedRaw = (raw as any).locked

    const z: ZonePoly = {
      id: typeof idRaw === "string" && idRaw.trim() ? idRaw : genId("zone"),
      name: typeof nameRaw === "string" && nameRaw.trim() ? nameRaw : "ZONA",
      color: typeof colorRaw === "string" && colorRaw.trim() ? colorRaw : "#ffd400",
      points: pts,
      // si tu tipo ZonePoly no tiene locked, quita esta línea
      locked: !!lockedRaw,
    }

    out.push(z)
  }

  return out
}

  async function onImportProjectJson(file: File) {
  try {
    const txt = await file.text()
    const parsed = JSON.parse(txt)

  if (!parsed || typeof parsed !== "object") {
  setStatusMsg("JSON inválido.")
  return
}

const hasZones =
  Array.isArray((parsed as any).zones) || Array.isArray((parsed as any)?.data?.zones)

const hasFixtures =
  Array.isArray((parsed as any).fixtures) || Array.isArray((parsed as any)?.data?.fixtures)

if (!hasZones && !hasFixtures) {
  setStatusMsg("Este archivo no parece un export del editor (faltan fixtures/zones).")
  return
}

    console.log("PARSED JSON:", parsed)
    console.log("PARSED KEYS:", Object.keys(parsed))

    // 🔹 Soporta export directo o export anidado
    const root =
      parsed?.fixtures || parsed?.zones
        ? parsed
        : parsed?.data ?? {}

    const rawFixtures = Array.isArray(root?.fixtures) ? root.fixtures : []
    const rawZones = Array.isArray(root?.zones) ? root.zones : []

    const nextFixtures = coerceImportedFixtures(rawFixtures)
    const nextZones = coerceImportedZones(rawZones)

    // 🔍 DEBUG IMPORT
    console.log("IMPORT rawZones:", rawZones)
    console.log("IMPORT nextZones:", nextZones)

    // 🔹 bgUrl robusto (evita blob:)
    let nextBgUrl = DEFAULT_BG_URL
    if (typeof root?.bgUrl === "string" && !root.bgUrl.startsWith("blob:")) {
      nextBgUrl = root.bgUrl
    }

    setFixtures(nextFixtures)
    setZones(nextZones)
    setBgUrl(nextBgUrl)

// ✅ Restaurar vista si viene en el JSON
    if (isValidView(root?.view)) {
    setView(root.view)
    didInitFit.current = true
    } else {
  // si no hay vista guardada, usamos la vista por defecto (25% centrado)
  fitView()
  didInitFit.current = true
    }

    setSelectedUid(nextFixtures[0]?.uid ?? null)
    setSelectedZoneId(nextZones[0]?.id ?? null)

    setUniverseInput("")
    setAddressInput("")

    setStatusMsg(
      `Proyecto importado: ${nextFixtures.length} fixtures, ${nextZones.length} zonas.`
    )
  } catch (err) {
    console.error("Import error:", err)
    setStatusMsg(
      "Error al importar JSON. Comprueba que el archivo es un export válido del editor."
    )
  }
}

  /** =========================
   *  VIEW: helpers zoom/pan
   *  ========================= */

  // conversión pantalla->mundo con view actual
  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const wx = (sx - view.ox) / view.scale
      const wy = (sy - view.oy) / view.scale
      return { x: wx, y: wy }
    },
    [view.ox, view.oy, view.scale]
  )

  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    setView((v) => {
      const newScale = clamp(v.scale * factor, 0.1, 8)
      // punto mundo bajo el cursor
      const wx = (sx - v.ox) / v.scale
      const wy = (sy - v.oy) / v.scale
      // nuevo offset para que el mismo punto quede bajo el cursor
      const ox = sx - wx * newScale
      const oy = sy - wy * newScale
      return { scale: newScale, ox, oy }
    })
  }, [])

  const zoomIn = useCallback(() => {
    const sx = stageViewport.width / 2
    const sy = stageViewport.height / 2
    zoomAt(sx, sy, 1.15)
  }, [stageViewport.width, stageViewport.height, zoomAt])

  const zoomOut = useCallback(() => {
    const sx = stageViewport.width / 2
    const sy = stageViewport.height / 2
    zoomAt(sx, sy, 1 / 1.15)
  }, [stageViewport.width, stageViewport.height, zoomAt])

  const resetView = useCallback(() => {
    fitView()
  }, [fitView])

type ViewState = { scale: number; ox: number; oy: number }

function computeCenteredView(
  stageW: number,
  stageH: number,
  worldW: number,
  worldH: number,
  scale = 0.25
): ViewState {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 0.25
  const ox = (stageW - worldW * s) / 2
  const oy = (stageH - worldH * s) / 2
  return { scale: s, ox, oy }
}

function isValidView(v: any): v is ViewState {
  return (
    v &&
    typeof v === "object" &&
    Number.isFinite(v.scale) &&
    v.scale > 0 &&
    Number.isFinite(v.ox) &&
    Number.isFinite(v.oy)
  )
}

  /** =========================
   *  RENDER
   *  ========================= */

  return (
    <main className="flex min-h-screen bg-neutral-950 text-white">
      <div className="flex-1 p-6">
        {/* TOP BAR */}
        <div className="mb-4 flex flex-wrap gap-2 items-center">
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={triggerImport}>
            Importar Patch DMX (Excel)
          </button>

          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={triggerProjectImport}>
            Importar proyecto (JSON)
          </button>

          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={triggerBgImport}>
            Cambiar plano (subir imagen)
          </button>

          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={autoPatchAll}>
            Auto-patch todo (DMX)
          </button>

          <button
            className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
            onClick={autoPatchSelected}
            disabled={!selectedFixture || selectedFixture.kind !== "DMX"}
          >
            Auto-patch seleccionado
          </button>

          {/* Zoom controls */}
          <div className="ml-2 flex items-center gap-2 rounded border border-neutral-800 bg-neutral-900/30 px-2 py-1">
            <div className="text-sm text-neutral-300 font-semibold">Vista</div>
            <button className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700" onClick={zoomOut}>
              Alejar
            </button>
            <button className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700" onClick={zoomIn}>
              Acercar
            </button>
            <button className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700" onClick={resetView}>
              Reset vista
            </button>
            <div className="text-xs text-neutral-400 ml-2">Zoom: {(view.scale * 100).toFixed(0)}% • Pan: Space + arrastrar • Rueda: zoom</div>
          </div>

          <label className="ml-2 flex items-center gap-2 text-sm text-neutral-300 select-none">
            <input type="checkbox" checked={showSymbols} onChange={(e) => setShowSymbols(e.target.checked)} />
            Ver símbolos
          </label>

          <label className="ml-2 flex items-center gap-2 text-sm text-neutral-300 select-none">
            <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} />
            Ver zonas
          </label>

          <label className="ml-2 flex items-center gap-2 text-sm text-neutral-300 select-none">
            <input type="checkbox" checked={editZones} onChange={(e) => setEditZones(e.target.checked)} />
            Editar zonas
          </label>

          <label className="ml-2 flex items-center gap-2 text-sm text-neutral-300 select-none">
            <input type="checkbox" checked={lockDragging} onChange={(e) => setLockDragging(e.target.checked)} />
            Bloquear arrastre (global)
          </label>

          {/* Rider presets */}
          <div className="ml-2 flex items-center gap-2 rounded border border-neutral-800 bg-neutral-900/30 px-2 py-1">
            <div className="text-sm text-neutral-300 font-semibold">Estilo</div>
            <button
              className={`rounded px-3 py-1 text-sm ${riderStyle === "COLOR" ? "bg-neutral-700" : "bg-neutral-800 hover:bg-neutral-700"}`}
              onClick={() => setRiderStyle("COLOR")}
            >
              Rider color
            </button>
            <button
              className={`rounded px-3 py-1 text-sm ${riderStyle === "CLASSIC" ? "bg-neutral-700" : "bg-neutral-800 hover:bg-neutral-700"}`}
              onClick={() => setRiderStyle("CLASSIC")}
            >
              Rider clásico
            </button>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-sm text-neutral-300">
              Issues (DMX):{" "}
              <span className={issueCount > 0 ? "text-red-400 font-semibold" : "text-green-400 font-semibold"}>{issueCount}</span>
            </div>

            <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={exportJson}>
              Exportar JSON
            </button>

            {statusMsg ? <div className="text-xs text-neutral-300 max-w-[520px] truncate">{statusMsg}</div> : null}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImportFile(f)
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
              if (f) onImportBg(f)
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
              if (f) onImportProjectJson(f)
              e.currentTarget.value = ""
            }}
          />
        </div>

        {/* PLANO CONTROLS */}
        <div className="mb-3 rounded border border-neutral-800 bg-neutral-900/30 p-3 flex flex-wrap gap-4 items-center">
          <div className="text-sm text-neutral-300 font-semibold">Plano</div>
          <div className="flex items-center gap-2 text-sm text-neutral-300">
            Opacidad
            <input type="range" min={0} max={1} step={0.01} value={bgOpacity} onChange={(e) => setBgOpacity(Number(e.target.value))} />
            <span className="tabular-nums text-neutral-400">{bgOpacity.toFixed(2)}</span>
          </div>

          <div className="ml-6 text-sm text-neutral-400">
            Área válida:{" "}
            <span className="font-semibold text-neutral-200">
              {worldSize.width}×{worldSize.height}px
            </span>{" "}
            (imagen completa)
          </div>

          {showZones ? (
            <div className="ml-6 flex items-center gap-2 text-sm text-neutral-300">
              Zonas (opacidad)
              <input type="range" min={0} max={0.35} step={0.01} value={zonesOpacity} onChange={(e) => setZonesOpacity(Number(e.target.value))} />
              <span className="tabular-nums text-neutral-400">{zonesOpacity.toFixed(2)}</span>
            </div>
          ) : null}

          <button className="ml-auto rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => setBgUrl(DEFAULT_BG_URL)}>
            Reset plano predeterminado
          </button>
        </div>

        {/* CANVAS */}
        <div ref={stageWrapRef} className="rounded border border-neutral-800 bg-neutral-900/30 p-2 h-[78vh] w-full overflow-hidden">
          <Stage
            ref={(n) => {
              stageRef.current = n
            }}
            width={stageViewport.width}
            height={stageViewport.height}
            onWheel={(e) => {
              e.evt.preventDefault()
              const stage = e.target.getStage()
              if (!stage) return
              const pointer = stage.getPointerPosition()
              if (!pointer) return
              const deltaY = e.evt.deltaY
              const factor = deltaY > 0 ? 1 / 1.08 : 1.08
              zoomAt(pointer.x, pointer.y, factor)
            }}
            onMouseDown={(e) => {
              const stage = e.target.getStage()
              if (!stage) return

              // PAN: Space + drag (o botón medio)
              if (spaceDown || (e.evt as MouseEvent).button === 1) {
                setIsPanning(true)
                panLast.current = stage.getPointerPosition() ?? null
                return
              }

              // Deselección si clic en vacío
              if (e.target === stage) {
                setSelectedUid(null)
                setSelectedZoneId(null)
                setUniverseInput("")
                setAddressInput("")
              }
            }}
            onMouseMove={(e) => {
              if (!isPanning) return
              const stage = e.target.getStage()
              if (!stage) return
              const pos = stage.getPointerPosition()
              if (!pos) return
              const last = panLast.current
              if (!last) {
                panLast.current = pos
                return
              }
              const dx = pos.x - last.x
              const dy = pos.y - last.y
              panLast.current = pos
              setView((v) => ({ ...v, ox: v.ox + dx, oy: v.oy + dy }))
            }}
            onMouseUp={() => {
              setIsPanning(false)
              panLast.current = null
            }}
          >
            <Layer>
              {/* TODO EL MUNDO (view transform manual) */}
              <Group x={view.ox} y={view.oy} scaleX={view.scale} scaleY={view.scale}>
                {/* Fondo */}
                {bgImg ? <KonvaImage image={bgImg} x={0} y={0} opacity={bgOpacity} listening={false} /> : null}

                {/* Zonas */}
                {showZones
                  ? zones.map((z) => {
                      const isSelected = selectedZoneId === z.id
                      const locked = !!z.locked
                      const strokeW = isSelected ? 3 : 2
                      const c = centroid(z.points)

                      return (
                        <Group key={z.id}>
                          <Line
                            points={z.points}
                            closed
                            fill={z.color}
                            opacity={zonesOpacity}
                            stroke={z.color}
                            strokeWidth={strokeW}
                            draggable={editZones && !locked && !lockDragging}
                            onClick={(ev) => {
                              ev.cancelBubble = true
                              setSelectedZoneId(z.id)
                              setSelectedUid(null)
                            }}
                            onDragEnd={(ev) => {
                              const dx = ev.target.x()
                              const dy = ev.target.y()
                              ev.target.position({ x: 0, y: 0 })
                              moveZone(z.id, dx, dy)
                            }}
                          />

                          <Text text={z.name} x={c.x + 8} y={c.y - 18} fontSize={14} fill={z.color} opacity={0.95} />

                          {/* Handles */}
                          {editZones && isSelected
                            ? z.points.map((_, idx) => {
                                if (idx % 2 !== 0) return null
                                const px = z.points[idx]
                                const py = z.points[idx + 1]
                                return (
                                  <Circle
                                    key={`${z.id}-h-${idx}`}
                                    x={px}
                                    y={py}
                                    radius={7}
                                    fill="#111827"
                                    stroke={z.color}
                                    strokeWidth={2}
                                    draggable={!locked && !lockDragging}
                                    onMouseDown={(ev) => (ev.cancelBubble = true)}
                                    onDragMove={(ev) => {
                                      const nx = ev.target.x()
                                      const ny = ev.target.y()
                                      setZones((prev) =>
                                        prev.map((zz) => {
                                          if (zz.id !== z.id) return zz
                                          const pts = [...zz.points]
                                          pts[idx] = nx
                                          pts[idx + 1] = ny
                                          return { ...zz, points: pts }
                                        })
                                      )
                                    }}
                                  />
                                )
                              })
                            : null}
                        </Group>
                      )
                    })
                  : null}

                {/* FIXTURES */}
                {fixtures.map((fx) => {
                  const isSelected = selectedUid === fx.uid
                  const isIssue = fx.kind === "DMX" ? hasIssue(fx.uid) : false

                  const base = baseFillFor(fx)
                  const fill = isIssue ? COLORS.issue : isSelected ? COLORS.selected : base
                  const stroke = isSelected ? COLORS.selected : COLORS.strokeBase
                  const strokeWidth = isSelected ? 3 : 2

                  const fxLocked = !!fx.locked || lockDragging

                  // ND
                  if (fx.kind === "ND") {
                    const k2 = ND_CATALOG[fx.type].kind2
                    const baseLabel = ND_CATALOG[fx.type].label

                    // SCREEN
                    if (k2 === "SCREEN") {
                      const { w, h } = screenSizePx(fx)
                      const screenFill = COLORS.classic ? COLORS.ndFillClassic : "rgba(0,0,0,0)"
                      const screenStroke = COLORS.classic ? COLORS.ndStrokeClassic : stroke

                      return (
                        <Group key={fx.uid}>
                          <Rect
                            x={fx.x}
                            y={fx.y}
                            width={w}
                            height={h}
                            cornerRadius={10}
                            fill={screenFill}
                            stroke={screenStroke}
                            strokeWidth={strokeWidth}
                            draggable={!fxLocked}
                            onClick={(ev) => {
                              ev.cancelBubble = true
                              selectFixture(fx.uid)
                              setSelectedZoneId(null)
                            }}
                            onDragEnd={(e) => updateFixture(fx.uid, { x: e.target.x(), y: e.target.y() })}
                          />
                          <Text
                            text={`${fx.label ?? baseLabel}${fx.widthM && fx.heightM ? ` (${fx.widthM}x${fx.heightM}m)` : ""}`}
                            x={fx.x}
                            y={fx.y - 18}
                            fontSize={12}
                            fill={COLORS.label}
                          />
                        </Group>
                      )
                    }

                    // AUDIO
                    const size = Math.max(16, Math.round(fx.sizePx ?? DEFAULT_AUDIO_SIZE))
                    const rot = fx.rotation ?? 0
                    const cx = fx.x + size / 2
                    const cy = fx.y + size / 2
                    const handleOffset = size * 1.35
                    const handleR = 7

                    const audioFill = COLORS.classic ? COLORS.ndFillClassic : "rgba(0,0,0,0)"
                    const audioStroke = COLORS.classic ? COLORS.ndStrokeClassic : "#e5e7eb"

                    return (
                      <Group
                        key={fx.uid}
                        x={cx}
                        y={cy}
                        rotation={rot}
                        draggable={!fxLocked}
                        onClick={(ev) => {
                          ev.cancelBubble = true
                          selectFixture(fx.uid)
                          setSelectedZoneId(null)
                        }}
                        onDblClick={() => updateFixture(fx.uid, { rotation: 0 } as Partial<NdFixture>)}
                        onDragEnd={(e) => {
                          if (e.target !== e.currentTarget) return
                          const node = e.currentTarget
                          updateFixture(fx.uid, { x: node.x() - size / 2, y: node.y() - size / 2 })
                        }}
                      >
                        <Line points={audioTrianglePoints(size)} closed fill={audioFill} stroke={audioStroke} strokeWidth={strokeWidth} />
                        <Line points={[-size / 2 - 10, 0, -size / 2, 0]} stroke={audioStroke} strokeWidth={2} />

                        {isSelected && !fxLocked ? (
                          <>
                            <Line points={[0, 0, 0, -handleOffset]} stroke={audioStroke} strokeWidth={2} />
                            <Group
                              x={0}
                              y={-handleOffset}
                              draggable
                              dragOnTop={false}
                              onMouseDown={(ev) => {
                                ev.cancelBubble = true
                              }}
                              onDragMove={(ev) => {
                                ev.cancelBubble = true
                                const hx = ev.target.x()
                                const hy = ev.target.y()
                                let deg = (Math.atan2(hy, hx) * 180) / Math.PI
                                deg = normDeg(deg)
                                const evt = ev.evt as MouseEvent
                                if (evt.shiftKey) deg = normDeg(snapDeg(deg, 15))
                                updateFixture(fx.uid, { rotation: deg } as Partial<NdFixture>)
                              }}
                              onDragEnd={(ev) => {
                                ev.cancelBubble = true
                                ev.target.position({ x: 0, y: -handleOffset })
                              }}
                            >
                              <Rect
                                x={-handleR}
                                y={-handleR}
                                width={handleR * 2}
                                height={handleR * 2}
                                cornerRadius={handleR}
                                fill="#111827"
                                stroke={audioStroke}
                                strokeWidth={2}
                              />
                            </Group>
                          </>
                        ) : null}

                        <Group rotation={-rot}>
                          <Text text={fx.label ?? baseLabel} x={-80} y={-46} fontSize={12} fill={COLORS.label} />
                          {typeof fx.quantity === "number" ? <Text text={`x${fx.quantity}`} x={-80} y={-30} fontSize={11} fill={COLORS.subLabel} /> : null}
                        </Group>
                      </Group>
                    )
                  }

                  // DMX
                  const size = Math.max(14, Math.round(fx.sizePx ?? DEFAULT_DMX_SIZE))
                  const label = `${fx.type} ${dmxLabel(fx)}`
                  const symSize = Math.max(12, Math.round(size * 0.9))

                  return (
                    <Group
                      key={fx.uid}
                      x={fx.x}
                      y={fx.y}
                      draggable={!fxLocked}
                      onClick={(ev) => {
                        ev.cancelBubble = true
                        selectFixture(fx.uid)
                        setSelectedZoneId(null)
                      }}
                      onDragEnd={(e) => {
                        if (e.target !== e.currentTarget) return
                        const node = e.currentTarget
                        updateFixture(fx.uid, { x: node.x(), y: node.y() })
                      }}
                    >
                      <Rect
                        x={0}
                        y={0}
                        width={size}
                        height={size}
                        cornerRadius={Math.max(6, Math.round(size * 0.18))}
                        fill={"rgba(0,0,0,0)"}
                        stroke={isIssue ? "#ffffff" : stroke}
                        strokeWidth={isIssue ? 3 : strokeWidth}
                      />

                      {showSymbols ? (
                        <Group x={size / 2} y={size / 2} listening={false}>
                          <DmxSymbol type={fx.type} size={symSize} stroke={fill} />
                        </Group>
                      ) : null}

                      <Text text={label} x={0} y={-18} fontSize={12} fill={COLORS.label} />
                      {fx.zona ? <Text text={fx.zona} x={0} y={size + 4} fontSize={10} fill={COLORS.subLabel} /> : null}
                      <Text text={`(${rangeLabel(fx.address, getChannels(fx))})`} x={0} y={size + 18} fontSize={10} fill={COLORS.fine} />
                    </Group>
                  )
                })}
              </Group>
            </Layer>
          </Stage>
        </div>
      </div>

      {/* SIDEBAR */}
      <aside className="w-[460px] border-l border-neutral-800 p-6 space-y-6 overflow-y-auto max-h-screen">
        {/* LIBRERÍA */}
        <section className="rounded border border-neutral-800 bg-neutral-900/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Librería</div>
            <div className="flex gap-2">
              <button
                className={`rounded px-3 py-1 text-sm ${libraryTab === "DMX" ? "bg-neutral-700" : "bg-neutral-800 hover:bg-neutral-700"}`}
                onClick={() => setLibraryTab("DMX")}
              >
                DMX
              </button>
              <button
                className={`rounded px-3 py-1 text-sm ${libraryTab === "ND" ? "bg-neutral-700" : "bg-neutral-800 hover:bg-neutral-700"}`}
                onClick={() => setLibraryTab("ND")}
              >
                NO-DMX
              </button>
            </div>
          </div>

          <input
            className="mt-3 w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
            placeholder="Buscar (ej: cabeza, par, strobe...)"
            value={libraryQuery}
            onChange={(e) => setLibraryQuery(e.target.value)}
          />

          {libraryTab === "DMX" ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {filteredDmx.map((t) => {
                const previewStroke = riderStyle === "CLASSIC" ? "#e5e7eb" : DMX_CATALOG[t].color
                return (
                  <button key={t} className="rounded bg-neutral-800 hover:bg-neutral-700 p-2 text-left" onClick={() => addDmxFixture(t)} title="Añadir">
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
                <button key={t} className="rounded bg-neutral-800 hover:bg-neutral-700 p-2 text-left" onClick={() => addNdFixture(t)} title="Añadir">
                  <div className="text-sm font-semibold">{t}</div>
                  <div className="text-xs text-neutral-400">{ND_CATALOG[t].label}</div>
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 text-xs text-neutral-400">Rider clásico: monocromo técnico. Rider color: operativo y visual.</div>
        </section>

        {/* ZONAS */}
        <section className="rounded border border-neutral-800 bg-neutral-900/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Zonas (polígonos)</div>
            <button className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700" onClick={addZone}>
              + Añadir
            </button>
          </div>

          {zones.length === 0 ? <div className="text-sm text-neutral-400">No hay zonas. Crea una con “Añadir”.</div> : null}

          <div className="space-y-2">
            {zones.map((z) => {
              const active = selectedZoneId === z.id
              return (
                <button
                  key={z.id}
                  className={`w-full rounded border px-3 py-2 text-left ${active ? "border-neutral-500 bg-neutral-800" : "border-neutral-800 bg-neutral-900/20 hover:bg-neutral-800"}`}
                  onClick={() => {
                    setSelectedZoneId(z.id)
                    setSelectedUid(null)
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{z.name}</div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded" style={{ background: z.color }} />
                      <span className="text-xs text-neutral-400">{Math.floor(z.points.length / 2)} pts</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {selectedZone ? (
            <div className="rounded border border-neutral-800 bg-neutral-950/30 p-3 space-y-3">
              <div className="text-sm text-neutral-300">Zona seleccionada</div>

              <div>
                <label className="mb-1 block text-sm">Nombre</label>
                <input
                  className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                  value={selectedZone.name}
                  onChange={(e) => updateZone(selectedZone.id, { name: e.target.value })}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm">Color</label>
                <input
                  type="color"
                  value={selectedZone.color}
                  onChange={(e) => updateZone(selectedZone.id, { color: e.target.value })}
                  className="h-10 w-full rounded bg-neutral-800 p-1"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-neutral-300 select-none">
                <input type="checkbox" checked={!!selectedZone.locked} onChange={(e) => updateZone(selectedZone.id, { locked: e.target.checked })} />
                Bloquear zona
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => addZonePoint(selectedZone.id)} disabled={!!selectedZone.locked}>
                  + Punto
                </button>
                <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => removeZonePoint(selectedZone.id)} disabled={!!selectedZone.locked}>
                  - Punto
                </button>
              </div>

              <button className="w-full rounded bg-red-600 px-3 py-2 text-sm hover:bg-red-500" onClick={() => deleteZone(selectedZone.id)}>
                Borrar zona
              </button>

              <div className="text-xs text-neutral-400">
                Edita puntos en el plano. Pan con Space. Si activas “Bloquear arrastre (global)”, no podrás mover zonas/fixtures.
              </div>
            </div>
          ) : (
            <div className="text-sm text-neutral-400">Selecciona una zona para editarla.</div>
          )}
        </section>

        {/* PROPIEDADES */}
        <section>
          <h2 className="mb-3 text-lg font-semibold">Propiedades</h2>

          {!selectedFixture && <p className="text-neutral-400">Selecciona un objeto</p>}

          {selectedFixture && (
            <div className="mb-4 rounded border border-neutral-800 bg-neutral-900/30 p-3 space-y-2">
              <div className="text-sm text-neutral-300">Movimiento</div>
              <label className="flex items-center gap-2 text-sm text-neutral-300 select-none">
                <input type="checkbox" checked={!!selectedFixture.locked} onChange={(e) => updateFixture(selectedFixture.uid, { locked: e.target.checked } as any)} />
                Bloquear este fixture
              </label>
              <div className="text-xs text-neutral-400">Tip: activa “Bloquear arrastre (global)” cuando estés colocando posiciones reales.</div>
            </div>
          )}

          {/* DMX PROPS */}
          {selectedFixture && selectedFixture.kind === "DMX" && (
            <div className="space-y-4">
              <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-sm text-neutral-300">Seleccionado (DMX)</div>
                <div className="mt-1 font-semibold">
                  {selectedFixture.id} — {DMX_CATALOG[selectedFixture.type].label}
                </div>
                <div className="mt-1 text-sm text-neutral-300">
                  DMX:{" "}
                  <span className={selectedIssues.length > 0 ? "text-red-400 font-semibold" : "text-green-400 font-semibold"}>{dmxLabel(selectedFixture)}</span>
                </div>
                <div className="mt-1 text-sm text-neutral-300">
                  Modo: <span className="font-semibold">{getMode(selectedFixture).label}</span> • Canales:{" "}
                  <span className="font-semibold">{getChannels(selectedFixture)}</span> • Rango:{" "}
                  <span className="font-semibold">{rangeLabel(selectedFixture.address, getChannels(selectedFixture))}</span>
                </div>
              </div>

              <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3 space-y-3">
                <div className="text-sm text-neutral-300">Patch</div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm">Universe</label>
                    <input
                      className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                      value={universeInput}
                      onChange={(e) => setUniverseInput(e.target.value)}
                      onBlur={() => {
                        const u = clamp(Number(universeInput || 1), 1, 99)
                        updateFixture(selectedFixture.uid, { universe: u } as any)
                        setUniverseInput(String(u))
                      }}
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm">Address</label>
                    <input
                      className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                      value={addressInput}
                      onChange={(e) => setAddressInput(e.target.value)}
                      onBlur={() => {
                        const a = clamp(Number(addressInput || 1), 1, 512)
                        updateFixture(selectedFixture.uid, { address: a } as any)
                        setAddressInput(String(a))
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm">Tipo</label>
                  <select
                    className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                    value={selectedFixture.type}
                    onChange={(e) => {
                      const t = e.target.value as DmxType
                      const modeId = DMX_CATALOG[t].modes[0].id
                      updateFixture(selectedFixture.uid, { type: t, modeId } as any)
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
                    className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                    value={selectedFixture.modeId}
                    onChange={(e) => updateFixture(selectedFixture.uid, { modeId: e.target.value } as any)}
                  >
                    {DMX_CATALOG[selectedFixture.type].modes.map((m) => (
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
                    value={Math.round(selectedFixture.sizePx ?? DEFAULT_DMX_SIZE)}
                    onChange={(e) => updateFixture(selectedFixture.uid, { sizePx: Number(e.target.value) } as any)}
                  />
                  <div className="text-xs text-neutral-400 tabular-nums">{Math.round(selectedFixture.sizePx ?? DEFAULT_DMX_SIZE)} px</div>
                </div>

                <div>
                  <label className="mb-1 block text-sm">Zona (texto)</label>
                  <input
                    className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                    value={selectedFixture.zona ?? ""}
                    onChange={(e) => updateFixture(selectedFixture.uid, { zona: e.target.value || undefined } as any)}
                    placeholder="Ej: ESCENARIO / PISTA / VIP..."
                  />
                </div>

                {selectedIssues.length > 0 ? (
                  <div className="rounded border border-red-700/50 bg-red-950/30 p-3">
                    <div className="font-semibold text-red-300">Problemas DMX</div>
                    <ul className="mt-2 space-y-1 text-sm text-red-200">
                      {selectedIssues.map((it, idx) =>
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
                  <div className="text-sm text-green-300">Sin conflictos DMX detectados.</div>
                )}
              </div>
            </div>
          )}

          {/* ND PROPS */}
          {selectedFixture && selectedFixture.kind === "ND" && (
            <div className="space-y-4">
              <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-sm text-neutral-300">Seleccionado (NO-DMX)</div>
                <div className="mt-1 font-semibold">
                  {selectedFixture.id} — {ND_CATALOG[selectedFixture.type].label}
                </div>
                <div className="mt-1 text-sm text-neutral-300">
                  Tipo: <span className="font-semibold">{ndKind2(selectedFixture.type)}</span>
                </div>
              </div>

              <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3 space-y-3">
                <div className="text-sm text-neutral-300">Datos</div>

                <div>
                  <label className="mb-1 block text-sm">Etiqueta</label>
                  <input
                    className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                    value={selectedFixture.label ?? ""}
                    onChange={(e) => updateFixture(selectedFixture.uid, { label: e.target.value || undefined } as any)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm">Zona (texto)</label>
                  <input
                    className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                    value={selectedFixture.zona ?? ""}
                    onChange={(e) => updateFixture(selectedFixture.uid, { zona: e.target.value || undefined } as any)}
                    placeholder="Ej: ESCENARIO / PISTA / VIP..."
                  />
                </div>

                {ndKind2(selectedFixture.type) === "SCREEN" ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-sm">Ancho (m)</label>
                        <input
                          className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                          value={selectedFixture.widthM ?? ""}
                          onChange={(e) => updateFixture(selectedFixture.uid, { widthM: e.target.value === "" ? undefined : Number(e.target.value) } as any)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm">Alto (m)</label>
                        <input
                          className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                          value={selectedFixture.heightM ?? ""}
                          onChange={(e) => updateFixture(selectedFixture.uid, { heightM: e.target.value === "" ? undefined : Number(e.target.value) } as any)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-sm">Ancho (px)</label>
                        <input
                          className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                          value={selectedFixture.widthPx ?? ""}
                          onChange={(e) => updateFixture(selectedFixture.uid, { widthPx: e.target.value === "" ? undefined : Number(e.target.value) } as any)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm">Alto (px)</label>
                        <input
                          className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                          value={selectedFixture.heightPx ?? ""}
                          onChange={(e) => updateFixture(selectedFixture.uid, { heightPx: e.target.value === "" ? undefined : Number(e.target.value) } as any)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-sm">Módulos</label>
                        <input
                          className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                          value={selectedFixture.modules ?? ""}
                          onChange={(e) => updateFixture(selectedFixture.uid, { modules: e.target.value === "" ? undefined : Number(e.target.value) } as any)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm">Procesador</label>
                        <input
                          className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                          value={selectedFixture.processor ?? ""}
                          onChange={(e) => updateFixture(selectedFixture.uid, { processor: e.target.value || undefined } as any)}
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
                          className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                          value={selectedFixture.quantity ?? ""}
                          onChange={(e) => updateFixture(selectedFixture.uid, { quantity: e.target.value === "" ? undefined : Number(e.target.value) } as any)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm">Tamaño (px)</label>
                        <input
                          className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                          value={selectedFixture.sizePx ?? ""}
                          onChange={(e) => updateFixture(selectedFixture.uid, { sizePx: e.target.value === "" ? undefined : Number(e.target.value) } as any)}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm">Rotación (°)</label>
                      <input
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                        value={selectedFixture.rotation ?? 0}
                        onChange={(e) => updateFixture(selectedFixture.uid, { rotation: Number(e.target.value) } as any)}
                      />
                      <div className="text-xs text-neutral-400">En el plano: arrastra el handle (Shift para snap 15°). Doble click para reset.</div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        <div className="text-xs text-neutral-500">
          Fondo y coordenadas del mundo se trabajan en píxeles del PNG. Zoom/pan manual ya implementado.
        </div>
      </aside>
    </main>
  )
}