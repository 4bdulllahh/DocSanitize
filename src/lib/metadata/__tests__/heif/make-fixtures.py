"""Writes the HEIC and AVIF fixtures used by metadata.test.ts.

Needs Python 3 with `pip install pillow-heif "pillow>=11.3"` (Pillow 11.3+ writes AVIF).
Each file is a small gradient photo carrying the kinds of metadata a phone adds: camera make,
model and serial number, dates, software, GPS, an XMP creator and (HEIC) a thumbnail, plus
technical camera settings that "keep technical data" must preserve.
"""
from pathlib import Path

import pillow_heif
from PIL import Image

pillow_heif.register_heif_opener()
here = Path(__file__).parent

XMP = (
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Jane Doe</rdf:li>'
    "</rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>"
).encode()


def photo() -> Image.Image:
    img = Image.new("RGB", (64, 48))
    img.putdata([(x * 4, y * 5, 128) for y in range(48) for x in range(64)])
    return img


def exif() -> Image.Exif:
    e = Image.Exif()
    e[0x010F] = "Apple"  # Make
    e[0x0110] = "iPhone 15 Pro"  # Model
    e[0x0131] = "17.4"  # Software
    e[0x0132] = "2026:03:14 09:26:53"  # DateTime
    e[0x011A] = 72.0  # XResolution
    e[0x011B] = 72.0  # YResolution
    e[0x0128] = 2  # ResolutionUnit
    ex = e.get_ifd(0x8769)
    ex[0x829A] = 1 / 120  # ExposureTime
    ex[0x829D] = 1.8  # FNumber
    ex[0x8827] = 64  # ISO
    ex[0x920A] = 6.86  # FocalLength
    ex[0xA001] = 1  # ColorSpace
    ex[0x9003] = "2026:03:14 09:26:53"  # DateTimeOriginal
    ex[0xA431] = "F17XK2QJ0D8A"  # BodySerialNumber
    ex[0x9286] = b"ASCII\0\0\0Meet at the harbour"  # UserComment
    gps = e.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (51.0, 30.0, 26.4)
    gps[3] = "W"
    gps[4] = (0.0, 7.0, 39.0)
    return e


img = photo()
img.save(here / "photo.heic", quality=80, exif=exif().tobytes(), xmp=XMP, thumbnails=[16])
img.save(here / "photo.avif", quality=80, exif=exif().tobytes(), xmp=XMP)
print("wrote photo.heic and photo.avif")
