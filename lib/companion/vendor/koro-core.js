function reportRenderError(error) { console.error("Companion renderer:", error); }

let MeshRenderer = class {
    constructor(e) { this.model = e; const n = e.gl, r = e._program, s = e.man.art_meshes, i = s.reduce((f, m) => f + m.vcount, 0), o = i <= 65535 ? Uint16Array : Uint32Array; this.indexType = i <= 65535 ? n.UNSIGNED_SHORT : n.UNSIGNED_INT; const a = new o(s.reduce((f, m) => f + m.idx_n, 0)), c = new Float32Array(i * 2); this.positions = e._worldPositions instanceof Float32Array && e._worldPositions.length === i * 2 ? e._worldPositions : new Float32Array(i * 2); const u = n.getExtension("WEBGL_multi_draw"); this.multi = typeof u?.multiDrawElementsWEBGL == "function" ? u : null, this.counts = this.multi ? new Int32Array(Math.max(1, s.length)) : null, this.offsets = this.multi ? new Int32Array(this.counts.length) : null, this.pending = 0; let d = 0, h = 0; for (const f of s) {
        f._positionOffset = d * 2, f._indexOffset = h * o.BYTES_PER_ELEMENT, c.set(f._uv, d * 2);
        for (const m of f._idx) {
            const y = m & 65535;
            if (y === 65535)
                a[h++] = o === Uint16Array ? 65535 : 4294967295;
            else {
                if (y >= f.vcount)
                    throw new Error("avatar index outside mesh");
                a[h++] = y + d;
            }
        }
        d += f.vcount;
    } this.vao = n.createVertexArray(), n.bindVertexArray(this.vao), this.positionBuffer = n.createBuffer(), n.bindBuffer(n.ARRAY_BUFFER, this.positionBuffer), n.bufferData(n.ARRAY_BUFFER, this.positions.byteLength, n.DYNAMIC_DRAW), n.enableVertexAttribArray(r.aPos), n.vertexAttribPointer(r.aPos, 2, n.FLOAT, !1, 0, 0), this.uvBuffer = n.createBuffer(), n.bindBuffer(n.ARRAY_BUFFER, this.uvBuffer), n.bufferData(n.ARRAY_BUFFER, c, n.STATIC_DRAW), n.enableVertexAttribArray(r.aUv), n.vertexAttribPointer(r.aUv, 2, n.FLOAT, !1, 0, 0), this.indexBuffer = n.createBuffer(), n.bindBuffer(n.ELEMENT_ARRAY_BUFFER, this.indexBuffer), n.bufferData(n.ELEMENT_ARRAY_BUFFER, a, n.STATIC_DRAW), n.bindVertexArray(null); }
    mesh(e, n, r, s, i) { const o = this.model.gl, a = this.model._program; (this.texture !== e.texture || this.mode !== n || this.opacity !== i || this.blend !== r || this.cull !== s) && this.flush(), this.texture !== e.texture && (o.bindTexture(o.TEXTURE_2D, this.model.textures[e.texture]), this.texture = e.texture), this.mode !== n && (o.uniform1i(a.uMode, n), this.mode = n), this.opacity !== i && (o.uniform1f(a.uOpacity, i), this.opacity = i), this.blend !== r && (r === -1 ? o.blendFunc(o.ONE, o.ONE) : r === 1 ? o.blendFuncSeparate(o.ONE, o.ONE, o.ZERO, o.ONE) : r === 2 ? o.blendFuncSeparate(o.DST_COLOR, o.ONE_MINUS_SRC_ALPHA, o.ZERO, o.ONE) : o.blendFuncSeparate(o.ONE, o.ONE_MINUS_SRC_ALPHA, o.ONE, o.ONE_MINUS_SRC_ALPHA), this.blend = r), this.cull !== s && (s ? o.enable(o.CULL_FACE) : o.disable(o.CULL_FACE), this.cull = s), this.multi ? (this.pending === this.counts.length && this.flush(), this.counts[this.pending] = e.idx_n, this.offsets[this.pending++] = e._indexOffset) : o.drawElements(o.TRIANGLES, e.idx_n, this.indexType, e._indexOffset); }
    flush() { if (!this.pending)
        return; const e = this.model.gl; this.pending === 1 ? e.drawElements(e.TRIANGLES, this.counts[0], this.indexType, this.offsets[0]) : this.multi.multiDrawElementsWEBGL(e.TRIANGLES, this.counts, 0, this.indexType, this.offsets, 0, this.pending), this.pending = 0; }
    draw(e) { const n = this.model, r = n.gl, s = n.man.art_meshes, i = n._program, o = r.drawingBufferWidth, a = r.drawingBufferHeight; if (n._ensureMaskFBO(o, a), this.positions === n._worldPositions) {
        for (const u of s)
            if (u._world.buffer !== this.positions.buffer || u._world.byteOffset !== this.positions.byteOffset + u._positionOffset * Float32Array.BYTES_PER_ELEMENT || u._world.length !== u.vcount * 2) {
                this.positions = new Float32Array(this.positions);
                break;
            }
    } if (this.positions !== n._worldPositions)
        for (const u of s)
            this.positions.set(u._world, u._positionOffset); r.bindVertexArray(this.vao), r.bindBuffer(r.ARRAY_BUFFER, this.positionBuffer), r.bufferSubData(r.ARRAY_BUFFER, 0, this.positions), r.useProgram(i.program), r.uniformMatrix4fv(i.uProj, !1, e), r.uniform1i(i.uTex, 0), r.uniform1i(i.uMaskTex, 1), r.uniform2f(i.uViewSize, o, a), r.enable(r.BLEND), r.disable(r.SCISSOR_TEST), r.cullFace(r.BACK), r.frontFace(n._frontFace || r.CW), r.activeTexture(r.TEXTURE1), r.bindTexture(r.TEXTURE_2D, n._maskTex), r.activeTexture(r.TEXTURE0), this.texture = this.opacity = this.cull = void 0, this.mode = -1, this.blend = -2; let c = null; for (const u of n._order) {
        const d = s[u];
        if (!(d._opacity <= .001 || d._offscreenSkip)) {
            if (d._maskKey && c !== d._maskKey) {
                this.flush(), r.activeTexture(r.TEXTURE1), r.bindTexture(r.TEXTURE_2D, null), r.activeTexture(r.TEXTURE0), r.bindFramebuffer(r.FRAMEBUFFER, n._maskFBO), r.viewport(0, 0, o, a), r.clearColor(0, 0, 0, 0), r.clear(r.COLOR_BUFFER_BIT);
                for (const h of d.masks)
                    this.mesh(s[h], 1, -1, !1, 1);
                this.flush(), r.bindFramebuffer(r.FRAMEBUFFER, null), r.viewport(0, 0, o, a), r.activeTexture(r.TEXTURE1), r.bindTexture(r.TEXTURE_2D, n._maskTex), r.activeTexture(r.TEXTURE0), c = d._maskKey;
            }
            this.mesh(d, d._maskKey ? d.inverted ? 3 : 2 : 0, d.blend & 1 ? 1 : d.blend & 2 ? 2 : 0, !d.double_sided, d._opacity);
        }
    } this.flush(), r.bindVertexArray(null); }
    dispose() { const e = this.model.gl; for (const n of [this.positionBuffer, this.uvBuffer, this.indexBuffer])
        e.deleteBuffer(n); e.deleteVertexArray(this.vao); }
};

function blendRotation(t, e, n) { let r = 0; if (e) {
    const { idx: s, wt: i, cnt: o, strides: a, n: c } = e, u = 1 << c;
    for (let d = 0; d < u; d++) {
        let h = 0, f = 1;
        for (let y = 0; y < c; y++) {
            const p = d >> y & 1;
            let A = s[y] + p;
            A > o[y] - 1 && (A = o[y] - 1), h += A * a[y], f *= p ? i[y] : 1 - i[y];
        }
        if (!(f > 0))
            continue;
        const m = t.keyforms[h];
        n.ox += m.ox * f, n.oy += m.oy * f, n.ang += m.angle * f, n.scale += m.scale * f, r += m.opacity * f;
    }
}
else {
    const s = t.keyforms[0];
    n.ox += s.ox * 1, n.oy += s.oy * 1, n.ang += s.angle * 1, n.scale += s.scale * 1, r += s.opacity * 1;
} return r; }

function interpolateTriangle(t, e, n, r, s, i, o, a, c, u, d, h) { if (t + e > 1) {
    const f = 1 - t, m = 1 - e;
    d[h] = c + (o - c) * f + (s - c) * m, d[h + 1] = u + (a - u) * f + (i - u) * m;
}
else
    d[h] = n + (s - n) * t + (o - n) * e, d[h + 1] = r + (i - r) * t + (a - r) * e; }

function extrapolateWarp(t, e, n) { const r = t._grid, s = t.cols, i = t.rows, o = s + 1, a = t._frame6, c = e[n], u = e[n + 1], d = c * s, h = u * i, f = a[0], m = a[1], y = a[2], p = a[3], A = a[4], v = a[5]; if (!(c >= -2 && c <= 3 && u >= -2 && u <= 3)) {
    e[n] = f + y * c + A * u, e[n + 1] = m + p * c + v * u;
    return;
} const E = c >= 1 ? 2 : c >= 0 ? 1 : 0, _ = u >= 1 ? 2 : u >= 0 ? 1 : 0, x = E + _ * 3, C = Math.max(0, Math.floor(d)), S = Math.max(0, Math.floor(h)); switch (x) {
    case 7: {
        const M = Math.min(C, s - 1), b = M / s, I = (M + 1) / s, R = (M + i * o) * 2, j = (M + 1 + i * o) * 2;
        interpolateTriangle(d - M, (u - 1) / 2, r[R], r[R + 1], r[j], r[j + 1], f + y * b + A * 3, m + p * b + v * 3, f + y * I + A * 3, m + p * I + v * 3, e, n);
        break;
    }
    case 1: {
        const M = Math.min(C, s - 1), b = M / s, I = (M + 1) / s, R = M * 2, j = (M + 1) * 2;
        interpolateTriangle(d - M, (u - -2) / 2, f + y * b + A * -2, m + p * b + v * -2, f + y * I + A * -2, m + p * I + v * -2, r[R], r[R + 1], r[j], r[j + 1], e, n);
        break;
    }
    case 3: {
        const M = Math.min(S, i - 1), b = M / i, I = (M + 1) / i, R = M * o * 2, j = (M + 1) * o * 2;
        interpolateTriangle((c - -2) / 2, h - M, f + y * -2 + A * b, m + p * -2 + v * b, r[R], r[R + 1], f + y * -2 + A * I, m + p * -2 + v * I, r[j], r[j + 1], e, n);
        break;
    }
    case 5: {
        const M = Math.min(S, i - 1), b = M / i, I = (M + 1) / i, R = (s + M * o) * 2, j = (s + (M + 1) * o) * 2;
        interpolateTriangle((c - 1) / 2, h - M, r[R], r[R + 1], f + y * 3 + A * b, m + p * 3 + v * b, r[j], r[j + 1], f + y * 3 + A * I, m + p * 3 + v * I, e, n);
        break;
    }
    case 6: {
        const M = i * o * 2;
        interpolateTriangle((c - -2) / 2, (u - 1) / 2, f + y * -2 + A * 1, m + p * -2 + v * 1, r[M], r[M + 1], f + y * -2 + A * 3, m + p * -2 + v * 3, f + y * 0 + A * 3, m + p * 0 + v * 3, e, n);
        break;
    }
    case 8: {
        const M = (s + i * o) * 2;
        interpolateTriangle((c - 1) / 2, (u - 1) / 2, r[M], r[M + 1], f + y * 3 + A * 1, m + p * 3 + v * 1, f + y * 1 + A * 3, m + p * 1 + v * 3, f + y * 3 + A * 3, m + p * 3 + v * 3, e, n);
        break;
    }
    case 0:
        interpolateTriangle((c - -2) / 2, (u - -2) / 2, f + y * -2 + A * -2, m + p * -2 + v * -2, f + y * 0 + A * -2, m + p * 0 + v * -2, f + y * -2 + A * 0, m + p * -2 + v * 0, r[0], r[1], e, n);
        break;
    case 2: {
        const M = s * 2;
        interpolateTriangle((c - 1) / 2, (u - -2) / 2, f + y * 1 + A * -2, m + p * 1 + v * -2, f + y * 3 + A * -2, m + p * 3 + v * -2, r[M], r[M + 1], f + y * 3 + A * 0, m + p * 3 + v * 0, e, n);
        break;
    }
} }

class KoroModel {
    constructor(e, n, r, s) { this.gl = e, this.man = n, this.bin = r; try {
        this.f32 = new Float32Array(r), this.i16 = new Int16Array(r);
    }
    catch (o) {
        throw reportRenderError(o, "binary_view"), o;
    } this.textures = s, this.params = n.parameters.map(o => o.default), this.clampMin = n.parameters.map(o => o.min), this.clampMax = n.parameters.map(o => o.max), this.scalePos = n.parameters.map(() => 1), this.scaleNeg = n.parameters.map(() => 1), this.scaledIdx = [], this.evalParams = Float32Array.from(this.params), this.paramIndex = new Map(n.parameters.map((o, a) => [o.id, a])), this.partOpacity = new Float32Array(n.parts.length).fill(1), this.partIndex = new Map(n.parts.map((o, a) => [o.id, a])), this.pb = n.parameter_bindings, this.kb = n.keyform_bindings; for (const o of n.deformers)
        o.type === "warp" ? o._grid = new Float32Array(o.cp * 2) : o._xf = { ox: 0, oy: 0, ang: 0, scale: 1 }; this._worldPositions = new Float32Array(n.art_meshes.reduce((o, a) => o + a.vcount * 2, 0)); let i = 0; for (const o of n.art_meshes) {
        o._world = this._worldPositions.subarray(i, i + o.vcount * 2), i += o.vcount * 2, o._opacity = 1, o._draw = 0;
        try {
            o._uv = new Float32Array(r, o.uv, o.vcount * 2), o._idx = new Int16Array(r, o.idx, o.idx_n);
        }
        catch (a) {
            throw reportRenderError(a, "binary_view"), a;
        }
    } if (this._program = this._program || createShaderProgram(e), this._order = n.art_meshes.map((o, a) => a), this._bsMesh = new Array(n.art_meshes.length).fill(null), this._bsWarp = new Array(n.deformers.length).fill(null), this._bsRot = new Array(n.deformers.length).fill(null), n.blend_shapes) {
        const o = n.blend_shapes.param_bindings, a = [], c = [];
        n.deformers.forEach((d, h) => (d.type === "warp" ? a : c).push(h));
        const u = (d, h, f) => { for (const m of d || []) {
            const y = f ? f[m.target] : m.target;
            if (y === void 0)
                continue;
            const p = m.bindings.map(A => ({ pb: o[A.pb], keyforms: A.keyforms, constraints: A.constraints }));
            h[y] = (h[y] || []).concat(p);
        } };
        u(n.blend_shapes.meshes, this._bsMesh, null), u(n.blend_shapes.warps, this._bsWarp, a), u(n.blend_shapes.rotations, this._bsRot, c);
    } if (n.offscreens && n.offscreens.length) {
        const o = new Array(n.parts.length).fill(-1);
        n.offscreens.forEach((a, c) => { o[a.part] = c; });
        for (const a of n.art_meshes) {
            let c = !1, u = null;
            for (let d = a.parent_part, h = 0; d >= 0 && h < 64; d = n.parts[d].parent, h++) {
                const f = o[d];
                if (f >= 0) {
                    const m = n.offscreens[f];
                    if (m.blend !== 0) {
                        c = !0;
                        break;
                    }
                    !u && m.masks.length && (u = m.masks);
                }
            }
            a._offscreenSkip = c, !c && u && a.masks.length === 0 && (a.masks = u);
        }
    } for (const o of n.art_meshes)
        o._maskKey = o.masks && o.masks.length ? o.masks.join(",") : null; this._wholeCore = null; }
    _bsSample(e) { const n = e.pb.keys, r = this.evalParams[e.pb.param]; let s = 0, i = 0; if (n.length > 1)
        if (r <= n[0])
            s = 0, i = 0;
        else if (r >= n[n.length - 1])
            s = n.length - 2, i = 1;
        else {
            for (; s < n.length - 2 && r > n[s + 1];)
                s++;
            const a = n[s], c = n[s + 1];
            i = c > a ? (r - a) / (c - a) : 0;
        } let o = 1; for (const a of e.constraints || []) {
        const c = this.evalParams[a.param], u = a.keys, d = a.weights;
        let h;
        if (c <= u[0])
            h = d[0];
        else if (c >= u[u.length - 1])
            h = d[d.length - 1];
        else {
            let f = 0;
            for (; f < u.length - 2 && c > u[f + 1];)
                f++;
            const m = (c - u[f]) / (u[f + 1] - u[f] || 1);
            h = d[f] * (1 - m) + d[f + 1] * m;
        }
        o = Math.min(o, h);
    } return { w: o, lo: s, t: i }; }
    _applyBSPositions(e, n) { const r = this.f32; for (const s of e) {
        const { w: i, lo: o, t: a } = this._bsSample(s);
        if (i === 0)
            continue;
        const c = Math.min(o + 1, s.keyforms.length - 1), u = s.keyforms[o] / 4, d = s.keyforms[c] / 4, h = i * (1 - a), f = i * a;
        for (let m = 0; m < n.length; m++)
            n[m] += r[u + m] * h + r[d + m] * f;
    } }
    dispose() { const e = this.gl; this._batchRenderer?.dispose(); for (const n of this.textures)
        e.deleteTexture(n); this._maskTex && (e.deleteTexture(this._maskTex), e.deleteFramebuffer(this._maskFBO)), this._maskTex = this._maskFBO = null, e.deleteProgram(this._program.program); }
    setParameter(e, n) { const r = this.paramIndex.get(e); r !== void 0 && (this.params[r] = Math.max(this.clampMin[r], Math.min(this.clampMax[r], n))); }
    applyTuning(e) { for (const [n, r] of Object.entries(e.param_clamps ?? {})) {
        const s = this.paramIndex.get(n);
        if (s === void 0)
            continue;
        if (r.fix !== void 0) {
            this.clampMin[s] = this.clampMax[s] = r.fix, this.params[s] = r.fix;
            continue;
        }
        const i = this.man.parameters[s];
        r.max !== void 0 && i.max > 0 && (this.scalePos[s] = r.max / i.max), r.min !== void 0 && i.min < 0 && (this.scaleNeg[s] = r.min / i.min), (this.scalePos[s] !== 1 || this.scaleNeg[s] !== 1) && !this.scaledIdx.includes(s) && this.scaledIdx.push(s);
    } }
    renderedParameter(e) { const n = this.paramIndex.get(e); if (n === void 0)
        return; const r = this.params[n]; return r * (r >= 0 ? this.scalePos[n] : this.scaleNeg[n]); }
    getParameter(e) { return this.params[this.paramIndex.get(e)]; }
    setPartOpacity(e, n) { const r = this.partIndex.get(e); r !== void 0 && (this.partOpacity[r] = n); }
    applyPose(e) { for (const n of e.Groups || [])
        n.forEach((r, s) => this.setPartOpacity(r.Id, s === 0 ? 1 : 0)); }
    _blendInfo(e) { let n = this._biCache; n || (n = this._biCache = new Array(this.kb.length).fill(null), this._biFrame = new Int32Array(this.kb.length).fill(-1)); let r = n[e]; if (r && this._biFrame[e] === this._frame)
        return r; const s = this.kb[e], i = s.length; if (!r) {
        r = n[e] = { idx: new Array(i), wt: new Array(i), cnt: new Array(i), strides: new Array(i), n: i };
        let u = 1;
        for (let d = 0; d < i; d++)
            r.cnt[d] = this.pb[s[d]].keys.length, r.strides[d] = u, u *= r.cnt[d];
    } const { idx: o, wt: a, cnt: c } = r; for (let u = 0; u < i; u++) {
        const d = this.pb[s[u]], h = this.evalParams[d.param], f = d.keys;
        let m = 0;
        if (h <= f[0])
            m = 0, a[u] = 0;
        else if (h >= f[f.length - 1])
            m = f.length - 2, a[u] = 1;
        else {
            for (; m < f.length - 2 && h > f[m + 1];)
                m++;
            const y = f[m], p = f[m + 1];
            a[u] = p > y ? (h - y) / (p - y) : 0;
        }
        o[u] = Math.max(0, Math.min(m, c[u] - 1));
    } return this._biFrame[e] = this._frame, r; }
    _multilinear(e, n) { const { idx: r, wt: s, cnt: i, strides: o, n: a } = e, c = 1 << a; for (let u = 0; u < c; u++) {
        let d = 0, h = 1;
        for (let f = 0; f < a; f++) {
            const m = u >> f & 1;
            let y = r[f] + m;
            y > i[f] - 1 && (y = i[f] - 1), d += y * o[f], h *= m ? s[f] : 1 - s[f];
        }
        h > 0 && n(d, h);
    } }
    _cacheWarpFrame(e) { const n = e._grid, r = e.cols, s = e.rows, i = r + 1, o = 0, a = r * 2, c = s * i * 2, u = (r + s * i) * 2, d = (n[o] + n[a] + n[c] + n[u]) / 4, h = (n[o + 1] + n[a + 1] + n[c + 1] + n[u + 1]) / 4, f = n[u] - n[o], m = n[u + 1] - n[o + 1], y = n[a] - n[c], p = n[a + 1] - n[c + 1], A = e._frame6 || (e._frame6 = new Float32Array(6)); A[0] = d - f * .5, A[1] = h - m * .5, A[2] = (f + y) / 2, A[3] = (m + p) / 2, A[4] = (f - y) / 2, A[5] = (m - p) / 2; }
    _topoOrder() { if (this._topo)
        return this._topo; const e = this.man, n = new Array(e.deformers.length), r = i => { if (n[i] !== void 0)
        return n[i]; const o = e.deformers[i].parent_deformer; return n[i] = o < 0 ? 0 : r(o) + 1; }; for (let i = 0; i < e.deformers.length; i++)
        r(i); const s = e.deformers.map((i, o) => o); return s.sort((i, o) => n[i] - n[o]), this._topo = s; }
    _applyParentPoint(e, n, r, s) { if (e.type === "warp")
        this._warpAt(e, n, r);
    else {
        const i = e._xf, o = (e.base_angle + i.ang) * Math.PI / 180, a = s[e._idx], c = Math.cos(o) * a, u = Math.sin(o) * a, d = n[r], h = n[r + 1];
        n[r] = i.ox + c * d - u * h, n[r + 1] = i.oy + u * d + c * h;
    } }
    _transformPoints(e, n, r) { if (e.type === "warp") {
        const s = e._grid, i = e.cols, o = e.rows, a = i + 1, c = e.quad !== !1;
        for (let u = 0; u < n.length; u += 2) {
            const d = n[u], h = n[u + 1];
            if (c && d >= 0 && d < 1 && h >= 0 && h < 1) {
                const f = d * i, m = h * o, y = Math.min(Math.floor(f), i - 1), p = Math.min(Math.floor(m), o - 1), A = f - y, v = m - p, E = (p * a + y) * 2, _ = E + 2, x = E + a * 2, C = x + 2, S = 1 - A, M = 1 - v;
                n[u] = s[E] * S * M + s[_] * A * M + s[x] * S * v + s[C] * A * v, n[u + 1] = s[E + 1] * S * M + s[_ + 1] * A * M + s[x + 1] * S * v + s[C + 1] * A * v;
            }
            else
                this._warpAt(e, n, u);
        }
    }
    else {
        const s = e._xf, i = (e.base_angle + s.ang) * Math.PI / 180, o = r[e._idx], a = Math.cos(i) * o, c = Math.sin(i) * o, u = s.ox, d = s.oy;
        for (let h = 0; h < n.length; h += 2) {
            const f = n[h], m = n[h + 1];
            n[h] = u + a * f - c * m, n[h + 1] = d + c * f + a * m;
        }
    } }
    _calcAngleFixup(e, n, r, s, i) { const o = this._fx2 || (this._fx2 = new Float32Array(2)); o[0] = n, o[1] = r, this._applyParentPoint(e, o, 0, i); const a = o[0], c = o[1], u = this._fx3 || (this._fx3 = [0, 0, 0]); u[1] = a, u[2] = c; for (let d = 0; d < 10; d++) {
        const h = Math.pow(.1, d);
        for (let f = 0; f < 2; f++) {
            const m = f === 0 ? 1 : -1;
            o[0] = n, o[1] = r - s * h * m, this._applyParentPoint(e, o, 0, i);
            const y = o[0] - a, p = o[1] - c;
            if (isFinite(y) && isFinite(p) && (y !== 0 || p !== 0)) {
                const v = -s * m;
                return u[0] = Math.atan2(0 * p - v * y, 0 * y + v * p) * 180 / Math.PI, u;
            }
        }
    } return u[0] = 0, u; }
    update() { if (this._wholeCore) {
        this._wholeCore.update();
        return;
    } this.evalParams.set(this.params); for (const c of this.scaledIdx) {
        const u = this.evalParams[c];
        this.evalParams[c] = u * (u >= 0 ? this.scalePos[c] : this.scaleNeg[c]);
    } const e = this.man, n = this.f32; this._frame = (this._frame || 0) + 1; const r = e.deformers.length, s = this._S || (this._S = new Float32Array(r)), i = this._O || (this._O = new Float32Array(r)); for (let c = 0; c < r; c++) {
        const u = e.deformers[c];
        u._idx = c;
        const d = u.keyform_binding >= 0 ? this._blendInfo(u.keyform_binding) : null;
        if (u.type === "warp") {
            const h = u._grid;
            h.fill(0);
            let f = 0;
            if (d) {
                const { idx: m, wt: y, cnt: p, strides: A, n: v } = d, E = 1 << v;
                for (let _ = 0; _ < E; _++) {
                    let x = 0, C = 1;
                    for (let b = 0; b < v; b++) {
                        const I = _ >> b & 1;
                        let R = m[b] + I;
                        R > p[b] - 1 && (R = p[b] - 1), x += R * A[b], C *= I ? y[b] : 1 - y[b];
                    }
                    if (C <= 0)
                        continue;
                    const S = u.keyforms[x], M = S.pos / 4;
                    for (let b = 0; b < h.length; b++)
                        h[b] += n[M + b] * C;
                    f += S.opacity * C;
                }
            }
            else {
                const m = u.keyforms[0], y = m.pos / 4;
                for (let p = 0; p < h.length; p++)
                    h[p] = n[y + p];
                f = m.opacity;
            }
            this._bsWarp[c] && this._applyBSPositions(this._bsWarp[c], h), u._op = f;
        }
        else {
            const h = u._xf;
            h.ox = h.oy = h.ang = 0, h.scale = 0;
            let f = blendRotation(u, d, h);
            const m = this._bsRot[c];
            if (m)
                for (const y of m) {
                    const { w: p, lo: A, t: v } = this._bsSample(y);
                    if (p === 0)
                        continue;
                    const E = Math.min(A + 1, y.keyforms.length - 1), _ = y.keyforms[A], x = y.keyforms[E], C = p * (1 - v), S = p * v;
                    h.ox += _.ox * C + x.ox * S, h.oy += _.oy * C + x.oy * S, h.ang += _.angle * C + x.angle * S, h.scale += _.scale * C + x.scale * S;
                }
            u._op = f;
        }
    } for (const c of this._topoOrder()) {
        const u = e.deformers[c], d = u.parent_deformer;
        if (d < 0) {
            s[c] = u.type === "rotation" ? u._xf.scale : 1, i[c] = u._op, u.type === "warp" && this._cacheWarpFrame(u);
            continue;
        }
        const h = e.deformers[d];
        if (u.type === "rotation") {
            const f = h.type === "warp" ? .1 : 10, m = this._calcAngleFixup(h, u._xf.ox, u._xf.oy, f, s);
            u._xf.ang += m[0], u._xf.ox = m[1], u._xf.oy = m[2], s[c] = u._xf.scale * s[d];
        }
        else
            this._transformPoints(h, u._grid, s), s[c] = s[d], this._cacheWarpFrame(u);
        i[c] = u._op * i[d];
    } const o = e.parts; (!this._partEff || this._partEff.length !== o.length) && (this._partEff = new Float32Array(o.length)); const a = this._partEff; for (let c = 0; c < o.length; c++) {
        let u = this.partOpacity[c];
        for (let d = o[c].parent, h = 0; d >= 0 && h < 64; d = o[d].parent, h++)
            u *= this.partOpacity[d];
        a[c] = u;
    } for (let c = 0; c < e.art_meshes.length; c++) {
        const u = e.art_meshes[c], d = u.keyform_binding >= 0 ? this._blendInfo(u.keyform_binding) : null, h = u._world;
        let f = 0, m = 0;
        if (d) {
            h.fill(0);
            const { idx: p, wt: A, cnt: v, strides: E, n: _ } = d, x = 1 << _;
            for (let C = 0; C < x; C++) {
                let S = 0, M = 1;
                for (let R = 0; R < _; R++) {
                    const j = C >> R & 1;
                    let D = p[R] + j;
                    D > v[R] - 1 && (D = v[R] - 1), S += D * E[R], M *= j ? A[R] : 1 - A[R];
                }
                if (M <= 0)
                    continue;
                const b = u.keyforms[S], I = b.pos / 4;
                for (let R = 0; R < h.length; R++)
                    h[R] += n[I + R] * M;
                f += b.opacity * M, m += b.draw_order * M;
            }
        }
        else {
            const p = u.keyforms[0], A = p.pos / 4;
            for (let v = 0; v < h.length; v++)
                h[v] = n[A + v];
            f = p.opacity, m = p.draw_order;
        }
        this._bsMesh[c] && this._applyBSPositions(this._bsMesh[c], h);
        const y = u.parent_deformer;
        if (y >= 0) {
            const p = e.deformers[y];
            this._transformPoints(p, h, s), f *= i[y];
        }
        u.parent_part >= 0 && (f *= a[u.parent_part]), u._opacity = f, u._draw = m;
    } for (const c of e.glue || []) {
        let u = 0;
        if (c.keyform_binding >= 0 && c.intensities.length > 1) {
            const y = this._blendInfo(c.keyform_binding);
            this._multilinear(y, (p, A) => { u += c.intensities[p] * A; });
        }
        else
            u = c.intensities[0] ?? 1;
        if (u === 0)
            continue;
        const d = e.art_meshes[c.a]._world, h = e.art_meshes[c.b]._world, f = c.pos, m = c.w;
        for (let y = 0; y + 1 < f.length; y += 2) {
            const p = f[y] * 2, A = f[y + 1] * 2, v = d[p], E = d[p + 1], _ = h[A], x = h[A + 1];
            d[p] += (_ - v) * m[y] * u, d[p + 1] += (x - E) * m[y] * u, h[A] += (v - _) * m[y + 1] * u, h[A + 1] += (E - x) * m[y + 1] * u;
        }
    } this._computeRenderOrder(); }
    _computeRenderOrder() { const e = this.man; if (!e.draw_order_groups || !e.draw_order_groups.length) {
        this._order.sort((i, o) => e.art_meshes[i]._draw - e.art_meshes[o]._draw);
        return;
    } if (!this._doTree) {
        const i = e.draw_order_groups, o = e.draw_order_objects, a = new Array(i.length).fill(null), c = { children: [] };
        a[0] = c;
        for (let u = 0; u < i.length; u++) {
            const d = a[u];
            if (!d)
                continue;
            const { begin: h, count: f } = i[u];
            for (let m = h; m < h + f; m++) {
                const y = { mesh: o.types[m] === 0 ? o.indices[m] : -1, part: o.types[m] === 1 ? o.indices[m] : -1, children: [] };
                d.children.push(y);
                const p = o.self_indices[m];
                p !== -1 && (a[p] = y);
            }
        }
        this._doTree = c, this._partDraw = new Float32Array(e.parts.length);
    } for (let i = 0; i < e.parts.length; i++) {
        const o = e.parts[i];
        if (!o.draw_orders || !o.draw_orders.length) {
            this._partDraw[i] = 500;
            continue;
        }
        if (o.draw_orders.length === 1 || o.keyform_binding < 0) {
            this._partDraw[i] = o.draw_orders[0];
            continue;
        }
        const a = this._blendInfo(o.keyform_binding);
        let c = 0;
        this._multilinear(a, (u, d) => { c += o.draw_orders[u] * d; }), this._partDraw[i] = c;
    } const n = this._order; let r = 0; const s = i => { const o = i.children, a = o.length; let c = i._kidKey, u = i._kidOrd; const d = !c; d && (c = i._kidKey = new Float64Array(a), u = i._kidOrd = new Int32Array(a)); let h = d; for (let f = 0; f < a; f++) {
        const m = o[f], y = m.mesh >= 0 ? Math.round(e.art_meshes[m.mesh]._draw) : this._partDraw[m.part];
        c[f] !== y && (h = !0), c[f] = y;
    } if (h) {
        for (let f = 0; f < a; f++)
            u[f] = f;
        for (let f = 1; f < a; f++) {
            const m = u[f], y = c[m];
            let p = f - 1;
            for (; p >= 0 && c[u[p]] > y;)
                u[p + 1] = u[p], p--;
            u[p + 1] = m;
        }
    } for (let f = 0; f < a; f++) {
        const m = o[u[f]];
        m.mesh >= 0 ? n[r++] = m.mesh : s(m);
    } }; s(this._doTree); }
    _warpAt(e, n, r) { const s = e._grid, i = e.cols, o = e.rows, a = i + 1, c = n[r], u = n[r + 1], d = c * i, h = u * o; if (c >= 0 && c < 1 && u >= 0 && u < 1) {
        const f = Math.min(Math.floor(d), i - 1), m = Math.min(Math.floor(h), o - 1), y = d - f, p = h - m, A = (m * a + f) * 2, v = A + 2, E = A + a * 2, _ = E + 2;
        if (e.quad !== !1) {
            const x = 1 - y, C = 1 - p;
            n[r] = s[A] * x * C + s[v] * y * C + s[E] * x * p + s[_] * y * p, n[r + 1] = s[A + 1] * x * C + s[v + 1] * y * C + s[E + 1] * x * p + s[_ + 1] * y * p;
        }
        else
            this._triAt(s, A, v, E, _, y, p, n, r);
        return;
    } extrapolateWarp(e, n, r); }
    _triPts(e, n, r, s, i, o, a, c) { if (e + n > 1) {
        const u = 1 - e, d = 1 - n;
        a[c] = o[0] + (i[0] - o[0]) * u + (s[0] - o[0]) * d, a[c + 1] = o[1] + (i[1] - o[1]) * u + (s[1] - o[1]) * d;
    }
    else
        a[c] = r[0] + (s[0] - r[0]) * e + (i[0] - r[0]) * n, a[c + 1] = r[1] + (s[1] - r[1]) * e + (i[1] - r[1]) * n; }
    _triAt(e, n, r, s, i, o, a, c, u) { if (o + a > 1) {
        const d = 1 - o, h = 1 - a;
        c[u] = e[i] + (e[s] - e[i]) * d + (e[r] - e[i]) * h, c[u + 1] = e[i + 1] + (e[s + 1] - e[i + 1]) * d + (e[r + 1] - e[i + 1]) * h;
    }
    else
        c[u] = e[n] + (e[r] - e[n]) * o + (e[s] - e[n]) * a, c[u + 1] = e[n + 1] + (e[r + 1] - e[n + 1]) * o + (e[s + 1] - e[n + 1]) * a; }
    _ensureMaskFBO(e, n) { const r = this.gl; this._maskTex && this._maskW === e && this._maskH === n || (this._maskTex && (r.deleteTexture(this._maskTex), r.deleteFramebuffer(this._maskFBO)), this._maskTex = r.createTexture(), r.bindTexture(r.TEXTURE_2D, this._maskTex), r.texImage2D(r.TEXTURE_2D, 0, r.R8, e, n, 0, r.RED, r.UNSIGNED_BYTE, null), r.texParameteri(r.TEXTURE_2D, r.TEXTURE_MIN_FILTER, r.LINEAR), r.texParameteri(r.TEXTURE_2D, r.TEXTURE_WRAP_S, r.CLAMP_TO_EDGE), r.texParameteri(r.TEXTURE_2D, r.TEXTURE_WRAP_T, r.CLAMP_TO_EDGE), this._maskFBO = r.createFramebuffer(), r.bindFramebuffer(r.FRAMEBUFFER, this._maskFBO), r.framebufferTexture2D(r.FRAMEBUFFER, r.COLOR_ATTACHMENT0, r.TEXTURE_2D, this._maskTex, 0), r.bindFramebuffer(r.FRAMEBUFFER, null), this._maskW = e, this._maskH = n); }
    draw(e) { this._batchRenderer || (this._batchRenderer = new MeshRenderer(this)), this._batchRenderer.draw(e); }
}

function createShaderProgram(t) {
    const e = `#version 300 es
    in vec2 aPos; in vec2 aUv; uniform mat4 uProj; out vec2 vUv;
    void main(){ vUv = aUv; gl_Position = uProj * vec4(aPos, 0.0, 1.0); }`, n = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uTex; uniform sampler2D uMaskTex;
    uniform float uOpacity; uniform vec2 uViewSize;
    uniform int uMode;         
    out vec4 o;
    void main(){
      vec4 c = texture(uTex, vUv);
      if (uMode == 1) { o = vec4(c.a); return; }         
      float m = 1.0;
      if (uMode >= 2) {
        m = texture(uMaskTex, gl_FragCoord.xy / uViewSize).r;
        if (uMode == 3) m = 1.0 - m;
      }
      o = c * uOpacity * m;
    }`, r = t.createProgram(), s = [];
    try {
        for (const [i, o] of [[t.VERTEX_SHADER, e], [t.FRAGMENT_SHADER, n]]) {
            const a = t.createShader(i);
            if (s.push(a), t.shaderSource(a, o), t.compileShader(a), !t.getShaderParameter(a, t.COMPILE_STATUS))
                throw new Error(t.getShaderInfoLog(a));
            t.attachShader(r, a);
        }
        if (t.linkProgram(r), !t.getProgramParameter(r, t.LINK_STATUS))
            throw new Error(t.getProgramInfoLog(r));
    }
    catch (i) {
        throw reportRenderError(i, "shader_program"), t.deleteProgram(r), i;
    }
    finally {
        for (const i of s)
            t.deleteShader(i);
    }
    return { program: r, aPos: t.getAttribLocation(r, "aPos"), aUv: t.getAttribLocation(r, "aUv"), uProj: t.getUniformLocation(r, "uProj"), uTex: t.getUniformLocation(r, "uTex"), uMaskTex: t.getUniformLocation(r, "uMaskTex"), uViewSize: t.getUniformLocation(r, "uViewSize"), uMode: t.getUniformLocation(r, "uMode"), uOpacity: t.getUniformLocation(r, "uOpacity") };
}

export { KoroModel };

