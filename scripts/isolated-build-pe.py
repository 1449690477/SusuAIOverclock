#!/usr/bin/env python3
"""Read actual PE resource version; never execute the Windows binary."""
import json
import os
import pefile
import sys


def expected_version():
    """Harness env first, project package.json second, never a hardcoded release.

    A literal 1.5.5 fallback asserted the wrong version against a 1.5.7 artifact
    the moment the harness env was absent, which is exactly what a standalone
    re-run of `isolated-build-verify.cjs artifact` does.
    """
    raw = os.environ.get('EXPECTED_APP_VERSION')
    if not raw:
        project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(project, 'package.json'), encoding='utf-8') as handle:
            raw = json.load(handle)['version']
    parts = [int(part) for part in raw.split('.')]
    # Must stay a list: the comparison below is against
    # [FileVersionMS>>16, ...], and [1,5,7,0] != (1,5,7,0) in Python.
    return (parts + [0, 0, 0, 0])[:4]


expected = expected_version()

for filename in sys.argv[1:]:
    pe = pefile.PE(filename)
    fixed = pe.VS_FIXEDFILEINFO[0]
    version = [fixed.FileVersionMS >> 16, fixed.FileVersionMS & 65535, fixed.FileVersionLS >> 16, fixed.FileVersionLS & 65535]
    product = [fixed.ProductVersionMS >> 16, fixed.ProductVersionMS & 65535, fixed.ProductVersionLS >> 16, fixed.ProductVersionLS & 65535]
    print(json.dumps({'file': filename, 'machine': hex(pe.FILE_HEADER.Machine), 'expected': expected, 'fileVersion': version, 'productVersion': product}))
    assert version == expected, version
    assert product == expected, product
