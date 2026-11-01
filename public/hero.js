// A broken bowl mended with gold. One shard drifts away as dust and comes back.
const canvas = document.querySelector('#bowl')
const stage = document.querySelector('.stage')
const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false })
const still = matchMedia('(prefers-reduced-motion: reduce)').matches

const TAU = Math.PI * 2
const JOIN = 0.34 // how far down the bowl the shard's two cracks meet

let state = 524287
const rnd = () => (state = (state * 16807) % 2147483647) / 2147483647

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const profile = (t) => [0.36 + 0.68 * Math.sin((t * Math.PI) / 2) ** 0.82, -0.52 + 0.94 * t ** 1.35]
const wander = (at, s) => (t) => at + 0.06 * Math.sin(t * 9 + s) + 0.03 * Math.sin(t * 23 + s * 2) + 0.016 * Math.sin(t * 51 + s * 3)

const shardLeft = wander(0.28, 1.2)
const shardRight = (t) => shardLeft(t) + 1.02 * ((t - JOIN) / (1 - JOIN)) ** 0.72 + 0.03 * Math.sin(t * 31)
const cracks = [
  { at: shardLeft, from: 0.1 },
  { at: shardRight, from: JOIN },
  { at: wander(-0.95, 2.1), from: 0.3 },
  { at: wander(2.2, 3.4), from: 0.46 },
  { at: wander(-2.3, 0.7), from: 0.2 },
]

const wrap = (a) => a - TAU * Math.round(a / TAU)

function point(out, i, theta, t, r, y, nr, ny, seam) {
  const inShard = t > JOIN && wrap(theta - shardLeft(t)) > 0 && wrap(theta - shardRight(t)) < 0
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const f = rnd()
  const reach = inShard ? 0.45 + 1.5 * f * f : 0
  const o = i * 12
  out.set([r * cos, y, r * sin, nr * cos, ny, nr * sin, (cos + 0.9) * reach, (0.5 + rnd() * 0.7) * reach, sin * 0.5 * reach, seam, inShard ? 0.05 + 0.42 * (1 - (t - JOIN) / (1 - JOIN)) + 0.22 * rnd() : 2, rnd()], o)
}

function build(count) {
  const out = new Float32Array(count * 12)
  for (let i = 0; i < count; i++) {
    const kind = rnd()
    if (kind < 0.09) {
      // the gold, sampled along each crack so the seams stay crisp
      const c = cracks[Math.floor(rnd() * cracks.length)]
      const t = c.from + rnd() * (1 - c.from)
      const [r, y] = profile(t)
      const inner = rnd() < 0.4
      point(out, i, c.at(t) + (rnd() - 0.5) * 0.012, t, inner ? r - 0.036 : r, inner ? y + 0.05 : y, inner ? -0.7 : 0.8, inner ? 0.7 : -0.55, 1)
      continue
    }
    if (kind < 0.11) {
      // the foot ring under the bowl
      const y = -0.52 - rnd() * 0.07
      point(out, i, rnd() * TAU, 0.001, 0.37, y, 1, 0, 0)
      continue
    }
    if (kind < 0.14) {
      // inside floor
      const r = Math.sqrt(rnd()) * 0.36
      point(out, i, rnd() * TAU, 0.001, r, -0.47, 0, 1, 0)
      continue
    }
    let t
    let r
    do {
      t = rnd()
      r = profile(t)[0]
    } while (rnd() > r / 1.05)
    const y = profile(t)[1]
    const [r2, y2] = profile(Math.min(1, t + 0.01))
    const [r1, y1] = profile(Math.max(0, t - 0.01))
    const len = Math.hypot(r2 - r1, y2 - y1)
    const nr = (y2 - y1) / len
    const ny = -(r2 - r1) / len
    const theta = rnd() * TAU
    if (kind < 0.58) point(out, i, theta, t, r, y, nr, ny, 0)
    else if (kind < 0.97) point(out, i, theta, t, r - 0.036, y + 0.05, -nr, -ny, 0)
    else {
      const lip = rnd() * Math.PI
      point(out, i, theta, 1, 1.022 + 0.02 * Math.cos(lip), 0.445 + 0.022 * Math.sin(lip), Math.cos(lip), Math.sin(lip), 0)
    }
  }
  return out
}

const vertex = `
attribute vec3 aPos, aNormal, aDrift, aMeta;
uniform float uYaw, uPitch, uScale, uPhase, uSize, uTime;
uniform vec2 uCentre, uRes;
varying vec4 vColor;
void main() {
  float seam = aMeta.x, delay = aMeta.y, grain = aMeta.z;
  float k = smoothstep(delay, delay + 0.4, uPhase);
  vec3 p = aPos + aDrift * k * k + 0.025 * k * vec3(sin(uTime * 0.7 + grain * 40.0), cos(uTime * 0.5 + grain * 60.0), sin(uTime * 0.4 + grain * 90.0));
  float ca = cos(uYaw), sa = sin(uYaw), cb = cos(uPitch), sb = sin(uPitch);
  vec3 q = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
  q = vec3(q.x, cb * q.y - sb * q.z, sb * q.y + cb * q.z);
  vec3 n = vec3(ca * aNormal.x + sa * aNormal.z, aNormal.y, -sa * aNormal.x + ca * aNormal.z);
  n = vec3(n.x, cb * n.y - sb * n.z, sb * n.y + cb * n.z);
  float light = max(dot(n, normalize(vec3(-0.5, 0.7, 0.55))), 0.0);
  float depth = 1.0 / (1.0 - q.z * 0.1);
  vec2 s = uCentre + uScale * q.xy * depth;
  gl_Position = vec4(s / uRes * 2.0 - 1.0, -q.z * 0.4, 1.0);
  gl_PointSize = uSize * depth * (1.0 + seam * 0.55);
  vec3 c = mix(vec3(0.05, 0.16, 0.19), vec3(0.38, 0.56, 0.58), pow(light, 1.5)) + (grain - 0.5) * 0.09;
  c = mix(c, vec3(0.78, 0.58, 0.2) + (grain - 0.5) * 0.22, seam);
  vColor = vec4(c, 1.0 - k * 0.5);
}`

const fragment = `
precision mediump float;
varying vec4 vColor;
void main() {
  if (length(gl_PointCoord - 0.5) > 0.5) discard;
  gl_FragColor = vColor;
}`

function compile(type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

if (gl) {
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment))
  gl.linkProgram(program)
  gl.useProgram(program)

  const count = innerWidth < 720 ? 110000 : 260000
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, build(count), gl.STATIC_DRAW)
  ;['aPos', 'aNormal', 'aDrift', 'aMeta'].forEach((name, i) => {
    const at = gl.getAttribLocation(program, name)
    gl.enableVertexAttribArray(at)
    gl.vertexAttribPointer(at, 3, gl.FLOAT, false, 48, i * 12)
  })
  const u = Object.fromEntries(['uYaw', 'uPitch', 'uScale', 'uPhase', 'uSize', 'uTime', 'uCentre', 'uRes'].map((n) => [n, gl.getUniformLocation(program, n)]))

  gl.enable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.clearColor(0, 0, 0, 0)

  const layout = () => {
    const dpr = Math.min(devicePixelRatio, 2)
    const box = canvas.getBoundingClientRect()
    const area = stage.getBoundingClientRect()
    canvas.width = box.width * dpr
    canvas.height = box.height * dpr
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(u.uRes, canvas.width, canvas.height)
    gl.uniform2f(u.uCentre, (area.left - box.left + area.width / 2) * dpr, (box.bottom - area.top - area.height * 0.46 - 8) * dpr)
    gl.uniform1f(u.uScale, Math.min(area.width * 0.3, (area.height - 65) * 0.54) * dpr)
    gl.uniform1f(u.uSize, 1.7 * dpr)
    gl.uniform1f(u.uPitch, 0.46)
  }

  const draw = (ms) => {
    const t = ms / 1000
    gl.uniform1f(u.uTime, t)
    gl.uniform1f(u.uPhase, still ? 0.6 : 0.46 - 0.46 * Math.cos(t * 0.3))
    gl.uniform1f(u.uYaw, still ? -0.12 : -0.12 + 0.2 * Math.sin(t * 0.17))
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.drawArrays(gl.POINTS, 0, count)
  }

  let frame = 0
  const loop = (ms) => {
    draw(ms)
    frame = requestAnimationFrame(loop)
  }
  const refresh = () => {
    layout()
    if (still) draw(0)
  }
  addEventListener('resize', refresh)
  refresh()
  document.fonts?.ready.then(refresh)

  if (!still) {
    new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(frame)
      if (entry.isIntersecting) frame = requestAnimationFrame(loop)
    }).observe(canvas)
  }
}
