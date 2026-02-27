"use client"

import { useMemo, useRef, useState } from "react"
import { Stage, Layer, Rect, Text, Group } from "react-konva"
import * as XLSX from "xlsx"

/** =========================
 *  CATÁLOGOS
 *  ========================= */

// DMX (con modos/canales)
const DMX_CATALOG = {
  "CABEZA MOVIL": {
    label: "Cabeza móvil",
    color: "#60a5fa",
    modes: [
      { id: "16ch", label: "16ch", channels: 16 },
      { id: "17ch", label: "17ch", channels: 17 },
    ],
  },
  STROBO: {
    label: "Strobo",
    color: "#ef4444",
    modes: [
      { id: "9ch", label: "9ch (RGBW)", channels: 9 },
      { id: "4ch", label: "4ch", channels: 4 },
    ],
  },
  LEDBAR: {
    label: "LED Bar",
    color: "#10b981",
    modes: [{ id: "16ch", label: "16ch", channels: 16 }],
  },
  CEGADORA: {
    label: "Cegadora",
    color: "#f59e0b",
    modes: [{ id: "4ch", label: "4ch", channels: 4 }],
  },
  LED: {
    label: "LED",
    color: "#a78bfa",
    modes: [
      { id: "1ch", label: "1ch (ON/OFF)", channels: 1 },
      { id: "3ch", label: "3ch", channels: 3 },
      { id: "4ch", label: "4ch", channels: 4 },
    ],
  },
  PCDJ: {
    label: "PCDJ",
    color: "#22c55e",
    modes: [{ id: "1ch", label: "1ch", channels: 1 }],
  },
} as const

type DmxType = keyof typeof DMX_CATALOG

// NO-DMX (pantallas + audio)
const ND_CATALOG = {
  // PANTALLAS
  "PANTALLA ESCENARIO": { label: "Pantalla Escenario", color: "#8b5cf6" },
  "PANTALLA PISTA": { label: "Pantalla Pista", color: "#7c3aed" },
  "PANTALLA CABINA DJ": { label: "Pantalla Cabina DJ", color: "#6d28d9" },

  // AUDIO
  ARRAY_L: { label: "Array L (5x Aero20A)", color: "#38bdf8" },
  ARRAY_R: { label: "Array R (5x Aero20A)", color: "#38bdf8" },
  SUB_U218: { label: "Sub DAS U-218", color: "#0ea5e9" },
  ESCENARIO_L: { label: "Escenario L (Aero12A)", color: "#22c55e" },
  ESCENARIO_R: { label: "Escenario R (Aero12A)", color: "#22c55e" },
  MONITOR_DJ: { label: "Monitor DJ (Aero12A)", color: "#10b981" },
  SUB_DJ_118A: { label: "Sub DJ (118A)", color: "#14b8a6" },
} as const

type NdType = keyof typeof ND_CATALOG

type FixtureKind = "DMX" | "ND"

type DmxFixture = {
  kind: "DMX"
  uid: string
  id: string // puede repetirse del Excel
  x: number
  y: number
  type: DmxType
  modeId: string
  universe: number
  address: number
  zona?: string
}

type NdFixture = {
  kind: "ND"
  uid: string
  id: string
  x: number
  y: number
  type: NdType
  zona?: string

  // props generales
  label?: string
  widthM?: number
  heightM?: number
  widthPx?: number
  heightPx?: number
  modules?: number
  processor?: string
  quantity?: number
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

function isDmxType(t: string): t is DmxType {
  return (Object.keys(DMX_CATALOG) as string[]).includes(t)
}

/** =========================
 *  HELPERS
 *  ========================= */

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

// Buckets de zona para colocar por bloques
function zoneBucket(zonaRaw?: string) {
  const z = (zonaRaw ?? "").toUpperCase()
  if (z.includes("ESCENARIO")) return "ESCENARIO"
  if (z.includes("PISTA")) return "PISTA"
  if (z.includes("VIP")) return "VIP"
  return "OTROS"
}

export default function EditorPage() {
  const [fixtures, setFixtures] = useState<AnyFixture[]>([])
  const [selectedUid, setSelectedUid] = useState<string | null>(null)

  const [universeInput, setUniverseInput] = useState<string>("")
  const [addressInput, setAddressInput] = useState<string>("")

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const stageSize = useMemo(() => ({ width: 900, height: 600 }), [])
  const selectedFixture = fixtures.find((f) => f.uid === selectedUid) ?? null

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

  /** =========================
   *  AÑADIR FIXTURES
   *  ========================= */

  function addDmxFixture(type: DmxType) {
    const uid = `uid-${crypto.randomUUID()}`
    const id = `NEW_DMX_${fixtures.length + 1}`
    const defaultMode = DMX_CATALOG[type].modes[0].id

    const fx: DmxFixture = {
      kind: "DMX",
      uid,
      id,
      x: 120,
      y: 160,
      type,
      modeId: defaultMode,
      universe: 1,
      address: 1,
    }
    const next = [...fixtures, fx]
    setFixtures(next)
    selectFixture(uid, next)
  }

  function addNdFixture(type: NdType) {
    const uid = `uid-${crypto.randomUUID()}`
    const id = `${type}_${fixtures.length + 1}`

    // Presets pantallas
    const preset =
      type === "PANTALLA ESCENARIO"
        ? {
            label: "Pantalla Escenario",
            widthM: 6,
            heightM: 2,
            widthPx: 1536,
            heightPx: 512,
            modules: 48,
            processor: "Novastar VX600",
          }
        : type === "PANTALLA PISTA"
          ? {
              label: "Pantalla Pista",
              widthM: 1,
              heightM: 4,
              widthPx: 256,
              heightPx: 1024,
              modules: 16,
              processor: "Novastar VX600",
            }
          : type === "PANTALLA CABINA DJ"
            ? {
                label: "Pantalla Cabina DJ",
                widthM: 3,
                heightM: 1,
                widthPx: 768,
                heightPx: 256,
                modules: 12,
                processor: "Novastar VX600",
              }
            : {}

    // Presets audio
    const audioPreset =
      type === "ARRAY_L"
        ? { label: "Array L", quantity: 5 }
        : type === "ARRAY_R"
          ? { label: "Array R", quantity: 5 }
          : type === "SUB_U218"
            ? { label: "Sub U-218", quantity: 1 }
            : type === "ESCENARIO_L"
              ? { label: "Escenario L", quantity: 1 }
              : type === "ESCENARIO_R"
                ? { label: "Escenario R", quantity: 1 }
                : type === "MONITOR_DJ"
                  ? { label: "Monitor DJ", quantity: 1 }
                  : type === "SUB_DJ_118A"
                    ? { label: "Sub DJ 118A", quantity: 1 }
                    : {}

    const fx: NdFixture = {
      kind: "ND",
      uid,
      id,
      x: 520,
      y: 120,
      type,
      ...preset,
      ...audioPreset,
    }

    const next = [...fixtures, fx]
    setFixtures(next)
    selectFixture(uid, next)
  }

  /** =========================
   *  IMPORT EXCEL (SOLO DMX)
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

    // Agrupar por zona bucket
    const buckets: Record<string, PatchRow[]> = { ESCENARIO: [], PISTA: [], VIP: [], OTROS: [] }
    for (const r of parsed) buckets[zoneBucket(r.zona)].push(r)
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a, b) => (a.universe - b.universe) || (a.address - b.address) || a.id.localeCompare(b.id))
    }

    // Layout por bloques
    const order = ["ESCENARIO", "PISTA", "VIP", "OTROS"] as const
    const blockY: Record<(typeof order)[number], number> = { ESCENARIO: 40, PISTA: 240, VIP: 420, OTROS: 520 }
    const startX = 40
    const cols = 14
    const stepX = 60
    const stepY = 70

    const nextDmx: DmxFixture[] = []
    let globalIndex = 0

    for (const bucket of order) {
      const list = buckets[bucket]
      for (let i = 0; i < list.length; i++) {
        const r = list[i]
        const safeType: DmxType = isDmxType(r.tipo) ? r.tipo : "LED"
        const modeId = findModeIdByChannels(safeType, r.canales)

        nextDmx.push({
          kind: "DMX",
          uid: `${r.id}__${globalIndex}`,
          id: r.id,
          x: startX + (i % cols) * stepX,
          y: blockY[bucket] + Math.floor(i / cols) * stepY,
          type: safeType,
          modeId,
          universe: r.universe,
          address: r.address,
          zona: r.zona || undefined,
        })
        globalIndex++
      }
    }

    // Import reemplaza solo DMX, pero respeta los ND que ya tengas
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
   *  AUTO-PATCH (SOLO DMX)
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
    const finalAll: AnyFixture[] = [...finalDmx, ...nd]
    setFixtures(finalAll)

    if (selectedUid) {
      const fx = finalAll.find((f) => f.uid === selectedUid)
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
   *  UI
   *  ========================= */

  return (
    <main className="flex min-h-screen bg-neutral-950 text-white">
      <div className="flex-1 p-6">
        <div className="mb-4 flex flex-wrap gap-2">
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={triggerImport}>
            Importar Patch DMX (Excel)
          </button>

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

          {/* DMX buttons */}
          {(Object.keys(DMX_CATALOG) as DmxType[]).map((t) => (
            <button
              key={t}
              className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
              onClick={() => addDmxFixture(t)}
            >
              + {t}
            </button>
          ))}

          {/* ND buttons */}
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => addNdFixture("PANTALLA ESCENARIO")}>
            + Pantalla Escenario
          </button>
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => addNdFixture("PANTALLA PISTA")}>
            + Pantalla Pista
          </button>
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => addNdFixture("PANTALLA CABINA DJ")}>
            + Pantalla Cabina DJ
          </button>

          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => addNdFixture("ARRAY_L")}>
            + Array L
          </button>
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => addNdFixture("ARRAY_R")}>
            + Array R
          </button>
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => addNdFixture("SUB_U218")}>
            + Sub U-218
          </button>
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => addNdFixture("ESCENARIO_L")}>
            + Escenario L
          </button>
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => addNdFixture("ESCENARIO_R")}>
            + Escenario R
          </button>
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => addNdFixture("MONITOR_DJ")}>
            + Monitor DJ
          </button>
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700" onClick={() => addNdFixture("SUB_DJ_118A")}>
            + Sub DJ 118A
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

          <div className="ml-auto flex items-center gap-3">
            <div className="text-sm text-neutral-300">
              Issues (DMX):{" "}
              <span className={issueCount > 0 ? "text-red-400 font-semibold" : "text-green-400 font-semibold"}>
                {issueCount}
              </span>
            </div>

            <button
              className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
              onClick={() => {
                const data = { fixtures }
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = "magma-map.json"
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              Exportar JSON
            </button>
          </div>
        </div>

        <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3">
          <Stage
            width={stageSize.width}
            height={stageSize.height}
            onMouseDown={(e) => {
              if (e.target === e.target.getStage()) {
                setSelectedUid(null)
                setUniverseInput("")
                setAddressInput("")
              }
            }}
          >
            <Layer>
              {fixtures.map((fx) => {
                const isSelected = selectedUid === fx.uid
                const isIssue = fx.kind === "DMX" ? hasIssue(fx.uid) : false

                const fill =
                  isIssue ? "#ff2d2d" : isSelected ? "#f59e0b" : fx.kind === "DMX" ? DMX_CATALOG[fx.type].color : ND_CATALOG[fx.type].color

                const label =
                  fx.kind === "DMX"
                    ? `${fx.type} ${dmxLabel(fx)}`
                    : `${fx.type.replaceAll("_", " ")}${fx.label ? ` • ${fx.label}` : ""}`

                return (
                  <Group key={fx.uid}>
                    <Rect
                      x={fx.x}
                      y={fx.y}
                      width={54}
                      height={54}
                      cornerRadius={8}
                      fill={fill}
                      stroke={isIssue ? "#ffffff" : "#0b1220"}
                      strokeWidth={isIssue ? 3 : 2}
                      draggable
                      onClick={() => selectFixture(fx.uid)}
                      onDragEnd={(e) => updateFixture(fx.uid, { x: e.target.x(), y: e.target.y() })}
                    />
                    <Text text={label} x={fx.x} y={fx.y - 18} fontSize={12} fill="#e5e7eb" />

                    {fx.zona ? <Text text={fx.zona} x={fx.x} y={fx.y + 58} fontSize={10} fill="#9ca3af" /> : null}

                    {fx.kind === "DMX" ? (
                      <Text
                        text={`(${rangeLabel(fx.address, getChannels(fx))})`}
                        x={fx.x}
                        y={fx.y + 72}
                        fontSize={10}
                        fill="#6b7280"
                      />
                    ) : null}
                  </Group>
                )
              })}
            </Layer>
          </Stage>
        </div>
      </div>

      <aside className="w-[460px] border-l border-neutral-800 p-6">
        <h2 className="mb-4 text-lg font-semibold">Propiedades</h2>

        {!selectedFixture && <p className="text-neutral-400">Selecciona un objeto</p>}

        {selectedFixture && selectedFixture.kind === "DMX" && (
          <div className="space-y-4">
            <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3">
              <div className="text-sm text-neutral-300">Seleccionado (DMX)</div>
              <div className="mt-1 font-semibold">
                {selectedFixture.id} — {DMX_CATALOG[selectedFixture.type].label}
              </div>
              <div className="mt-1 text-sm text-neutral-300">
                DMX:{" "}
                <span className={selectedIssues.length > 0 ? "text-red-400 font-semibold" : "text-green-400 font-semibold"}>
                  {dmxLabel(selectedFixture)}
                </span>
              </div>
              <div className="mt-1 text-sm text-neutral-300">
                Modo: <span className="font-semibold">{getMode(selectedFixture).label}</span> • Canales:{" "}
                <span className="font-semibold">{getChannels(selectedFixture)}</span> • Rango:{" "}
                <span className="font-semibold">{rangeLabel(selectedFixture.address, getChannels(selectedFixture))}</span>
              </div>

              {selectedFixture.zona ? (
                <div className="mt-1 text-sm text-neutral-300">
                  Zona: <span className="font-semibold">{selectedFixture.zona}</span>
                </div>
              ) : null}

              {selectedIssues.length > 0 && (
                <div className="mt-2 space-y-1 text-sm text-red-300">
                  {selectedIssues.slice(0, 6).map((it, idx) => {
                    if (it.kind === "OUT_OF_RANGE") {
                      return (
                        <div key={idx}>
                          Fuera de rango: U{it.universe} ocupa {it.start}-{it.end} (máx 512)
                        </div>
                      )
                    }
                    return (
                      <div key={idx}>
                        Solapamiento parcial en U{it.universe} con otro fixture
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm">Tipo</label>
              <select
                value={selectedFixture.type}
                onChange={(e) => {
                  const type = e.target.value as DmxType
                  const defaultMode = DMX_CATALOG[type].modes[0].id
                  updateFixture(selectedFixture.uid, { type, modeId: defaultMode } as Partial<DmxFixture>)
                }}
                className="w-full rounded bg-neutral-800 px-2 py-2"
              >
                {(Object.keys(DMX_CATALOG) as DmxType[]).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm">Modo</label>
              <select
                value={selectedFixture.modeId}
                onChange={(e) => updateFixture(selectedFixture.uid, { modeId: e.target.value } as Partial<DmxFixture>)}
                className="w-full rounded bg-neutral-800 px-2 py-2"
              >
                {DMX_CATALOG[selectedFixture.type].modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.channels}ch)
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm">Universe</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={universeInput}
                  onChange={(e) => /^\d*$/.test(e.target.value) && setUniverseInput(e.target.value)}
                  onBlur={() => {
                    const n = Number(universeInput)
                    const safe = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
                    setUniverseInput(String(safe))
                    updateFixture(selectedFixture.uid, { universe: safe } as Partial<DmxFixture>)
                  }}
                  className="w-full rounded bg-neutral-800 px-2 py-2 outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm">Address</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={addressInput}
                  onChange={(e) => /^\d*$/.test(e.target.value) && setAddressInput(e.target.value)}
                  onBlur={() => {
                    const n = Number(addressInput)
                    const safe = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
                    setAddressInput(String(safe))
                    updateFixture(selectedFixture.uid, { address: safe } as Partial<DmxFixture>)
                  }}
                  className="w-full rounded bg-neutral-800 px-2 py-2 outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm">Zona</label>
              <input
                type="text"
                value={selectedFixture.zona ?? ""}
                onChange={(e) => updateFixture(selectedFixture.uid, { zona: e.target.value } as Partial<DmxFixture>)}
                className="w-full rounded bg-neutral-800 px-2 py-2 outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
              />
            </div>

            <button
              className="w-full rounded bg-red-600 px-3 py-2 text-sm hover:bg-red-500"
              onClick={() => {
                setFixtures((prev) => prev.filter((f) => f.uid !== selectedFixture.uid))
                setSelectedUid(null)
                setUniverseInput("")
                setAddressInput("")
              }}
            >
              Borrar este objeto
            </button>
          </div>
        )}

        {selectedFixture && selectedFixture.kind === "ND" && (
          <div className="space-y-4">
            <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3">
              <div className="text-sm text-neutral-300">Seleccionado (NO-DMX)</div>
              <div className="mt-1 font-semibold">{ND_CATALOG[selectedFixture.type].label}</div>
            </div>

            <div>
              <label className="mb-1 block text-sm">Etiqueta / Nombre</label>
              <input
                type="text"
                value={selectedFixture.label ?? ""}
                onChange={(e) => updateFixture(selectedFixture.uid, { label: e.target.value } as Partial<NdFixture>)}
                className="w-full rounded bg-neutral-800 px-2 py-2 outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Zona</label>
              <input
                type="text"
                value={selectedFixture.zona ?? ""}
                onChange={(e) => updateFixture(selectedFixture.uid, { zona: e.target.value } as Partial<NdFixture>)}
                className="w-full rounded bg-neutral-800 px-2 py-2 outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
              />
            </div>

            {/* Pantallas: tamaño/px/módulos/procesador */}
            {selectedFixture.type.includes("PANTALLA") ? (
              <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3 space-y-3">
                <div className="font-semibold">Datos de pantalla</div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm">Ancho (m)</label>
                    <input
                      type="number"
                      value={selectedFixture.widthM ?? 0}
                      onChange={(e) => updateFixture(selectedFixture.uid, { widthM: Number(e.target.value) } as Partial<NdFixture>)}
                      className="w-full rounded bg-neutral-800 px-2 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm">Alto (m)</label>
                    <input
                      type="number"
                      value={selectedFixture.heightM ?? 0}
                      onChange={(e) => updateFixture(selectedFixture.uid, { heightM: Number(e.target.value) } as Partial<NdFixture>)}
                      className="w-full rounded bg-neutral-800 px-2 py-2"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm">Ancho (px)</label>
                    <input
                      type="number"
                      value={selectedFixture.widthPx ?? 0}
                      onChange={(e) => updateFixture(selectedFixture.uid, { widthPx: Number(e.target.value) } as Partial<NdFixture>)}
                      className="w-full rounded bg-neutral-800 px-2 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm">Alto (px)</label>
                    <input
                      type="number"
                      value={selectedFixture.heightPx ?? 0}
                      onChange={(e) => updateFixture(selectedFixture.uid, { heightPx: Number(e.target.value) } as Partial<NdFixture>)}
                      className="w-full rounded bg-neutral-800 px-2 py-2"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm">Módulos</label>
                    <input
                      type="number"
                      value={selectedFixture.modules ?? 0}
                      onChange={(e) => updateFixture(selectedFixture.uid, { modules: Number(e.target.value) } as Partial<NdFixture>)}
                      className="w-full rounded bg-neutral-800 px-2 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm">Procesador</label>
                    <input
                      type="text"
                      value={selectedFixture.processor ?? ""}
                      onChange={(e) => updateFixture(selectedFixture.uid, { processor: e.target.value } as Partial<NdFixture>)}
                      className="w-full rounded bg-neutral-800 px-2 py-2"
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {/* Audio: cantidad */}
            {!selectedFixture.type.includes("PANTALLA") ? (
              <div className="rounded border border-neutral-800 bg-neutral-900/30 p-3 space-y-3">
                <div className="font-semibold">Datos de audio</div>
                <div>
                  <label className="mb-1 block text-sm">Cantidad</label>
                  <input
                    type="number"
                    value={selectedFixture.quantity ?? 1}
                    onChange={(e) => updateFixture(selectedFixture.uid, { quantity: Number(e.target.value) } as Partial<NdFixture>)}
                    className="w-full rounded bg-neutral-800 px-2 py-2"
                  />
                </div>
              </div>
            ) : null}

            <button
              className="w-full rounded bg-red-600 px-3 py-2 text-sm hover:bg-red-500"
              onClick={() => {
                setFixtures((prev) => prev.filter((f) => f.uid !== selectedFixture.uid))
                setSelectedUid(null)
              }}
            >
              Borrar este objeto
            </button>
          </div>
        )}
      </aside>
    </main>
  )
}