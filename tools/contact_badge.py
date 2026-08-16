#!/usr/bin/env python3
# Контактная плашка akov.tech для презентаций: PNG с прозрачными краями.
# Два варианта размещения: left (плашка слева на слайде, взгляд вправо)
#                          right (плашка справа, взгляд влево).
# Дизайн — «увеличенная фавиконка»: тёмная скруглённая плита #111, три фирменных
# квадрата по углам, URL моноширинным Menlo (https:// приглушённым), QR с цветными
# «глазами». Шрифт имени выбирается из NAME_FONTS (запуск: contact_badge.py [ключ]).
import sys
import qrcode
from PIL import Image, ImageDraw, ImageFont

ROOT = "/Users/arrivarus/Documents/VibeCoding2/2026.06 AKov.tech"
SS = 3  # суперсэмплинг: рисуем в 3x, в конце уменьшаем — гладкие круги и углы

# --- палитра (фавиконочные осветлённые цвета для тёмного фона) ---
PLATE = (17, 17, 17, 255)          # #111
WHITE = (255, 255, 255, 255)
MUTED = (150, 150, 150, 255)
RING = (47, 47, 47, 255)
SQ_BLUE, SQ_ORANGE, SQ_GREEN = (35, 163, 255, 255), (255, 138, 30, 255), (76, 255, 126, 255)
# чернильные варианты для QR-финдеров на белом (контраст для сканера)
INK_BLUE, INK_ORANGE, INK_GREEN = (6, 114, 207, 255), (192, 90, 16, 255), (23, 138, 67, 255)
INK = (17, 17, 17, 255)

# --- геометрия (финальные пиксели; при отрисовке умножаются на SS) ---
PAD = 58            # поля плиты
AV = 360            # диаметр круга с фото
GAP = 56            # горизонтальные промежутки между блоками
RADIUS = 44         # скругление плиты
SQ = 26             # фирменный квадрат
SQ_INSET = 24
URL_SIZE = 64
TEXT_GAP = 22       # между именем и URL
MODULE = 10         # пиксель модуля QR
QUIET = 3           # тихая зона, в модулях
QR_RADIUS = 22      # скругление белой плитки QR
MARGIN = 12         # прозрачное поле вокруг плиты

NAME = "АЛЕКСЕЙ КОВАЛЕВ"
URL_SCHEME = "https://"
URL_DOMAIN = "akov.tech"
QR_DATA = "https://akov.tech"

def ttc(path, family, style, size):
    for i in range(24):
        try:
            f = ImageFont.truetype(path, size, index=i)
        except Exception:
            break
        if f.getname() == (family, style):
            return f
    raise RuntimeError(f"нет {family} {style} в {path}")

def sf(variation, size):
    f = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", size)
    f.set_variation_by_name(variation)
    return f

def draw_justified(dr, xy, s, fonts, colors, target_w):
    """Строка, растянутая межбуквенными зазорами точно до target_w (SS-пиксели).
    fonts/colors — по символу (список той же длины, что s)."""
    base_w = int(sum(fonts[i].getlength(c) for i, c in enumerate(s)))
    extra = (target_w - base_w) / max(len(s) - 1, 1)
    x, y = float(xy[0]), xy[1]
    for i, c in enumerate(s):
        dr.text((round(x), y), c, font=fonts[i], fill=colors[i])
        x += fonts[i].getlength(c) + extra

# ключ -> (загрузчик шрифта имени, размер, трекинг между буквами)
NAME_FONTS = {
    "arial-black": (lambda s: ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Black.ttf", s), 52, 0),
    "helvetica-ultralight": (lambda s: ttc("/System/Library/Fonts/HelveticaNeue.ttc", "Helvetica Neue", "UltraLight", s), 60, 8),
    "helvetica-light": (lambda s: ttc("/System/Library/Fonts/HelveticaNeue.ttc", "Helvetica Neue", "Light", s), 56, 6),
    "sf-thin": (lambda s: sf("Thin", s), 58, 7),
    "avenir-ultralight": (lambda s: ttc("/System/Library/Fonts/Avenir Next.ttc", "Avenir Next", "Ultra Light", s), 58, 8),
    "menlo": (lambda s: ttc("/System/Library/Fonts/Menlo.ttc", "Menlo", "Regular", s), 46, 2),
}

F_URL_BOLD = ttc("/System/Library/Fonts/Menlo.ttc", "Menlo", "Bold", URL_SIZE * SS)
F_URL_REG = ttc("/System/Library/Fonts/Menlo.ttc", "Menlo", "Regular", URL_SIZE * SS)

def text_size(font, s):
    l, t, r, b = font.getbbox(s)
    return r - l, b - t, l, t

def tracked_width(font, s, tr):
    return int(sum(font.getlength(c) for c in s)) + tr * SS * (len(s) - 1)

def draw_tracked(dr, xy, s, font, tr, fill):
    x, y = xy
    for c in s:
        dr.text((x, y), c, font=font, fill=fill)
        x += font.getlength(c) + tr * SS

# --- фото: квадратный кроп головы с микрофоном из оригинала (смотрит влево) ---
CROP_BOX = (185, 45, 735, 595)  # x0, y0, x1, y1 в координатах IMG_2973.JPG

def avatar_circle(mirror):
    im = Image.open(f"{ROOT}/assets/IMG_2973.JPG").convert("RGB").crop(CROP_BOX)
    if mirror:  # зеркалим: взгляд вправо (вариант для левого края слайда)
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    d = AV * SS
    im = im.resize((d, d), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (d, d), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, d - 1, d - 1), fill=255)
    im.putalpha(mask)
    return im

# --- QR: матрица через qrcode, модули рисуем сами ---
def qr_tile():
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, border=0)
    q.add_data(QR_DATA)
    q.make(fit=True)
    m = q.get_matrix()
    n = len(m)
    tile = (n + 2 * QUIET) * MODULE
    img = Image.new("RGBA", (tile * SS, tile * SS), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    dr.rounded_rectangle((0, 0, tile * SS - 1, tile * SS - 1), radius=QR_RADIUS * SS, fill=WHITE)
    ms = MODULE * SS
    r = int(ms * 0.28)
    def in_finder(row, col):
        return (row < 7 and col < 7) or (row < 7 and col >= n - 7) or (row >= n - 7 and col < 7)
    for row in range(n):
        for col in range(n):
            if not m[row][col] or in_finder(row, col):
                continue
            x = (QUIET + col) * ms
            y = (QUIET + row) * ms
            dr.rounded_rectangle((x, y, x + ms - 1, y + ms - 1), radius=r, fill=INK)
    # три «глаза» в фирменных цветах: кольцо 7×7 + сплошной центр 3×3
    def finder(row0, col0, color):
        x, y = (QUIET + col0) * ms, (QUIET + row0) * ms
        dr.rounded_rectangle((x, y, x + 7 * ms - 1, y + 7 * ms - 1),
                             radius=int(ms * 1.15), outline=color, width=ms)
        dr.rounded_rectangle((x + 2 * ms, y + 2 * ms, x + 5 * ms - 1, y + 5 * ms - 1),
                             radius=int(ms * 0.7), fill=color)
    finder(0, 0, INK_BLUE)
    finder(0, n - 7, INK_GREEN)
    finder(n - 7, 0, INK_ORANGE)
    return img, tile

def make_badge(side, font_key, out_path):
    f_load, f_size, tracking = NAME_FONTS[font_key]
    f_name = f_load(f_size * SS)
    av = avatar_circle(mirror=(side == "left"))
    qr, qr_tile_px = qr_tile()

    name_w = tracked_width(f_name, NAME, tracking)
    scheme_w = int(F_URL_REG.getlength(URL_SCHEME))
    domain_w, _, _, _ = text_size(F_URL_BOLD, URL_DOMAIN)
    url_w = scheme_w + domain_w
    text_w = max(name_w, url_w) // SS

    plate_w = PAD + AV + GAP + text_w + GAP + qr_tile_px + PAD
    plate_h = max(PAD + AV + PAD, PAD + qr_tile_px + PAD)

    W, H = (plate_w + 2 * MARGIN) * SS, (plate_h + 2 * MARGIN) * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    px, py = MARGIN * SS, MARGIN * SS
    dr.rounded_rectangle((px, py, px + plate_w * SS - 1, py + plate_h * SS - 1),
                         radius=RADIUS * SS, fill=PLATE)

    # три фирменных квадрата по углам — как на фавиконке
    def square(cx, cy, color):
        dr.rectangle((cx, cy, cx + SQ * SS - 1, cy + SQ * SS - 1), fill=color)
    square(px + SQ_INSET * SS, py + (plate_h - SQ_INSET - SQ) * SS, SQ_BLUE)
    square(px + (plate_w - SQ_INSET - SQ) * SS, py + (plate_h - SQ_INSET - SQ) * SS, SQ_ORANGE)
    square(px + (plate_w - SQ_INSET - SQ) * SS, py + SQ_INSET * SS, SQ_GREEN)

    av_y = py + ((plate_h - AV) // 2) * SS
    qr_y = py + ((plate_h - qr_tile_px) // 2) * SS
    if side == "left":
        av_x = px + PAD * SS
        text_x = px + (PAD + AV + GAP) * SS
        qr_x = px + (plate_w - PAD - qr_tile_px) * SS
        align_right = False
    else:
        qr_x = px + PAD * SS
        text_x = px + (PAD + qr_tile_px + GAP) * SS
        av_x = px + (plate_w - PAD - AV) * SS
        align_right = True

    dr.ellipse((av_x - 2 * SS, av_y - 2 * SS, av_x + (AV + 2) * SS, av_y + (AV + 2) * SS),
               outline=RING, width=3 * SS)
    img.paste(av, (av_x, av_y), av)

    # имя + URL, вертикально по центру плиты
    _, nh, nl, nt = text_size(f_name, NAME)
    _, uh, ul, ut = text_size(F_URL_BOLD, URL_SCHEME + URL_DOMAIN)
    block_h = nh + TEXT_GAP * SS + uh
    ty = py + (plate_h * SS - block_h) // 2
    zone_w = text_w * SS
    nx = text_x + (zone_w - name_w if align_right else 0) - nl
    ux = text_x + (zone_w - url_w if align_right else 0) - ul
    draw_tracked(dr, (nx, ty - nt), NAME, f_name, tracking, WHITE)
    uy = ty + nh + TEXT_GAP * SS - ut
    dr.text((ux, uy), URL_SCHEME, font=F_URL_REG, fill=MUTED)
    dr.text((ux + scheme_w, uy), URL_DOMAIN, font=F_URL_BOLD, fill=WHITE)

    img.paste(qr, (qr_x, qr_y), qr)

    out = img.resize((W // SS, H // SS), Image.LANCZOS)
    out.save(out_path, optimize=True)
    print(f"{out_path}: {out.size[0]}x{out.size[1]}")

def make_vertical(side, font_key, out_path):
    """Вертикальная плашка: фото → локап (АЛЕКСЕЙ / КОВАЛЕВ / URL одной ширины) → QR.
    Все три строки подгоняются попиксельно: ширину задаёт более широкая строка имени,
    вторая строка имени добирается разрядкой, URL — конденсированным SF + разрядкой."""
    f_load, _, tracking = NAME_FONTS[font_key]
    f_name = f_load(48 * SS)
    av = avatar_circle(mirror=(side == "left"))
    qr, qr_tile_px = qr_tile()

    plate_w = PAD + AV + PAD

    line1, line2 = NAME.split(" ", 1)
    master_w = qr_tile_px * SS  # эталон ширины — QR-плитка: текст и QR флашево

    # URL: максимальный размер конденсированного, не шире эталона; остаток — в зазоры
    url = URL_SCHEME + URL_DOMAIN
    url_size = 90
    while url_size > 20:
        fr = sf("Condensed Regular", url_size * SS)
        fb = sf("Condensed Semibold", url_size * SS)
        u_fonts = [fr if i < len(URL_SCHEME) else fb for i in range(len(url))]
        base_w = int(sum(u_fonts[i].getlength(c) for i, c in enumerate(url)))
        if base_w <= master_w:
            break
        url_size -= 1

    _, h1, _, t1 = text_size(f_name, line1)
    _, h2, _, t2 = text_size(f_name, line2)
    _, uh, _, ut = text_size(fb, url)

    G_AV, G_NAME, G_URL, G_QR = 38, 10, 26, 38  # вертикальные промежутки
    plate_h = PAD + AV + G_AV + h1 // SS + G_NAME + h2 // SS + G_URL + uh // SS + G_QR + qr_tile_px + PAD

    W, H = (plate_w + 2 * MARGIN) * SS, (plate_h + 2 * MARGIN) * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    px, py = MARGIN * SS, MARGIN * SS
    dr.rounded_rectangle((px, py, px + plate_w * SS - 1, py + plate_h * SS - 1),
                         radius=RADIUS * SS, fill=PLATE)

    def square(cx, cy, color):
        dr.rectangle((cx, cy, cx + SQ * SS - 1, cy + SQ * SS - 1), fill=color)
    square(px + SQ_INSET * SS, py + (plate_h - SQ_INSET - SQ) * SS, SQ_BLUE)
    square(px + (plate_w - SQ_INSET - SQ) * SS, py + (plate_h - SQ_INSET - SQ) * SS, SQ_ORANGE)
    square(px + (plate_w - SQ_INSET - SQ) * SS, py + SQ_INSET * SS, SQ_GREEN)

    cx = px + (plate_w * SS) // 2  # ось симметрии
    y = py + PAD * SS
    av_x = cx - (AV * SS) // 2
    dr.ellipse((av_x - 2 * SS, y - 2 * SS, av_x + (AV + 2) * SS, y + (AV + 2) * SS),
               outline=RING, width=3 * SS)
    img.paste(av, (av_x, y), av)
    y += AV * SS + G_AV * SS

    # локап: обе строки имени и URL выровнены в одну ширину master_w
    lx = cx - master_w // 2
    _, _, l1, _ = text_size(f_name, line1)
    _, _, l2, _ = text_size(f_name, line2)
    _, _, lu, _ = text_size(fb, url)
    n = len(line1)
    draw_justified(dr, (lx - l1, y - t1), line1, [f_name] * n, [WHITE] * n, master_w)
    y += h1 + G_NAME * SS
    n = len(line2)
    draw_justified(dr, (lx - l2, y - t2), line2, [f_name] * n, [WHITE] * n, master_w)
    y += h2 + G_URL * SS

    u_colors = [MUTED if i < len(URL_SCHEME) else WHITE for i in range(len(url))]
    draw_justified(dr, (lx - lu, y - ut), url, u_fonts, u_colors, master_w)
    y += uh + G_QR * SS

    img.paste(qr, (cx - (qr_tile_px * SS) // 2, y), qr)

    out = img.resize((W // SS, H // SS), Image.LANCZOS)
    out.save(out_path, optimize=True)
    print(f"{out_path}: {out.size[0]}x{out.size[1]} (url {url_size}px)")

if __name__ == "__main__":
    keys = sys.argv[1:] or ["arial-black"]
    if keys == ["sampler"]:  # по одному левому образцу на каждый шрифт
        for k in NAME_FONTS:
            make_badge("left", k, f"{ROOT}/promo/font-variants/{k}.png")
    else:
        for k in keys:
            make_badge("left", k, f"{ROOT}/promo/contact-left.png")
            make_badge("right", k, f"{ROOT}/promo/contact-right.png")
            make_vertical("left", k, f"{ROOT}/promo/contact-vertical-left.png")
            make_vertical("right", k, f"{ROOT}/promo/contact-vertical-right.png")
