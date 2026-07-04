/** Viewport transform: world coordinates <-> screen pixels. */
export class Camera {
  x = 0 // world coordinate at the left edge of the screen
  y = 0
  zoom = 1

  static readonly MIN_ZOOM = 0.05
  static readonly MAX_ZOOM = 8

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom }
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom }
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom
    this.y -= dyScreen / this.zoom
  }

  /** Zoom by `factor`, keeping the world point under (sx, sy) fixed on screen. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy)
    this.zoom = Math.min(
      Camera.MAX_ZOOM,
      Math.max(Camera.MIN_ZOOM, this.zoom * factor),
    )
    const after = this.screenToWorld(sx, sy)
    this.x += before.x - after.x
    this.y += before.y - after.y
  }
}
