"""Read-only checks of the emitted local SQL; no database/service invocation."""
import pathlib, unittest
SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'scripts/local/run-ilsenburg-pilot.py'
namespace={'__file__':str(SCRIPT)}
exec(SCRIPT.read_text().split('parser=argparse.ArgumentParser()')[0], namespace)
class LocalBootstrapTest(unittest.TestCase):
    def test_preserves_cancellation_and_runtime_boundary(self):
        sql=namespace['bootstrap_sql']()
        self.assertIn('CREATE OR REPLACE FUNCTION trailmind_control.cancel_active_outdoor_research_backend_integer',sql)
        self.assertIn("AND usename = 'outdoor_research_runtime_role'",sql)
        self.assertIn('TO outdoor_research_cancellation_control_role;',sql)
        self.assertIn('GRANT pg_signal_backend TO trailmind_control_owner WITH INHERIT TRUE, SET FALSE',sql)
        self.assertIn('TO outdoor_research_runtime_role;',sql)
        self.assertIn('CREATE POLICY projection_all',sql)
        self.assertNotIn("'managed-supabase-postgres-v1'",sql)
    def test_statistics_collected_before_ready_receipt(self):
        script=SCRIPT.read_text()
        self.assertIn("SET statement_timeout='2500ms'",script)
        self.assertLess(script.index("'analyze-pilot'"),script.index("'status':'imported-and-projected'"))
    def test_exact_migrations_are_reused_unchanged(self):
        sql=namespace['bootstrap_sql']()
        self.assertEqual(len(namespace['MIGRATIONS']),10)
        for name in namespace['MIGRATIONS']:
            original=(namespace['REPO']/'backend/migrations'/name).read_text()
            self.assertIn(original,sql)
        self.assertNotIn('008_outdoor_research_runtime_read_contract.sql',sql)
if __name__=='__main__': unittest.main()
