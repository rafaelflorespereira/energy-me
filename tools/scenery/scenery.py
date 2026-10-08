#!/usr/bin/env python3
"""
Cenários do resumo do energy-me: uma cena animada por sentimento.

Cada cena nasce do elemento do sentimento na MTC (Madeira -> vento, Fogo -> calor,
Terra -> umidade, Metal -> outono/chuva, Água -> frio/noite). Tudo é procedural:
este arquivo é a fonte dos assets em web/public/scenery e pode ser rodado de novo
para ajustar qualquer detalhe. Nenhuma imagem de terceiros, nenhum serviço externo.

Saída por cena e variante (mobile = retrato 780x1688, desktop = paisagem 1600x900):
  <sentimento>-<variante>.webm  VP9, mudo, loop perfeito de 4 s
  <sentimento>-<variante>.mp4   H.264 (fallback para navegadores sem VP9)
  <sentimento>-<variante>.webp  pôster estático (versão completa, sem vídeo)

Uso (Python 3.11+, numpy, scipy, Pillow, ffmpeg com libvpx-vp9 e libx264):
  python3 scenery.py --still              # 1 frame de cada cena, rápido, para revisão
  python3 scenery.py                      # todas as cenas e variantes
  python3 scenery.py alegria medo         # só algumas cenas
  python3 scenery.py --variant mobile     # só uma variante
"""
import argparse
import math
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, map_coordinates

TAU = 2 * math.pi
FPS = 24
SECONDS = 4
NF = FPS * SECONDS
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "web", "public", "scenery"))

VARIANTS = {
    "mobile": (390, 844, 2.0),     # pontos CSS de um celular, renderizado em 2x
    "desktop": (1600, 900, 1.0),
}

# ------------------------------------------------------------------ tela atual
# Coordenadas de desenho em pontos (W x H); a matriz de pixels tem PW x PH = (W x H) * S.
W = H = S = 1.0
PW = PH = 1
YY = XX = XS = None
AA = 0.7
SSF = 3


def set_canvas(dw, dh, s):
    global W, H, S, PW, PH, YY, XX, XS, AA, SSF
    W, H, S = float(dw), float(dh), float(s)
    PW, PH = int(round(dw * s)), int(round(dh * s))
    yy, xx = np.mgrid[0:PH, 0:PW].astype(np.float32)
    YY, XX = (yy + 0.5) / S, (xx + 0.5) / S
    XS = (np.arange(PW, dtype=np.float32) + 0.5) / S
    AA = 0.7 / S
    SSF = 2 if S >= 1.5 else 3


# ------------------------------------------------------------------ utilidades
def C(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255.0


def lerp(a, b, t):
    return a + (b - a) * t


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def vgrad(stops):
    stops = sorted(stops, key=lambda s: s[0])
    ys = (np.arange(PH, dtype=np.float32) + 0.5) / PH
    pos = np.array([p for p, _ in stops], np.float32)
    cols = np.stack([c for _, c in stops])
    col = np.stack([np.interp(ys, pos, cols[:, k]) for k in range(3)], axis=1)
    return np.repeat(col[:, None, :].astype(np.float32), PW, axis=1)


def over(base, col, a):
    a = np.clip(np.asarray(a, np.float32), 0.0, 1.0)
    if a.ndim == 2:
        a = a[..., None]
    return base * (1.0 - a) + col * a


def put(img, rgb_premult, alpha):
    return img * (1.0 - alpha[..., None]) + rgb_premult


def lum(img):
    return img @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def grade(img, sat=1.0, contrast=1.0, pivot=0.45):
    L = lum(img)[..., None]
    img = L + (img - L) * sat
    img = (img - pivot) * contrast + pivot
    return np.clip(img, 0.0, 1.0)


def vignette(img, k=0.2, cy=0.55):
    d = ((XX - W / 2) / (W * 0.85)) ** 2 + ((YY - H * cy) / (H * 0.75)) ** 2
    return img * (1.0 - k * np.clip(d, 0.0, 1.5))[..., None]


def rim(mask, dx, dy):
    """Borda da silhueta voltada para a luz (dx, dy em pontos)."""
    sx, sy = int(round(dx * S)), int(round(dy * S))
    sh = np.roll(np.roll(mask, sy, axis=0), sx, axis=1)
    return np.clip(mask - sh, 0.0, 1.0)


def band(yc, sig):
    return np.exp(-((YY - yc) / sig) ** 2)


def below(r):
    """Máscara 1 abaixo da linha r(x) (array por coluna, em pontos)."""
    return sstep(r - AA, r + AA, YY)


def radial(cx, cy, r):
    return np.sqrt((XX - cx) ** 2 + (YY - cy) ** 2) / r


# ---------------------------------------------------------------------- ruído
def noise2(h, w, sy, sx, seed):
    hp, wp = int(round(h * S)), int(round(w * S))
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((hp, wp))
    fy = np.fft.fftfreq(hp)[:, None]
    fx = np.fft.fftfreq(wp)[None, :]
    filt = np.exp(-2.0 * math.pi ** 2 * ((sy * S * fy) ** 2 + (sx * S * fx) ** 2))
    n = np.fft.ifft2(np.fft.fft2(white) * filt).real
    n -= n.mean()
    n /= n.std() + 1e-9
    return n.astype(np.float32)


def fbm2(h, w, sy, sx, seed, octaves=4, gain=0.5):
    acc = None
    amp = 1.0
    for o in range(octaves):
        n = noise2(h, w, max(sy / 2 ** o, 0.6 / S), max(sx / 2 ** o, 0.6 / S), seed + 97 * o)
        acc = amp * n if acc is None else acc + amp * n
        amp *= gain
    acc -= acc.mean()
    acc /= acc.std() + 1e-9
    return acc


def fbm1(n, s, seed, octaves=5, gain=0.5):
    npx = int(round(n * S))
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(npx)
    acc = np.zeros(npx)
    amp = 1.0
    for o in range(octaves):
        sig = max(s / 2 ** o, 0.6 / S) * S
        v = np.fft.ifft(np.fft.fft(rng.standard_normal(npx)) * np.exp(-2 * math.pi ** 2 * (sig * f) ** 2)).real
        acc += amp * v / (v.std() + 1e-9)
        amp *= gain
    acc -= acc.mean()
    acc /= acc.std() + 1e-9
    return acc.astype(np.float32)


def shift_x(tex, dx):
    i = math.floor(dx)
    f = dx - i
    return np.roll(tex, i, axis=1) * (1.0 - f) + np.roll(tex, i + 1, axis=1) * f


def flow(tex, ph, dist):
    """Deriva horizontal em loop perfeito (flow map): duas fases defasadas com pesos
    triangulares; normaliza a variância para o contraste não 'respirar'. Recorta a tela."""
    p1 = ph % 1.0
    p2 = (ph + 0.5) % 1.0
    w1 = 1.0 - abs(2.0 * p1 - 1.0)
    w2 = 1.0 - w1
    a = shift_x(tex, dist * S * p1)
    b = shift_x(np.roll(tex, tex.shape[1] // 2, axis=1), dist * S * p2)
    out = (w1 * a + w2 * b) / math.sqrt(w1 * w1 + w2 * w2)
    return out[:PH, :PW]


def shimmer(a, b, ph, cycles=1):
    """Ruído que evolui em loop (rotação entre dois campos), variância constante."""
    t = TAU * cycles * ph
    return a * math.cos(t) + b * math.sin(t)


# ------------------------------------------------------- desenho vetorial AA
class Ink:
    """Máscara desenhada em supersampling, em pontos, opcionalmente num recorte."""

    def __init__(self, ss=None, box=None):
        self.ss = ss or SSF
        bx0, by0, bx1, by1 = box or (0, 0, W, H)
        self.px0 = max(0, int(math.floor(bx0 * S)))
        self.py0 = max(0, int(math.floor(by0 * S)))
        self.px1 = min(PW, int(math.ceil(bx1 * S)))
        self.py1 = min(PH, int(math.ceil(by1 * S)))
        self.f = S * self.ss
        size = (max(1, (self.px1 - self.px0) * self.ss), max(1, (self.py1 - self.py0) * self.ss))
        self.im = Image.new("L", size, 0)
        self.d = ImageDraw.Draw(self.im)

    def P(self, pts):
        f, ox, oy = self.f, self.px0 * self.ss, self.py0 * self.ss
        return [(x * f - ox, y * f - oy) for x, y in pts]

    def poly(self, pts, v=255):
        if len(pts) >= 3:
            self.d.polygon(self.P(pts), fill=int(v))

    def circle(self, x, y, r, v=255):
        (a, b), (c, d) = self.P([(x - r, y - r), (x + r, y + r)])
        if c - a >= 1 and d - b >= 1:
            self.d.ellipse([a, b, c, d], fill=int(v))

    def ellipse(self, x, y, rx, ry, ang=0.0, v=255, n=36):
        ca, sa = math.cos(ang), math.sin(ang)
        pts = []
        for i in range(n):
            t = TAU * i / n
            ex, ey = rx * math.cos(t), ry * math.sin(t)
            pts.append((x + ex * ca - ey * sa, y + ex * sa + ey * ca))
        self.poly(pts, v)

    def limb(self, p1, p2, r1, r2, v=255):
        (x1, y1), (x2, y2) = p1, p2
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) + 1e-9
        nx, ny = -dy / L, dx / L
        self.poly([(x1 + nx * r1, y1 + ny * r1), (x2 + nx * r2, y2 + ny * r2),
                   (x2 - nx * r2, y2 - ny * r2), (x1 - nx * r1, y1 - ny * r1)], v)
        self.circle(x1, y1, r1, v)
        self.circle(x2, y2, r2, v)

    def line(self, p1, p2, width, v=255):
        self.d.line(self.P([p1, p2]), fill=int(v), width=max(1, int(round(width * self.f))))

    def polyline(self, pts, width, v=255):
        self.d.line(self.P(pts), fill=int(v), width=max(1, int(round(width * self.f))), joint="curve")

    def ring(self, x, y, rx, ry, width, v=255):
        (a, b), (c, d) = self.P([(x - rx, y - ry), (x + rx, y + ry)])
        if c - a < 3 or d - b < 3:
            return
        self.d.ellipse([a, b, c, d], outline=int(v), width=max(1, int(round(width * self.f))))

    def mask(self):
        w, h = self.px1 - self.px0, self.py1 - self.py0
        out = np.zeros((PH, PW), np.float32)
        if w > 0 and h > 0:
            out[self.py0:self.py1, self.px0:self.px1] = np.asarray(self.im.resize((w, h), Image.BOX), np.float32) / 255.0
        return out


class ColorInk(Ink):
    """Objetos coloridos pequenos: cor pré-multiplicada + alfa."""

    def __init__(self, ss=None, box=None):
        super().__init__(ss, box)
        self.rgb = Image.new("RGB", self.im.size, (0, 0, 0))
        self.dc = ImageDraw.Draw(self.rgb)

    def cpoly(self, pts, col, a=1.0):
        P = self.P(pts)
        if len(P) < 3 or a <= 0.003:
            return
        self.d.polygon(P, fill=int(255 * a))
        self.dc.polygon(P, fill=tuple(int(255 * c * a) for c in col))

    def ccircle(self, x, y, r, col, a=1.0):
        (p, q), (u, v) = self.P([(x - r, y - r), (x + r, y + r)])
        if u - p < 1 or v - q < 1 or a <= 0.003:
            return
        self.d.ellipse([p, q, u, v], fill=int(255 * a))
        self.dc.ellipse([p, q, u, v], fill=tuple(int(255 * c * a) for c in col))

    def cline(self, pts, width, col, a=1.0):
        P = self.P(pts)
        wpx = max(1, int(round(width * self.f)))
        self.d.line(P, fill=int(255 * a), width=wpx, joint="curve")
        self.dc.line(P, fill=tuple(int(255 * c * a) for c in col), width=wpx, joint="curve")

    def layers(self):
        w, h = self.px1 - self.px0, self.py1 - self.py0
        A = np.zeros((PH, PW), np.float32)
        R = np.zeros((PH, PW, 3), np.float32)
        if w > 0 and h > 0:
            A[self.py0:self.py1, self.px0:self.px1] = np.asarray(self.im.resize((w, h), Image.BOX), np.float32) / 255.0
            R[self.py0:self.py1, self.px0:self.px1] = np.asarray(self.rgb.resize((w, h), Image.BOX), np.float32) / 255.0
        return R, A


def bez2(p0, p1, p2, s):
    u = 1 - s
    return (u * u * p0[0] + 2 * u * s * p1[0] + s * s * p2[0], u * u * p0[1] + 2 * u * s * p1[1] + s * s * p2[1])


def bez3(p0, p1, p2, p3, s):
    u = 1 - s
    return (u ** 3 * p0[0] + 3 * u * u * s * p1[0] + 3 * u * s * s * p2[0] + s ** 3 * p3[0],
            u ** 3 * p0[1] + 3 * u * u * s * p1[1] + 3 * u * s * s * p2[1] + s ** 3 * p3[1])


def ribbon(ink, pts, w0, w1):
    n = len(pts) - 1
    top, bot = [], []
    for i in range(n + 1):
        a, c = pts[max(i - 1, 0)], pts[min(i + 1, n)]
        gx, gy = c[0] - a[0], c[1] - a[1]
        L = math.hypot(gx, gy) + 1e-9
        nx, ny = -gy / L, gx / L
        wd = lerp(w0, w1, i / n)
        top.append((pts[i][0] + nx * wd, pts[i][1] + ny * wd))
        bot.append((pts[i][0] - nx * wd, pts[i][1] - ny * wd))
    ink.poly(top + bot[::-1])


def leaf_pts(x, y, L, Wd, ang, flip):
    base = [(1.0, 0.0), (0.45, 0.62), (0.0, 0.8), (-0.5, 0.6), (-1.0, 0.0),
            (-0.5, -0.6), (0.0, -0.8), (0.45, -0.62)]
    ca, sa = math.cos(ang), math.sin(ang)
    out = []
    for px, py in base:
        px, py = px * L, py * Wd * flip
        out.append((x + px * ca - py * sa, y + px * sa + py * ca))
    return out


def ellipse_pts(x, y, rx, ry, ang=0.0, n=20):
    ca, sa = math.cos(ang), math.sin(ang)
    return [(x + rx * math.cos(t) * ca - ry * math.sin(t) * sa, y + rx * math.cos(t) * sa + ry * math.sin(t) * ca)
            for t in (TAU * i / n for i in range(n))]


def blade(x0, y0, h, w0, bend, side=-1):
    """Folha de capim/junco: bezier quadrática afinando até a ponta."""
    bend = min(bend, 1.25)
    tx_, ty_ = x0 + side * h * math.sin(bend), y0 - h * math.cos(bend)
    cx, cy = x0 + side * h * 0.22 * math.sin(bend), y0 - h * 0.62
    left, right = [], []
    n = 6
    for i in range(n + 1):
        s = i / n
        bx = (1 - s) ** 2 * x0 + 2 * (1 - s) * s * cx + s * s * tx_
        by = (1 - s) ** 2 * y0 + 2 * (1 - s) * s * cy + s * s * ty_
        gx = 2 * (1 - s) * (cx - x0) + 2 * s * (tx_ - cx)
        gy = 2 * (1 - s) * (cy - y0) + 2 * s * (ty_ - cy)
        L = math.hypot(gx, gy) + 1e-9
        nx, ny = -gy / L, gx / L
        ww = 0.5 * w0 * (1 - s) ** 0.85
        left.append((bx + nx * ww, by + ny * ww))
        right.append((bx - nx * ww, by - ny * ww))
    return left + right[::-1]


def blade_tip(x0, y0, h, bend, side=-1):
    bend = min(bend, 1.25)
    return x0 + side * h * math.sin(bend), y0 - h * math.cos(bend)


# --------------------------------------------------------------------- água
def water_rows(yh):
    yh_px = int(round(yh * S))
    d = (np.arange(PH - yh_px, dtype=np.float32) + 0.5) / S
    return yh_px, d


def lake_waves(yh, ph, amp_scale=1.0):
    """Ondulação por linha (em pontos), com perspectiva: ondas maiores perto de quem olha."""
    _, d = water_rows(yh)
    t = d / (H - yh)
    amp = (0.12 + 2.4 * t ** 1.4) * amp_scale
    phase = np.log(3.0 + 0.12 * d) / 0.12
    dx = amp * (0.62 * np.sin(TAU * (0.9 * phase + 2 * ph)) + 0.38 * np.sin(TAU * (1.7 * phase - 3 * ph) + 1.3))
    dy = 0.4 * amp * np.sin(TAU * (1.3 * phase + ph) + 0.4)
    return dx, dy


def reflect(img, yh, dx, dy, blur=(1.3, 0.6)):
    yh_px, d = water_rows(yh)
    sx = np.arange(PW, dtype=np.float32)[None, :] + (dx * S)[:, None]
    sy = np.broadcast_to((yh_px - 1 - d * S + dy * S)[:, None], sx.shape)
    out = np.stack([map_coordinates(img[..., c], [sy, sx], order=1, mode="nearest") for c in range(3)], -1)
    return gaussian_filter(out, sigma=(blur[0] * S, blur[1] * S, 0)), yh_px


def mirror_mask(m, y0, yh, dx, dy, fade=60.0):
    """Reflexo de uma máscara apoiada na água em y0 (pontos)."""
    out = np.zeros_like(m)
    y0p = int(round(y0 * S))
    yh_px = int(round(yh * S))
    ys = np.arange(y0p, PH, dtype=np.float32)
    di = np.clip((ys - yh_px).astype(int), 0, len(dx) - 1)
    sx = np.arange(PW, dtype=np.float32)[None, :] + 1.4 * dx[di][:, None] * S
    sy = np.broadcast_to((2 * y0 * S - ys + 1.5 * dy[di] * S)[:, None], sx.shape)
    out[y0p:] = map_coordinates(m, [sy, sx], order=1, mode="constant", cval=0.0)
    out[y0p:] *= np.exp(-(ys / S - y0) / fade)[:, None]
    return gaussian_filter(out, sigma=(1.0 * S, 0.5 * S))


# ------------------------------------------------------------------- pessoas
def mulher_sentada(ink, hx, hy, u, breath=0.0):
    """Abraçando os joelhos, cabeça baixa — de perfil, olhando para a direita."""
    def Pt(X, Y):
        return (hx + X * u, hy - Y * u)
    b = 0.035 * breath
    ink.circle(*Pt(0.05, 0.42), 0.42 * u)
    ink.limb(Pt(0.10, 0.45), Pt(1.22, 1.38), 0.36 * u, 0.25 * u)
    ink.limb(Pt(1.22, 1.38), Pt(1.52, 0.20), 0.24 * u, 0.13 * u)
    ink.limb(Pt(1.50, 0.14), Pt(1.95, 0.07), 0.12 * u, 0.08 * u)
    p0, p1, p2 = (0.0, 0.55), (-0.16, 1.55 + b), (0.78, 2.0 + b)
    for i in range(16):
        s = i / 15
        X = (1 - s) ** 2 * p0[0] + 2 * (1 - s) * s * p1[0] + s * s * p2[0]
        Y = (1 - s) ** 2 * p0[1] + 2 * (1 - s) * s * p1[1] + s * s * p2[1]
        ink.circle(*Pt(X, Y), (0.42 - 0.08 * s) * u)
    ink.circle(*Pt(0.74, 1.95 + b), 0.30 * u)
    ink.ellipse(*Pt(1.22, 2.06 + b), 0.40 * u, 0.48 * u, ang=math.radians(35))
    ink.circle(*Pt(1.04, 2.50 + b), 0.17 * u)
    ink.limb(Pt(0.82, 1.90 + b), Pt(1.45, 1.40), 0.16 * u, 0.13 * u)
    ink.limb(Pt(1.45, 1.40), Pt(1.58, 1.02), 0.13 * u, 0.13 * u)


def homem_vento(ink, fx, fy, u, ph, wind=1.0):
    """De perfil, inclinado contra o vento que vem da direita, punhos cerrados."""
    def Pt(X, Y):
        return (fx + X * u, fy - Y * u)
    fl = math.sin(TAU * 3 * ph)
    fl2 = math.sin(TAU * 3 * ph + 1.3)
    w = wind
    ink.limb(Pt(-0.10, 3.75), Pt(-0.55, 1.95), 0.36 * u, 0.25 * u)
    ink.limb(Pt(-0.55, 1.95), Pt(-0.98, 0.24), 0.24 * u, 0.16 * u)
    ink.limb(Pt(-1.02, 0.14), Pt(-0.50, 0.07), 0.14 * u, 0.10 * u)
    ink.limb(Pt(0.20, 3.75), Pt(0.70, 2.00), 0.36 * u, 0.25 * u)
    ink.limb(Pt(0.70, 2.00), Pt(1.00, 0.24), 0.24 * u, 0.16 * u)
    ink.limb(Pt(0.96, 0.14), Pt(1.50, 0.07), 0.14 * u, 0.10 * u)
    ink.limb(Pt(0.05, 3.9), Pt(0.55, 5.8), 0.58 * u, 0.56 * u)
    ink.circle(*Pt(0.50, 5.95), 0.50 * u)
    ink.limb(Pt(0.62, 6.2), Pt(0.78, 6.6), 0.20 * u, 0.20 * u)
    ink.ellipse(*Pt(0.92, 7.0), 0.42 * u, 0.52 * u, ang=math.radians(14))
    ink.circle(*Pt(0.76, 7.22), 0.30 * u)
    coat = [Pt(0.40, 6.40), Pt(-0.02, 6.10), Pt(-0.30, 4.7),
            Pt(-0.62 - 0.08 * w * fl2, 3.55),
            Pt(-1.02 - 0.16 * w * fl, 2.70 + 0.12 * w * fl2),
            Pt(-0.55, 2.62 + 0.06 * w * fl), Pt(0.10, 2.60), Pt(0.75, 2.62),
            Pt(1.08, 2.72), Pt(1.10, 4.5), Pt(1.06, 5.6), Pt(0.86, 6.2)]
    ink.poly(coat)
    ink.limb(Pt(0.30, 5.95), Pt(0.02, 4.80), 0.21 * u, 0.17 * u)
    ink.limb(Pt(0.02, 4.80), Pt(0.12, 3.80), 0.17 * u, 0.15 * u)
    ink.circle(*Pt(0.13, 3.68), 0.21 * u)
    ink.limb(Pt(0.78, 5.95), Pt(1.08, 4.85), 0.21 * u, 0.17 * u)
    ink.limb(Pt(1.08, 4.85), Pt(1.34, 3.98), 0.17 * u, 0.15 * u)
    ink.circle(*Pt(1.37, 3.90), 0.22 * u)


def de_costas(ink, cx, fy, u, arms, head="level", hair=False, dress=False, hood=False,
              hunch=0.0, ph=0.0, sway=0.0):
    """Pessoa de pé vista de costas. `arms`: [(cotovelo, mão)] para direita e esquerda,
    em unidades de cabeça (X para a direita, Y para cima, origem no chão)."""
    def Pt(X, Y):
        return (cx + X * u, fy - Y * u)
    sh = 5.95 + hunch
    for s in (-1, 1):
        ink.limb(Pt(0.34 * s, 3.80), Pt(0.36 * s, 2.0), 0.36 * u, 0.25 * u)
        ink.limb(Pt(0.36 * s, 2.0), Pt(0.40 * s, 0.28), 0.25 * u, 0.15 * u)
        ink.ellipse(*Pt(0.42 * s, 0.13), 0.21 * u, 0.13 * u)
    ink.ellipse(*Pt(0, 3.85), 0.74 * u, 0.48 * u)
    ink.poly([Pt(-0.64, 3.70), Pt(0.64, 3.70), Pt(0.70, 4.6), Pt(0.86, 5.5), Pt(0.98, sh),
              Pt(0.60, sh + 0.32), Pt(-0.60, sh + 0.32), Pt(-0.98, sh), Pt(-0.86, 5.5), Pt(-0.70, 4.6)])
    if dress:
        fl = 0.07 * math.sin(TAU * 2 * ph)
        ink.poly([Pt(-0.66, 4.5), Pt(0.66, 4.5), Pt(1.0 + fl, 2.25), Pt(-0.92 + fl, 2.25)])
    hy = {"level": 6.95, "down": 6.76, "up": 7.02}[head]
    hry = {"level": 0.52, "down": 0.45, "up": 0.50}[head]
    ink.limb(Pt(0, sh + 0.2), Pt(0, 6.5), 0.21 * u, 0.21 * u)
    ink.ellipse(*Pt(0, hy), 0.42 * u, hry * u)
    if hair:
        sw = 0.10 * math.sin(TAU * ph) + sway
        ink.poly([Pt(-0.42, hy + 0.12), Pt(0.42, hy + 0.12), Pt(0.50, hy - 0.4), Pt(0.54 + sw, 5.75),
                  Pt(0.34 + 1.3 * sw, 5.25), Pt(-0.30 + 1.3 * sw, 5.25), Pt(-0.50 + sw, 5.75), Pt(-0.50, hy - 0.4)])
    if hood:
        ink.poly([Pt(-0.80, sh + 0.25), Pt(-0.64, hy), Pt(-0.36, hy + 0.55), Pt(0, hy + 0.68),
                  Pt(0.36, hy + 0.55), Pt(0.64, hy), Pt(0.80, sh + 0.25)])
    for s, (elb, hand) in zip((1, -1), arms):
        shp = Pt(0.86 * s, sh - 0.05)
        e, h_ = Pt(elb[0] * s, elb[1]), Pt(hand[0] * s, hand[1])
        ink.limb(shp, e, 0.20 * u, 0.16 * u)
        ink.limb(e, h_, 0.16 * u, 0.14 * u)
        ink.circle(*h_, 0.16 * u)


def carregando_fardo(ink, fx, fy, u, ph):
    """De perfil, subindo para a direita, curvado sob um saco pesado, com cajado."""
    def Pt(X, Y):
        return (fx + X * u, fy - Y * u + 0.025 * u * math.sin(TAU * 2 * ph))
    ink.limb(Pt(-0.05, 3.75), Pt(-0.45, 2.05), 0.34 * u, 0.24 * u)          # perna de trás
    ink.limb(Pt(-0.45, 2.05), Pt(-0.95, 0.42), 0.23 * u, 0.15 * u)
    ink.limb(Pt(-0.98, 0.36), Pt(-0.60, 0.06), 0.12 * u, 0.08 * u)
    ink.limb(Pt(0.10, 3.75), Pt(0.62, 2.12), 0.34 * u, 0.24 * u)           # perna da frente
    ink.limb(Pt(0.62, 2.12), Pt(0.78, 0.22), 0.23 * u, 0.15 * u)
    ink.limb(Pt(0.76, 0.13), Pt(1.28, 0.06), 0.13 * u, 0.09 * u)
    ink.limb(Pt(0.05, 3.85), Pt(0.95, 5.50), 0.54 * u, 0.48 * u)           # tronco curvado
    ink.limb(Pt(1.05, 5.70), Pt(1.30, 5.92), 0.19 * u, 0.19 * u)
    ink.ellipse(*Pt(1.55, 6.02), 0.40 * u, 0.48 * u, ang=math.radians(40))  # cabeça baixa
    ink.ellipse(*Pt(0.15, 5.85), 1.02 * u, 1.25 * u, ang=math.radians(-22))  # o fardo
    ink.circle(*Pt(0.72, 6.95), 0.24 * u)
    ink.limb(Pt(0.95, 5.40), Pt(1.32, 4.62), 0.19 * u, 0.15 * u)            # braço com cajado
    ink.limb(Pt(1.32, 4.62), Pt(1.55, 4.25), 0.15 * u, 0.14 * u)
    ink.circle(*Pt(1.57, 4.22), 0.16 * u)
    ink.line(Pt(1.45, 4.70), Pt(2.05, 0.02), 0.10 * u)


# ===================================================================== CENAS
class Cena:
    """Base: retrato (celular) ou paisagem (desktop); o sentimento é baked na intensidade 4
    e o app aplica a intensidade de hoje com cor e velocidade."""

    def __init__(self, seed):
        self.rng = np.random.default_rng(seed)
        self.portrait = H >= W
        self.k = H / 844.0
        self.ufig = self.k * (1.0 if self.portrait else 1.25)
        self.wscale = W / 390.0
        self.area = (W * H) / (390.0 * 844.0)

    def P(self, portrait, landscape):
        return portrait if self.portrait else landscape


# ------------------------------------------------------------ árvores
def build_tree(rng, depth):
    nodes = []

    def add(parent, rel, L, w, lvl):
        idx = len(nodes)
        nodes.append({"parent": parent, "rel": rel, "L": L, "w": w, "lvl": lvl, "ph": rng.uniform(0, TAU)})
        if lvl < depth:
            nk = 2 if (rng.random() < 0.72 or lvl == 0) else 3
            spread = rng.uniform(0.30, 0.50) if nk == 2 else rng.uniform(0.45, 0.65)
            for j in range(nk):
                off = (j - (nk - 1) / 2.0) * 2 * spread / max(nk - 1, 1) + rng.normal(0, 0.10)
                add(idx, off, L * rng.uniform(0.64, 0.80), w * 0.67, lvl + 1)
        return idx

    add(-1, 0.0, 1.0, 1.0, 0)
    return nodes


def tree_geometry(nodes, x0, y0, ang0, L0, w0, ph, sway):
    ends, angs, segs = [None] * len(nodes), [0.0] * len(nodes), []
    for i, nd in enumerate(nodes):
        if nd["parent"] < 0:
            sx, sy, a = x0, y0, ang0
        else:
            sx, sy = ends[nd["parent"]]
            a = angs[nd["parent"]] + nd["rel"]
        a += sway * nd["lvl"] * math.sin(TAU * ph + 0.35 * nd["lvl"] + 0.2 * nd["ph"])
        a = max(-1.3, min(1.6, a))
        L = L0 * nd["L"]
        ex, ey = sx + L * math.sin(a), sy - L * math.cos(a)
        ends[i], angs[i] = (ex, ey), a
        segs.append((sx, sy, ex, ey, w0 * nd["w"], w0 * nd["w"] * 0.68, nd["lvl"]))
    return segs, ends


class Salgueiro:
    """Salgueiro-chorão: tronco, galhos em arco e cortina de ramos pendentes que balançam."""

    def __init__(self, rng, base, pal, k, nstrands=26):
        bx, by = base
        self.k = k

        def T(x, y):
            return (bx + x * k, by + y * k)
        self.trunk = (T(0, 0), T(-6, -60), T(30, -105), T(40, -150), 18.0 * k, 11.0 * k)
        self.limbs = [(T(36, -140), T(20, -205), T(-5, -250), T(-40, -262), 8.0 * k, 2.2 * k),
                      (T(40, -148), T(44, -230), T(58, -300), T(92, -318), 8.5 * k, 2.2 * k),
                      (T(42, -140), T(80, -210), T(130, -262), T(170, -262), 7.5 * k, 2.0 * k),
                      (T(40, -125), T(90, -150), T(150, -195), T(200, -200), 6.5 * k, 1.8 * k)]
        cx = bx + 40 * k
        self.strands = []
        for (p0, p1, p2, p3, w0, w1) in self.limbs:
            for _ in range(nstrands):
                s = rng.uniform(0.22, 1.0) ** 0.7
                ax, ay = bez3(p0, p1, p2, p3, s)
                ax += rng.normal(0, 3.0 * k)
                ay += rng.normal(0, 2.5 * k)
                out = 1.0 if ax > cx else -1.0
                Ls = (50 + 160 * rng.random() ** 0.8) * k
                leaves = []
                nk = int(Ls / (7.5 * k))
                for j in range(nk):
                    if rng.random() < 0.3:
                        continue
                    sk = 0.14 + 0.86 * (j + rng.uniform(0, 0.7)) / nk
                    leaves.append((sk, (1 if j % 2 else -1) * rng.uniform(0.6, 1.7) * k, rng.normal(0, 0.35),
                                   pal[int(rng.integers(len(pal)))], rng.uniform(2.3, 3.1) * k))
                self.strands.append((ax, ay, out, Ls, rng.uniform(0, TAU), leaves))

    def strand_pts(self, st, ph, n=12):
        ax, ay, out, Ls, p, _ = st
        k = self.k
        A = (2.0 + 3.0 * Ls / (200 * k)) * k
        P0, P1 = (ax, ay), (ax + out * 10 * k, ay - 10 * k)
        P2, P3 = (ax + out * 16 * k, ay + 0.35 * Ls), (ax + out * 14 * k + 4 * k, ay + Ls)
        pts = []
        for i in range(n + 1):
            s = i / n
            x, y = bez3(P0, P1, P2, P3, s)
            pts.append((x + A * s ** 1.5 * math.sin(TAU * ph - 2.2 * s + p), y))
        return pts

    @staticmethod
    def at(pts, s):
        f = s * (len(pts) - 1)
        i = min(int(f), len(pts) - 2)
        t = f - i
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        return x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, math.atan2(y1 - y0, x1 - x0)

    def draw(self, ink, lk, ph):
        def curve(p0, p1, p2, p3, w0, w1, n=12):
            prev = (p0, w0)
            for i in range(1, n + 1):
                s = i / n
                q, wq = bez3(p0, p1, p2, p3, s), lerp(w0, w1, s)
                ink.limb(prev[0], q, prev[1] / 2, wq / 2)
                prev = (q, wq)
        curve(*self.trunk)
        for limb in self.limbs:
            curve(*limb)
        for st in self.strands:
            pts = self.strand_pts(st, ph)
            ink.polyline(pts, 0.9 * self.k)
            for (sk, side, da, col, sz) in st[5]:
                x, y, ang = self.at(pts, sk)
                nx, ny = -math.sin(ang), math.cos(ang)
                lk.cpoly(leaf_pts(x + nx * side, y + ny * side, sz, sz * 0.32, ang + da, 1.0), col, 0.85)


# ============================================================ TRISTEZA (Metal)
class Tristeza(Cena):
    """Metal: outono, prata, chuva mansa e salgueiro-chorão. Pessoa sentada no deque."""

    def __init__(self, seed=11):
        super().__init__(seed)
        rng, k = self.rng, self.k
        self.yh = yh = 0.585 * H
        hz = C("#cdd2d5")
        self.sky = vgrad([(0.00, C("#5b6774")), (0.28, C("#7e8b98")), (0.50, C("#aeb8c0")), (0.585, hz), (1.0, hz)])
        g = np.exp(-(((XX - self.P(0.70, 0.66) * W) / (150 * k)) ** 2 + ((YY - self.P(0.37, 0.30) * H) / (115 * k)) ** 2))
        self.sky = over(self.sky, C("#eef2f4"), 0.25 * g)
        self.cl_tex = fbm2(H, 2 * W, 20 * k, 80 * k, seed + 1, octaves=5)
        self.fog_tex = fbm2(H, 2 * W, 7 * k, 60 * k, seed + 2, octaves=4)

        bw = self.P(1.0, 2.4)
        r_far = (0.508 * H + 12 * k * fbm1(W, 50 * k, seed + 3) - 30 * k * np.exp(-((XS - 0.80 * W) / (70 * k * bw)) ** 2)
                 - 12 * k * np.exp(-((XS - 0.42 * W) / (45 * k * bw)) ** 2))
        r_mid = 0.548 * H + 7 * k * fbm1(W, 28 * k, seed + 4) - 15 * k * np.exp(-((XS - 0.16 * W) / (60 * k * bw)) ** 2)
        r_sh = 0.574 * H - 3 * k - 4.5 * k * np.abs(fbm1(W, 3 * k, seed + 5)) - 2.5 * k * fbm1(W, 20 * k, seed + 6)
        self.m_far, self.m_mid, self.m_sh = below(r_far), below(r_mid), below(r_sh)
        self.c_far = lerp(hz, C("#7a8692"), 0.55)
        self.c_mid = C("#5d6873")
        self.c_sh = C("#3b434a")
        self.deep = C("#33404b")
        self.mist = 0.22
        self.fogc = C("#d3d8da")

        self.u = 24.0 * self.ufig
        self.ydeck = 0.789 * H
        self.yws = 0.812 * H
        self.hip_x = self.P(0.50, 0.30) * W
        self.xend = self.hip_x + 2.6 * self.u
        yb = (lerp(0.792 * H, 0.874 * H, sstep(25 * k, 165 * k, XS))
              - 5 * k * np.abs(fbm1(W, 6 * k, seed + 7)) - 3 * k * fbm1(W, 30 * k, seed + 8))
        self.yb = yb
        self.m_bank = below(yb)
        self.c_sil = C("#1b2025")
        self.c_fig = C("#1d2329")
        self.rimc = lerp(hz, C("#ffffff"), 0.25)

        self.reeds = [(rng.uniform(self.P(0.60, 0.62) * W, W + 6), rng.uniform(2, 12) * k, rng.uniform(26, 78) * k,
                       rng.uniform(1.6, 2.6) * k, rng.uniform(0, TAU), rng.random() < 0.22)
                      for _ in range(int(30 * self.wscale * self.P(1.0, 0.8)))]
        pal = [C("#948d55"), C("#a99d5c"), C("#7d7a4b"), C("#b5a663"), C("#8c7a45")]
        self.willow = Salgueiro(rng, (-6.0 * k, float(yb[0]) + 16.0 * k), pal, k)
        self.falling = []
        for j in range(self.P(7, 10)):
            st = self.willow.strands[int(rng.integers(len(self.willow.strands)))]
            x0, y0, _ = Salgueiro.at(self.willow.strand_pts(st, 0.0), rng.uniform(0.5, 1.0))
            self.falling.append((x0, y0, min(0.80 * H, max(y0 + 60 * k, yh + 25 * k) + rng.uniform(0, 90) * k),
                                 rng.uniform(30, 90) * k, rng.uniform(8, 18) * k, rng.uniform(0, TAU),
                                 (j + rng.uniform(0, 0.6)) / self.P(7, 10), pal[int(rng.integers(len(pal)))]))
        self.leaf_box = (0, 0.30 * H, min(W, 320 * k), 0.86 * H)

        dens = 0.85 * self.area
        self.slant = 0.10
        self.rain = [self.drops(rng, int(250 * dens), (10 * k, 16 * k), (0.16, 0.28), 3),
                     self.drops(rng, int(75 * dens), (22 * k, 34 * k), (0.26, 0.40), 4)]
        self.ripples = []
        for _ in range(int(110 * 0.85 * self.wscale)):
            y = rng.uniform(yh + 5 * k, 0.86 * H)
            t = (y - yh) / (H - yh)
            self.ripples.append((rng.uniform(0, W), y, rng.random(), (2.5 + 15 * t ** 1.2) * k,
                                 0.20 + 0.16 * t, rng.uniform(0.16, 0.24)))

    @staticmethod
    def drops(rng, n, Lr, ar, cycles):
        return {"x0": rng.uniform(0, W, n), "s0": rng.uniform(0, 1, n), "L": rng.uniform(*Lr, n),
                "a": rng.uniform(*ar, n), "k": float(cycles)}

    def draw_pier(self, ink):
        yd, yw, xe, k = self.ydeck, self.yws, self.xend, self.k
        ink.poly([(-6, yd), (xe - 3 * k, yd), (xe, yd + 4 * k), (-6, yd + 4 * k)])
        ink.poly([(-6, yd + 4 * k), (xe, yd + 4 * k), (xe, yd + 10 * k), (-6, yd + 10 * k)])
        for px in np.arange(10 * k, xe, 44 * k):
            ink.poly([(px, yd + 9 * k), (px + 5 * k, yd + 9 * k), (px + 5 * k, yw + 1), (px, yw + 1)])

    def rain_mask(self, dr, ph, width):
        ink = Ink(2)
        s = (dr["s0"] + dr["k"] * ph) % 1.0
        L = dr["L"]
        y = -L + s * (H + 2 * L)
        x = (dr["x0"] + self.slant * y) % W
        for xi, yi, Li, ai in zip(x, y, L, dr["a"]):
            ink.line((xi, yi), (xi + self.slant * Li, yi + Li), width * self.k, 255 * ai)
        return ink.mask()

    def ripple_mask(self, ph):
        ink = Ink(box=(0, self.yh, W, H))
        for (x, y, p, rmax, flat, life) in self.ripples:
            tau = (ph - p) % 1.0
            if tau >= life:
                continue
            s = tau / life
            a = (1 - s) ** 1.6 * 0.5
            r = rmax * (0.15 + 0.85 * s)
            ink.ring(x, y, r, r * flat, 0.6 * self.k, 255 * a)
            if s > 0.25:
                ink.ring(x, y, r * 0.55, r * 0.55 * flat, 0.5 * self.k, 255 * a * 0.6)
        return ink.mask()

    def frame(self, ph):
        yh, k = self.yh, self.k
        img = self.sky.copy()
        n = flow(self.cl_tex, ph, 26.0 * k)
        img *= (1.0 + 0.065 * n * sstep(yh, 0.0, YY))[..., None]
        fm = np.clip(0.62 + 0.38 * flow(self.fog_tex, ph, 44.0 * k), 0.0, 1.5)
        img = over(img, self.c_far, self.m_far)
        img = over(img, self.fogc, self.mist * 0.55 * band(0.522 * H, 14 * k) * fm)
        img = over(img, self.c_mid, self.m_mid)
        img = over(img, self.fogc, self.mist * 0.80 * band(0.562 * H, 12 * k) * fm)
        img = over(img, self.c_sh, self.m_sh)

        dx, dy = lake_waves(yh, ph, 1.1)
        refl, yh_px = reflect(img, yh, dx, dy)
        t = (np.arange(PH - yh_px, dtype=np.float32) / (PH - yh_px))[:, None, None]
        img[yh_px:] = refl * (0.88 - 0.22 * t) + self.deep * (0.08 + 0.36 * t)
        img = over(img, self.fogc, self.mist * 0.65 * band(0.596 * H, 18 * k) * fm)

        fg = Ink(box=(0, self.ydeck - 4 * self.u, self.xend + 8, self.yws + 4))
        self.draw_pier(fg)
        mulher_sentada(fg, self.hip_x, self.ydeck + 1, self.u, breath=math.sin(TAU * ph))
        m_fg = fg.mask()
        img = over(img, self.deep * 0.72, 0.75 * mirror_mask(m_fg, self.yws, yh, dx, dy, 60 * k))
        img = over(img, C("#dfe5ea"), self.ripple_mask(ph))
        img = over(img, C("#eef2f5"), self.rain_mask(self.rain[0], ph, 0.7))

        img = over(img, self.c_fig, m_fg)
        img = over(img, self.rimc, 0.45 * rim(m_fg, 1, 1))
        ink = Ink(2)
        lk = ColorInk(box=self.leaf_box)
        self.willow.draw(ink, lk, ph)
        for (x, dep, h, wd, p, cat) in self.reeds:
            y0 = float(np.interp(x, XS, self.yb)) + dep
            bend = 0.10 + 0.07 * math.sin(TAU * ph + x / (40.0 * k)) + 0.02 * math.sin(TAU * 3 * ph + p)
            ink.poly(blade(x, y0, h, wd, bend, side=+1))
            if cat:
                tx, ty = x + h * math.sin(bend) * 0.93, y0 - h * math.cos(bend) * 0.93
                ink.ellipse(tx, ty, 1.8 * k, 5.5 * k, ang=bend)
        sil = np.maximum(self.m_bank, ink.mask())
        img = over(img, self.c_sil, sil)
        img = over(img, self.rimc, 0.32 * rim(sil, 1, 1))
        for (x0, y0, y1, drift, amp, p, s0, col) in self.falling:
            s = (s0 + ph) % 1.0
            a = float(sstep(0.0, 0.08, s) * sstep(1.0, 0.88, s))
            x = x0 + drift * s + amp * math.sin(TAU * 1.5 * s + p)
            y = y0 + (y1 - y0) * s
            fl = 0.25 + 0.75 * abs(math.cos(TAU * 2.0 * s + p))
            lk.cpoly(leaf_pts(x, y, 3.6 * k, 1.2 * k, p + TAU * 1.2 * s, fl), col, 0.95 * a)
        img = put(img, *lk.layers())

        img = over(img, C("#f2f5f7"), self.rain_mask(self.rain[1], ph, 1.0))
        img = over(img, self.fogc, 0.03)
        img = grade(img, sat=1.0, contrast=1.04)
        return vignette(img, 0.16)


# ============================================================== RAIVA (Madeira)
class Raiva(Cena):
    """Madeira: vento forte; o 'fogo do fígado' acende o horizonte sob a tempestade.
    Pessoa de pé no alto do morro, contra o vento, punhos cerrados."""

    def __init__(self, seed=23):
        super().__init__(seed)
        rng, k = self.rng, self.k
        self.glow = 1.25
        dy = 0.14                        # pessoa no terço de baixo, livre dos cartões
        self.dy = dy
        ly = 0.42 + dy
        self.lid = ly * H
        hz = 0.598 + dy
        self.bg = vgrad([(0.0, C("#2a1411")), (ly - 0.07, C("#571d15")), (ly, C("#a3321c")),
                         (min(ly + 0.035, hz - 0.02), C("#e05a28")), (hz - 0.016, C("#ff9f50")),
                         (hz, C("#ffcf86")), (1.0, C("#ffcf86"))])
        self.fx = self.P(0.36, 0.30) * W
        self.hconc = (0.80 + 0.30 * np.exp(-((XS - self.P(0.70, 0.62) * W) / (self.P(140, 420) * k)) ** 2))[None, :, None]
        self.lid_dark = vgrad([(0.0, C("#121a1c")), (ly * 0.6, C("#1a2526")), (ly, C("#26302d")), (1.0, C("#26302d"))])
        self.edge = (self.lid + 9 * k * fbm1(W, 45 * k, seed + 1) + 2.5 * k * fbm1(W, 9 * k, seed + 2)
                     + 6 * k * np.abs(np.sin(math.pi * (XS + 14 * k * fbm1(W, 30 * k, seed + 11)) / (34.0 * k))))
        self.cl_tex = fbm2(H, 2 * W, 34 * k, 80 * k, seed + 3, octaves=5)
        self.det_tex = fbm2(H, 2 * W, 10 * k, 22 * k, seed + 4, octaves=3)
        self.scud_tex = fbm2(H, 2 * W, 12 * k, 30 * k, seed + 5, octaves=3)

        bw = self.P(1.0, 2.5)
        r_far = ((hz - 0.003) * H + 5 * k * fbm1(W, 40 * k, seed + 6)
                 - 9 * k * np.exp(-((XS - 0.22 * W) / (55 * k * bw)) ** 2) - 5 * k * np.exp(-((XS - 0.90 * W) / (40 * k * bw)) ** 2))
        r_mid = (0.618 + dy) * H + 8 * k * fbm1(W, 30 * k, seed + 7) - 10 * k * np.exp(-((XS - 0.78 * W) / (70 * k * bw)) ** 2)
        self.m_far, self.m_mid = below(r_far), below(r_mid)
        crest = self.P(105, 300) * k
        self.yfg = ((0.705 + dy) * H - 34 * k * np.exp(-((XS - self.fx) / crest) ** 2)
                    + 8 * k * sstep(self.fx + 0.2 * W, W, XS) + 4 * k * fbm1(W, 25 * k, seed + 8))
        self.m_fg = below(self.yfg)
        self.c_far = C("#3a211c")
        self.c_mid = C("#172019")
        self.sil = vgrad([(0.0, C("#15211a")), (0.66 + dy, C("#1a281d")), (0.72 + dy, C("#152018")), (1.0, C("#0b110d"))])
        self.fg_tex = (1.0 + 0.08 * fbm2(H, W, 5 * k, 26 * k, seed + 9, octaves=4))[..., None]

        nb = int(560 * self.wscale)
        self.bx = rng.uniform(-10, W + 10, nb)
        dep = rng.uniform(0, 1, nb) ** 2.2 * 80 * k
        self.by = np.interp(self.bx, XS, self.yfg) + dep
        self.bh = (9 + 26 * rng.uniform(0, 1, nb)) * k * (1 - dep / (120 * k))
        self.bw = (1.5 + 1.4 * rng.uniform(0, 1, nb)) * k
        self.bp = rng.uniform(0, TAU, nb)
        greens = [C("#4f7d3f"), C("#6c9a49"), C("#3b5e32"), C("#88a94f")]
        self.fly = [(rng.uniform(0, 1), int(rng.choice([2, 3])), rng.uniform((0.47 + dy) * H, min(0.95, 0.80 + dy) * H),
                     rng.uniform(0, TAU), greens[int(rng.integers(4))]) for _ in range(int(12 * self.wscale ** 0.8))]
        self.fy = float(np.interp(self.fx, XS, self.yfg)) + 3 * k

    def frame(self, ph):
        k = self.k
        gt = self.glow * (1.0 + 0.05 * math.sin(TAU * ph))
        img = np.clip(self.bg * self.hconc * (0.55 + 0.45 * gt), 0, 1)

        cl = flow(self.cl_tex, ph, -150 * k)
        det = flow(self.det_tex, ph, -190 * k)
        sc = flow(self.scud_tex, ph, -230 * k)
        h = cl + 0.22 * det
        shade = np.clip(0.5 - 9.0 * k * np.gradient(h, axis=0) * S, 0, 1)
        B = 0.5 + 0.5 * np.tanh(1.1 * h)
        y_edge = self.edge[None, :] + 4 * k * sc
        L = np.exp(-np.clip(y_edge - YY, 0, None) / (26.0 * k)) * gt
        base = self.lid_dark * (0.70 + 0.60 * B)[..., None]
        lit = C("#c4482a") * (0.75 + 0.25 * B)[..., None]
        col = lerp(base, lit, np.clip(L * (0.35 + 0.65 * shade), 0, 0.85)[..., None])
        img = over(img, col, sstep(y_edge + 6 * k, y_edge - 6 * k, YY))

        img = over(img, lerp(self.c_far, C("#ff9f50"), 0.18 * gt), self.m_far)
        img = over(img, self.c_mid, self.m_mid)

        ink = Ink(2)
        homem_vento(ink, self.fx, self.fy, 15.0 * self.ufig, ph, wind=1.0)
        gust = 0.5 + 0.5 * np.sin(TAU * (2 * ph + self.bx / (170.0 * k)))
        bend = 0.40 + 0.32 * gust + 0.05 * np.sin(TAU * 5 * ph + self.bp)
        for i in range(len(self.bx)):
            ink.poly(blade(self.bx[i], self.by[i], self.bh[i], self.bw[i], float(bend[i]), side=-1))
        sil = np.maximum(self.m_fg, ink.mask())
        img = over(img, self.sil * self.fg_tex, sil)
        rr = np.clip(rim(sil, -1, 1) + 0.5 * rim(sil, -2, 2), 0, 1)
        img = over(img, C("#ff9b55"), rr * 0.55 * gt * sstep((0.80 + self.dy) * H, (0.55 + self.dy) * H, YY))

        lk = ColorInk(box=(0, (0.40 + self.dy) * H, W, H))
        for (s0, cyc, y0, p, col) in self.fly:
            s = (s0 + cyc * ph) % 1.0
            x = W + 25 * k - s * (W + 50 * k)
            y = y0 + 16 * k * math.sin(TAU * 1.3 * s + p) + 22 * k * s
            fl = 0.25 + 0.75 * abs(math.cos(TAU * 2.5 * s + p))
            lk.cpoly(leaf_pts(x, y, 3.6 * k, 2.0 * k, p + TAU * 2.0 * s * cyc, fl), col, 0.92)
        img = put(img, *lk.layers())

        img = grade(img, sat=1.10, contrast=1.06)
        return vignette(img, 0.24, cy=0.5 + self.dy / 2)


# =============================================================== ALEGRIA (Fogo)
class Alegria(Cena):
    """Fogo: verão, calor, sol. Campo aberto com papoulas, borboletas e brisa leve;
    pessoa de braços abertos para o sol."""

    def __init__(self, seed=31):
        super().__init__(seed)
        rng, k = self.rng, self.k
        self.yh = yh = self.P(0.60, 0.58) * H
        sx, sy = self.P(0.70, 0.66) * W, self.P(0.34, 0.24) * H
        hz = C("#fbe6bf")
        sky = vgrad([(0.0, C("#4a9ae2")), (0.25, C("#74b3ea")), (0.48, C("#b4daf3")), (yh / H, hz), (1.0, hz)])
        d = radial(sx, sy, 1.0)
        sky = over(sky, C("#fff3cf"), 0.55 * np.exp(-d / (110 * k)))
        sky = over(sky, C("#ffe9b0"), 0.22 * np.exp(-d / (300 * k)))
        self.sky, self.sun_d = sky, d
        self.cl_tex = fbm2(H, 2 * W, 22 * k, 60 * k, seed + 1, octaves=5)
        self.cl_band = sstep(0.03 * H, 0.12 * H, YY) * sstep(yh - 0.04 * H, yh - 0.16 * H, YY)
        bw = self.P(1.0, 2.6)
        r_far = (yh - 26 * k + 9 * k * fbm1(W, 60 * k, seed + 2)
                 - 16 * k * np.exp(-((XS - 0.25 * W) / (80 * k * bw)) ** 2))
        r_mid = (yh - 9 * k + 5 * k * fbm1(W, 35 * k, seed + 3)
                 - 8 * k * np.exp(-((XS - 0.78 * W) / (70 * k * bw)) ** 2))
        trees = sstep(0.35, 0.9, fbm1(W, 40 * k, seed + 4))
        r_tr = r_mid - (3 + 6 * np.abs(fbm1(W, 3.5 * k, seed + 5))) * k * trees
        self.m_far, self.m_tr, self.m_mid = below(r_far), below(r_tr), below(r_mid)
        self.meadow = vgrad([(0.0, C("#a2d06c")), (yh / H, C("#a2d06c")), ((yh / H + 1) / 2, C("#6eaa47")),
                             (1.0, C("#3f7e2f"))])
        self.meadow *= (1.0 + 0.07 * fbm2(H, W, 10 * k, 60 * k, seed + 6, octaves=4))[..., None]
        self.m_ground = below(np.full(PW, yh, np.float32))
        self.hz = hz

        pal = [(C("#e0412f"), 0.42), (C("#f08a24"), 0.15), (C("#f6cf3a"), 0.20), (C("#fbf6ea"), 0.17),
               (C("#e889a8"), 0.06)]
        cols, probs = [c for c, _ in pal], np.array([p for _, p in pal])
        flowers = []
        for _ in range(int(820 * self.wscale)):
            t = rng.uniform(0, 1) ** 1.8
            flowers.append((rng.uniform(-5, W + 5), yh + 3 * k + (H - yh) * 0.86 * t, t, (0.5 + 3.4 * t ** 1.25) * k,
                            cols[int(rng.choice(len(cols), p=probs))], rng.uniform(0, TAU)))
        self.near_flowers = [f for f in flowers if f[2] > 0.5]
        ink = ColorInk(box=(0, yh, W, H))
        for (x, y, t, r, col, p) in flowers:
            if t <= 0.5:
                ink.ccircle(x, y, r, col, 0.95)
        self.far_flowers = ink.layers()

        ng = int(380 * self.wscale)
        self.gx = rng.uniform(-10, W + 10, ng)
        self.gy = rng.uniform(0.86 * H, H + 6 * k, ng)
        self.gh = rng.uniform(14, 40, ng) * k
        self.gw = rng.uniform(1.6, 2.8, ng) * k
        self.gp = rng.uniform(0, TAU, ng)

        self.px = self.P(0.42, 0.30) * W
        self.py = yh + self.P(0.42, 0.55) * (H - yh)
        self.pu = 13.5 * self.ufig
        sh = Ink(box=(self.px - 3 * self.pu, self.py - self.pu, self.px + 3 * self.pu, self.py + self.pu))
        sh.ellipse(self.px + 0.5 * self.pu, self.py + 0.05 * self.pu, 1.6 * self.pu, 0.28 * self.pu)
        self.m_shadow = gaussian_filter(sh.mask(), 1.5 * S)

        bcols = [C("#f39c2b"), C("#f7d64a"), C("#f5f2e8"), C("#e0503a"), C("#f2b13a")]
        self.butterflies = []
        for _ in range(self.P(7, 12)):
            cy = rng.uniform(yh - 50 * k, H - 90 * k)
            t = float(np.clip((cy - yh) / (H - yh), 0, 1))
            self.butterflies.append(dict(
                cx=rng.uniform(0.08, 0.92) * W, cy=cy, ax=rng.uniform(25, 60) * k, ay=rng.uniform(12, 30) * k,
                m1=int(rng.choice([1, 2])), m2=int(rng.choice([1, 2, 3])), p1=rng.uniform(0, TAU),
                p2=rng.uniform(0, TAU), f=int(rng.choice([14, 16, 18])), pf=rng.uniform(0, TAU),
                sz=lerp(6.0, 11.0, t) * k, col=bcols[int(rng.integers(len(bcols)))]))
        self.motes = [(rng.uniform(0, W), rng.uniform(yh - 130 * k, yh + 160 * k), rng.uniform(0, 1),
                       rng.uniform(0.9, 1.6) * k, rng.uniform(0, TAU)) for _ in range(int(45 * self.wscale))]
        self.birds = [(self.P(0.22, 0.18) * W, self.P(0.17, 0.14) * H, 26 * k, 0.0),
                      (self.P(0.33, 0.27) * W, self.P(0.22, 0.20) * H, 18 * k, 2.1)]

    def frame(self, ph):
        k, yh = self.k, self.yh
        img = self.sky.copy()
        img = over(img, C("#fffbea"), sstep(19 * k + AA, 19 * k - AA, self.sun_d))
        n = flow(self.cl_tex, ph, 34 * k)
        dens = sstep(0.75, 1.5, n) * self.cl_band
        shade = np.clip(0.62 + 4.0 * k * np.gradient(n, axis=0) * S, 0, 1)
        ccol = lerp(C("#d3e2f0"), C("#ffffff"), shade[..., None])
        ccol = over(ccol, C("#fff2d6"), 0.5 * np.exp(-self.sun_d / (180 * k)))
        img = over(img, ccol, 0.94 * dens)

        bk = ColorInk(box=(0, 0, W, yh))
        for (bx, by, r, p) in self.birds:
            a = TAU * ph + p
            x, y = bx + r * math.cos(a), by + 0.45 * r * math.sin(a)
            flap = 0.6 + 0.4 * math.sin(TAU * 5 * ph + p)
            sp = 5.5 * k
            bk.cline([(x - sp, y - 2.4 * k * flap), (x - 0.4 * sp, y - 0.6 * k), (x, y), (x + 0.4 * sp, y - 0.6 * k),
                      (x + sp, y - 2.4 * k * flap)], 1.0 * k, C("#2b3a4a"), 0.75)
        img = put(img, *bk.layers())

        img = over(img, C("#acd0ba"), self.m_far)
        img = over(img, C("#5e9a5f"), self.m_tr)
        img = over(img, C("#8fc08a"), self.m_mid)
        img = over(img, self.meadow, self.m_ground)
        img = over(img, self.hz, 0.35 * band(yh, 9 * k))
        img = put(img, *self.far_flowers)

        fk = ColorInk(box=(0, yh, W, H))
        for (x, y, t, r, col, p) in self.near_flowers:
            sw = 1.6 * k * t * math.sin(TAU * (ph + x / (150 * k))) + 0.5 * k * math.sin(TAU * 3 * ph + p)
            if t > 0.7:
                fk.cline([(x, y + 9 * k * t), (x + sw * 0.6, y + 4 * k * t), (x + sw, y)], 0.7 * k, C("#3d6e2a"), 0.9)
            fk.ccircle(x + sw, y, r, col, 0.97)
            if r > 2.2 * k:
                fk.ccircle(x + sw, y, r * 0.32, C("#3a2a14"), 0.9)
        img = put(img, *fk.layers())

        img = over(img, C("#2f5a25"), 0.30 * self.m_shadow)
        pu = self.pu
        pk = Ink(box=(self.px - 3.5 * pu, self.py - 9.5 * pu, self.px + 3.5 * pu, self.py + pu))
        sw = 0.05 * math.sin(TAU * ph)
        arms = [((1.55 + sw, 7.0), (2.0 + sw, 8.05)), ((1.55 - sw, 7.0), (2.0 - sw, 8.05))]
        de_costas(pk, self.px, self.py, pu, arms, head="up", hair=True, dress=True, ph=ph)
        m = pk.mask()
        img = over(img, C("#33452b"), m)
        img = over(img, C("#ffe7a3"), 0.75 * rim(m, -1, 1))

        gk = Ink(2, box=(0, 0.80 * H, W, H))
        for i in range(len(self.gx)):
            bend = (0.16 + 0.10 * math.sin(TAU * (ph + self.gx[i] / (200 * k))) + 0.04 * math.sin(TAU * 3 * ph + self.gp[i]))
            gk.poly(blade(self.gx[i], self.gy[i], self.gh[i], self.gw[i], bend, side=+1))
        gm = gk.mask()
        img = over(img, C("#4c8a34"), gm)
        img = over(img, C("#d9f09c"), 0.35 * rim(gm, -1, 1))

        bk = ColorInk(box=(0, yh - 90 * k, W, H))
        for b in self.butterflies:
            a1 = TAU * b["m1"] * ph + b["p1"]
            a2 = TAU * b["m2"] * ph + b["p2"]
            x = b["cx"] + b["ax"] * math.sin(a1)
            y = b["cy"] + b["ay"] * math.sin(a2) + 3 * k * math.sin(TAU * 6 * ph + b["p1"])
            flap = 0.15 + 0.85 * abs(math.cos(TAU * b["f"] * ph + b["pf"]))
            sz, col = b["sz"], b["col"]
            tilt = 0.35 * math.cos(a1)
            for s in (-1, 1):
                bk.cpoly(ellipse_pts(x + s * 0.55 * sz * flap, y - 0.22 * sz, 0.55 * sz * flap + 0.05 * k, 0.45 * sz,
                                     s * 0.35 + tilt, 14), col, 0.95)
                bk.cpoly(ellipse_pts(x + s * 0.38 * sz * flap, y + 0.30 * sz, 0.38 * sz * flap + 0.05 * k, 0.30 * sz,
                                     -s * 0.3 + tilt, 12), col * 0.85, 0.95)
            bk.cpoly(ellipse_pts(x, y, 0.09 * sz, 0.5 * sz, tilt, 10), C("#2b2118"), 0.95)
        img = put(img, *bk.layers())

        mk = ColorInk(box=(0, yh - 170 * k, W, min(H, yh + 170 * k)))
        for (x0, y0, s0, r, p) in self.motes:
            s = (s0 + ph) % 1.0
            a = float(sstep(0, 0.15, s) * sstep(1, 0.85, s)) * (0.45 + 0.55 * abs(math.sin(TAU * 2 * ph + p)))
            mk.ccircle(x0 + 6 * k * math.sin(TAU * s + p), y0 - 34 * k * s, r, C("#fff4c8"), 0.85 * a)
        img = put(img, *mk.layers())

        img = grade(img, sat=1.06, contrast=1.03)
        return vignette(img, 0.10)


# ======================================================= FRUSTRAÇÃO (Madeira)
class Frustracao(Cena):
    """Madeira estagnada: céu baixo e parado; a estrada termina numa porteira fechada.
    Rajadas que começam e morrem, sem levar a lugar nenhum."""

    def __init__(self, seed=41):
        super().__init__(seed)
        rng, k = self.rng, self.k
        self.yh = yh = self.P(0.62, 0.64) * H
        g = C("#c9c6a0")
        self.sky = vgrad([(0.0, C("#333a30")), (0.30, C("#4a5242")), (0.50, C("#6c745a")),
                          (yh / H - 0.012, C("#a4a685")), (yh / H, g), (1.0, g)])
        self.cl1 = fbm2(H, 2 * W, 12 * k, 70 * k, seed + 1, octaves=5)
        self.cl2 = fbm2(H, 2 * W, 22 * k, 110 * k, seed + 2, octaves=4)
        self.xvp = self.P(0.50, 0.31) * W
        self.u = 14.0 * self.ufig
        self.yf = yf = yh + self.P(0.34, 0.42) * (H - yh)
        self.hf = hf = 0.62 * 7.4 * self.u
        trees = sstep(0.2, 0.8, fbm1(W, 45 * k, seed + 3))
        self.m_tr = below(yh - (2 + 7 * np.abs(fbm1(W, 4 * k, seed + 4))) * k * trees - 1.0 * k)

        tones = [C(h) for h in ("#7a8150", "#69733f", "#7f8654", "#5f6936", "#737b47", "#58622f", "#6c7540", "#4f592a")]
        edges = [yh + (H - yh) * (i / 8) ** 1.9 for i in range(9)]
        tt = np.clip((YY - yh) / (H - yh), 0, 1)
        field = np.zeros((PH, PW, 3), np.float32)
        for i in range(8):
            m = sstep(edges[i] - AA, edges[i] + AA, YY) * (1 - sstep(edges[i + 1] - AA, edges[i + 1] + AA, YY))
            field += m[..., None] * tones[i]
        field = lerp(field, C("#9a9a74"), (0.55 * (1 - tt) ** 3)[..., None])
        field *= (1.0 + 0.06 * fbm2(H, W, 4 * k, 30 * k, seed + 5, octaves=4))[..., None]
        self.field = field
        self.m_ground = below(np.full(PW, yh, np.float32))

        self.xb = self.xvp + self.P(0.0, 0.03) * W
        self.hwb = self.P(0.31, 0.15) * W

        def road_hw(y):
            return 1.5 * k + (self.hwb - 1.5 * k) * np.clip((y - yh) / (H - yh), 0, 1)

        def road_xc(y):
            return self.xvp + (self.xb - self.xvp) * np.clip((y - yh) / (H - yh), 0, 1)
        hw, dist = road_hw(YY), np.abs(XX - road_xc(YY))
        self.m_road = sstep(hw + AA, hw - AA, dist) * (YY > yh)
        self.m_strip = sstep(0.09 * hw + AA, 0.09 * hw - AA, dist) * self.m_road
        self.ruts = np.exp(-((dist - 0.55 * hw) / (0.08 * hw + 0.3 * k)) ** 2) * self.m_road
        self.road_col = lerp(C("#b8ae8a"), C("#9a8e68"), tt[..., None])

        fk = Ink(box=(0, yf - hf * 1.3, W, yf + 6 * k))
        hwf, xcf = float(road_hw(yf)) * 1.08, float(road_xc(yf))
        gl, gr = xcf - hwf, xcf + hwf
        step = 44 * k * self.P(1.0, 1.15)
        posts = []
        x = gr + step
        while x < W + step:
            posts.append(x)
            x += step * rng.uniform(0.9, 1.1)
        x = gl - step
        while x > -step:
            posts.append(x)
            x -= step * rng.uniform(0.9, 1.1)
        for x in posts:
            h, tl = hf * rng.uniform(0.92, 1.04), rng.normal(0, 0.03)
            fk.poly([(x - 2.2 * k, yf + 2 * k), (x + 2.2 * k, yf + 2 * k), (x + 2.0 * k + tl * h, yf - h),
                     (x - 2.0 * k + tl * h, yf - h)])
        allp = sorted(posts + [gl, gr])
        for fr in (0.33, 0.62, 0.90):
            for a, b in zip(allp[:-1], allp[1:]):
                if a >= gl - 1 and b <= gr + 1:
                    continue
                fk.polyline([(lerp(a, b, t), yf - fr * hf + 1.6 * k * math.sin(math.pi * t)) for t in np.linspace(0, 1, 8)],
                            0.8 * k)
        for x in (gl, gr):
            fk.poly([(x - 3.6 * k, yf + 3 * k), (x + 3.6 * k, yf + 3 * k), (x + 3.2 * k, yf - 1.10 * hf),
                     (x - 3.2 * k, yf - 1.10 * hf)])
        th = 3.0 * k
        for fr in np.linspace(0.14, 0.95, 5):
            y = yf - fr * hf
            fk.poly([(gl, y - th / 2), (gr, y - th / 2), (gr, y + th / 2), (gl, y + th / 2)])
        for x in (gl + 6 * k, gr - 6 * k, (gl + gr) / 2):
            fk.poly([(x - 1.6 * k, yf - 0.14 * hf), (x + 1.6 * k, yf - 0.14 * hf), (x + 1.6 * k, yf - 0.95 * hf),
                     (x - 1.6 * k, yf - 0.95 * hf)])
        fk.line((gl + 6 * k, yf - 0.14 * hf), (gr - 6 * k, yf - 0.95 * hf), 2.6 * k)
        self.m_fence = fk.mask()

        self.px, self.py = xcf, yf + 8 * k
        yhand = (0.95 * hf + 8 * k) / self.u
        self.arms = [((1.32, 5.2), (0.95, yhand)), ((1.32, 5.2), (0.95, yhand))]

        tufts = []
        for _ in range(int(240 * self.wscale)):
            x = rng.uniform(-8, W + 8)
            if abs(x - xcf) < hwf * 0.95:
                continue
            tufts.append((x, rng.uniform(yf - 1 * k, yf + 16 * k), rng.uniform(8, 26) * k, rng.uniform(1.3, 2.2) * k,
                          rng.uniform(0, TAU)))
        for _ in range(int(170 * self.wscale)):
            x, y = rng.uniform(-8, W + 8), rng.uniform(0.92 * H, H + 6 * k)
            if abs(x - float(road_xc(y))) < float(road_hw(y)) * 0.9:
                continue
            tufts.append((x, y, rng.uniform(20, 50) * k, rng.uniform(1.8, 3.0) * k, rng.uniform(0, TAU)))
        self.tufts = tufts

    def frame(self, ph):
        k, yh = self.k, self.yh
        n1 = flow(self.cl1, ph, 14 * k)
        n2 = flow(self.cl2, ph, -9 * k)
        img = self.sky * (1 + (0.10 * n1 + 0.07 * n2) * sstep(yh, 0, YY))[..., None]
        img = over(img, C("#e4e0b6"), 0.45 * np.exp(-np.clip(yh - YY, 0, None) / (14 * k)) * (YY < yh))
        img = over(img, lerp(C("#3d4429"), C("#c9c6a0"), 0.45), self.m_tr)
        img = over(img, self.field, self.m_ground)
        img = over(img, self.road_col, self.m_road)
        img = over(img, C("#626c3a"), self.m_strip)
        img = over(img, C("#857a57"), 0.45 * self.ruts)
        img = over(img, C("#2b2f22"), self.m_fence)
        img = over(img, C("#d8d4a8"), 0.35 * rim(self.m_fence, 0, 1))

        pk = Ink(box=(self.px - 3 * self.u, self.py - 8 * self.u, self.px + 3 * self.u, self.py + self.u))
        de_costas(pk, self.px, self.py + 0.02 * self.u * math.sin(TAU * ph), self.u, self.arms, head="down")
        m = pk.mask()
        img = over(img, C("#262a1e"), m)
        img = over(img, C("#d8d4a8"), 0.30 * rim(m, 0, 1))

        gk = Ink(2)
        for (x, y, h, w, p) in self.tufts:
            mm = (2 * ph - x / (1.3 * W)) % 1.0
            gust = sstep(0, 0.07, mm) * (1 - mm) ** 2.5
            bend = 0.06 + 0.55 * gust + 0.02 * math.sin(TAU * 5 * ph + p)
            gk.poly(blade(x, y, h, w, bend, side=+1))
        gm = gk.mask()
        img = over(img, C("#4f5a2c"), gm)
        img = over(img, C("#cfcb9a"), 0.30 * rim(gm, 0, 1))

        img = grade(img, sat=1.0, contrast=1.04)
        return vignette(img, 0.22)


# ======================================================== PREOCUPAÇÃO (Terra)
class Preocupacao(Cena):
    """Terra: umidade, ocre, fim de verão. Um caminho entre o trigo some na névoa;
    a pessoa para, com a mão na nuca, sem enxergar adiante."""

    def __init__(self, seed=51):
        super().__init__(seed)
        rng, k = self.rng, self.k
        self.yh = yh = self.P(0.585, 0.57) * H
        hz = C("#e7dbb4")
        self.fogc = C("#eadcb2")
        sky = vgrad([(0.0, C("#847e69")), (0.30, C("#a99e80")), (0.50, C("#cfc29b")), (yh / H, hz), (1.0, hz)])
        d = radial(self.P(0.64, 0.62) * W, self.P(0.30, 0.22) * H, 1.0)
        sky = over(sky, C("#f6edd2"), 0.28 * np.exp(-d / (90 * k)))
        sky = over(sky, C("#f8f1dc"), 0.35 * sstep(17 * k + AA, 17 * k - AA, d))
        self.sky = sky
        self.f1 = fbm2(H, 2 * W, 10 * k, 80 * k, seed + 1, octaves=4)
        self.f2 = fbm2(H, 2 * W, 16 * k, 140 * k, seed + 2, octaves=4)
        tt = np.clip((YY - yh) / (H - yh), 0, 1)
        field = lerp(C("#d1bb80"), C("#b58d3e"), (tt ** 0.6)[..., None])
        field = lerp(field, C("#7a5a22"), (tt ** 2.2)[..., None])
        field *= (1.0 + 0.07 * fbm2(H, W, 1.6 * k, 9 * k, seed + 3, octaves=3) * tt
                  + 0.05 * fbm2(H, W, 12 * k, 60 * k, seed + 4))[..., None]
        self.field = field
        self.m_ground = below(np.full(PW, yh, np.float32))

        x0, x1 = self.P(0.42, 0.30) * W, self.P(0.56, 0.50) * W
        A = self.P(0.16, 0.08) * W

        def xc(t):
            return x1 + (x0 - x1) * t + A * np.sin(math.pi * 1.6 * t + 0.4) * t ** 0.7

        def hw(t):
            return 1.2 * k + 0.5 * self.P(0.40, 0.20) * W * t ** 1.15
        dist = np.abs(XX - xc(tt))
        self.m_path = sstep(hw(tt) + AA, hw(tt) - AA, dist) * (YY > yh)
        self.path_col = lerp(C("#ddcc9e"), C("#c2aa72"), tt[..., None])

        trees = []
        for i in range(self.P(6, 10)):
            t = rng.uniform(0.04, 0.55)
            side = 1 if i % 2 else -1
            x = float(xc(t)) + side * (float(hw(t)) + rng.uniform(10, 60) * k * (0.3 + t) * self.P(1, 3))
            trees.append((x, yh + t * (H - yh), t, int(rng.integers(1 << 30))))
        ck = ColorInk(box=(0, max(0.0, yh - 220 * k), W, yh + 0.7 * (H - yh)))
        for (x, y, t, sd) in sorted(trees, key=lambda q: q[2]):
            r = np.random.default_rng(sd)
            s = (0.10 + t) * 140 * k
            col = lerp(self.fogc, C("#4b4430"), min(1.0, 0.18 + 1.25 * t))
            ck.cpoly([(x - 0.035 * s, y), (x + 0.035 * s, y), (x + 0.025 * s, y - 0.5 * s), (x - 0.025 * s, y - 0.5 * s)],
                     col, 1.0)
            for _ in range(6):
                ck.ccircle(x + r.normal(0, 0.16) * s, y - 0.62 * s + r.normal(0, 0.12) * s, r.uniform(0.16, 0.27) * s, col)
        self.tree_layer = ck.layers()

        pt = self.P(0.52, 0.56)
        self.px, self.py = float(xc(pt)), yh + pt * (H - yh)
        self.pu = 12.5 * self.ufig
        self.pcol = lerp(self.fogc, C("#3b3220"), 0.82)
        self.arms = [((1.40, 6.95), (0.34, 7.06)), ((1.0, 4.85), (1.0, 3.9))]

        n = int(560 * self.wscale)
        wx, wy = rng.uniform(-10, W + 10, n), rng.uniform(0.80 * H, H + 8 * k, n)
        tw = (wy - yh) / (H - yh)
        keep = np.abs(wx - xc(tw)) > hw(tw) * 0.9
        self.wx, self.wy = wx[keep], wy[keep]
        n = len(self.wx)
        self.wh = rng.uniform(26, 58, n) * k
        self.ww = rng.uniform(1.0, 1.8, n) * k
        self.wp = rng.uniform(0, TAU, n)
        self.motes = [(rng.uniform(0, W), rng.uniform(0.55 * H, 0.95 * H), rng.uniform(0, 1), rng.uniform(0.8, 1.4) * k,
                       rng.uniform(0, TAU)) for _ in range(int(30 * self.wscale))]

    def frame(self, ph):
        k, yh = self.k, self.yh
        img = self.sky.copy()
        fm = np.clip(0.55 + 0.25 * flow(self.f1, ph, 46 * k) + 0.20 * flow(self.f2, ph, 26 * k), 0, 1.3)
        img = over(img, self.field, self.m_ground)
        img = over(img, self.path_col, self.m_path)
        img = put(img, *self.tree_layer)
        dh = YY - yh
        dens = np.where(dh > 0, 0.92 * np.exp(-(np.clip(dh, 0, None) / (self.P(80, 90) * k)) ** 1.3),
                        0.80 * np.exp(-np.clip(-dh, 0, None) / (120 * k)))
        img = over(img, self.fogc, dens * fm)

        pu = self.pu
        pk = Ink(box=(self.px - 3 * pu, self.py - 8.5 * pu, self.px + 3 * pu, self.py + pu))
        de_costas(pk, self.px, self.py, pu, self.arms, head="level", ph=ph)
        m = pk.mask()
        img = over(img, self.pcol, m)
        img = over(img, C("#f3e3b5"), 0.35 * rim(m, -1, 1))
        img = over(img, self.fogc, 0.16 * band(self.py - 20 * k, 70 * k) * fm)

        wk = Ink(2, box=(0, 0.66 * H, W, H))
        for i in range(len(self.wx)):
            x, y, h = self.wx[i], self.wy[i], self.wh[i]
            bend = 0.10 + 0.08 * math.sin(TAU * (ph + x / (180 * k))) + 0.03 * math.sin(TAU * 3 * ph + self.wp[i])
            wk.poly(blade(x, y, h, self.ww[i], bend, side=+1))
            tx, ty = blade_tip(x, y, h * 0.96, bend, side=+1)
            wk.ellipse(tx, ty, 1.1 * k, 3.6 * k, ang=bend)
        wm = wk.mask()
        img = over(img, C("#9c7a34"), wm)
        img = over(img, C("#f2dc9a"), 0.40 * rim(wm, -1, 1))

        mk = ColorInk(box=(0, 0.5 * H, W, H))
        for (x0, y0, s0, r, p) in self.motes:
            s = (s0 + ph) % 1.0
            a = float(sstep(0, 0.15, s) * sstep(1, 0.85, s)) * (0.5 + 0.5 * abs(math.sin(TAU * 2 * ph + p)))
            mk.ccircle(x0 + 26 * k * s, y0 + 6 * k * math.sin(TAU * s + p), r, C("#fff3d0"), 0.7 * a)
        img = put(img, *mk.layers())

        img = grade(img, sat=1.04, contrast=1.02)
        return vignette(img, 0.16)


# ============================================================== CULPA (Água)
class Culpa(Cena):
    """Água (Rim): inverno na hora azul, neve caindo. Alguém sobe a encosta carregando
    um fardo; ao longe, uma janela acesa."""

    def __init__(self, seed=61):
        super().__init__(seed)
        rng, k = self.rng, self.k
        self.yh = yh = self.P(0.56, 0.54) * H
        hz = C("#9a9cc2")
        sky = vgrad([(0.0, C("#121a33")), (0.25, C("#222c55")), (0.42, C("#434e7d")), (yh / H, hz), (1.0, hz)])
        sky = over(sky, C("#d9a9a2"), 0.20 * np.exp(-((XX - self.P(0.80, 0.82) * W) / (260 * k)) ** 2
                                                   - ((YY - yh) / (60 * k)) ** 2))
        self.sky = sky
        bw = self.P(1.0, 2.6)
        self.hx = hx = self.P(0.74, 0.80) * W
        r1 = yh - 16 * k + 9 * k * fbm1(W, 70 * k, seed + 1)
        r2 = yh + 16 * k + 10 * k * fbm1(W, 55 * k, seed + 2) - 22 * k * np.exp(-((XS - hx) / (90 * k * bw)) ** 2)
        self.m1, self.m2 = below(r1), below(r2)
        self.snow2 = vgrad([(0.0, C("#c2cbe6")), (yh / H, C("#c2cbe6")), (1.0, C("#8e9cc6"))])

        pk = Ink(box=(0, yh - 70 * k, W, yh + 90 * k))
        cluster = fbm1(W, 30 * k, seed + 3)
        x = 0.0
        while x < W:
            i = min(PW - 1, int(x * S))
            if cluster[i] > 0.25 and abs(x - hx) > 30 * k:
                y = float(r2[i]) + 3 * k
                h = rng.uniform(9, 18) * k
                pk.poly([(x - 0.32 * h, y), (x + 0.32 * h, y), (x, y - h)])
            x += rng.uniform(4, 9) * k
        hy = float(np.interp(hx, XS, r2)) + 2 * k
        bwid, bh = 18 * k, 11 * k
        pk.poly([(hx - bwid / 2, hy), (hx + bwid / 2, hy), (hx + bwid / 2, hy - bh), (hx - bwid / 2, hy - bh)])
        pk.poly([(hx - bwid / 2 - 3 * k, hy - bh), (hx + bwid / 2 + 3 * k, hy - bh), (hx, hy - bh - 9 * k)])
        pk.poly([(hx + 4 * k, hy - bh - 2 * k), (hx + 7 * k, hy - bh - 2 * k), (hx + 7 * k, hy - bh - 9 * k),
                 (hx + 4 * k, hy - bh - 9 * k)])
        self.m_pines = pk.mask()
        wk = Ink(box=(hx - 20 * k, hy - 30 * k, hx + 20 * k, hy))
        self.win = (hx - 4 * k, hy - 6 * k)
        wk.poly([(hx - 6 * k, hy - 4 * k), (hx - 2 * k, hy - 4 * k), (hx - 2 * k, hy - 8 * k), (hx - 6 * k, hy - 8 * k)])
        self.m_window = wk.mask()
        self.d_win = radial(*self.win, 1.0)

        yA, yB = self.P(0.87, 0.90) * H, self.P(0.72, 0.74) * H
        self.ys = ys = yA + (yB - yA) * (XS / W) + 7 * k * fbm1(W, 90 * k, seed + 4)
        self.m_slope = below(ys)
        ts = np.clip((YY - ys[None, :]) / (H - ys[None, :] + 1e-3), 0, 1)
        self.slope_col = lerp(C("#e1e8f7"), C("#8090bb"), (ts ** 0.8)[..., None])
        self.px = self.P(0.48, 0.30) * W
        self.py = float(np.interp(self.px, XS, ys)) + 2 * k
        self.pu = 13.5 * self.ufig
        fp = Ink(box=(0, 0.6 * H, self.px, H))
        for j in range(1, 13):
            x = self.px - (j * 11 + 3 * (j % 2)) * k * self.ufig
            y = float(np.interp(x, XS, ys)) + (2.0 if j % 2 else 0.6) * k
            fp.ellipse(x, y, 2.4 * k * self.ufig, 0.9 * k * self.ufig, ang=-0.12, v=255 * 0.6 * (1 - j / 14))
        self.m_prints = fp.mask()
        self.tree = build_tree(rng, depth=5)
        self.tx = self.P(0.12, 0.10) * W
        self.ty = float(np.interp(self.tx, XS, ys)) + 4 * k
        self.flakes = []
        for _ in range(int(170 * self.area ** 0.85)):
            r = rng.uniform(0.6, 2.4) * k
            near = r > 1.6 * k
            self.flakes.append((rng.uniform(0, W), rng.uniform(0, 1), r, 2 if near else 1, rng.uniform(6, 14) * k,
                                int(rng.choice([1, 2])), rng.uniform(0, TAU), 0.85 if near else 0.6))

    def frame(self, ph):
        k = self.k
        img = self.sky.copy()
        img = over(img, C("#7d88b4"), self.m1)
        img = over(img, self.snow2, self.m2)
        img = over(img, C("#2c3659"), self.m_pines)
        fl = 0.92 + 0.08 * math.sin(TAU * 3 * ph) * math.sin(TAU * 5 * ph + 1.0)
        img = over(img, C("#ffb45a"), 0.45 * fl * np.exp(-self.d_win / (14 * k)))
        img = over(img, C("#ffd28a"), self.m_window * fl)
        img = over(img, self.slope_col, self.m_slope)
        img = over(img, C("#7f8cba"), self.m_prints)

        tk = Ink(box=(0, 0.25 * H, self.tx + 140 * k * self.P(1, 1.6), H))
        segs, _ = tree_geometry(self.tree, self.tx, self.ty, -0.08, self.P(70, 115) * k, 7 * k, ph, 0.0015)
        for (x1, y1, x2, y2, w1, w2, _) in segs:
            tk.limb((x1, y1), (x2, y2), w1 / 2, w2 / 2)
        img = over(img, C("#1c2340"), tk.mask())

        pu = self.pu
        pk = Ink(box=(self.px - 3 * pu, self.py - 8.5 * pu, self.px + 3.5 * pu, self.py + pu))
        carregando_fardo(pk, self.px, self.py, pu, ph)
        m = pk.mask()
        img = over(img, C("#1a2140"), m)
        img = over(img, C("#b8c3ea"), 0.45 * rim(m, 1, 1))

        fk = ColorInk(ss=2)
        for (x0, s0, r, cyc, A, mm, p, a) in self.flakes:
            s = (s0 + cyc * ph) % 1.0
            y = -10 * k + s * (H + 20 * k)
            x = (x0 + A * math.sin(TAU * mm * s + p) + 18 * k * s) % W
            fk.ccircle(x, y, r, C("#f3f6ff"), a)
        img = put(img, *fk.layers())

        img = grade(img, sat=1.02, contrast=1.03)
        return vignette(img, 0.20)


# =============================================================== MEDO (Água)
class Medo(Cena):
    """Água: noite fria, mar escuro e vasto, lua encoberta. Alguém pequeno na areia,
    de capuz, abraçando o próprio corpo."""

    def __init__(self, seed=71):
        super().__init__(seed)
        rng, k = self.rng, self.k
        self.yh = yh = self.P(0.60, 0.56) * H
        self.ys = ys = self.P(0.80, 0.79) * H
        hz = C("#1e3456")
        sky = vgrad([(0.0, C("#03060f")), (0.25, C("#071226")), (0.45, C("#0e1e3a")), (yh / H, hz), (1.0, hz)])
        self.mx, self.my = self.P(0.66, 0.64) * W, self.P(0.22, 0.18) * H
        d = radial(self.mx, self.my, 1.0)
        self.dm = d
        sky = over(sky, C("#3e5b8c"), 0.28 * np.exp(-d / (220 * k)))
        sky = over(sky, C("#8aa3cc"), 0.38 * np.exp(-d / (60 * k)))
        self.sky = sky
        self.moon = sstep(15 * k + AA, 15 * k - AA, d)
        self.stars = [(rng.uniform(0, W), rng.uniform(0, yh - 30 * k), rng.uniform(0.4, 1.1) * k, rng.uniform(0.2, 0.8),
                       rng.uniform(0, TAU), rng.random() < 0.3) for _ in range(int(110 * self.wscale))]
        self.cl = fbm2(H, 2 * W, 16 * k, 70 * k, seed + 1, octaves=5)
        self.cl_band = sstep(yh - 8 * k, yh - 60 * k, YY)
        tt = np.clip((YY - yh) / (ys - yh), 0, 1)
        self.sea = lerp(C("#18294a"), C("#08132a"), (tt ** 0.5)[..., None])
        self.sA = fbm2(H, 2 * W, 0.9 * k, 9 * k, seed + 2, octaves=2)[:PH, :PW]
        self.sB = fbm2(H, 2 * W, 0.9 * k, 9 * k, seed + 3, octaves=2)[:PH, :PW]
        sig = 8 * k + 0.45 * np.clip(YY - yh, 0, None)
        self.glit = np.exp(-((XX - self.mx) / sig) ** 2) * sstep(yh, yh + 6 * k, YY) * (YY < ys)
        self.swell = np.log(1.0 + np.clip(YY - yh, 0, None) / (5 * k)) / 0.3
        self.m_sea = (YY >= yh).astype(np.float32)
        self.waves = [(i / 3.0, fbm1(W, 40 * k, seed + 10 + i)) for i in range(3)]
        self.foam_tex = np.clip(0.5 + 0.5 * fbm2(H, W, 1.4 * k, 7 * k, seed + 5, octaves=3), 0, 1)
        tb = np.clip((YY - ys) / (H - ys), 0, 1)
        self.sand = (lerp(C("#1a2130"), C("#0a0e16"), (tb ** 0.7)[..., None])
                     * (1 + 0.06 * fbm2(H, W, 1.2 * k, 4 * k, seed + 6, octaves=3))[..., None])
        self.m_beach = below(ys + 2 * k * fbm1(W, 30 * k, seed + 7))
        rk = Ink(box=(0, ys - 50 * k, W, H))
        rocks = self.P([(0.05 * W, ys + 12 * k, 36 * k, 20 * k), (0.97 * W, ys + 6 * k, 28 * k, 15 * k)],
                       [(0.03 * W, ys + 10 * k, 64 * k, 28 * k), (0.98 * W, ys + 4 * k, 44 * k, 20 * k),
                        (0.72 * W, ys + 34 * k, 20 * k, 9 * k)])
        for (x, y, rx, ry) in rocks:
            rk.ellipse(x, y, rx, ry, ang=0.08)
            rk.ellipse(x + 0.45 * rx, y - 0.35 * ry, 0.55 * rx, 0.7 * ry, ang=-0.2)
        self.m_rocks = rk.mask()
        self.px = self.P(0.42, 0.30) * W
        self.py = ys + self.P(0.22, 0.30) * (H - ys)
        self.pu = 12.5 * self.ufig
        self.arms = [((1.02, 5.05), (0.52, 5.4)), ((1.02, 5.05), (0.52, 5.4))]
        self.mist = fbm2(H, 2 * W, 6 * k, 80 * k, seed + 8, octaves=3)

    def frame(self, ph):
        k, yh, ys = self.k, self.yh, self.ys
        img = self.sky.copy()
        sk = ColorInk(box=(0, 0, W, yh))
        for (x, y, r, a, p, tw) in self.stars:
            sk.ccircle(x, y, r, C("#dfe7ff"), a * (0.5 + 0.5 * math.sin(TAU * 3 * ph + p) if tw else 1.0))
        img = put(img, *sk.layers())
        img = over(img, C("#e6ecf6"), self.moon)
        n = flow(self.cl, ph, 40 * k)
        dens = sstep(0.25, 1.15, n) * self.cl_band
        edge = np.clip(4 * dens * (1 - dens), 0, 1)
        lit = np.exp(-self.dm / (85 * k))
        ccol = lerp(C("#0a1427"), C("#9db3d8"), np.clip(0.85 * lit * (0.35 + 0.65 * edge), 0, 0.9)[..., None])
        img = over(img, ccol, 0.95 * dens)

        sea = self.sea * (1 + 0.05 * np.sin(TAU * (self.swell - 3 * ph)))[..., None]
        spark = np.clip((shimmer(self.sA, self.sB, ph, 3) - 1.0) * 1.6, 0, 1) * self.glit
        sea = over(sea, C("#3b5682"), 0.22 * self.glit)
        sea = over(sea, C("#d4e0f3"), 0.95 * spark)
        img = over(img, sea, self.m_sea)
        fm = np.clip(0.6 + 0.4 * flow(self.mist, ph, 30 * k), 0, 1.3)
        img = over(img, C("#2c4268"), 0.32 * band(yh + 2 * k, 9 * k) * fm)
        wash_total = np.zeros((PH, PW), np.float32)
        for (off, prof) in self.waves:
            s = (ph + off) % 1.0
            yw = lerp(ys - self.P(70, 80) * k, ys - 2 * k, s ** 1.6)
            yl = yw + 2.5 * k * prof[None, :]
            th = (0.8 + 2.4 * s) * k
            a = float(sstep(0.0, 0.25, s) * (1 - sstep(0.86, 1.0, s)) * (0.25 + 0.6 * s))
            img = over(img, C("#b9c9e1"), np.exp(-((YY - yl) / th) ** 2) * self.foam_tex * a)
            wa = float(sstep(0.80, 0.92, s) * (1 - sstep(0.92, 1.0, s)))
            if wa > 0:
                yw2 = ys + (2 + 7 * float(sstep(0.80, 0.95, s))) * k + 2 * k * prof[None, :]
                wash_total += np.exp(-((YY - yw2) / (2.5 * k)) ** 2) * wa

        img = over(img, self.sand, self.m_beach)
        img = over(img, C("#2a3c5e"), 0.45 * band(ys + 4 * k, 5 * k) * self.m_beach)
        img = over(img, C("#8aa3cc"), 0.25 * band(ys + 3 * k, 4 * k) * np.exp(-((XX - self.mx) / (40 * k)) ** 2) * self.m_beach)
        img = over(img, C("#a9bbd8"), 0.45 * wash_total * self.foam_tex)
        img = over(img, C("#05080f"), self.m_rocks)
        img = over(img, C("#5f769c"), 0.35 * rim(self.m_rocks, -1, 1))

        pu = self.pu
        pk = Ink(box=(self.px - 3 * pu, self.py - 9 * pu, self.px + 3 * pu, self.py + pu))
        de_costas(pk, self.px, self.py, pu, self.arms, head="down", hood=True, hunch=0.22,
                  sway=0.0, ph=ph)
        m = pk.mask()
        img = over(img, C("#04070d"), m)
        img = over(img, C("#7f96bd"), 0.80 * rim(m, -1, 1))

        img = grade(img, sat=1.0, contrast=1.04)
        return vignette(img, 0.24)


# IDs estáveis do app (web/src/domain/feelings.ts)
SCENES = {
    "raiva": Raiva,
    "frustracao": Frustracao,
    "preocupacao": Preocupacao,
    "alegria": Alegria,
    "tristeza": Tristeza,
    "culpa": Culpa,
    "medo": Medo,
}


MASTER = os.path.join(HERE, "_master")


def render_job(job):
    """Renderiza uma cena: pôster WebP + master sem perdas (para codificar quantas vezes precisar)."""
    scene_id, variant, still = job
    dw, dh, s = VARIANTS[variant]
    if still:
        s = 1.0 if variant == "mobile" else 0.5
    set_canvas(dw, dh, s)
    cena = SCENES[scene_id]()
    name = f"{scene_id}-{variant}"
    if still:
        prev = os.path.join(HERE, "_preview")
        os.makedirs(prev, exist_ok=True)
        for ph in (0.0, 0.5):
            Image.fromarray(to_u8(cena.frame(ph))).save(os.path.join(prev, f"{name}-{int(ph * 10)}.png"))
        return name
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(MASTER, exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{PW}x{PH}",
           "-r", str(FPS), "-i", "-", "-c:v", "libx264rgb", "-qp", "0", "-preset", "ultrafast",
           os.path.join(MASTER, f"{name}.mkv")]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for f in range(NF):
        fr = to_u8(cena.frame(f / NF))
        if f == 0:
            Image.fromarray(fr).save(os.path.join(OUT, f"{name}.webp"), quality=80, method=6)
        proc.stdin.write(fr.tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg falhou em {name}")
    return name


def encode_job(name):
    """Master -> WebM (VP9) e MP4 (H.264), mudos, cor BT.709, um keyframe por loop."""
    src = os.path.join(MASTER, f"{name}.mkv")
    vf = "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
    tags = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", vf, "-c:v", "libvpx-vp9", "-b:v", "0",
                    "-crf", str(CRF_VP9), "-deadline", "good", "-cpu-used", "2", "-row-mt", "1", "-g", str(NF),
                    *tags, "-an", os.path.join(OUT, f"{name}.webm")], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", vf, "-c:v", "libx264", "-preset", "slow",
                    "-crf", str(CRF_H264), "-profile:v", "high", "-g", str(NF), *tags, "-movflags", "+faststart",
                    "-an", os.path.join(OUT, f"{name}.mp4")], check=True)
    return name


CRF_VP9 = 38
CRF_H264 = 26


def to_u8(img):
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scenes", nargs="*")
    ap.add_argument("--variant", choices=list(VARIANTS))
    ap.add_argument("--still", action="store_true", help="só frames PNG de revisão")
    ap.add_argument("--encode-only", action="store_true", help="só recodifica a partir dos masters")
    ap.add_argument("--jobs", type=int, default=2)
    a = ap.parse_args()
    ids = a.scenes or list(SCENES)
    variants = [a.variant] if a.variant else list(VARIANTS)
    names = [f"{i}-{v}" for i in ids for v in variants]
    with ProcessPoolExecutor(max_workers=a.jobs) as ex:
        if not a.encode_only:
            for name in ex.map(render_job, [(i, v, a.still) for i in ids for v in variants]):
                print("render", name, flush=True)
        if not a.still:
            for name in ex.map(encode_job, names):
                print("encode", name, flush=True)


if __name__ == "__main__":
    main()
