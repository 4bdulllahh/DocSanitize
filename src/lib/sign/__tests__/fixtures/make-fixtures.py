# Test fixtures for src/lib/sign: certificate files, and PDFs signed by pyHanko (an independent signer).
# Usage (in a virtualenv with pyhanko installed): python make-fixtures.py <this folder> <an unsigned 2-page PDF>
import sys, datetime
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, ec
from cryptography.hazmat.primitives.serialization import pkcs12, PrivateFormat
from cryptography.hazmat.primitives.serialization.pkcs12 import PBES

out = Path(sys.argv[1]); pdf_in = Path(sys.argv[2])
PW = b"fixture"
now = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)

def name(cn, o=None, email=None):
    parts = [x509.NameAttribute(NameOID.COUNTRY_NAME, "DE")]
    if o: parts.append(x509.NameAttribute(NameOID.ORGANIZATION_NAME, o))
    parts.append(x509.NameAttribute(NameOID.COMMON_NAME, cn))
    if email: parts.append(x509.NameAttribute(NameOID.EMAIL_ADDRESS, email))
    return x509.Name(parts)

def cert(subject, key, issuer_name, issuer_key, ca, years=10):
    b = (x509.CertificateBuilder().subject_name(subject).issuer_name(issuer_name).public_key(key.public_key())
         .serial_number(x509.random_serial_number()).not_valid_before(now).not_valid_after(now + datetime.timedelta(days=365 * years))
         .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
         .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False))
    if not ca:
        b = b.add_extension(x509.KeyUsage(True, True, False, False, False, False, False, False, False), critical=True)
    else:
        b = b.add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
    return b.sign(issuer_key, hashes.SHA256())

root_key = rsa.generate_private_key(65537, 3072)
root = cert(name("Fixture Root CA", "Fixture Trust"), root_key, name("Fixture Root CA", "Fixture Trust"), root_key, True, 20)
leaf_key = rsa.generate_private_key(65537, 2048)
leaf = cert(name("Max Mustermann", "Muster GmbH", "max@example.com"), leaf_key, root.subject, root_key, False, 5)
ec_key = ec.generate_private_key(ec.SECP256R1())
ec_cert = cert(name("Erika EC"), ec_key, name("Erika EC"), ec_key, False)

modern = serialization.BestAvailableEncryption(PW)
legacy = PrivateFormat.PKCS12.encryption_builder().kdf_rounds(2048).key_cert_algorithm(PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(PW)
(out / "chain-aes.p12").write_bytes(pkcs12.serialize_key_and_certificates(b"max", leaf_key, leaf, [root], modern))
(out / "legacy-3des.p12").write_bytes(pkcs12.serialize_key_and_certificates(b"max", leaf_key, leaf, [root], legacy))
(out / "ec-p256.p12").write_bytes(pkcs12.serialize_key_and_certificates(b"erika", ec_key, ec_cert, None, modern))
(out / "root.der").write_bytes(root.public_bytes(serialization.Encoding.DER))

from pyhanko.sign import signers
from pyhanko.sign.fields import SigFieldSpec
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.keys import load_cert_from_pemder
import io
def pysign(p12name, field, box, reason, outname):
    s = signers.SimpleSigner.load_pkcs12(str(out / p12name), passphrase=PW)
    w = IncrementalPdfFileWriter(io.BytesIO(pdf_in.read_bytes()))
    res = signers.sign_pdf(w, signers.PdfSignatureMetadata(field_name=field, reason=reason, location="Berlin"), signer=s,
                           new_field_spec=SigFieldSpec(field, on_page=0, box=box) if box else None)
    (out / outname).write_bytes(res.getvalue())
pysign("chain-aes.p12", "MaxSig", (300, 60, 520, 120), "Genehmigt", "pyhanko-rsa.pdf")
pysign("ec-p256.p12", "ErikaSig", None, "Reviewed", "pyhanko-ec.pdf")
print("fixtures written")
