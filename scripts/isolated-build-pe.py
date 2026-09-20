#!/usr/bin/env python3
"""Read actual PE resource version; never execute the Windows binary."""
import json
import pefile
import sys

for filename in sys.argv[1:]:
    pe = pefile.PE(filename)
    fixed = pe.VS_FIXEDFILEINFO[0]
    version = [fixed.FileVersionMS >> 16, fixed.FileVersionMS & 65535, fixed.FileVersionLS >> 16, fixed.FileVersionLS & 65535]
    product = [fixed.ProductVersionMS >> 16, fixed.ProductVersionMS & 65535, fixed.ProductVersionLS >> 16, fixed.ProductVersionLS & 65535]
    print(json.dumps({'file': filename, 'machine': hex(pe.FILE_HEADER.Machine), 'fileVersion': version, 'productVersion': product}))
    assert version == [1, 5, 5, 0], version
    assert product == [1, 5, 5, 0], product
