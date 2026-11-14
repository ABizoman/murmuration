// The orb: a WebGL shader that moves with the sound this device is putting out.
// Plain WebGL (no library). Adapted from the "voice powered orb" component: same shader, but driven
// by an AnalyserNode on the audio output instead of the microphone, and drawn for a white page.

const VERT = 'attribute vec2 position; varying vec2 vUv; void main(){ vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }';

const FRAG = `
precision highp float;
uniform float iTime; uniform vec3 iResolution; uniform float hue; uniform float hover;
uniform float rot; uniform float hoverIntensity; uniform float pulse;
varying vec2 vUv;

vec3 rgb2yiq(vec3 c){ return vec3(dot(c,vec3(0.299,0.587,0.114)), dot(c,vec3(0.596,-0.274,-0.322)), dot(c,vec3(0.211,-0.523,0.312))); }
vec3 yiq2rgb(vec3 c){ return vec3(c.x+0.956*c.y+0.621*c.z, c.x-0.272*c.y-0.647*c.z, c.x-1.106*c.y+1.703*c.z); }
vec3 adjustHue(vec3 color, float hueDeg){
  float h = hueDeg*3.14159265/180.0; vec3 yiq = rgb2yiq(color); float ca = cos(h); float sa = sin(h);
  return yiq2rgb(vec3(yiq.x, yiq.y*ca - yiq.z*sa, yiq.y*sa + yiq.z*ca));
}
vec3 hash33(vec3 p3){
  p3 = fract(p3*vec3(0.1031,0.11369,0.13787)); p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0*fract(vec3(p3.x+p3.y, p3.x+p3.z, p3.y+p3.z)*p3.zyx);
}
float snoise3(vec3 p){
  const float K1 = 0.333333333; const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x+p.y+p.z)*K1); vec3 d0 = p - (i - (i.x+i.y+i.z)*K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx); vec3 i1 = e*(1.0 - e.zxy); vec3 i2 = 1.0 - e.zxy*(1.0 - e);
  vec3 d1 = d0 - (i1 - K2); vec3 d2 = d0 - (i2 - K1); vec3 d3 = d0 - 0.5;
  vec4 h = max(0.6 - vec4(dot(d0,d0), dot(d1,d1), dot(d2,d2), dot(d3,d3)), 0.0);
  vec4 n = h*h*h*h*vec4(dot(d0,hash33(i)), dot(d1,hash33(i+i1)), dot(d2,hash33(i+i2)), dot(d3,hash33(i+1.0)));
  return dot(vec4(31.316), n);
}
vec4 extractAlpha(vec3 c){ float a = max(max(c.r,c.g),c.b); return vec4(c.rgb/(a+1e-5), a); }
const vec3 baseColor1 = vec3(0.611765,0.262745,0.996078);
const vec3 baseColor2 = vec3(0.298039,0.760784,0.913725);
const vec3 baseColor3 = vec3(0.062745,0.078431,0.600000);
const float innerRadius = 0.6; const float noiseScale = 0.65;
float light1(float i, float a, float d){ return i/(1.0 + d*a); }
float light2(float i, float a, float d){ return i/(1.0 + d*d*a); }

vec4 draw(vec2 uv){
  vec3 color1 = adjustHue(baseColor1, hue); vec3 color2 = adjustHue(baseColor2, hue); vec3 color3 = adjustHue(baseColor3, hue);
  float ang = atan(uv.y, uv.x); float len = length(uv); float invLen = len > 0.0 ? 1.0/len : 0.0;
  float n0 = snoise3(vec3(uv*noiseScale, iTime*0.5))*0.5 + 0.5;
  float r0 = mix(mix(innerRadius,1.0,0.4), mix(innerRadius,1.0,0.6), n0);
  float d0 = distance(uv, (r0*invLen)*uv);
  float v0 = light1(1.0, 10.0, d0); v0 *= smoothstep(r0*1.05, r0, len);
  float cl = cos(ang + iTime*2.0)*0.5 + 0.5;
  float a = iTime*-1.0; vec2 pos = vec2(cos(a), sin(a))*r0; float d = distance(uv, pos);
  float v1 = light2(1.5, 5.0, d); v1 *= light1(1.0, 50.0, d0);
  float v2 = smoothstep(1.0, mix(innerRadius,1.0,n0*0.5), len);
  float v3 = smoothstep(innerRadius, mix(innerRadius,1.0,0.5), len);
  vec3 col = mix(color1, color2, cl); col = mix(color3, col, v0); col = (col + v1)*v2*v3; col = clamp(col, 0.0, 1.0);
  return extractAlpha(col);
}

void main(){
  vec2 fragCoord = vUv*iResolution.xy;
  vec2 center = iResolution.xy*0.5; float size = min(iResolution.x, iResolution.y);
  vec2 uv = (fragCoord - center)/size*2.0;
  uv /= (1.0 + pulse*0.07);
  float s = sin(rot); float c = cos(rot); uv = vec2(c*uv.x - s*uv.y, s*uv.x + c*uv.y);
  uv.x += hover*hoverIntensity*0.1*sin(uv.y*10.0 + iTime);
  uv.y += hover*hoverIntensity*0.1*sin(uv.x*10.0 + iTime);
  // Straight (not premultiplied) alpha so the glow stays bright on a white page.
  gl_FragColor = draw(uv);
}`;

export class Orb {
  constructor(canvas, { hue = 0, reactivity = 1 } = {}) {
    this.canvas = canvas;
    this.hue = hue;
    this.reactivity = reactivity;
    this.analyser = null;
    this.level = 0; // overall loudness, 0..1, smoothed
    this.low = 0; // bass energy, 0..1, smoothed (drives the pulse)
    this.rot = 0;
    this.lastT = 0;
    this.slow = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.ok = this.initGL();
    if (this.ok) requestAnimationFrame((t) => this.frame(t));
  }

  // Feed it the AnalyserNode that sits on this device's audio output.
  listen(analyser) {
    this.analyser = analyser;
    this.td = new Float32Array(analyser.fftSize);
    this.fd = new Uint8Array(analyser.frequencyBinCount);
  }

  initGL() {
    const gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) return false;
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('orb shader:', gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, make(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = Object.fromEntries(['iTime', 'iResolution', 'hue', 'hover', 'rot', 'hoverIntensity', 'pulse'].map((n) => [n, gl.getUniformLocation(prog, n)]));
    gl.clearColor(0, 0, 0, 0);
    this.gl = gl;
    return true;
  }

  readAudio() {
    let target = 0, lowTarget = 0;
    const a = this.analyser;
    if (a && a.context.state === 'running') {
      a.getFloatTimeDomainData(this.td);
      let sum = 0;
      for (let i = 0; i < this.td.length; i++) sum += this.td[i] * this.td[i];
      target = Math.min(Math.sqrt(sum / this.td.length) * 4.5 * this.reactivity, 1);
      a.getByteFrequencyData(this.fd);
      let lo = 0;
      for (let j = 1; j < 7; j++) lo += this.fd[j];
      lowTarget = Math.min((lo / 6 / 255) * this.reactivity, 1);
    }
    // Fast attack, slower release, so it follows the beat without jitter.
    this.level += (target - this.level) * (target > this.level ? 0.35 : 0.08);
    this.low += (lowTarget - this.low) * (lowTarget > this.low ? 0.5 : 0.12);
  }

  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const { gl, u, canvas } = this;
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    this.readAudio();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);

    const lv = this.slow ? this.level * 0.4 : this.level;
    this.rot += dt * (0.15 + lv * 2.4);
    gl.uniform1f(u.iTime, (this.slow ? 0.4 : 1) * t / 1000);
    gl.uniform3f(u.iResolution, canvas.width, canvas.height, canvas.width / Math.max(canvas.height, 1));
    gl.uniform1f(u.hue, this.hue);
    gl.uniform1f(u.rot, this.rot);
    gl.uniform1f(u.hover, Math.min(lv * 2, 1));
    gl.uniform1f(u.hoverIntensity, Math.min(lv * 0.64, 0.8));
    gl.uniform1f(u.pulse, this.slow ? 0 : this.low);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}