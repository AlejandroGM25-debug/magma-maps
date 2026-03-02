// app/lib/riderPdf.ts
"use client"

import { jsPDF } from "jspdf"
import type Konva from "konva"

type CatalogEntry = { label?: string; kind2?: "SCREEN" | "AUDIO" | "OTHER" }
type Catalog = Record<string, CatalogEntry>

type AnyFixture = any // no tipamos fuerte aquí para que te encaje sí o sí

type RiderInput = {
  projectName: string
  stage: Konva.Stage
  fixtures: AnyFixture[]
  zones: any[]
  exportedJsonName?: string

  dmxCatalog: Catalog
  ndCatalog: Catalog
  getChannels: (fx: AnyFixture) => number

  // Si algún ND no trae processor/modules, no pasa nada.
  logoPath?: string // default "/magma-logo.png"
}

const MAGMA_RED = "#E11D2E"
const TEXT = "#111827"
const MUTED = "#6B7280"

function dataUrlToImageType(dataUrl: string): "PNG" | "JPEG" {
  return dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG"
}

async function fetchAsDataUrl(path: string): Promise<string | null> {
  try {
    const res = await fetch(path)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = reject
      r.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function rangeLabel(address: number, ch: number) {
  const a = Math.max(1, address || 1)
  const b = Math.max(1, a + Math.max(1, ch) - 1)
  return `${a}–${b}`
}

function zoneBucket(z?: string) {
  const s = (z ?? "").toLowerCase()
  if (s.includes("esc") || s.includes("stage")) return "ESCENARIO"
  if (s.includes("pista") || s.includes("floor")) return "PISTA"
  if (s.includes("vip")) return "VIP"
  return "OTROS"
}

function drawHeader(doc: jsPDF, title: string, subtitle?: string) {
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.setTextColor(TEXT)
  doc.text(title, 18, 18)

  doc.setDrawColor(MAGMA_RED)
  doc.setLineWidth(1.2)
  doc.line(18, 22, pageW - 18, 22)

  if (subtitle) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.setTextColor(MUTED)
    doc.text(subtitle, 18, 28)
  }
}

function drawKeyValue(doc: jsPDF, x: number, y: number, key: string, value: string) {
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.setTextColor(TEXT)
  doc.text(key, x, y)

  doc.setFont("helvetica", "normal")
  doc.setTextColor(MUTED)
  doc.text(value, x + 28, y)
}

function drawTable(
  doc: jsPDF,
  x: number,
  y: number,
  colWidths: number[],
  header: string[],
  rows: string[][],
  options?: { rowH?: number; headerH?: number }
) {
  const rowH = options?.rowH ?? 6.2
  const headerH = options?.headerH ?? 7.2
  const totalW = colWidths.reduce((a, b) => a + b, 0)

  doc.setFillColor(245, 245, 245)
  doc.rect(x, y, totalW, headerH, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(TEXT)

  let cx = x
  for (let i = 0; i < header.length; i++) {
    doc.text(header[i], cx + 2, y + 5)
    cx += colWidths[i]
  }

  doc.setFont("helvetica", "normal")
  doc.setTextColor(TEXT)

  let ry = y + headerH
  for (const r of rows) {
    cx = x
    for (let i = 0; i < r.length; i++) {
      doc.text(String(r[i] ?? ""), cx + 2, ry + 4.6)
      cx += colWidths[i]
    }
    doc.setDrawColor(230, 230, 230)
    doc.line(x, ry, x + totalW, ry)
    ry += rowH
  }

  doc.setDrawColor(200, 200, 200)
  doc.rect(x, y, totalW, headerH + rows.length * rowH)
  return ry
}

export async function exportRiderPdf(input: RiderInput) {
  const {
    projectName,
    stage,
    fixtures,
    zones,
    exportedJsonName = "magma-map.json",
    dmxCatalog,
    ndCatalog,
    getChannels,
    logoPath = "/magma-logo.png",
  } = input

  const mapDataUrl = stage.toDataURL({ pixelRatio: 6 })
  const mapType = dataUrlToImageType(mapDataUrl)

  const logoDataUrl = await fetchAsDataUrl(logoPath)
  const logoType = logoDataUrl ? dataUrlToImageType(logoDataUrl) : null

  const dmx = fixtures.filter((f) => f?.kind === "DMX")
  const nd = fixtures.filter((f) => f?.kind === "ND")

  const screens = nd.filter((f) => (ndCatalog[f.type]?.kind2 ?? "OTHER") === "SCREEN")
  const audio = nd.filter((f) => (ndCatalog[f.type]?.kind2 ?? "OTHER") === "AUDIO")

  // Resumen por zonas
  const byBucket: Record<string, number> = { ESCENARIO: 0, PISTA: 0, VIP: 0, OTROS: 0 }
  for (const f of fixtures) byBucket[zoneBucket(f?.zona)]++

  // Patch DMX
  const dmxRows = [...dmx]
    .sort((a, b) => (a.universe - b.universe) || (a.address - b.address) || String(a.id).localeCompare(String(b.id)))
    .map((fx) => {
      const ch = getChannels(fx)
      const tipo = dmxCatalog[fx.type]?.label ?? fx.type
      const zona = fx.zona ?? "-"
      return [
        String(fx.id ?? "-"),
        String(tipo),
        String(fx.universe ?? "-"),
        String(fx.address ?? "-"),
        rangeLabel(Number(fx.address ?? 1), ch),
        String(ch),
        String(zona),
      ]
    })

  // Pantallas
  const screenRows = screens.map((s) => {
    const label = s.label ?? (ndCatalog[s.type]?.label ?? s.type)
    const dims = (s.widthM && s.heightM) ? `${s.widthM}m x ${s.heightM}m` : "-"
    const mods = typeof s.modules === "number" ? String(s.modules) : "-"
    const proc = s.processor ?? "-"
    return [String(label), dims, mods, String(proc), String(s.zona ?? "-")]
  })

  // Audio (agregado)
  const audioAgg = new Map<string, number>()
  for (const a of audio) {
    const label = ndCatalog[a.type]?.label ?? a.type
    const qty = Number.isFinite(a.quantity) ? Number(a.quantity) : 1
    audioAgg.set(label, (audioAgg.get(label) ?? 0) + qty)
  }
  const audioRows = [...audioAgg.entries()].map(([label, qty]) => [label, String(qty)])

  // PDF A4 horizontal
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  // Página 1
  drawHeader(doc, "MAGMA CLUB · RIDER TÉCNICO", projectName)

  if (logoDataUrl && logoType) {
    const w = 60
    const h = 22
    doc.addImage(logoDataUrl, logoType, pageW - 18 - w, 10, w, h)
  }

  const now = new Date()
  drawKeyValue(doc, 18, 38, "Fecha:", now.toLocaleDateString())
  drawKeyValue(doc, 18, 44, "Proyecto:", projectName)
  drawKeyValue(doc, 18, 50, "Export JSON:", exportedJsonName)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.setTextColor(TEXT)
  doc.text("Resumen por zonas", 18, 60)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(MUTED)
  doc.text(
    `Escenario: ${byBucket.ESCENARIO} · Pista: ${byBucket.PISTA} · VIP: ${byBucket.VIP} · Otros: ${byBucket.OTROS}`,
    18,
    66
  )

  const imgX = 18
  const imgY = 72
  const imgW = pageW - 36
  const imgH = pageH - imgY - 14

  doc.setDrawColor(220, 220, 220)
  doc.rect(imgX, imgY, imgW, imgH)
  doc.addImage(mapDataUrl, mapType, imgX, imgY, imgW, imgH, undefined, "FAST")

  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(MUTED)
  doc.text("MAGMA CLUB · Documento interno", 18, pageH - 8)
  doc.setTextColor(MAGMA_RED)
  doc.text("magma-maps", pageW - 18, pageH - 8, { align: "right" })

  // Página 2
  doc.addPage()
  drawHeader(doc, "Patch & Sistemas", "DMX · Video · Audio")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(TEXT)
  doc.text("Patch DMX", 18, 34)

  let y = 38
  const colW = [34, 42, 14, 16, 22, 14, 48]
  const header = ["ID", "Tipo", "U", "Addr", "Rango", "Ch", "Zona"]

  const rowH = 6.2
  const headerH = 7.2
  const maxTableH = pageH - 18 - y
  const rowsPerPage = Math.max(1, Math.floor((maxTableH - headerH) / rowH) - 1)

  let idx = 0
  while (idx < dmxRows.length) {
    const chunk = dmxRows.slice(idx, idx + rowsPerPage)
    const endY = drawTable(doc, 18, y, colW, header, chunk, { rowH, headerH })
    idx += chunk.length

    if (idx < dmxRows.length) {
      doc.addPage()
      drawHeader(doc, "Patch & Sistemas (cont.)")
      y = 26
    } else {
      y = endY + 8
    }
  }

  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(TEXT)
  doc.text("Pantallas", 18, y)
  y += 4

  const screenHeader = ["Nombre", "Dimensiones", "Módulos", "Procesador", "Zona"]
  const screenColW = [64, 36, 18, 42, 38]
  y = drawTable(doc, 18, y + 2, screenColW, screenHeader, screenRows.length ? screenRows : [["-", "-", "-", "-", "-"]])
  y += 8

  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(TEXT)
  doc.text("Audio", 18, y)
  y += 4

  const audioHeader = ["Sistema", "Cantidad"]
  const audioColW = [140, 20]
  drawTable(doc, 18, y + 2, audioColW, audioHeader, audioRows.length ? audioRows : [["-", "-"]])

  const safeName = projectName.trim().replace(/[^\w\-]+/g, "_")
  doc.save(`MAGMA_RIDER_${safeName}.pdf`)
}