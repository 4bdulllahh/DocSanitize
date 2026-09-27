"""Regenerate the encrypted test PDFs with an independent encryptor (pypdf).

pdf-lib can't produce these: its encrypt() leaves strings outside object streams
in plain text, while real-world tools (Acrobat, Word, qpdf) encrypt every string.

    node src/lib/pdf/__tests__/encrypted/base.mjs        # writes base.pdf
    pip install pypdf cryptography
    python src/lib/pdf/__tests__/encrypted/make-fixtures.py
"""
from pathlib import Path
from pypdf import PdfReader, PdfWriter

here = Path(__file__).parent
variants = {
    "aes256.pdf": dict(user_password="open sesame", owner_password="boss", algorithm="AES-256"),
    "aes128.pdf": dict(user_password="open sesame", owner_password="boss", algorithm="AES-128"),
    "rc4.pdf": dict(user_password="open sesame", owner_password="boss", algorithm="RC4-128"),
    # No password to open; the owner password only restricts printing/copying.
    "owner-only.pdf": dict(user_password="", owner_password="boss", algorithm="AES-256", permissions_flag=0),
}
for name, options in variants.items():
    writer = PdfWriter(clone_from=PdfReader(here / "base.pdf"))
    writer.encrypt(**options)
    with open(here / name, "wb") as f:
        writer.write(f)
    print("wrote", name)
