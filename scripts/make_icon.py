#!/usr/bin/env python3
"""NoteFlow app icon — modern 3D "paper stack" style.

Light comes from the top-left:
- teal squircle tile with vertical gradient + soft radial light/shade + inner rim
- note page with layered extrusion (paper thickness), drop shadow, tilted -4°
- folded corner with shaded flap, embossed text lines, checklist badge
- subtle glossy sheen across the top, clipped to the tile

Rendered at 2048 (4x supersampling), downsampled with Lanczos.
"""
from PIL import Image, ImageDraw, ImageFilter
import os

S = 2048  # supersampled canvas
OUT = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
SIZES = [32, 64, 128, 256, 512]
SIZE_NAMES = {512: "icon.png", 256: "256x256.png", 128: "128x128.png",
              64: "64x64.png", 32: "32x32.png"}

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def vgrad(size, top, bottom):
    img = Image.new("RGBA", size)
    d = ImageDraw.Draw(img)
    w, h = size
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp(top, bottom, y / (h - 1)) + (255,))
    return img

def radial(size, cx, cy, radius, color, max_alpha):
    """Soft radial light/shade blob."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    steps = 48
    for i in range(steps, 0, -1):
        r = radius * i / steps
        a = int(max_alpha * (1 - i / steps) ** 1.6)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (a,))
    return layer.filter(ImageFilter.GaussianBlur(radius / 12))

def squircle_mask(size, radius_ratio=0.225):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1],
                                        radius=int(size[0] * radius_ratio), fill=255)
    return m

# ---------------------------------------------------------------- tile
def build_tile():
    grad = vgrad((S, S), (28, 202, 190), (8, 96, 90))          # teal gradient
    tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mask = squircle_mask((S, S))

    light = radial((S, S), int(S * 0.32), int(S * 0.20), int(S * 0.75), (255, 255, 255), 60)
    shade = radial((S, S), int(S * 0.80), int(S * 0.92), int(S * 0.85), (0, 20, 18), 70)

    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    base.paste(grad, (0, 0))
    base = Image.alpha_composite(base, light)
    base = Image.alpha_composite(base, shade)
    base.putalpha(mask)

    # subtle inner rim (light top edge feel)
    rim = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    inset = int(S * 0.012)
    rd.rounded_rectangle([inset, inset, S - 1 - inset, S - 1 - inset],
                         radius=int(S * 0.215), outline=(255, 255, 255, 34), width=int(S * 0.008))
    rim_mask = squircle_mask((S, S))
    rim.putalpha(Image.composite(rim.getchannel("A"), Image.new("L", (S, S), 0), rim_mask))
    base = Image.alpha_composite(base, rim)
    return base, mask

# ---------------------------------------------------------------- page
PAGE = [int(S*0.305), int(S*0.222), int(S*0.695), int(S*0.770)]  # x0,y0,x1,y1
FOLD = int(S * 0.135)
PR = int(S * 0.052)  # page corner radius

def page_silhouette(offset_y=0, grow=0):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = PAGE
    d.rounded_rectangle([x0 - grow, y0 + offset_y - grow, x1 + grow, y1 + offset_y + grow],
                        radius=PR + grow, fill=(255, 255, 255, 255))
    return layer.getchannel("A")

def build_page():
    # --- drop shadow (beneath the paper, cast onto the tile)
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow.paste(Image.new("RGBA", (S, S), (4, 34, 30, 110)), (int(S*0.012), int(S*0.030)),
                 page_silhouette().point(lambda a: int(a * 0.9)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(S * 0.018)))

    # --- extruded paper thickness: stacked darker sheets below the face
    stack = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    layers = 11
    step = int(S * 0.0075)
    for i in range(layers, 0, -1):
        t = i / layers
        col = lerp((208, 226, 229), (139, 165, 171), t)      # lighter -> darker downward
        sheet = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(sheet)
        x0, y0, x1, y1 = PAGE
        d.rounded_rectangle([x0, y0 + i * step, x1, y1 + i * step], radius=PR,
                            fill=col + (255,))
        stack = Image.alpha_composite(stack, sheet)

    # --- front face with its own soft vertical gradient
    face = vgrad((S, S), (255, 255, 255), (222, 238, 240))
    face_mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(face_mask).rounded_rectangle(PAGE, radius=PR, fill=255)
    face.putalpha(face_mask)

    paper = Image.alpha_composite(stack, face)

    # --- folded corner (top-right): cut + shaded flap
    x0, y0, x1, y1 = PAGE
    cut = [(x1 - FOLD, y0), (x1, y0 + FOLD), (x1, y0)]
    cut_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(cut_layer).polygon(cut, fill=(16, 148, 138, 255))  # tile tone shows through
    # keep the cut inside the page only
    cut_layer.putalpha(Image.composite(cut_layer.getchannel("A"),
                                       Image.new("L", (S, S), 0), face_mask))

    flap = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fd = ImageDraw.Draw(flap)
    fd.polygon([(x1 - FOLD, y0), (x1 - FOLD, y0 + FOLD), (x1, y0 + FOLD)],
               fill=(233, 245, 246, 255))
    # flap gradient shading (darker toward the fold crease)
    flap_shade = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fsh = ImageDraw.Draw(flap_shade)
    for i in range(14):
        t = i / 14
        off = int(FOLD * t)
        fsh.polygon([(x1 - off, y0 + FOLD - off), (x1 - FOLD, y0 + FOLD), (x1 - FOLD + off, y0 + FOLD)],
                    fill=(120, 155, 160, int(5 + t * 4)))
    flap = Image.alpha_composite(flap, flap_shade.filter(ImageFilter.GaussianBlur(3)))
    flap_mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(flap_mask).polygon([(x1 - FOLD, y0), (x1 - FOLD, y0 + FOLD), (x1, y0 + FOLD)], fill=255)
    flap.putalpha(flap_mask)

    paper = Image.alpha_composite(paper, cut_layer)
    paper = Image.alpha_composite(paper, flap)

    # --- crease shadow under the fold onto the face
    crease = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cd = ImageDraw.Draw(crease)
    for i in range(10):
        off = int(S * 0.006 * (i + 1))
        cd.line([(x1 - FOLD + off // 2, y0 + FOLD - off), (x1 - off, y0 + off)],
                fill=(90, 120, 126, 26), width=int(S * 0.004))
    crease = crease.filter(ImageFilter.GaussianBlur(int(S * 0.004)))
    crease_mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(crease_mask).polygon([(x1 - FOLD, y0), (x1 - FOLD, y0 + FOLD), (x1, y0),
                                         (x1 - FOLD, y0 + FOLD)][:3] + [(x1, y0)], fill=255)
    crease.putalpha(Image.composite(crease.getchannel("A"), Image.new("L", (S, S), 0), face_mask))
    paper = Image.alpha_composite(paper, crease)

    # --- text lines with emboss (dark bar + light offset underneath)
    ld = ImageDraw.Draw(paper)
    teal = (13, 148, 136, 255)
    teal_dark = (10, 120, 111, 255)
    lh = int(S * 0.030)
    lines = [(0.385, 0.255), (0.475, 0.255), (0.565, 0.160)]
    for idx, (y, w) in enumerate(lines):
        lx0 = x0 + int(S * 0.070)
        bar = [lx0, int(S * (y - 0.0165)), lx0 + int(S * w), int(S * (y + 0.0165))]
        ld.rounded_rectangle([bar[0], bar[1] + int(S*0.004), bar[2], bar[3] + int(S*0.004)],
                             radius=lh // 2, fill=(255, 255, 255, 200))       # emboss light
        ld.rounded_rectangle(bar, radius=lh // 2,
                             fill=(teal_dark if idx == 0 else teal))

    # --- checklist badge: gradient circle + white check + tiny shadow
    bx, by, br = x0 + int(S * 0.095), int(S * 0.668), int(S * 0.052)
    ld.ellipse([bx - br + 4, by - br + 6, bx + br + 4, by + br + 6], fill=(60, 95, 95, 60))
    badge = vgrad((br * 2, br * 2), (24, 190, 176), (10, 128, 119))
    badge_mask = Image.new("L", (br * 2, br * 2), 0)
    ImageDraw.Draw(badge_mask).ellipse([0, 0, br * 2 - 1, br * 2 - 1], fill=255)
    badge.putalpha(badge_mask)
    paper.alpha_composite(badge, (bx - br, by - br))
    ld = ImageDraw.Draw(paper)
    lw = int(S * 0.016)
    ld.line([(bx - br*0.42, by + br*0.05), (bx - br*0.10, by + br*0.42), (bx + br*0.48, by - br*0.34)],
            fill=(255, 255, 255, 255), width=lw, joint="curve")
    # label bar next to badge
    ld.rounded_rectangle([x0 + int(S*0.175), int(S*0.6515), x0 + int(S*0.175) + int(S*0.190), int(S*0.6845)],
                         radius=lh // 2, fill=teal)

    # --- slight tilt for dynamic 3D feel
    paper = paper.rotate(-4, resample=Image.BICUBIC, expand=False)

    return shadow, paper

# ---------------------------------------------------------------- sheen
def build_sheen(mask):
    sheen = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    for y in range(int(S * 0.56)):
        a = int(36 * (1 - y / (S * 0.56)) ** 1.3)
        sd.line([(0, y), (S, y)], fill=(255, 255, 255, a))
    sheen.putalpha(Image.composite(sheen.getchannel("A"), Image.new("L", (S, S), 0), mask))
    return sheen

def main():
    os.makedirs(OUT, exist_ok=True)
    tile, mask = build_tile()
    shadow, paper = build_page()
    sheen = build_sheen(mask)

    icon = Image.alpha_composite(tile, shadow)
    icon = Image.alpha_composite(icon, paper)
    icon = Image.alpha_composite(icon, sheen)

    for size in SIZES:
        icon.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, SIZE_NAMES[size]))
        if size == 512:
            icon.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, "512x512.png"))
    print("3D icons written:", SIZES)

if __name__ == "__main__":
    main()
