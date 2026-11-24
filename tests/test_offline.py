import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'build'))
from offline import asset_record, generate_worker, inventory_json

class OfflineBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.index = self.root / 'index.html'
        self.index.write_text('hello')
        self.asset = asset_record(self.root, self.index, ['shell'])
    def generate(self, records=None, **kwargs):
        return generate_worker(records if records is not None else [self.asset], **{'cache_prefix':'test-shell-', 'version':'0.1.0', **kwargs})
    def test_deterministic_generation_and_content_invalidation(self):
        a = self.generate()
        self.assertEqual(a, self.generate())
        self.index.write_text('changed')
        self.assertNotEqual(a[0], self.generate([asset_record(self.root,self.index,['shell'])])[0])
    def test_independent_cache_namespaces_and_explicit_migration(self):
        name, worker, _ = self.generate(legacy_prefixes=['ciyan-shell-'],excluded_path_prefixes=['/_profiles/'])
        self.assertTrue(name.startswith('test-shell-v0.1.0-'))
        self.assertIn('const CACHE_PREFIXES=["test-shell-","ciyan-shell-"]',worker)
        self.assertIn('const EXCLUDED_PATH_PREFIXES=["/_profiles/"]',worker)
        self.assertNotIn('app-launcher-shell-',worker)
        self.assertNotEqual(name,self.generate()[0])
        self.assertNotEqual(name,self.generate(cache_prefix='other-shell-')[0])
    def test_invalid_inventory_fails_closed(self):
        for record in ({**self.asset,'path':'./../private'}, {**self.asset,'path':'./sw.js'}, {**self.asset,'sha256':'bad'}, {**self.asset,'groups':[]}, {**self.asset,'size':True}):
            with self.subTest(record=record), self.assertRaises(ValueError):
                self.generate([record])
        with self.assertRaises(ValueError): self.generate([self.asset,self.asset])
        with self.assertRaises(ValueError): self.generate([])
        with self.assertRaises(ValueError): self.generate(cache_prefix='')
        with self.assertRaises(ValueError): self.generate(excluded_path_prefixes=['/'])
    def test_inventory_order_is_stable(self):
        p=self.root/'app.js';p.write_text('export {}')
        app=asset_record(self.root,p,['app:example'])
        self.assertEqual(self.generate([self.asset,app]),self.generate([app,self.asset]))
    def test_asset_outside_root_fails(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'secret';p.write_text('secret')
            with self.assertRaises(ValueError): asset_record(self.root,p,['shell'])

if __name__=='__main__': unittest.main()
