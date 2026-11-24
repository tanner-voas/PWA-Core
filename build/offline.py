"""Deterministic, dependency-free offline inventory and worker generation.

The application selects the files, groups, cache namespace and bypass paths.
No network access, filesystem scanning policy, or app state is owned here.
"""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path, PurePosixPath

TEMPLATE = Path(__file__).with_name('sw.template.js')
PREFIX = re.compile(r'[a-z][a-z0-9-]*-shell-\Z')
VERSION = re.compile(r'[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.+-]+)?\Z')
GROUP = re.compile(r'(?:shell|[a-z][a-z0-9-]*:[a-zA-Z0-9_-]+)\Z')
HASH = re.compile(r'[0-9a-f]{64}\Z')


def validate_path(path):
    if not isinstance(path, str) or not path.startswith('./'):
        raise ValueError('Asset path must be relative to worker scope')
    raw = path[2:]
    if (not raw or any(c in raw for c in ('\\', '?', '#', '%', ':'))
        or any(ord(c) < 32 or ord(c) == 127 for c in raw)
        or any(p in ('', '.', '..') for p in raw.split('/'))
        or PurePosixPath(raw).is_absolute()):
        raise ValueError(f'Unsafe asset path: {path!r}')
    if raw in ('sw.js', '__offline_release_metadata__'):
        raise ValueError('Asset path is reserved by the worker')
    return path


def validate_groups(groups):
    if (not isinstance(groups, (list, tuple)) or not groups
        or any(not isinstance(g, str) or not GROUP.fullmatch(g) for g in groups)
        or len(set(groups)) != len(groups)):
        raise ValueError('Invalid offline asset groups')
    return list(groups)


def asset_record(root: Path, file: Path, groups):
    """Fingerprint actual packaged bytes. Refuse escapes/symlinks outside root."""
    root, file = Path(root).resolve(), Path(file).resolve()
    if not file.is_relative_to(root) or not file.is_file():
        raise ValueError('Asset must be a file within the distribution root')
    path = validate_path('./' + file.relative_to(root).as_posix())
    data = file.read_bytes()
    return dict(path=path, size=len(data), sha256=hashlib.sha256(data).hexdigest(),
                groups=validate_groups(groups))


def inventory_json(assets):
    """Canonical ordering; fail closed on duplicate or malformed records."""
    seen, records = set(), []
    for a in assets:
        path = validate_path(a['path'])
        if path in seen:
            raise ValueError(f'Duplicate offline asset: {path}')
        seen.add(path)
        if type(a['size']) is not int or a['size'] < 0 or not isinstance(a['sha256'], str) or not HASH.fullmatch(a['sha256']):
            raise ValueError('Invalid offline asset fingerprint')
        records.append(dict(path=path, size=a['size'], sha256=a['sha256'], groups=validate_groups(a['groups'])))
    if not any(a['path'] == './index.html' and 'shell' in a['groups'] for a in records):
        raise ValueError('Offline inventory must contain a mandatory index.html')
    return json.dumps(sorted(records, key=lambda a: a['path']), ensure_ascii=False, separators=(',', ':'))


def generate_worker(assets, *, cache_prefix, version, legacy_prefixes=(), excluded_path_prefixes=()):
    """Return (cache_name, worker_source, inventory_json). No files are written.

    Legacy cache prefixes are opt-in, allowing the existing Ciyan/launcher
    migration while other apps cannot touch each other's cache namespaces.
    """
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError('Invalid app version')
    prefixes = list(dict.fromkeys((cache_prefix, *legacy_prefixes)))
    if any(not isinstance(p, str) or not PREFIX.fullmatch(p) for p in prefixes):
        raise ValueError('Invalid managed cache namespace')
    excludes = list(dict.fromkeys(excluded_path_prefixes))
    if any(not isinstance(p, str) or not p.startswith('/') or not p.endswith('/') or p == '/' or '\\' in p or '..' in p.split('/') for p in excludes):
        raise ValueError('Invalid bypass path prefix')
    inventory = inventory_json(assets)
    template = TEMPLATE.read_text(encoding='utf-8')
    config = template.replace('__CACHE_PREFIXES__', json.dumps(prefixes, separators=(',', ':'))).replace('__EXCLUDED_PATH_PREFIXES__', json.dumps(excludes, separators=(',', ':')))
    digest = hashlib.sha256(inventory.encode('utf-8') + config.encode('utf-8')).hexdigest()[:16]
    cache_name = f'{cache_prefix}v{version}-{digest}'
    if any(config.count(token) != 1 for token in ('__SHELL_CACHE_NAME__', '__PRECACHE_ASSETS__')):
        raise RuntimeError('Invalid worker template')
    worker = config.replace('__SHELL_CACHE_NAME__', cache_name).replace('__PRECACHE_ASSETS__', inventory)
    return cache_name, worker, inventory
