// A copy of the screen in a texture, its mip levels the blur pyramid: the open panel's and the closed shapes' (GlassLayer.tsx), the
// bar's (src/features/taskbar/window/BarGlass.tsx).

import type { GlassZone } from "../../platform/native";
import type { Program } from "./shader";

/** A copy in a texture, its mip levels the blur pyramid; `meta` is the area of the window it holds. */
export interface Copy { tex: WebGLTexture | null; w: number; h: number; levels: number; meta: GlassZone | null }

/** DOWN_FS and the framebuffer it draws each level through. */
type Gpu = { down: Program; fbo: WebGLFramebuffer | null };

// The blur pyramid in the texture's mip levels, each from the one above (dual filter, shader.ts).
function pyramid(gl: WebGL2RenderingContext, { down, fbo }: Gpu, c: Copy) {
  gl.useProgram(down.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  for (let k = 1; k < c.levels; k++) {
    // Only level k - 1 is visible to the sampler while level k is the target: no feedback loop.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, k - 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, k - 1);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, c.tex, k);
    gl.viewport(0, 0, Math.max(1, c.w >> k), Math.max(1, c.h >> k));
    gl.uniform2f(down.u.uStep, 1 / Math.max(1, c.w >> (k - 1)), 1 / Math.max(1, c.h >> (k - 1)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, c.levels - 1);
  // Detached, or the framebuffer would keep the texture, and the copy in it, alive after free().
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/** Puts `bytes` (BGRA, uploaded as RGBA) into `c`'s texture, allocated again only for a new size, and blurs it into its levels. */
export function storeCopy(gl: WebGL2RenderingContext, gpu: Gpu, c: Copy, m: GlassZone, bytes: Uint8Array): void {
  if (!c.tex || m.w !== c.w || m.h !== c.h) {
    if (c.tex) gl.deleteTexture(c.tex);
    c.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, c.tex);
    c.levels = Math.floor(Math.log2(Math.max(m.w, m.h))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, c.levels, gl.RGBA8, m.w, m.h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // The bend and a window partly off its monitor sample past the copy: they get its edge, not the far side.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    c.w = m.w;
    c.h = m.h;
  }
  gl.bindTexture(gl.TEXTURE_2D, c.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, m.w, m.h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  pyramid(gl, gpu, c);
  c.meta = m;
}

/** A texture freed and its size forgotten: the next copy allocates again, even at the same size. */
export function freeCopy(gl: WebGL2RenderingContext, c: Copy): void {
  if (c.tex) gl.deleteTexture(c.tex);
  c.tex = null;
  c.w = c.h = 0;
}
