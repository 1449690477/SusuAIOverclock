#!/usr/bin/env python3
"""Read actual PE resource version; never execute the Windows binary."""
import json
import os
import pefile
import sys

expected = [int(part) for part in os.environ.get('EXPECTED_APP_VERSION', '1.5.5').split('.')]
expected = (expected + [0, 0, 0, 0])[:4]

for filename in sys.argv[1:]:
    pe = pefile.PE(filename)
    fixed = pe.VS_FIXEDFILEINFO[0]
    version = [fixed.FileVersionMS >> 16, fixed.FileVersionMS & 65535, fixed.FileVersionLS >> 16, fixed.FileVersionLS & 65535]
    product = [fixed.ProductVersionMS >> 16, fixed.ProductVersionMS & 65535, fixed.ProductVersionLS >> 16, fixed.ProductVersionLS & 65535]
    print(json.dumps({'file': filename, 'machine': hex(pe.FILE_HEADER.Machine), 'expected': expected, 'fileVersion': version, 'productVersion': product}))
    assert version == expected, version
    assert product == expected, product
