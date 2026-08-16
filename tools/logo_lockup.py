#!/usr/bin/env python3
# Лого-локап akov.tech: «АЛЕКСЕЙ КОВАЛЕВ» (Helvetica Light, разрядка) и под ним
# «https://akov.tech» конденсированным шрифтом (SF Condensed — системный аналог
# Roboto Condensed), подогнанным по ширине к имени ПИКСЕЛЬ В ПИКСЕЛЬ:
# размер подбирается, остаток ширины распределяется по межбуквенным зазорам.
# Два файла: logo-on-dark.png (белый, для тёмных фонов) и logo-on-light.png (тёмный).
from PIL import Image, ImageDraw, ImageFont

ROOT = "/Users/arrivarus/Documents/VibeCoding2/2026.06 AKov.tech"
SS = 3
NAME = "АЛЕКСЕЙ КОВАЛЕВ"
URL_SCHEME = "https://"
URL_DOMAIN = "akov.tech"
NAME_SIZE = 100
NAME_TRACK = 8      # финальных px между буквами имени
GAP = 26            # между строками, финальных px
MARGIN = 20

def ttc(path, family, style, size):
    for i in range(24):
        try:
            f = ImageFont.truetype(path, size, index=i)
        except Exception:
            break
        if f.getname() == (family, style):
            return f
    raise RuntimeError(f"нет {family} {style}")

def sf_cond(variation, size):
    f = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", size)
    f.set_variation_by_name(variation)
    return f

F_NAME = ttc("/System/Library/Fonts/HelveticaNeue.ttc", "Helvetica Neue", "Light", NAME_SIZE * SS)

def tracked_width(font, s, tr):
    return int(sum(font.getlength(c) for c in s)) + tr * SS * (len(s) - 1)

def draw_tracked(dr, xy, s, font, tr, fill):
    x, y = xy
    for c in s:
        dr.text((round(x), y), c, font=font, fill=fill)
        x += font.getlength(c) + tr * SS

def make_logo(out_path, name_color, scheme_color, domain_color):
    name_w = tracked_width(F_NAME, NAME, NAME_TRACK)

    # размер URL: максимальный, при котором строка НЕ шире имени
    url = URL_SCHEME + URL_DOMAIN
    size = 200
    while size > 20:
        fr = sf_cond("Condensed Regular", size * SS)
        fb = sf_cond("Condensed Semibold", size * SS)
        base_w = int(sum((fr if i < len(URL_SCHEME) else fb).getlength(c) for i, c in enumerate(url)))
        if base_w <= name_w:
            break
        size -= 1
    # остаток ширины растворяем в межбуквенных зазорах — правые края совпадут
    extra = (name_w - base_w) / (len(url) - 1)

    lb, tb, rb, bb = F_NAME.getbbox(NAME)
    nh = bb - tb
    ub_l, ub_t, ub_r, ub_b = fb.getbbox(url)
    uh = ub_b - ub_t

    W = name_w + 2 * MARGIN * SS
    H = nh + GAP * SS + uh + 2 * MARGIN * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    x0, y0 = MARGIN * SS, MARGIN * SS

    draw_tracked(dr, (x0 - lb, y0 - tb), NAME, F_NAME, NAME_TRACK, name_color)

    uy = y0 + nh + GAP * SS - ub_t
    x = float(x0 - ub_l)
    for i, c in enumerate(url):
        f = fr if i < len(URL_SCHEME) else fb
        dr.text((round(x), uy), c, font=f, fill=scheme_color if i < len(URL_SCHEME) else domain_color)
        x += f.getlength(c) + extra

    out = img.resize((W // SS, H // SS), Image.LANCZOS)
    out.save(out_path, optimize=True)
    print(f"{out_path}: {out.size[0]}x{out.size[1]} (url {size}px, добор {extra / SS:.2f}px/зазор)")

if __name__ == "__main__":
    WHITE = (255, 255, 255, 255)
    make_logo(f"{ROOT}/promo/logo-on-dark.png", WHITE, (150, 150, 150, 255), WHITE)
    INKD = (17, 17, 17, 255)
    make_logo(f"{ROOT}/promo/logo-on-light.png", INKD, (120, 120, 120, 255), INKD)
