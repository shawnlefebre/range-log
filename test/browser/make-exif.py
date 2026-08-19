# Builds a tiny valid JPEG carrying an EXIF DateTimeOriginal, so the EXIF path can be
# tested for real rather than by poking the date field directly.
import struct, sys, io

def exif_app1(dt):  # dt like "2026:05:14 09:30:00"
    val = dt.encode() + b'\x00'
    # TIFF header (little-endian), IFD0 with one entry: ExifIFDPointer -> ExifIFD
    tiff = b'II' + struct.pack('<HI', 42, 8)
    ifd0 = struct.pack('<H', 1) + struct.pack('<HHII', 0x8769, 4, 1, 26) + struct.pack('<I', 0)
    # ExifIFD at offset 26: one entry, DateTimeOriginal (ASCII), value stored after the IFD
    val_off = 26 + 2 + 12 + 4
    exif_ifd = struct.pack('<H', 1) + struct.pack('<HHII', 0x9003, 2, len(val), val_off) + struct.pack('<I', 0)
    body = tiff + ifd0 + exif_ifd + val
    payload = b'Exif\x00\x00' + body
    return b'\xff\xe1' + struct.pack('>H', len(payload) + 2) + payload

# Minimal 1x1 grey JPEG, with the APP1 segment spliced in right after SOI.
base = bytes.fromhex(
    'ffd8ffdb004300ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc000'
    '0b080001000101011100ffc40014000100000000000000000000000000000003ffda000801010000'
    '3f00d2cf20ffd9')
out = base[:2] + exif_app1(sys.argv[2]) + base[2:]
open(sys.argv[1], 'wb').write(out)
print(f'wrote {sys.argv[1]} with DateTimeOriginal {sys.argv[2]}')
