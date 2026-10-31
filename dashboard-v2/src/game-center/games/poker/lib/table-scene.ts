type Point = { x: number; y: number }
export type TableScene = {
  mode: "landscape" | "square" | "portrait"
  width: number
  height: number
  rail: { left: number; top: number; width: number; height: number }
  center: Point
  boardCardWidth: number
  seats: Point[]
  wagers: Point[]
}

function points(values: number[][]): Point[] { return values.map(([x, y]) => ({ x, y })) }

const scenes: Record<TableScene["mode"], TableScene> = {
  landscape: {
    mode: "landscape", width: 1440, height: 900,
    rail: { left: 80, top: 68, width: 1280, height: 740 },
    center: { x: 720, y: 435 }, boardCardWidth: 80,
    seats: points([[720,770],[410,708],[190,570],[190,300],[410,142],[720,110],[1030,142],[1250,300],[1250,570],[1030,708]]),
    wagers: points([[720,610],[410,830],[190,692],[190,422],[410,264],[720,237],[1030,264],[1250,422],[1250,692],[1030,830]]),
  },
  square: {
    mode: "square", width: 1080, height: 1080,
    rail: { left: 50, top: 60, width: 980, height: 930 },
    center: { x: 540, y: 535 }, boardCardWidth: 72,
    seats: points([[540,945],[340,850],[125,690],[125,390],[340,190],[540,115],[740,190],[955,390],[955,690],[740,850]]),
    wagers: points([[540,792],[340,972],[125,812],[125,512],[340,312],[540,237],[740,312],[955,512],[955,812],[740,972]]),
  },
  portrait: {
    mode: "portrait", width: 840, height: 1320,
    rail: { left: 48, top: 50, width: 744, height: 1220 },
    center: { x: 420, y: 650 }, boardCardWidth: 64,
    seats: points([[420,1195],[110,1060],[110,820],[110,550],[110,290],[420,115],[730,290],[730,550],[730,820],[730,1060]]),
    wagers: points([[420,1045],[110,1182],[110,942],[110,672],[110,412],[420,237],[730,412],[730,672],[730,942],[730,1182]]),
  },
}

/** Measure only the board viewport: chrome and controls have already reserved their space. */
export function fitTableScene(width: number, height: number) {
  const valid = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
  const ratio = valid ? width / height : 1.6
  // The geometric mean is where two contained aspect ratios occupy equal area.
  const landscapeBoundary = Math.sqrt(scenes.landscape.width / scenes.landscape.height)
  const portraitBoundary = Math.sqrt(scenes.portrait.width / scenes.portrait.height)
  const scene = scenes[ratio >= landscapeBoundary ? "landscape" : ratio >= portraitBoundary ? "square" : "portrait"]
  const scale = valid ? Math.min(width / scene.width, height / scene.height) : 0
  return { scene, scale, width: scene.width * scale, height: scene.height * scale }
}

/** Single geometry source for CSS seats, the table surface, and measured chip anchors. */
export function tableSceneVariables(scene: TableScene): Record<string, string> {
  const variables: Record<string, string> = {
    "--poker-rail-left": `${scene.rail.left}px`, "--poker-rail-top": `${scene.rail.top}px`,
    "--poker-rail-width": `${scene.rail.width}px`, "--poker-rail-height": `${scene.rail.height}px`,
    "--poker-center-x": `${scene.center.x}px`, "--poker-center-y": `${scene.center.y}px`,
    "--poker-board-card-width": `${scene.boardCardWidth}px`,
  }
  scene.seats.forEach((point, index) => {
    variables[`--poker-seat-${index}-x`] = `${point.x}px`
    variables[`--poker-seat-${index}-y`] = `${point.y}px`
  })
  return variables
}
