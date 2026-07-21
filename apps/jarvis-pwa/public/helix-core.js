/* Blackspire Helix Core — optional first-party WebGL enhancement.
   The SVG core remains visible and authoritative when this module cannot load,
   WebGL is unavailable, motion is reduced, or the context is lost. */

const STATE_COLORS = {
  dormant: [0.31, 0.85, 1],
  listening: [0.66, 0.91, 1],
  processing: [0.31, 0.85, 1],
  approval: [0.96, 0.72, 0.29],
  completed: [0.34, 0.73, 0.54],
  denied: [0.89, 0.36, 0.36],
  cancelled: [0.49, 0.58, 0.67],
  offline: [0.28, 0.34, 0.4],
  emergency: [0.89, 0.36, 0.36],
};

const STATE_SPEED = {
  dormant: 0.07,
  listening: 0.18,
  processing: 0.42,
  approval: 0,
  completed: 0,
  denied: 0,
  cancelled: 0.025,
  offline: 0,
  emergency: 0,
};

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    throw new Error('Helix shader unavailable');
  }
  return shader;
}

function programFor(gl) {
  const vertex = compile(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    uniform vec2 u_scale;
    uniform float u_rotation;
    uniform float u_aspect;
    void main() {
      float c = cos(u_rotation);
      float s = sin(u_rotation);
      vec2 p = a_position * u_scale;
      p = mat2(c, -s, s, c) * p;
      p.x /= u_aspect;
      gl_Position = vec4(p, 0.0, 1.0);
      gl_PointSize = 3.0;
    }
  `);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec3 u_color;
    uniform float u_alpha;
    void main() { gl_FragColor = vec4(u_color, u_alpha); }
  `);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    throw new Error('Helix program unavailable');
  }
  return program;
}

function ringVertices(segments = 88) {
  const values = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    values.push(Math.cos(angle), Math.sin(angle));
  }
  return new Float32Array(values);
}

/**
 * Mount an optional WebGL layer over the permanent SVG Helix Core.
 * @param {{container: HTMLElement, initialState?: string}} options
 * @returns {{setState(state: string): void, setPaused(paused: boolean): void, destroy(): void}}
 */
export function mountHelixCore({ container, initialState = 'dormant' }) {
  if (!container || !window.WebGLRenderingContext) throw new Error('WebGL unavailable');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = document.createElement('canvas');
  canvas.className = 'helix-enhancement';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL unavailable');

  container.prepend(canvas);
  let program = null;
  let buffer = null;
  let frame = 0;
  let paused = document.hidden || reducedMotion.matches;
  let lost = false;
  let state = STATE_COLORS[initialState] ? initialState : 'dormant';
  let angle = 0;
  let previous = performance.now();

  const setup = () => {
    program = programFor(gl);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, ringVertices(), gl.STATIC_DRAW);
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  };

  const resize = () => {
    const bounds = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    return width / height;
  };

  const drawRing = (scale, rotation, alpha, aspect) => {
    gl.uniform2fv(gl.getUniformLocation(program, 'u_scale'), scale);
    gl.uniform1f(gl.getUniformLocation(program, 'u_rotation'), rotation);
    gl.uniform1f(gl.getUniformLocation(program, 'u_aspect'), aspect);
    gl.uniform1f(gl.getUniformLocation(program, 'u_alpha'), alpha);
    gl.drawArrays(gl.LINE_STRIP, 0, 89);
  };

  const draw = (now) => {
    frame = 0;
    if (paused || lost) return;
    const aspect = resize();
    const delta = Math.min((now - previous) / 1000, 0.05);
    previous = now;
    if (!reducedMotion.matches) angle += delta * STATE_SPEED[state];
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform3fv(gl.getUniformLocation(program, 'u_color'), STATE_COLORS[state]);
    drawRing([0.92, 0.28], angle - 0.3, 0.42, aspect);
    drawRing([0.66, 0.47], -angle * 0.78 + 0.24, 0.28, aspect);
    drawRing([0.4, 0.7], angle * 1.2 - 0.08, 0.22, aspect);
    frame = requestAnimationFrame(draw);
  };

  const resume = () => {
    if (!paused && !lost && !frame) {
      previous = performance.now();
      frame = requestAnimationFrame(draw);
    }
  };

  const onContextLost = (event) => {
    event.preventDefault();
    lost = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    canvas.hidden = true;
  };
  const onContextRestored = () => {
    lost = false;
    canvas.hidden = false;
    setup();
    resume();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  setup();
  resume();

  return {
    setState(next) {
      state = STATE_COLORS[next] ? next : 'dormant';
      if (reducedMotion.matches && !paused && !lost) {
        previous = performance.now();
        if (!frame) frame = requestAnimationFrame(draw);
      }
    },
    setPaused(next) {
      paused = Boolean(next) || reducedMotion.matches;
      if (paused && frame) cancelAnimationFrame(frame);
      if (paused) frame = 0;
      else resume();
    },
    destroy() {
      paused = true;
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      canvas.remove();
    },
  };
}
