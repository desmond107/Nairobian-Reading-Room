"""Builds book-shaped PDFs that exercise the extractor's hard cases."""
import io, os, random, textwrap
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tests', 'fixtures')
os.makedirs(OUT, exist_ok=True)
W, H = letter

PROSE = [
 "The rains came late that year, and the whole valley waited for them with the patience of people who have waited before.",
 "Nobody in the settlement said so aloud, but the elders had begun to measure the grain differently, and the children noticed.",
 "It was a small thing, the way a hand hesitates over a measure, and yet it travelled through the households faster than any announcement.",
 "By the second week of the dry spell the river had narrowed to a bright thread, and the women walked further each morning to reach it.",
 "Ndungu kept the ledger, as his father had, in a book whose spine had been repaired three times with the same waxed thread.",
 "He wrote in a hand so small that the pages seemed to contain no writing at all until you brought a lamp close to them.",
 "Everything in the settlement passed through those pages eventually: the debts, the marriages, the goats sold at the crossroads market.",
 "“You write too much,” his wife told him, not unkindly, and he answered that a thing unwritten is a thing already half forgotten.",
 "The truth was more ordinary. He wrote because the writing steadied him, the way other men were steadied by walking or by prayer.",
 "In the fourth month the rains arrived all at once, without ceremony, and washed a section of the eastern road entirely away.",
 "Afterwards there was the usual argument about whether the road had been badly built or merely badly maintained—a distinction that mattered enormously to the two men who had built it.",
 "The government surveyor came in a truck the colour of dust and stayed three days, measuring things that everyone already knew the size of.",
]

def wrap_line(c, text, font, size, width):
    """Greedy wrap that hyphenates a word when it saves the line."""
    c.setFont(font, size)
    words, lines, cur = text.split(), [], ''
    for w in words:
        trial = (cur + ' ' + w).strip()
        if c.stringWidth(trial, font, size) <= width:
            cur = trial
            continue
        # Try to split the word so the line reaches the margin, as a typesetter would.
        if len(w) > 7 and cur:
            for cut in range(len(w) - 3, 2, -1):
                piece = cur + ' ' + w[:cut] + '-'
                if c.stringWidth(piece, font, size) <= width:
                    lines.append(piece)
                    cur = w[cut:]
                    break
            else:
                lines.append(cur); cur = w
        else:
            lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

# ---------------------------------------------------------------- novel
def novel_with_outline(path, chapters=6, pages_per_chapter=4):
    """A single-column novel: running heads, folios, hyphenation, an outline."""
    c = canvas.Canvas(path, pagesize=letter)
    c.setTitle("The Ledger of Small Rains")
    c.setAuthor("A. Wanjiru")
    random.seed(7)
    names = ["ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE","TEN",
             "ELEVEN","TWELVE","THIRTEEN","FOURTEEN","FIFTEEN","SIXTEEN","SEVENTEEN",
             "EIGHTEEN","NINETEEN","TWENTY","TWENTY-ONE","TWENTY-TWO","TWENTY-THREE",
             "TWENTY-FOUR","TWENTY-FIVE"]
    titles = ["The Ledger","Dry Season","The Surveyor","A Repaired Spine","The Eastern Road",
              "What Was Measured","The Crossroads","Waxed Thread","A Bright Thread","The Measure",
              "Grain","The Truck","Three Days","The Households","Lamp Light","The Debts",
              "Goats at Market","The Argument","Badly Built","Badly Kept","The Return",
              "Small Rains","The Repair","What the Elders Knew","The Last Page"]
    page_no = 0
    outline = []
    for ch in range(chapters):
        for p in range(pages_per_chapter):
            page_no += 1
            y = H - 96
            if p == 0:
                c.setFont("Times-Bold", 22)
                c.drawCentredString(W/2, y, "CHAPTER %s" % names[ch]); y -= 34
                c.setFont("Times-Italic", 13)
                c.drawCentredString(W/2, y, titles[ch]); y -= 40
                c.bookmarkPage("ch%d" % ch, fit="XYZ", top=H)
                outline.append(("Chapter %s: %s" % (names[ch], titles[ch]), "ch%d" % ch))
            else:
                c.setFont("Times-Italic", 9)
                if page_no % 2 == 0: c.drawString(72, H - 54, "THE LEDGER OF SMALL RAINS")
                else: c.drawRightString(W - 72, H - 54, "CHAPTER %s" % names[ch])
            while y > 96:
                para = PROSE[random.randrange(len(PROSE))]
                lines = wrap_line(c, para, "Times-Roman", 11.5, W - 144)
                first = True
                for ln in lines:
                    if y <= 96: break
                    c.setFont("Times-Roman", 11.5)
                    c.drawString(72 + (14 if first else 0), y, ln)
                    first = False; y -= 15.5
                y -= 5
            c.setFont("Times-Roman", 9.5)
            c.drawCentredString(W/2, 54, str(page_no))
            c.showPage()
    for title, key in outline:
        c.addOutlineEntry(title, key, level=0)
    c.showOutline()
    c.save()

# ------------------------------------------------------------- journal
def journal(path, pages=8):
    c = canvas.Canvas(path, pagesize=letter)
    c.setTitle("Rainfall Variability and Grain Reserves")
    c.setAuthor("M. Otieno and P. Kamau")
    random.seed(11)
    col_w = (W - 144 - 24) / 2
    note_counter = 1
    for pg in range(1, pages + 1):
        c.setFont("Helvetica", 8)
        c.drawString(72, H - 50, "JOURNAL OF EAST AFRICAN ECONOMIC HISTORY")
        c.drawRightString(W - 72, H - 50, "VOL. 12, NO. 3")
        c.setFont("Helvetica", 8.5)
        c.drawCentredString(W/2, 46, "%d" % (pg + 240))

        top = H - 80
        if pg == 1:
            c.setFont("Helvetica-Bold", 17)
            c.drawCentredString(W/2, top, "Rainfall Variability and Grain Reserves")
            top -= 24
            c.setFont("Helvetica", 10)
            c.drawCentredString(W/2, top, "M. Otieno and P. Kamau")
            top -= 30

        note_lines = []
        for col in range(2):
            x = 72 + col * (col_w + 24)
            y = top
            floor = 120
            if pg == 3 and col == 1:
                # A table: wide gaps between cells and mostly numeric rows.
                c.setFont("Helvetica-Bold", 9)
                c.drawString(x, y, "Table 2. Reserve levels by district, 1961-1968.")
                y -= 16
                headers = ["District", "1961", "1964", "1968"]
                rows = [["Kiambu","412","388","501"],["Nyeri","298","310","277"],
                        ["Machakos","150","142","166"],["Kisumu","505","498","540"],
                        ["Nakuru","377","401","392"]]
                for r in [headers] + rows:
                    c.setFont("Helvetica" if r is not headers else "Helvetica-Bold", 8.5)
                    for i, cell in enumerate(r):
                        c.drawString(x + i * (col_w / 4), y, cell)
                    y -= 12
                y -= 10
            while y > floor:
                para = PROSE[random.randrange(len(PROSE))]
                mark = ''
                if random.random() < 0.35 and note_counter <= 3 * pg:
                    mark = str(note_counter)
                lines = wrap_line(c, para, "Times-Roman", 9.8, col_w)
                for i, ln in enumerate(lines):
                    if y <= floor: break
                    c.setFont("Times-Roman", 9.8)
                    c.drawString(x + (10 if i == 0 else 0), y, ln)
                    if mark and i == len(lines) - 1:
                        # Superscript note marker: smaller and raised.
                        c.setFont("Times-Roman", 6.2)
                        c.drawString(x + c.stringWidth(ln, "Times-Roman", 9.8) + 0.5, y + 4, mark)
                        note_lines.append((mark, "See %s, Reserve Bulletin, pages %d-%d." % (
                            ["Otieno","Kamau","Wanjiru","Njoroge"][int(mark) % 4], 10 + int(mark), 20 + int(mark))))
                        note_counter += 1
                        mark = ''
                    y -= 12.6
                y -= 4
        # Footnote apparatus: a rule, then smaller type at the foot of the page.
        if note_lines:
            c.setLineWidth(0.5)
            c.line(72, 112, 72 + col_w * 0.6, 112)
            ny = 100
            for mark, text in note_lines:
                c.setFont("Times-Roman", 7.6)
                for j, ln in enumerate(wrap_line(c, "%s. %s" % (mark, text), "Times-Roman", 7.6, W - 144)):
                    c.drawString(72, ny, ln); ny -= 9.4
        c.showPage()
    c.save()

# ----------------------------------------------------------- encrypted
def locked(path):
    from reportlab.lib import pdfencrypt
    enc = pdfencrypt.StandardEncryption("swahili", canPrint=1)
    c = canvas.Canvas(path, pagesize=letter, encrypt=enc)
    c.setTitle("Locked Report")
    for pg in range(3):
        c.setFont("Times-Roman", 12)
        y = H - 100
        for ln in wrap_line(c, ' '.join(PROSE[:4]), "Times-Roman", 12, W - 144):
            c.drawString(72, y, ln); y -= 16
        c.showPage()
    c.save()

# -------------------------------------------------------------- scanned
def scanned(path, pages=3):
    """Pages that are photographs of text: no text layer at all."""
    c = canvas.Canvas(path, pagesize=letter)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Times New Roman.ttf", 30)
    except Exception:
        font = ImageFont.load_default(30)
    for pg in range(pages):
        img = Image.new("RGB", (1275, 1650), "white")
        d = ImageDraw.Draw(img)
        y = 180
        d.text((150, 90), "CHAPTER %d" % (pg + 1), fill="black", font=font)
        for para in PROSE[pg*3:(pg*3)+4]:
            for ln in textwrap.wrap(para, 52):
                d.text((150, y), ln, fill="black", font=font)
                y += 46
            y += 20
        buf = io.BytesIO(); img.save(buf, format="PNG"); buf.seek(0)
        c.drawImage(ImageReader(buf), 0, 0, width=W, height=H)
        c.showPage()
    c.save()

novel_with_outline(os.path.join(OUT, 'novel.pdf'))
# A full-length book, for the memory and throughput check.
novel_with_outline(os.path.join(OUT, 'novel-300.pdf'), chapters=25, pages_per_chapter=12)
journal(os.path.join(OUT, 'journal.pdf'))
locked(os.path.join(OUT, 'locked.pdf'))
scanned(os.path.join(OUT, 'scanned.pdf'))
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)), 'bytes')
