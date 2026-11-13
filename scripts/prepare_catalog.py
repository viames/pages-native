"""Build a registry-only presentation revision from a verified release record."""

from pathlib import Path
import json
import re
import struct
import sys
import urllib.request


def prepare(path):
    """Preserve release identity and packages while validating presentation metadata."""
    root = Path(__file__).resolve().parents[1]
    template = json.loads((root / 'registry/server.template.json').read_text())
    revision = json.loads((root / 'registry/catalog-revision.json').read_text())
    record = json.loads(path.read_text())
    assert record['version'] == revision['baseVersion']
    assert re.fullmatch(r'\d+\.\d+\.\d+-catalog\.\d+', revision['version'])
    assert revision['version'] != record['version']
    for key in ['name', 'repository', 'websiteUrl']:
        assert record[key] == template[key], f'Release identity mismatch: {key}'
    assert 1 <= len(template['description']) <= 100
    repository = template['repository']['url'].removeprefix('https://github.com/')
    assert len(template['icons']) == 1
    icon = template['icons'][0]
    expected = f'https://raw.githubusercontent.com/{repository}/main/.github/assets/catalog-icon.png'
    assert icon == {'src': expected, 'mimeType': 'image/png', 'sizes': ['256x256']}
    # Bind the public icon to the reviewed source, without changing the MCPB.
    with urllib.request.urlopen(expected, timeout=30) as response:
        image = response.read()
    assert image == (root / '.github/assets/catalog-icon.png').read_bytes()
    assert image[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', image[16:24]) == (256, 256)
    record.update(version=revision['version'], description=template['description'], icons=template['icons'])
    path.write_text(json.dumps(record, indent=2) + '\n')
    print(f"Prepared {record['name']} {record['version']}; runtime packages remain {revision['baseVersion']}.")


if __name__ == '__main__':
    prepare(Path(sys.argv[1]))
