"""Offline OCI source overlay over an existing Docker-save runtime image.

Use only when installed runtime dependencies match the source lock. Does not
start Docker, push, execute containers, extract to disk, or read credentials.
"""
import argparse
import datetime
import hashlib
import io
import json
import pathlib
import re
import tarfile

ROOT_FILES = frozenset({'server.js', 'start_admin.js', 'package.json', 'package-lock.json'})
REQUIRED_FILES = ROOT_FILES | {'src/server.js', 'src/paths.js'}
FORBIDDEN_PARTS = frozenset({'tools', 'tests', 'node_modules', 'exports', 'data', 'assets', 'secrets', 'credentials'})
DEPENDENCIES = {'openid-client': '^6.9.0'}
LIMIT_BYTES = 4 * 1024 * 1024
ADMIN_EXTENSIONS = frozenset({'.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf'})


def digest(value):
    return hashlib.sha256(value).hexdigest()


def clean_name(name, allow_colon=False):
    if not isinstance(name, str) or '\\' in name or (not allow_colon and ':' in name) or name.startswith('/'):
        raise ValueError('Unsafe archive path: ' + str(name))
    while name.startswith('./'):
        name = name[2:]
    if '..' in name.split('/') or '\x00' in name:
        raise ValueError('Unsafe archive path: ' + name)
    return name.rstrip('/')


def sensitive_name(name):
    return bool(re.search(r'(?:^|[/_.-])(?:secrets?|credentials?|private[_-]?key|api[_-]?key)(?:[/_.-]|$)', name.lower()))


def allowed_patch_path(name, directory=False):
    name = clean_name(name)
    if directory:
        return name in ['', '.', 'src'] or name.startswith('src/') and all(p and not p.startswith('.') and p.lower() not in FORBIDDEN_PARTS for p in name.split('/'))
    if name in ROOT_FILES:
        return True
    if not name.startswith('src/') or not name.endswith('.js'):
        return False
    parts = name.split('/')
    if any(not p or p.startswith('.') or p.lower() in FORBIDDEN_PARTS for p in parts):
        return False
    lowered = name.lower()
    return not sensitive_name(name) and not any(word in lowered for word in ['.local.', '.secret.', 'credentials', '/secret.', '/secrets.'])


def allowed_admin_path(name, directory=False):
    name = clean_name(name)
    if directory:
        return name in ['', '.', 'assets'] or name.startswith('assets/') and all(p and not p.startswith('.') and p.lower() not in FORBIDDEN_PARTS for p in name.split('/')[1:])
    if name in ['index.html', 'favicon.svg']:
        return True
    if not name.startswith('assets/') or pathlib.PurePosixPath(name).suffix.lower() not in ADMIN_EXTENSIONS:
        return False
    lowered = name.lower()
    return all(p and not p.startswith('.') and p.lower() not in FORBIDDEN_PARTS for p in name.split('/')[1:]) and not sensitive_name(name) and not any(word in lowered for word in ['.local.', '.secret.', 'credentials', '/secret.', '/secrets.'])


def patch_files(source, kind='server'):
    files = {}
    allowed = allowed_admin_path if kind == 'admin' else allowed_patch_path
    for member in source.getmembers():
        name = clean_name(member.name)
        if member.isdir():
            if not allowed(name, True):
                raise ValueError('Unexpected source patch directory: ' + name)
            continue
        if not member.isfile() or not allowed(name):
            raise ValueError('Unexpected source patch path/type: ' + name)
        if name in files:
            raise ValueError('Duplicate source patch path: ' + name)
        if member.size > LIMIT_BYTES:
            raise ValueError('Source patch member too large: ' + name)
        files[name] = source.extractfile(member).read()
    required = {'index.html'} if kind == 'admin' else REQUIRED_FILES
    missing = sorted(required - files.keys())
    if missing:
        raise ValueError('Incomplete runtime source tree: ' + ', '.join(missing))
    if kind == 'admin':
        return files, None
    package = json.loads(files['package.json'])
    lock = json.loads(files['package-lock.json'])
    if package.get('dependencies') != DEPENDENCIES or lock.get('packages', {}).get('', {}).get('dependencies') != DEPENDENCIES:
        raise ValueError('Runtime dependencies changed; rebuild with Dockerfile')
    # A partial recursive patch must not resolve an obsolete module from base.
    for name, data in files.items():
        if not name.endswith('.js'):
            continue
        for request in re.findall(r"\brequire\(\s*['\"](\.[^'\"]*)['\"]\s*\)", data.decode('utf-8')):
            logical = pathlib.PurePosixPath(name).parent.joinpath(request)
            stack = []
            for part in logical.parts:
                if part == '..':
                    if not stack:
                        raise ValueError('Runtime import escapes source tree: ' + name)
                    stack.pop()
                elif part != '.':
                    stack.append(part)
            target = '/'.join(stack)
            if not any(candidate in files for candidate in [target, target + '.js', target + '.json', target + '/index.js']):
                raise ValueError('Missing runtime import from ' + name + ': ' + request)
    return files, lock


def runtime_lock(lock):
    return {name: {key: entry.get(key) for key in ['version', 'integrity', 'dependencies', 'optionalDependencies'] if key in entry}
            for name, entry in lock.get('packages', {}).items() if name and not entry.get('dev')}


def base_app_files(old, entry):
    """Inspect existing layer headers in-memory; never extract untrusted paths."""
    found = {}
    names = set()
    for layer_name in entry['Layers']:
        with tarfile.open(fileobj=old.extractfile(layer_name), mode='r:*') as layer:
            for member in layer:
                name = clean_name(member.name, allow_colon=True)
                if not name.startswith('app/'):
                    continue
                if member.isfile():
                    names.add(name)
                    if name in ['app/package.json', 'app/package-lock.json']:
                        if member.size > LIMIT_BYTES:
                            raise ValueError('Invalid base dependency metadata')
                        found[name] = layer.extractfile(member).read()
    return found, names


def add_bytes(archive, name, value, mode=0o644, uid=0):
    info = tarfile.TarInfo(name)
    info.size, info.mode, info.uid, info.gid = len(value), mode, uid, uid
    archive.addfile(info, io.BytesIO(value))


def build(args):
    with tarfile.open(args.base) as old, tarfile.open(args.patch) as source:
        entry = next(x for x in json.load(old.extractfile('manifest.json')) if args.source_tag in x.get('RepoTags', []))
        config = json.load(old.extractfile(entry['Config']))
        kind = getattr(args, 'kind', 'server')
        files, lock = patch_files(source, kind)
        base_names = set()
        if kind == 'server':
            base_files, base_names = base_app_files(old, entry)
            if 'app/package-lock.json' not in base_files or runtime_lock(json.loads(base_files['app/package-lock.json'])) != runtime_lock(lock):
                raise ValueError('Installed runtime lock differs from source; rebuild with Dockerfile')
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w') as layer:
            removed = []
            if kind == 'server':
                # Old 0.10 put every JS file in /app: remove old tools/tests/modules.
                removed = sorted(name for name in base_names if name.startswith('app/') and '/' not in name[4:] and name.endswith('.js') and name[4:] not in ROOT_FILES)
                for name in removed:
                    add_bytes(layer, 'app/.wh.' + name[4:], b'', uid=1000)
                for directory in ['tools', 'tests', 'exports', 'android', 'docs']:
                    add_bytes(layer, 'app/.wh.' + directory, b'', uid=1000)
                # Deleted source files and lower source data must not linger.
                add_bytes(layer, 'app/src/.wh..wh..opq', b'', uid=1000)
                add_bytes(layer, 'app/data/.wh..wh..opq', b'', uid=1000)
                add_bytes(layer, 'app/data/postcards.json', b'[]\n', uid=1000)
                destination = 'app/'
            else:
                destination = 'usr/share/nginx/html/admin/'
                add_bytes(layer, destination + '.wh..wh..opq', b'')
            for name, value in sorted(files.items()):
                add_bytes(layer, destination + name, value, uid=1000 if kind == 'server' else 0)
        data = buffer.getvalue()
        sha = digest(data)
        config['rootfs']['diff_ids'].append('sha256:' + sha)
        config.setdefault('history', []).append({'created': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'created_by': 'Travel Frog source overlay; validated source tree and unchanged runtime lock'})
        cfg = json.dumps(config, separators=(',', ':')).encode()
        cfgsha = digest(cfg)
        layers = []
        for name in entry['Layers']:
            info = old.getmember(name)
            if not re.fullmatch(r'blobs/sha256/[0-9a-f]{64}', name):
                raise ValueError('Expected OCI blob paths in the Docker-save base image')
            meta = entry.get('LayerSources', {}).get('sha256:' + name.rsplit('/', 1)[-1], {})
            layers.append({'mediaType': meta.get('mediaType', 'application/vnd.oci.image.layer.v1.tar'), 'digest': 'sha256:' + name.rsplit('/', 1)[-1], 'size': info.size})
        layers.append({'mediaType': 'application/vnd.oci.image.layer.v1.tar', 'digest': 'sha256:' + sha, 'size': len(data)})
        manifest = json.dumps({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'config': {'mediaType': 'application/vnd.oci.image.config.v1+json', 'digest': 'sha256:' + cfgsha, 'size': len(cfg)}, 'layers': layers}, separators=(',', ':')).encode()
        msha = digest(manifest)
        index = json.dumps({'schemaVersion': 2, 'manifests': [{'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'digest': 'sha256:' + msha, 'size': len(manifest), 'annotations': {'io.containerd.image.name': args.tag, 'org.opencontainers.image.ref.name': args.tag}, 'platform': {'os': 'linux', 'architecture': 'amd64'}}]}).encode()
        with tarfile.open(args.output, 'w') as output:
            for member in old.getmembers():
                if member.name in ['index.json', 'manifest.json', 'oci-layout']:
                    continue
                clean_name(member.name)
                output.addfile(member, old.extractfile(member) if member.isfile() else None)
            for name, value in [('oci-layout', b'{"imageLayoutVersion":"1.0.0"}'), ('index.json', index), ('blobs/sha256/' + sha, data), ('blobs/sha256/' + cfgsha, cfg), ('blobs/sha256/' + msha, manifest)]:
                add_bytes(output, name, value)
        return {'kind': kind, 'tag': args.tag, 'digest': 'sha256:' + msha, 'output': args.output, 'source_files': len(files), 'removed_legacy_js': len(removed)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for arg in ['base', 'patch', 'source_tag', 'tag', 'output']:
        parser.add_argument('--' + arg.replace('_', '-'), required=True)
    parser.add_argument('--kind', choices=['server', 'admin'], default='server')
    print(json.dumps(build(parser.parse_args())))
