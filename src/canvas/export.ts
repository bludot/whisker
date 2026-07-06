import type { BoardRenderer } from './renderer'

/** Board exports: PNG/JPEG via the renderer, PDF by wrapping the JPEG in a
 *  minimal hand-rolled document (single image, DCTDecode — no pdf library
 *  needed), and .whisker files via scene/serialize. */

export async function exportBoardImage(
  renderer: BoardRenderer,
  kind: 'png' | 'jpeg',
): Promise<Blob | null> {
  const canvas = renderer.exportCanvas()
  if (!canvas) return null
  return new Promise((resolve) =>
    canvas.toBlob(
      (b) => resolve(b),
      kind === 'png' ? 'image/png' : 'image/jpeg',
      0.92,
    ),
  )
}

export async function exportBoardPdf(
  renderer: BoardRenderer,
): Promise<Blob | null> {
  const canvas = renderer.exportCanvas()
  if (!canvas) return null
  const jpegBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
  )
  if (!jpegBlob) return null
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer())
  return jpegToPdf(jpeg, canvas.width, canvas.height)
}

/** Wrap JPEG bytes in a one-page PDF sized to the image (rendered at
 *  144 dpi: the export canvas is 2x, so 2 device px = 1 board px = 0.5 pt). */
function jpegToPdf(jpeg: Uint8Array, pxW: number, pxH: number): Blob {
  const ptW = +((pxW * 72) / 144).toFixed(2)
  const ptH = +((pxH * 72) / 144).toFixed(2)
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  let offset = 0
  const offsets: number[] = []
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk
    parts.push(bytes)
    offset += bytes.length
  }
  const beginObj = () => offsets.push(offset)

  const content = `q\n${ptW} 0 0 ${ptH} 0 0 cm\n/Im0 Do\nQ\n`

  push('%PDF-1.4\n')
  beginObj()
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  beginObj()
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  beginObj()
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  )
  beginObj()
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${jpeg.length} >>\nstream\n`,
  )
  push(jpeg)
  push('\nendstream\nendobj\n')
  beginObj()
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)

  const xrefStart = offset
  push(
    'xref\n0 6\n0000000000 65535 f \n' +
      offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join(''),
  )
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`)
  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function exportFilename(ext: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `whisker-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`
}
