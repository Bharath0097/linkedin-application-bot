/* StratEdge ID reader (v36.3). Reads the three machine-readable lines on the back of a green card (ICAO 9303 TD1, set
   in OCR-B) from a picture or a camera frame, here in the browser: nothing is sent anywhere to read them.

   How: the picture is turned grey, its dark marks are found (local threshold, connected components), marks of one
   size standing in a row are chained into lines, and three parallel, equally long lines of about 30 characters are
   the machine-readable zone. Each line is straightened and scaled to one size, cut into its 30 fixed-pitch cells, and
   every cell is recognised by a small neural network trained on OCR-B (the weights are below; the font itself is not
   part of this file). The check digits then repair the few characters a blurred picture leaves uncertain.

   Use on a page: SEIdRead.mrz({w, h, g}) with g a Uint8Array of grey values (or SEIdRead.gray(imageData));
   as a worker: postMessage({op: 'mrz', w, h, g, live}) and the answer comes back as a message.
   Returns {found, ok, lines, conf, min, checks, fixed, quad, weak}. */
(function (G) {
  'use strict';
  const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<';
  const NC = CH.length;
  const PW = 16; // a cell as the network sees it: 16 x 24
  const PH = 24;
  const HN = 28; // straightened lines: characters 28 pixels high
  const VAL = c => (c === '<' ? 0 : c <= '9' ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 55);

  /* ---------- pictures ---------- */
  /** Grey values (ITU-R 601) of RGBA pixels. */
  function gray(img) {
    const d = img.data;
    const n = img.width * img.height;
    const g = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114 + 500) / 1000;
    return { w: img.width, h: img.height, g };
  }
  /** Summed-area table (one row and column of zeros in front). */
  function integral(g, w, h) {
    const W = w + 1;
    const s = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      const o = (y + 1) * W;
      const p = y * W;
      for (let x = 0; x < w; x++) {
        row += g[y * w + x];
        s[o + x + 1] = s[p + x + 1] + row;
      }
    }
    return s;
  }
  /** A smaller copy (area average) whose longer side is at most max. */
  function shrink(im, max) {
    const k = Math.min(1, max / Math.max(im.w, im.h));
    if (k >= 1) return { w: im.w, h: im.h, g: im.g, k: 1 };
    const w = Math.max(1, Math.round(im.w * k));
    const h = Math.max(1, Math.round(im.h * k));
    const S = integral(im.g, im.w, im.h);
    const W = im.w + 1;
    const g = new Uint8Array(w * h);
    const fx = im.w / w;
    const fy = im.h / h;
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * fy);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * fx);
        const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
        const sum = S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0];
        g[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
      }
    }
    return { w, h, g, k: w / im.w };
  }
  /** The picture turned by 90, 180 or 270 degrees (clockwise). */
  function turn(im, rot) {
    const { w, h, g } = im;
    if (!rot) return im;
    const out = new Uint8Array(w * h);
    if (rot === 180) {
      for (let i = 0, n = w * h; i < n; i++) out[i] = g[n - 1 - i];
      return { w, h, g: out };
    }
    // 90: new width = h; (x, y) -> (h - 1 - y, x); 270: (y, w - 1 - x)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = g[y * w + x];
        if (rot === 90) out[x * h + (h - 1 - y)] = v;
        else out[(w - 1 - x) * h + y] = v;
      }
    }
    return { w: h, h: w, g: out };
  }

  /* ---------- dark marks and the lines they stand in ---------- */
  /** Dark pixels against their surroundings (Bradley's local mean threshold). */
  function inkMap(im) {
    const { w, h, g } = im;
    const S = integral(g, w, h);
    const W = w + 1;
    const r = Math.max(7, Math.round(Math.max(w, h) / 48));
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(w, x + r + 1);
        const area = (x1 - x0) * (y1 - y0);
        const mean = (S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0]) / area;
        const v = g[y * w + x];
        if (v < mean * 0.86 && v < mean - 9) out[y * w + x] = 1;
      }
    }
    return out;
  }
  /** Connected groups of ink pixels (8 neighbours) with their boxes. */
  function blobs(bin, w, h) {
    const lab = new Int32Array(w * h);
    const par = [0];
    const find = a => {
      while (par[a] !== a) {
        par[a] = par[par[a]];
        a = par[a];
      }
      return a;
    };
    const join = (a, b) => {
      a = find(a);
      b = find(b);
      if (a !== b) par[Math.max(a, b)] = Math.min(a, b);
    };
    let next = 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!bin[i]) continue;
        let l = 0;
        const nb = [x > 0 ? lab[i - 1] : 0, y > 0 ? lab[i - w] : 0, y > 0 && x > 0 ? lab[i - w - 1] : 0, y > 0 && x < w - 1 ? lab[i - w + 1] : 0];
        for (const n of nb) {
          if (!n) continue;
          if (!l) l = n;
          else if (n !== l) join(l, n);
        }
        if (!l) {
          l = next++;
          par.push(l);
        }
        lab[i] = l;
      }
    }
    const box = new Map();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const l0 = lab[y * w + x];
        if (!l0) continue;
        const l = find(l0);
        let b = box.get(l);
        if (!b) box.set(l, (b = { x0: x, y0: y, x1: x, y1: y, n: 0 }));
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
        b.n++;
      }
    }
    const out = [];
    for (const b of box.values()) {
      b.w = b.x1 - b.x0 + 1;
      b.h = b.y1 - b.y0 + 1;
      b.cx = (b.x0 + b.x1) / 2;
      b.cy = (b.y0 + b.y1) / 2;
      out.push(b);
    }
    return out;
  }
  /** A straight line through points (least squares of y on x). */
  function fit(pts) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const n = pts.length;
    for (const [x, y] of pts) {
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
    }
    const den = n * sxx - sx * sx;
    const b = n > 1 && Math.abs(den) > 1e-9 ? (n * sxy - sx * sy) / den : 0;
    return { a: (sy - b * sx) / n, b };
  }
  const median = a => {
    if (!a.length) return 0;
    const s = Float64Array.from(a).sort();
    return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  /** Marks of one size standing next to each other, chained into lines of text. */
  function chains(bs, w, h) {
    const maxH = Math.max(20, h / 5);
    const cand = bs.filter(b => b.h >= 7 && b.h <= maxH && b.w >= 2 && b.w <= b.h * 4.5 && b.n / (b.w * b.h) > 0.06 && b.n / (b.w * b.h) < 0.95);
    cand.sort((a, b) => a.x0 - b.x0);
    // rows of buckets so neighbours are found quickly
    const bucket = 16;
    const rows = new Map();
    cand.forEach((b, i) => {
      const r = Math.floor(b.cy / bucket);
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r).push(i);
    });
    const nextOf = new Int32Array(cand.length).fill(-1);
    const best = new Float64Array(cand.length).fill(Infinity);
    const prevOf = new Int32Array(cand.length).fill(-1);
    for (let i = 0; i < cand.length; i++) {
      const a = cand[i];
      let bj = -1;
      let bs2 = Infinity;
      const r0 = Math.floor((a.cy - a.h) / bucket);
      const r1 = Math.floor((a.cy + a.h) / bucket);
      for (let r = r0; r <= r1; r++) {
        for (const j of rows.get(r) || []) {
          if (j === i) continue;
          const b = cand[j];
          if (b.x0 <= a.x0 + a.w * 0.3) continue;
          const hh = Math.max(a.h, b.h);
          const gap = b.x0 - a.x1;
          if (gap < -0.2 * hh || gap > 1.25 * hh) continue;
          const dy = Math.abs(b.cy - a.cy);
          if (dy > 0.32 * hh) continue;
          if (Math.min(a.h, b.h) / hh < 0.55) continue;
          const s = Math.max(0, gap) / hh + (3 * dy) / hh;
          if (s < bs2) {
            bs2 = s;
            bj = j;
          }
        }
      }
      if (bj >= 0 && bs2 < best[bj]) {
        if (prevOf[bj] >= 0) nextOf[prevOf[bj]] = -1;
        best[bj] = bs2;
        prevOf[bj] = i;
        nextOf[i] = bj;
      }
    }
    const out = [];
    for (let i = 0; i < cand.length; i++) {
      if (prevOf[i] >= 0) continue;
      const list = [];
      for (let j = i; j >= 0; j = nextOf[j]) list.push(cand[j]);
      if (list.length >= 4) out.push(lineOf(list));
    }
    return out;
  }
  function lineOf(list) {
    // the line's character height: most marks are full height ('<' is a little lower), a few are pieces
    const hs = list.map(b => b.h).sort((p, q) => p - q);
    const hm = hs[Math.min(hs.length - 1, Math.floor(hs.length * 0.75))];
    const f = fit(list.filter(b => b.h > hm * 0.75 && b.w < hm * 1.3).map(b => [b.cx, b.cy]));
    return { bs: list, h: hm, a: f.a, b: f.b, x0: list[0].x0, x1: list[list.length - 1].x1, n: list.length };
  }
  /** Pieces of one line broken by a gap (glare, a missing mark) joined again. */
  function joinLines(ls) {
    ls.sort((p, q) => p.x0 - q.x0);
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < ls.length && !changed; i++) {
        for (let j = 0; j < ls.length && !changed; j++) {
          if (i === j) continue;
          const A = ls[i];
          const B = ls[j];
          if (B.x0 < A.x1 - A.h * 0.5) continue;
          if (B.x0 - A.x1 > 4.5 * Math.max(A.h, B.h)) continue;
          if (Math.min(A.h, B.h) / Math.max(A.h, B.h) < 0.75) continue;
          const b0 = B.bs[0];
          const yA = A.a + A.b * b0.cx;
          if (Math.abs(yA - b0.cy) > 0.4 * A.h) continue;
          const merged = lineOf(A.bs.concat(B.bs));
          ls.splice(Math.max(i, j), 1);
          ls.splice(Math.min(i, j), 1);
          ls.push(merged);
          changed = true;
        }
      }
    }
    return ls;
  }
  /** Three parallel lines of about 30 characters, as long as each other and evenly spaced: the lines of a TD1 card. */
  function findZone(ls) {
    const L = ls.filter(l => l.n >= 10 && (l.x1 - l.x0) / l.h > 18 && (l.x1 - l.x0) / l.h < 44);
    let best = null;
    for (const A of L) {
      for (const B of L) {
        if (B === A) continue;
        const dAB = lineDist(A, B);
        if (!(dAB > 1.15 * A.h && dAB < 2.8 * A.h)) continue;
        if (!similar(A, B)) continue;
        for (const C of L) {
          if (C === A || C === B) continue;
          const dBC = lineDist(B, C);
          if (!(dBC > 1.15 * B.h && dBC < 2.8 * B.h)) continue;
          if (!similar(B, C) || !similar(A, C)) continue;
          if (Math.abs(dAB - dBC) > 0.3 * Math.max(dAB, dBC)) continue;
          const score = A.n + B.n + C.n - 10 * Math.abs(dAB - dBC) / A.h;
          if (!best || score > best.score) best = { score, ls: [A, B, C] };
        }
      }
    }
    return best ? best.ls : null;
  }
  /** How far below line A line B runs (perpendicular, at the middle of A). */
  function lineDist(A, B) {
    const xm = (A.x0 + A.x1) / 2;
    const dy = B.a + B.b * xm - (A.a + A.b * xm);
    return dy / Math.sqrt(1 + A.b * A.b);
  }
  function similar(A, B) {
    if (Math.abs(Math.atan(A.b) - Math.atan(B.b)) > 0.05) return false;
    if (Math.min(A.h, B.h) / Math.max(A.h, B.h) < 0.78) return false;
    const la = A.x1 - A.x0;
    const lb = B.x1 - B.x0;
    if (Math.min(la, lb) / Math.max(la, lb) < 0.86) return false;
    // they start in the same place along the line (turned pictures shift each line a little)
    const t = Math.atan(A.b);
    const sa = A.x0 * Math.cos(t) + (A.a + A.b * A.x0) * Math.sin(t);
    const sb = B.x0 * Math.cos(t) + (B.a + B.b * B.x0) * Math.sin(t);
    return Math.abs(sa - sb) < 2.2 * A.h;
  }

  /* ---------- one line, straightened, cut into cells ---------- */
  /** Bilinear sample of the full picture. */
  function sample(im, x, y) {
    const { w, h, g } = im;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x > w - 1.001) x = w - 1.001;
    if (y > h - 1.001) y = h - 1.001;
    const xi = x | 0;
    const yi = y | 0;
    const fx = x - xi;
    const fy = y - yi;
    const i = yi * w + xi;
    return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
  }
  /** The line as a strip HN*2 high with its characters HN high, from the full picture (k: the detection scale). */
  function strip(im, L, k) {
    const th = Math.atan(L.b);
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    const hFull = L.h / k;
    const r = HN / hFull;
    // the line's middle, in full-picture coordinates
    const xm = (L.x0 + L.x1) / 2;
    const cx = xm / k;
    const cy = (L.a + L.b * xm) / k;
    const half = ((L.x1 - L.x0) / k / 2) / ux + hFull * 1.2;
    const W = Math.max(8, Math.ceil(2 * half * r));
    const H = HN * 2;
    const out = new Float32Array(W * H);
    const ss = Math.max(1, Math.min(4, Math.ceil(1 / r)));
    const step = 1 / (r * ss);
    for (let ys = 0; ys < H; ys++) {
      for (let xs = 0; xs < W; xs++) {
        let acc = 0;
        for (let sy = 0; sy < ss; sy++) {
          const v = (ys - H / 2) / r + (sy + 0.5) * step;
          for (let sx = 0; sx < ss; sx++) {
            const t = -half + xs / r + (sx + 0.5) * step;
            acc += sample(im, cx + t * ux - v * uy, cy + t * uy + v * ux);
          }
        }
        out[ys * W + xs] = acc / (ss * ss);
      }
    }
    return { W, H, g: out, cx, cy, ux, uy, half, r };
  }
  /** Ink strength 0..1 of a strip, against the paper around each part of it (glare and shadows differ along a line). */
  function inkLevels(S) {
    const { W, H, g } = S;
    const t = new Float32Array(W * H);
    const win = HN * 2;
    const colsPaper = new Float32Array(W);
    const colsInk = new Float32Array(W);
    // percentiles in overlapping windows along the line
    for (let x0 = 0; x0 < W; x0 += HN) {
      const a = Math.max(0, x0 - win / 2);
      const b = Math.min(W, x0 + HN + win / 2);
      const vals = [];
      for (let y = 0; y < H; y++) for (let x = a; x < b; x++) vals.push(g[y * W + x]);
      vals.sort((p, q) => p - q);
      const ink = vals[Math.floor(vals.length * 0.03)];
      const paper = vals[Math.floor(vals.length * 0.8)];
      for (let x = x0; x < Math.min(W, x0 + HN); x++) {
        colsPaper[x] = paper;
        colsInk[x] = ink;
      }
    }
    // smooth the levels a little along the line
    const sm = (arr) => {
      const o = new Float32Array(W);
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let d = -HN; d <= HN; d += 4) {
          const xx = x + d;
          if (xx >= 0 && xx < W) {
            s += arr[xx];
            n++;
          }
        }
        o[x] = s / n;
      }
      return o;
    };
    const P = sm(colsPaper);
    const I = sm(colsInk);
    let contrast = 0;
    for (let x = 0; x < W; x++) contrast += P[x] - I[x];
    contrast /= W;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.max(18, P[x] - I[x]);
        const v = (P[x] - g[y * W + x]) / d;
        t[y * W + x] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
    }
    return { t, contrast };
  }
  /** The cells of a straightened line. The pitch comes from the line's rhythm (its ink repeats once per character),
   *  each mark gets its cell by stepping along the line, and the centres follow x = a + b*k + q*k^2 (a camera at an
   *  angle stretches one end). Returns where cell 0 (the leftmost character) is and how many cells the marks span. */
  function cells(S, t) {
    const { W, H } = S;
    const bin = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) bin[i] = t[i] > 0.42 ? 1 : 0;
    let bs = blobs(bin, W, H).filter(b => b.h >= HN * 0.45 && b.h <= HN * 1.6 && b.w <= HN * 9);
    // pieces of one character (a broken stroke) count as one mark
    bs.sort((a, b) => a.x0 - b.x0);
    const m = [];
    for (const b of bs) {
      const p = m[m.length - 1];
      if (p && Math.min(p.x1, b.x1) - Math.max(p.x0, b.x0) > 0.5 * Math.min(p.w, b.w)) {
        p.x0 = Math.min(p.x0, b.x0);
        p.x1 = Math.max(p.x1, b.x1);
        p.y0 = Math.min(p.y0, b.y0);
        p.y1 = Math.max(p.y1, b.y1);
        p.w = p.x1 - p.x0 + 1;
        p.h = p.y1 - p.y0 + 1;
        p.cx = (p.x0 + p.x1) / 2;
        p.cy = (p.y0 + p.y1) / 2;
      } else m.push({ ...b });
    }
    bs = m.filter(b => b.h >= HN * 0.6);
    if (bs.length < 8) return null;
    // the pitch: the ink along the line (its middle rows) repeats once per character
    const xa = Math.max(0, Math.floor(bs[0].x0 - 2));
    const xb = Math.min(W, Math.ceil(bs[bs.length - 1].x1 + 2));
    const n = xb - xa;
    if (n < HN * 8) return null;
    const pr = new Float32Array(n);
    const y0 = Math.max(0, Math.floor(H / 2 - HN * 0.6));
    const y1 = Math.min(H, Math.ceil(H / 2 + HN * 0.6));
    for (let y = y0; y < y1; y++) for (let x = 0; x < n; x++) pr[x] += t[y * W + xa + x];
    let mean = 0;
    for (let x = 0; x < n; x++) mean += pr[x];
    mean /= n;
    for (let x = 0; x < n; x++) pr[x] -= mean;
    const ac = lag => {
      const li = Math.floor(lag);
      const f = lag - li;
      let sum = 0;
      let cnt = 0;
      for (let i = 0; i + li + 1 < n; i++) {
        sum += pr[i] * (pr[i + li] * (1 - f) + pr[i + li + 1] * f);
        cnt++;
      }
      return cnt ? sum / cnt : -Infinity;
    };
    let P = 0;
    let best = -Infinity;
    for (let p = HN * 0.8; p <= HN * 1.4; p += 0.25) {
      const v = ac(p);
      if (v > best) {
        best = v;
        P = p;
      }
    }
    for (let p = P - 0.25; p <= P + 0.25; p += 0.05) {
      const v = ac(p);
      if (v > best) {
        best = v;
        P = p;
      }
    }
    // each single mark (one character wide) gets its cell, stepping along the line with the local pitch
    const single = bs.filter(b => b.w < P * 1.15);
    if (single.length < 6) return null;
    const pts = [[0, single[0].cx]];
    let k = 0;
    let local = P;
    for (let i = 1; i < single.length; i++) {
      const g = single[i].cx - single[i - 1].cx;
      const steps = Math.max(1, Math.round(g / local));
      if (Math.abs(g / steps - local) > 0.22 * local) continue; // a mark that does not sit in a cell (noise)
      k += steps;
      if (steps <= 2) local = local * 0.8 + (g / steps) * 0.2;
      pts.push([k, single[i].cx]);
    }
    if (pts.length < 6) return null;
    let a, b, q;
    const f2 = pts.length >= 12 ? fit2(pts) : null;
    if (f2 && Math.abs(f2.q) * k * k < 4 * P && f2.b > HN * 0.6 && f2.b < HN * 1.6) {
      a = f2.a;
      b = f2.b;
      q = f2.q;
    } else {
      const f1 = fit(pts);
      a = f1.a;
      b = f1.b;
      q = 0;
      if (!(b > HN * 0.75 && b < HN * 1.45)) return null;
    }
    const at = kk => a + b * kk + q * kk * kk;
    const pitchAt = kk => b + 2 * q * kk;
    // the leftmost and rightmost marks' cells (from their outer edges: a pair joined by blur at an end is no trouble)
    const cellOf = x => {
      let kk = Math.round((x - a) / b);
      for (let it = 0; it < 3; it++) kk = Math.round(kk + (x - at(kk)) / pitchAt(kk));
      return kk;
    };
    const kFirst = cellOf(bs[0].x0 + 0.34 * HN);
    const kLast = cellOf(bs[bs.length - 1].x1 - 0.34 * HN);
    const fy = fit(single.map(sm => [sm.cx, sm.cy]));
    return { at, pitch: pitchAt, kFirst, span: kLast - kFirst + 1, fy, marks: bs.length };
  }
  /** Least squares x = a + b*k + q*k^2. */
  function fit2(pts) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
    for (const [k, x] of pts) {
      const k2 = k * k;
      s0++;
      s1 += k;
      s2 += k2;
      s3 += k2 * k;
      s4 += k2 * k2;
      t0 += x;
      t1 += k * x;
      t2 += k2 * x;
    }
    // solve the 3x3 normal equations (Cramer)
    const det3 = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    const M = [s0, s1, s2, s1, s2, s3, s2, s3, s4];
    const D = det3(M);
    if (Math.abs(D) < 1e-9) return null;
    const a = det3([t0, s1, s2, t1, s2, s3, t2, s3, s4]) / D;
    const b = det3([s0, t0, s2, s1, t1, s3, s2, t2, s4]) / D;
    const q = det3([s0, s1, t0, s1, s2, t1, s2, s3, t2]) / D;
    return { a, b, q };
  }
  /** One cell as the network's input: 16 x 24 values 0..1, the cell 1 pitch wide and 1.5 characters high. */
  function patch(t, W, H, cx, cy, P) {
    const out = new Float32Array(PW * PH);
    const sx = P / PW;
    const sy = (HN * 1.5) / PH;
    for (let y = 0; y < PH; y++) {
      const yy = cy + (y + 0.5 - PH / 2) * sy;
      for (let x = 0; x < PW; x++) {
        const xx = cx + (x + 0.5 - PW / 2) * sx;
        let v = 0;
        if (xx >= 0 && yy >= 0 && xx < W - 1 && yy < H - 1) {
          const xi = xx | 0;
          const yi = yy | 0;
          const fx = xx - xi;
          const fy = yy - yi;
          const i = yi * W + xi;
          v = (t[i] * (1 - fx) + t[i + 1] * fx) * (1 - fy) + (t[i + W] * (1 - fx) + t[i + W + 1] * fx) * fy;
        }
        out[y * PW + x] = v;
      }
    }
    return out;
  }

  /* ---------- the network ---------- */
  let NET = null;
  function net() {
    if (NET) return NET;
    const M = G.__SE_IDREAD_MODEL || MODEL;
    if (!M) return null;
    const dec = s => {
      const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
      const a = new Int8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = (bin.charCodeAt(i) << 24) >> 24;
      return a;
    };
    NET = M.layers.map(L => ({ n: L.n, m: L.m, w: dec(L.w), s: Float32Array.from(L.s), b: Float32Array.from(L.b) }));
    return NET;
  }
  /** Class probabilities of one cell. */
  function classify(x) {
    const N = net();
    if (!N) return null;
    let v = x;
    for (let l = 0; l < N.length; l++) {
      const L = N[l];
      const o = new Float32Array(L.m);
      for (let j = 0; j < L.m; j++) {
        let s = 0;
        const row = j * L.n;
        for (let i = 0; i < L.n; i++) s += L.w[row + i] * v[i];
        s = s * L.s[j] + L.b[j];
        o[j] = l < N.length - 1 ? (s > 0 ? s : 0) : s;
      }
      v = o;
    }
    let mx = -Infinity;
    for (let j = 0; j < v.length; j++) if (v[j] > mx) mx = v[j];
    let sum = 0;
    for (let j = 0; j < v.length; j++) sum += v[j] = Math.exp(v[j] - mx);
    for (let j = 0; j < v.length; j++) v[j] /= sum;
    return v;
  }

  /* ---------- the characters each place may hold, and the check digits ---------- */
  const DIG = '0123456789';
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function allowed(line, pos, gc) {
    if (line === 0) {
      if (pos === 0) return ALPHA;
      if (pos === 1) return gc ? '12' : ALPHA + DIG + '<';
      if (pos < 5) return gc ? 'USA'[pos - 2] : ALPHA + '<';
      if (pos < 14) return gc ? DIG : ALPHA + DIG + '<';
      if (pos === 14) return gc ? DIG : DIG + '<';
      if (gc && pos < 18) return ALPHA;
      if (gc && pos < 28) return DIG;
      return ALPHA + DIG + '<';
    }
    if (line === 1) {
      if (pos < 7) return DIG;
      if (pos === 7) return 'MFX<';
      if (pos < 15) return DIG;
      if (pos < 18) return ALPHA + '<';
      if (pos < 29) return ALPHA + DIG + '<';
      return DIG;
    }
    return ALPHA + '<';
  }
  function cd(s) {
    let t = 0;
    for (let i = 0; i < s.length; i++) t += VAL(s[i]) * [7, 3, 1][i % 3];
    return t % 10;
  }
  /** The checks of three lines: number, birth date, expiry date, the whole (composite). */
  function checksOf(l) {
    const [a, b] = l;
    const long = a[14] === '<';
    return {
      num: long || cd(a.slice(5, 14)) === +a[14],
      dob: cd(b.slice(0, 6)) === +b[6],
      exp: cd(b.slice(8, 14)) === +b[14],
      all: cd(a.slice(5, 30) + b.slice(0, 7) + b.slice(8, 15) + b.slice(18, 29)) === +b[29],
    };
  }
  const allOk = c => c.num && c.dob && c.exp && c.all;
  /** The most likely lines, then repairs that the check digits ask for (least unlikely first). */
  function decode(P) {
    // a green card (C1/C2 USA) narrows what several places hold
    const first = (p, set) => {
      let bi = 0, bv = -1;
      for (const ch of set) {
        const v = p[CH.indexOf(ch)];
        if (v > bv) {
          bv = v;
          bi = CH.indexOf(ch);
        }
      }
      return [CH[bi], bv];
    };
    const head = [0, 1, 2, 3, 4].map(i => first(P[0][i], allowed(0, i, false))[0]).join('');
    const gc = /^C[12]USA$/.test(head) || (head[0] === 'C' && head.slice(2) === 'USA');
    const L = [[], [], []];
    const conf = [[], [], []];
    for (let li = 0; li < 3; li++) {
      for (let k = 0; k < 30; k++) {
        const [c, v] = first(P[li][k], allowed(li, k, gc));
        L[li][k] = c;
        conf[li][k] = v;
      }
    }
    const str = () => L.map(x => x.join(''));
    const fixed = [];
    // repairs: one place (or two) changed to its next most likely character
    // how many places the network was unsure about: with more than a few, the picture was not read (no repairs)
    let unsure = 0;
    for (let li = 0; li < 3; li++) for (let k = 0; k < 30; k++) if (conf[li][k] < 0.6) unsure++;
    const repair = (places, test) => {
      if (unsure > 4) return null;
      const opts = [];
      for (const [li, k] of places) {
        if (conf[li][k] > 0.97) continue; // a character read with certainty is not changed
        const cur = P[li][k][CH.indexOf(L[li][k])];
        for (const ch of allowed(li, k, gc)) {
          if (ch === L[li][k]) continue;
          const p = P[li][k][CH.indexOf(ch)];
          if (p < 0.004) continue;
          opts.push({ li, k, ch, cost: Math.log(cur + 1e-9) - Math.log(p + 1e-9) });
        }
      }
      opts.sort((x, y) => x.cost - y.cost);
      const apply = list => list.map(o => {
        const was = L[o.li][o.k];
        L[o.li][o.k] = o.ch;
        return was;
      });
      const undo = (list, was) => list.forEach((o, i) => (L[o.li][o.k] = was[i]));
      for (const o of opts) {
        if (o.cost > 7) break;
        const was = apply([o]);
        if (test()) return [o];
        undo([o], was);
      }
      // two places at once, among the ten cheapest changes
      const top = opts.slice(0, 10);
      let best = null;
      for (let i = 0; i < top.length; i++) {
        for (let j = i + 1; j < top.length; j++) {
          const x = top[i];
          const y = top[j];
          if (x.li === y.li && x.k === y.k) continue;
          const c = x.cost + y.cost;
          if (c > 9 || (best && c >= best.c)) continue;
          const was = apply([x, y]);
          if (test()) best = { c, list: [x, y] };
          undo([x, y], was);
        }
      }
      if (!best) return null;
      apply(best.list);
      return best.list;
    };
    const range = (li, a, b) => Array.from({ length: b - a }, (_, i) => [li, a + i]);
    let c = checksOf(str());
    if (!c.num) {
      const r = repair(range(0, 5, 15), () => checksOf(str()).num);
      if (r) fixed.push(...r);
    }
    if (!c.dob) {
      const r = repair(range(1, 0, 7), () => checksOf(str()).dob);
      if (r) fixed.push(...r);
    }
    if (!c.exp) {
      const r = repair(range(1, 8, 15), () => checksOf(str()).exp);
      if (r) fixed.push(...r);
    }
    c = checksOf(str());
    if (c.num && c.dob && c.exp && !c.all) {
      const r = repair(range(0, 15, 30).concat(range(1, 18, 30)), () => checksOf(str()).all);
      if (r) fixed.push(...r);
    }
    const lines = str();
    c = checksOf(lines);
    // confidence after repairs: the probability of each character finally chosen
    let sum = 0, min = 1;
    const weak = [];
    for (let li = 0; li < 3; li++) {
      for (let k = 0; k < 30; k++) {
        const v = P[li][k][CH.indexOf(L[li][k])];
        sum += v;
        if (v < min) min = v;
        if (v < 0.6) weak.push([li, k]);
      }
    }
    return { lines, checks: c, conf: sum / 90, min, weak, fixed: fixed.length, gc };
  }
  // places no check digit covers: the document code and country, the sex, the nationality, and the whole name line
  const UNCHECKED = (li, k) => li === 2 || (li === 0 && k < 5) || (li === 1 && (k === 7 || (k >= 15 && k < 18)));
  /** Lines to be trusted: every check digit right (after at most a few repairs), read with confidence overall, and
   *  every character no check digit covers read clearly (a misread name would otherwise go unnoticed). */
  const accept = d => allOk(d.checks) && plausible(d.lines) && d.conf >= 0.95 && d.weak.length <= 3 && d.min > 0.1 && !d.weak.some(([li, k]) => UNCHECKED(li, k));
  /** Lines that look like a real TD1 zone besides their check digits. */
  function plausible(lines) {
    const [a, b, c] = lines;
    if (!/^[A-Z][A-Z0-9<][A-Z<]{3}/.test(a)) return false;
    if (!/^\d{7}[MFX<]\d{7}[A-Z<]{3}/.test(b)) return false;
    if (!/^[A-Z]+(<[A-Z]+)*<<[A-Z<]*$/.test(c) && !/^[A-Z]+(<[A-Z]+)*<*$/.test(c)) return false;
    const mm = +b.slice(2, 4);
    const dd = +b.slice(4, 6);
    const em = +b.slice(10, 12);
    const ed = +b.slice(12, 14);
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && em >= 1 && em <= 12 && ed >= 1 && ed <= 31;
  }

  /* ---------- reading a picture ---------- */
  /** Finds the zone in one orientation; returns the cells' class probabilities and where the zone is. */
  function readOnce(im, opts) {
    const small = shrink(im, opts.det || 1100);
    const bin = inkMap(small);
    const bs = blobs(bin, small.w, small.h);
    const ls = joinLines(chains(bs, small.w, small.h));
    const zone = findZone(ls);
    if (!zone) return { found: false, lines: ls.length };
    zone.sort((p, q) => p.a + p.b * (p.x0 + p.x1) / 2 - (q.a + q.b * (q.x0 + q.x1) / 2));
    // the three lines are printed in one size: one height scales them all
    const hz = median(zone.map(z => z.h));
    const made = [];
    for (const L of zone) {
      const S = strip(im, { ...L, h: hz }, small.k);
      const lv = inkLevels(S);
      const C = cells(S, lv.t);
      if (!C) return { found: false, why: 'cells' };
      made.push({ L, S, lv, C });
    }
    // every line starts in the same column: a line whose first cell is a pitch off the others is moved back
    const startOf = x => {
      const M = made[x];
      const tt = -M.S.half + M.C.at(M.C.kFirst) / M.S.r;
      const px = M.S.cx + tt * M.S.ux;
      const py = M.S.cy + tt * M.S.uy;
      return px * made[1].S.ux + py * made[1].S.uy;
    };
    const st = [0, 1, 2].map(startOf);
    const pitchImg = made[1].C.pitch(made[1].C.kFirst + 15) / made[1].S.r;
    for (let x = 0; x < 3; x++) {
      const others = st.filter((_, j) => j !== x);
      const ref = Math.abs(others[0] - others[1]) < 0.5 * pitchImg ? (others[0] + others[1]) / 2 : null;
      if (ref !== null && Math.abs(st[x] - ref) > 0.6 * pitchImg) made[x].C.kFirst += Math.round((ref - st[x]) / pitchImg);
    }
    const P = [];
    const patches = [];
    let contrast = 0;
    for (const { S, lv, C } of made) {
      contrast += lv.contrast / 3;
      const row = [];
      const prow = [];
      for (let k = 0; k < 30; k++) {
        const kk = C.kFirst + k;
        const x = C.at(kk);
        const y = C.fy.a + C.fy.b * x;
        const p = patch(lv.t, S.W, S.H, x, y, C.pitch(kk));
        prow.push(p);
        if (!opts.patchesOnly) row.push(classify(p));
      }
      P.push(row);
      patches.push(prow);
    }
    // the zone's corners in the full picture (for drawing a frame around it)
    const k = small.k;
    const corners = [];
    for (const [i, side] of [[0, -1], [2, 1]]) {
      const L = zone[i];
      for (const x of side < 0 ? [L.x0, L.x1] : [L.x1, L.x0]) {
        corners.push([x / k, (L.a + L.b * x + (side * L.h) / 2) / k]);
      }
    }
    return { found: true, P, patches, quad: corners, h: median(zone.map(z => z.h)) / k, contrast };
  }
  /** Reads the lines of a picture. opts.turns: the picture may be turned (a file); opts.flip: upside down too. */
  function mrz(im, opts) {
    opts = opts || {};
    const one = rot => {
      const r = readOnce(turn(im, rot), opts);
      if (!r.found) return null;
      if (opts.patchesOnly) return { found: true, patches: r.patches, rot };
      if (!net()) return { found: true, ok: false, why: 'no model' };
      const d = decode(r.P);
      const ok = accept(d);
      return { found: true, ok, lines: d.lines, conf: d.conf, min: d.min, checks: d.checks, fixed: d.fixed, weak: d.weak, gc: d.gc, rot, quad: unturn(r.quad, rot, im), h: r.h, P: opts.keepP ? r.P : undefined };
    };
    const better = (a, b) => (!a ? b : !b ? a : a.ok !== b.ok ? (a.ok ? a : b) : a.conf >= b.conf ? a : b);
    let best = null;
    for (const r0 of opts.turns ? [0, 90] : [0]) {
      const res = one(r0);
      if (!res) continue;
      if (opts.patchesOnly || (res.ok && res.min > 0.2)) return res;
      best = better(best, res);
      // a zone that reads poorly may be upside down
      if ((opts.turns || opts.flip) && !(res.ok && res.conf > 0.9)) {
        const r2 = one(r0 + 180);
        if (r2 && (r2.patchesOnly || (r2.ok && r2.min > 0.2))) return r2;
        best = better(best, r2);
      }
      if (best && best.ok) break;
    }
    return best || { found: false };
  }
  /** Corners found in a turned picture, back in the original picture's coordinates. */
  function unturn(q, rot, im) {
    const { w, h } = im;
    return q.map(([x, y]) => (rot === 180 ? [w - 1 - x, h - 1 - y] : rot === 90 ? [y, h - 1 - x] : rot === 270 ? [w - 1 - y, x] : [x, y]));
  }

  /* ---------- live: several camera frames agree ---------- */
  function live() {
    let acc = null;
    let n = 0;
    let lastLines = '';
    let lastAt = 0;
    return {
      /** A frame read: returns {ok, lines, ...} once the lines are certain, or progress. */
      push(im, opts) {
        const now = Date.now();
        const r = mrz(im, { ...(opts || {}), flip: true, keepP: true });
        if (!r.found || !r.P) {
          if (now - lastAt > 1500) {
            acc = null;
            n = 0;
            lastLines = '';
          }
          return { found: false };
        }
        lastAt = now;
        if (!acc) {
          acc = r.P.map(row => row.map(p => Float32Array.from(p, v => Math.log(v + 1e-6))));
          n = 1;
        } else {
          for (let li = 0; li < 3; li++) for (let k = 0; k < 30; k++) for (let c = 0; c < NC; c++) acc[li][k][c] += Math.log(r.P[li][k][c] + 1e-6);
          n++;
        }
        const one = r.lines.join('|');
        const agree = r.ok && one === lastLines;
        lastLines = r.ok ? one : '';
        if (agree && r.min > 0.3) return { ...r, P: undefined, ok: true, frames: n };
        // the frames together
        if (n >= 3) {
          const avg = acc.map(row => row.map(lp => {
            const m = Math.max(...lp);
            const e = Float32Array.from(lp, v => Math.exp((v - m) / n));
            const s = e.reduce((x, y) => x + y, 0);
            return e.map(v => v / s);
          }));
          const d = decode(avg);
          if (accept(d) && d.min > 0.5) return { found: true, ok: true, lines: d.lines, conf: d.conf, min: d.min, checks: d.checks, fixed: d.fixed, quad: r.quad, frames: n };
        }
        return { found: true, ok: false, quad: r.quad, conf: r.conf, frames: n, checks: r.checks };
      },
      reset() {
        acc = null;
        n = 0;
        lastLines = '';
      },
    };
  }

  /* ---------- sharpness: is a camera frame still and in focus? ---------- */
  /** Mean absolute Laplacian of a picture's middle (higher is sharper). */
  function sharpness(im) {
    const { w, h, g } = im;
    let s = 0, n = 0;
    for (let y = Math.floor(h * 0.2); y < h * 0.8; y += 2) {
      for (let x = Math.floor(w * 0.2); x < w * 0.8; x += 2) {
        const i = y * w + x;
        s += Math.abs(4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]);
        n++;
      }
    }
    return n ? s / n : 0;
  }

  /* ---------- the front: the back's values looked for in the text read from the front ---------- */
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  // letters a reader often sees in place of digits
  const LOOK = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', '|': '1', '!': '1', J: '1', T: '7', Z: '2', S: '5', B: '8', G: '6', A: '4' };
  const toDigits = s => s.replace(/[OQDUIL|!JTZSBGA]/g, c => LOOK[c]);
  // letters and digits that look alike count as the same (number on the front against the number on the back)
  const SHAPE = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6' };
  const shape = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[OQDILSBZG]/g, c => SHAPE[c]);
  /** Text lines of the front: words {t, c, b: [x0, y0, x1, y1], l} grouped by line, left to right. */
  function frontLines(words) {
    const by = new Map();
    for (const w of words || []) {
      if (!w || typeof w.t !== 'string') continue;
      const k = w.l == null ? 0 : w.l;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(w);
    }
    const out = [];
    for (const ws of by.values()) {
      ws.sort((a, b) => a.b[0] - b.b[0]);
      const b = [Math.min(...ws.map(w => w.b[0])), Math.min(...ws.map(w => w.b[1])), Math.max(...ws.map(w => w.b[2])), Math.max(...ws.map(w => w.b[3]))];
      out.push({ ws, b, t: ws.map(w => w.t).join(' ').toUpperCase(), h: median(ws.map(w => w.b[3] - w.b[1])) });
    }
    out.sort((a, b) => a.b[1] - b.b[1]);
    return out;
  }
  /** The confidence of the words a stretch of a line's text came from (the lowest). */
  function confAt(L, from, to) {
    let pos = 0;
    let c = 100;
    let b = null;
    for (const w of L.ws) {
      const end = pos + w.t.length;
      if (end > from && pos < to) {
        c = Math.min(c, w.c);
        b = b ? [Math.min(b[0], w.b[0]), Math.min(b[1], w.b[1]), Math.max(b[2], w.b[2]), Math.max(b[3], w.b[3])] : w.b.slice();
      }
      pos = end + 1;
    }
    return { c, b };
  }
  const yr = (y, future) => (y.length === 4 ? +y : future ? 2000 + +y : +y > (new Date().getFullYear() % 100) ? 1900 + +y : 2000 + +y);
  const okDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1890 && y < 2100;
  /** Every date written on the front: 21 APR 1959, 04/21/1959, 04/21/59, 1959-04-21, 04211959. */
  function datesIn(lines) {
    const out = [];
    lines.forEach((L, li) => {
      const t = L.t;
      let m;
      const word = /(\d{1,2}|[0-9OIL]{2})\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s?(\d{4}|\d{2})\b/g;
      while ((m = word.exec(t))) {
        const d = +toDigits(m[1]);
        const mo = MONTHS.indexOf(m[2]) + 1;
        out.push({ y: m[3], m: mo, d, li, at: m.index, len: m[0].length, txt: m[0] });
      }
      const dg = toDigits(t);
      const num = /(?<![0-9])(\d{1,2})\s?[/.-]\s?(\d{1,2})\s?[/.-]\s?(\d{4}|\d{2})(?![0-9])/g;
      while ((m = num.exec(dg))) out.push({ y: m[3], m: +m[1], d: +m[2], li, at: m.index, len: m[0].length, txt: t.substr(m.index, m[0].length) });
      const iso = /(?<![0-9])(\d{4})\s?[/.-]\s?(\d{1,2})\s?[/.-]\s?(\d{1,2})(?![0-9])/g;
      while ((m = iso.exec(dg))) out.push({ y: m[1], m: +m[2], d: +m[3], li, at: m.index, len: m[0].length, txt: t.substr(m.index, m[0].length) });
      const run = /(?<![0-9])(\d{2})(\d{2})(\d{4})(?![0-9])/g;
      while ((m = run.exec(dg))) out.push({ y: m[3], m: +m[1], d: +m[2], li, at: m.index, len: m[0].length, txt: t.substr(m.index, m[0].length) });
    });
    return out
      .filter(x => okDate(yr(x.y, false), x.m, x.d) || okDate(yr(x.y, true), x.m, x.d))
      .map(x => ({ ...x, ...confAt(lines[x.li], x.at, x.at + x.len) }));
  }
  /** A date read from the front is the back's date (two-digit years: the century from the back). */
  function sameDate(x, ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    if (x.m !== m || x.d !== d) return false;
    return x.y.length === 4 ? +x.y === y : +x.y === y % 100;
  }
  const fmtDate = x => (x.y.length === 4 ? x.y : (x.y.length === 2 ? "'" + x.y : x.y)) + '-' + String(x.m).padStart(2, '0') + '-' + String(x.d).padStart(2, '0');
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  /** A name part on the front: the same, one letter misread (long parts), or cut short on the back (30 characters). */
  const namePart = (part, toks, cut) => toks.some(t => t === part || (part.length >= 3 && lev(part, t) <= 1) || (part.length >= 8 && lev(part, t) <= 2) || (cut && part.length >= 2 && t.startsWith(part)));
  /** Labels next to which a value is printed (the value is on the same line after it, or on the line below). */
  const LABELS = {
    dob: /\bDOB\b|BIRTH|\b3\s?DOB|DATE OF B/,
    exp: /\bEXP\b|EXPIRES|EXPIRATION|\b4B\b|CARD EXP/,
    num: /USCIS|\bA#|A-NUMBER|\bDLN\b|\bDL\b|LIC|\b4D\b|\bNO\.?\s?#?$/,
    fam: /SURNAME|LAST NAME|FAMILY NAME/,
  };
  /** Words printed after a label: the rest of its line, and the line below it (under the label). */
  function nearLabel(lines, key) {
    const out = [];
    lines.forEach((L, li) => {
      const m = LABELS[key].exec(L.t);
      if (!m) return;
      const after = L.t.slice(m.index + m[0].length);
      if (after.replace(/[^A-Z0-9]/g, '').length >= 2) out.push({ li, from: m.index + m[0].length, t: after });
      const lb = confAt(L, m.index, m.index + m[0].length).b || L.b;
      for (let j = li + 1; j < lines.length && j <= li + 2; j++) {
        const N = lines[j];
        if (N.b[1] - L.b[3] > 2.5 * L.h) break;
        // the part of the line below that starts under the label
        const ws = N.ws.filter(w => w.b[2] > lb[0] - L.h && w.b[0] < lb[2] + 6 * L.h);
        if (ws.length) {
          const t = ws.map(w => w.t).join(' ').toUpperCase();
          const startCh = N.t.indexOf(ws[0].t.toUpperCase());
          out.push({ li: j, from: Math.max(0, startCh), t });
          break;
        }
      }
    });
    return out;
  }
  /**
   * The back's values against the words read from the front. back: {kind: 'gc'|'dl', family, given, dob, expiry,
   * uscis, number, cut}. Returns {readable, n, found: {name, dob, exp, num}, diff: [{f, front, back, c, b}], need}.
   */
  function frontMatch(words, back) {
    const lines = frontLines(words);
    const good = (words || []).filter(w => w.c >= 75 && /[A-Za-z0-9]{2}/.test(w.t));
    const readable = good.length >= 6 && good.reduce((s, w) => s + w.t.length, 0) >= 30;
    const toks = [];
    for (const L of lines) for (const w of L.ws) for (const p of w.t.toUpperCase().split(/[^A-Z]+/)) if (p.length >= 2) toks.push(p);
    const found = {};
    const diff = [];
    // name
    const fam = String(back.family || '').toUpperCase().split(/[\s<]+/).filter(x => x.length >= 2);
    const giv = String(back.given || '').toUpperCase().split(/[\s<]+/).filter(x => x.length >= 2);
    if (fam.length) {
      const famOk = fam.every((p, i) => namePart(p, toks, !!back.cut && !giv.length && i === fam.length - 1));
      const givOk = !giv.length || giv.some((p, i) => namePart(p, toks, !!back.cut && i === giv.length - 1));
      found.name = famOk && givOk;
      if (!famOk && back.kind === 'gc') {
        for (const n of nearLabel(lines, 'fam')) {
          const word = n.t.split(/[^A-Z]+/).filter(x => x.length >= 2)[0];
          const L = lines[n.li];
          const at = L.t.indexOf(word || '#', n.from);
          const cf = word ? confAt(L, at, at + word.length) : { c: 0 };
          if (word && cf.c >= 85 && !fam.some(p => lev(p, word) <= 1)) diff.push({ f: 'name', front: word, back: fam.join(' '), c: cf.c, b: cf.b });
        }
      }
    }
    // dates
    const ds = datesIn(lines);
    const dateField = (f, val, label) => {
      if (!val) return;
      found[f] = ds.some(x => sameDate(x, val));
      if (found[f]) return;
      for (const n of nearLabel(lines, label)) {
        const x = ds.find(x => x.li === n.li && x.at >= n.from - 1);
        if (x && x.c >= 85) diff.push({ f, front: fmtDate(x), back: val, c: x.c, b: x.b, txt: x.txt });
      }
    };
    dateField('dob', back.dob, 'dob');
    dateField('exp', back.expiry, 'exp');
    // the document's number
    const num = back.kind === 'gc' ? String(back.uscis || '').replace(/\D/g, '') : shape(back.number || '');
    if (num.length >= 4) {
      const flat = lines.map(L => (back.kind === 'gc' ? toDigits(L.t).replace(/[^0-9]/g, '') : shape(L.t)));
      found.num = flat.some(t => t.includes(back.kind === 'gc' ? num.replace(/^0+/, '') : num));
      if (!found.num && back.kind === 'gc') {
        lines.forEach((L, li) => {
          const m = /(?<![0-9])(\d{3})\s?-\s?(\d{3})\s?-\s?(\d{3})(?![0-9])/.exec(toDigits(L.t));
          if (!m) return;
          const v = m[1] + m[2] + m[3];
          const cf = confAt(L, m.index, m.index + m[0].length);
          if (v !== num && cf.c >= 85) diff.push({ f: 'num', front: m[1] + '-' + m[2] + '-' + m[3], back: num.slice(0, 3) + '-' + num.slice(3, 6) + '-' + num.slice(6), c: cf.c, b: cf.b });
        });
      }
    }
    const got = Object.keys(found).filter(k => found[k]);
    return { readable, n: good.length, found, got, diff, lines: lines.length };
  }
  /** Fields worth reading again closer up: the places a difference was seen. */
  function frontRecheck(m) {
    return (m.diff || []).filter(d => d.b).map(d => ({ f: d.f, b: d.b }));
  }

  /* ---------- the values the front is compared with ---------- */
  const ymd = (yy, mm, dd, future) => {
    const y = +yy;
    const now = new Date().getFullYear() % 100;
    const full = future ? (y < 70 ? 2000 + y : 1900 + y) : y > now ? 1900 + y : 2000 + y;
    return full + '-' + mm + '-' + dd;
  };
  /** A green card's three lines: name, birth date, expiry, USCIS number, card number. */
  function parseTd1(lines) {
    const [a, b, c] = lines;
    const [fam, giv] = c.split('<<');
    return {
      kind: 'gc',
      family: (fam || '').replace(/</g, ' ').trim(),
      given: (giv || '').replace(/</g, ' ').replace(/\s+/g, ' ').trim(),
      dob: ymd(b.slice(0, 2), b.slice(2, 4), b.slice(4, 6), false),
      expiry: ymd(b.slice(8, 10), b.slice(10, 12), b.slice(12, 14), true),
      uscis: a.slice(5, 14),
      number: a.slice(15, 30).replace(/<+$/, ''),
      // the name was cut to fit 30 characters when the line ends with a letter
      cut: /[A-Z]$/.test(c),
    };
  }
  /** A license barcode (AAMVA): name, birth date, expiry, license number (dates MMDDCCYY, or CCYYMMDD in Canada). */
  function parseAamva(raw) {
    const f = {};
    for (let line of String(raw).split(/[\n\r\x1e]+/)) {
      line = line.replace(/^\s+/, '');
      // the first element follows the subfile type (DL or ID), at the start of a line or after the header
      let m = /(?:^|ANSI \d{6}\d{4}\d{2}(?:[A-Z]{2}\d{8})+)(?:DL|ID)(D[A-Z]{2})(.*)$/.exec(line);
      if (m) line = m[1] + m[2];
      m = /^(D[A-Z]{2})(.*)$/.exec(line);
      if (m && !(m[1] in f)) f[m[1]] = m[2].trim();
    }
    const canada = f.DCG === 'CAN';
    const date = v => {
      v = String(v || '').replace(/\D/g, '');
      if (v.length !== 8) return '';
      const us = v.slice(4, 8) + '-' + v.slice(0, 2) + '-' + v.slice(2, 4);
      const ca = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
      const ok = d => +d.slice(5, 7) >= 1 && +d.slice(5, 7) <= 12 && +d.slice(8, 10) >= 1 && +d.slice(8, 10) <= 31;
      return canada ? (ok(ca) ? ca : us) : ok(us) ? us : ca;
    };
    let family = f.DCS || f.DAB || '';
    let given = f.DAC || f.DCT || '';
    if (!family && f.DAA) {
      const p = f.DAA.split(',');
      family = (p[0] || '').trim();
      given = given || (p[1] || '').trim();
    }
    return { kind: 'dl', family, given: (given + ' ' + (f.DAD || '')).trim(), dob: date(f.DBB), expiry: date(f.DBA), number: (f.DAQ || '').replace(/[\s-]/g, ''), cut: false };
  }

  const MODEL = {"v":1,"in":[16,24],"classes":"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<","layers":[{"n":384,"m":192,"w":"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","s":[0.00973834,0.0092446,0.00811274,0.0137032,0.00958407,0.0113866,0.00932851,0.00976459,0.00995879,0.0109462,0.00984859,0.00924419,0.00973459,0.00865396,0.00890957,0.00961334,0.011663,0.0101827,0.00929593,0.00685529,0.0108704,0.00795784,0.014201,0.0109307,0.00947066,0.00888952,0.00869033,0.0108178,0.00830021,0.0106121,0.009903,0.0108333,0.00986451,0.0110061,0.00827407,0.00905063,0.0100298,0.00885445,0.0105205,0.00956614,0.00727398,0.012291,0.00948783,0.00806308,0.010502,0.00710504,0.0112693,0.0100983,0.0137084,0.00854722,0.0135858,0.0104693,0.0123796,0.00767737,1.42784e-40,0.00839702,0.00671781,0.00773307,0.00950545,0.0108956,0.00939846,0.0100497,0.00775074,0.00914717,0.0135272,0.00916215,0.00948984,0.00849948,0.00927898,0.0105697,1.4284e-40,0.00775017,0.00816206,0.00785011,1.43328e-40,0.0098584,0.00723474,0.0110896,0.0128231,0.0109099,0.00958442,0.00878674,0.0101444,0.0113498,0.0127628,0.0084199,0.00751962,0.00938689,1.42987e-40,0.00758947,0.00936249,0.0109791,0.00935324,0.00998816,0.00955571,0.00937587,0.00993673,0.0109166,0.00996133,0.0085604,0.00945185,0.0100954,1.43445e-40,0.00896056,0.00942494,0.00953293,0.0104438,0.0116772,0.00927323,0.00898732,0.00930148,0.00924088,0.0103529,0.00950079,0.00844483,0.00742453,0.00934174,0.00850462,0.00886033,1.41933e-40,0.0104392,0.0153393,0.00951605,0.01052,0.0101438,0.0137175,0.0112067,0.00919289,0.00848665,0.0102009,0.0132043,0.0113791,0.00992615,0.00851628,0.00936699,0.00806822,0.0119119,1.43089e-40,0.00926185,0.00782395,0.00808701,0.0104244,0.0099375,0.00814837,0.0115358,0.00975377,1.43059e-40,0.0091125,0.0114806,0.00764186,0.00869892,1.42818e-40,0.00773854,0.00871835,0.00900992,0.00848289,0.0122277,0.00949673,0.011683,0.00956214,0.0111443,0.00966714,0.00963261,0.0112102,0.0103999,0.00825917,0.0126683,0.00902974,0.0077418,0.00948131,0.00970061,0.00885801,1.43159e-40,1.43448e-40,0.00906604,0.0102156,0.0120417,0.0100215,0.0139806,0.00833903,0.00977763,0.00859534,0.00947008,0.00943017,0.0113608,0.0133102,0.0096441,0.00819455,0.00978813,0.011307,0.00759059,0.00951399],"b":[0.738912,0.414826,0.12615,0.631924,0.602186,0.479957,-0.0477475,0.0358235,-0.111388,0.495512,0.226317,0.189254,0.408557,0.0730925,0.281057,0.679656,-0.119758,0.219831,0.239077,0.409273,0.413339,0.0718264,-0.0279197,-0.175907,-0.372711,0.297033,0.131275,0.995837,0.389321,0.538471,0.328337,0.0634285,-0.133781,0.737828,0.00886066,-0.355604,0.218012,-0.216811,-0.286381,-0.000109603,0.207795,0.601831,0.47683,0.206364,0.586135,0.234779,0.622264,0.225039,0.0769947,-0.0519601,0.26394,0.431766,0.497868,-0.214922,-0.0646693,0.32826,0.574712,-0.429421,0.740423,-0.232464,-0.0354109,0.716337,0.475701,0.529979,0.969598,0.194189,-0.176036,0.312497,0.427169,0.578829,-0.0201767,0.187515,0.588302,-0.201434,-0.0787884,0.146624,-0.0265719,-0.111054,-0.0220459,0.863435,0.893827,0.425715,0.548985,0.17507,0.363263,-0.160401,0.51211,0.434276,-0.163826,0.523974,0.363238,0.341732,0.382291,0.683187,0.323277,-0.290483,0.830001,-0.0188706,0.498417,0.529038,0.493424,0.514557,-0.0871065,0.154682,0.564137,-0.0270049,-0.229885,0.0614936,0.355469,-0.0504876,0.32289,-0.202486,0.444416,0.327945,0.249858,-0.240186,0.839895,0.693109,-0.179001,-0.129717,-0.246169,0.223038,0.440104,-0.123207,-0.0520389,-0.141954,0.44092,0.0964561,0.191763,0.35781,0.217767,0.217811,0.938708,0.214724,0.270813,-0.10327,0.663523,-0.114575,0.095703,0.527937,-0.11163,0.919533,0.35949,0.0108569,0.231375,0.12671,-0.101266,0.0545269,1.07749,0.1445,0.133549,-0.0663432,-0.14351,0.398078,0.0480847,0.23256,0.635024,-0.0316598,0.332268,-0.0590097,0.803682,0.284107,-0.229147,0.0402306,-0.155261,0.00434255,-0.325625,0.228282,-0.104903,-0.29685,-0.27332,0.302307,-0.109662,-0.0397969,0.536969,0.116565,0.0554328,0.0104602,0.402683,-0.0371455,0.0969065,0.326629,0.363798,0.667464,0.152514,0.130785,0.24638,0.378283,-0.454916,-0.368454,-0.0873274,0.435191]},{"n":192,"m":37,"w":"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","s":[0.0171052,0.0104419,0.00776052,0.00859009,0.00789799,0.00890379,0.0117362,0.0102257,0.00902494,0.0122567,0.0111332,0.014399,0.0121588,0.0106293,0.0105795,0.00842008,0.0133772,0.0127244,0.0138787,0.00857728,0.012529,0.00827176,0.00963211,0.0108186,0.0104758,0.0133525,0.0132599,0.00902947,0.0208235,0.0155121,0.0100913,0.0107434,0.0121274,0.012759,0.0131992,0.0130849,0.00744303],"b":[0.357404,-0.356267,-0.0517514,0.0303244,-0.28236,-0.209736,-0.049147,-0.0654133,0.206124,-0.182664,-0.345597,0.339884,0.163728,-0.12976,0.287666,-0.180872,0.435843,0.451542,-0.0895301,-0.0204081,0.128551,-0.223364,0.225807,0.294261,-0.506942,-0.419413,-0.0455023,0.15674,0.215765,-0.00750248,0.0899119,-0.0580036,-0.316964,0.111655,-0.138388,0.0420992,-0.352133]}]}; /*MODEL*/

  const api = { gray, mrz, live, cd, checksOf, sharpness, turn, shrink, CH, frontMatch, frontLines, datesIn, frontRecheck, parseTd1, parseAamva, sameDate, fmtDate, toDigits, shape, lev, _internal: { readOnce, decode, patch, inkMap, blobs, chains, joinLines, findZone, plausible } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else G.SEIdRead = api;
  // as a worker: one request at a time
  if (typeof WorkerGlobalScope !== 'undefined' && G instanceof WorkerGlobalScope) {
    let lv = null;
    G.onmessage = e => {
      const m = e.data || {};
      let out;
      try {
        const im = { w: m.w, h: m.h, g: m.g };
        if (m.op === 'live') {
          if (!lv || m.reset) lv = live();
          out = lv.push(im, m.opts);
        } else if (m.op === 'sharp') out = { sharp: sharpness(im) };
        else out = mrz(im, m.opts || { turns: true });
      } catch (err) {
        out = { found: false, error: String((err && err.message) || err) };
      }
      G.postMessage({ id: m.id, r: out });
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
