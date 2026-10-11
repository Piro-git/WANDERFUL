import contextlib
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import urlparse,unquote
spec=importlib.util.spec_from_file_location('owner_credentials',Path(__file__).with_name('complete-owner-credential.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SECRET='Synthetic-only:$foo`bar@p&ss/word#with%chars'
PROOF={'status':'runtime_verified','role':'wanderful_owner_runtime','host':m.HOST,'tlsAuthorized':True,'tlsProtocol':'TLSv1.3','peerCertificateSHA256':'a'*64,'roleSchemaAndGuardVerified':True,'waveUsage':{'requests':0,'google':0,'graphhopper':0},'privateDebug':SECRET}
def result(code=0,data='',error=''):return SimpleNamespace(returncode=code,stdout=data,stderr=error)
class FlowTests(unittest.TestCase):
 def setUp(self):
  self.calls=[];self.output=io.StringIO();self.prompts=[]
  self.local=patch.object(m,'check_local_inputs');self.local.start();self.addCleanup(self.local.stop)
 def prompt(self,message):self.prompts.append(message);return SECRET
 def child_run(self,args,**kwargs):
  self.calls.append((args,kwargs))
  self.assertNotIn(SECRET,' '.join(args));self.assertNotIn(m.owner_url(SECRET),' '.join(args))
  self.assertFalse(any(k.startswith('OWNER_') or k in ('PGPASSWORD','NODE_OPTIONS') for k in kwargs['env']))
  if 'ls' in args:return result(data=' GOOGLE_API_KEY Encrypted Production\n APP_ATTEST_DATABASE_CA_PEM Encrypted Production')
  if str(m.PROOF) in args:return result(data=json.dumps(PROOF))
  if 'add' in args:return result()
  self.fail('unexpected child')
 def execute(self,**kwargs):
  with contextlib.redirect_stdout(self.output):return m.flow(runner=kwargs.pop('runner',self.child_run),prompt=self.prompt,tty=kwargs.pop('tty',True),**kwargs)
 def test_verified_input_is_stdin_only_and_receipt_has_no_secret(self):
  receipt=self.execute();self.assertEqual(len(self.calls),3)
  proof_input=json.loads(self.calls[1][1]['input']);self.assertEqual(unquote(urlparse(proof_input['databaseURL']).password),SECRET)
  args,options=self.calls[-1];self.assertIn('--sensitive',args);self.assertIn('--yes',args);self.assertNotIn('--force',args);self.assertNotIn('--value',args)
  self.assertEqual(options['input'],m.owner_url(SECRET));self.assertIn(m.PROJECT,args);self.assertIn(m.SCOPE,args)
  self.assertNotIn(SECRET,self.output.getvalue()+json.dumps(receipt));self.assertNotIn('privateDebug',receipt['actualRestrictedRuntime'])
  self.assertFalse(receipt['ledgerReconciled']);self.assertEqual(receipt['providerCalls'],0)
 def test_missing_tty_stops_before_secrets_or_children(self):
  with self.assertRaises(m.SafeFailure):self.execute(tty=False)
  self.assertEqual(self.calls,[]);self.assertEqual(self.prompts,[])
 def test_existing_sensitive_field_is_not_overwritten(self):
  with self.assertRaises(m.SafeFailure):self.execute(runner=lambda *a,**k:result(data=' OWNER_ACCESS_DATABASE_URL Encrypted Production'))
  self.assertEqual(self.prompts,[])
 def test_failed_tls_never_transfers_or_leaks_child_error(self):
  def runner(args,**kwargs):
   if str(m.PROOF) in args:return result(1,json.dumps({'status':'runtime_unavailable'}),SECRET)
   return self.child_run(args,**kwargs)
  with self.assertRaises(m.SafeFailure) as error:self.execute(runner=runner)
  self.assertNotIn(SECRET,str(error.exception)+self.output.getvalue());self.assertFalse(any('add' in args for args,_ in self.calls))
 def test_activation_refusal_never_transfers_operator_secret_or_overwrites_role(self):
  def runner(args,**kwargs):
   if str(m.ACTIVATOR) in args:
    self.assertNotIn(SECRET,' '.join(args));self.assertEqual(set(json.loads(kwargs['input'])),{'operatorPassword','newOwnerPassword','caPath'})
    return result(1,json.dumps({'status':'activation_refused','role':'wanderful_owner_runtime'}),SECRET)
   return self.child_run(args,**kwargs)
  with self.assertRaises(m.SafeFailure) as error:self.execute(activate=True,runner=runner)
  self.assertEqual(len(self.prompts),3);self.assertNotIn(SECRET,str(error.exception)+self.output.getvalue());self.assertFalse(any('add' in args for args,_ in self.calls))
 def test_new_role_activation_proceeds_to_real_owner_proof_before_sensitive_transfer(self):
  def runner(args,**kwargs):
   if str(m.ACTIVATOR) in args:return result(data=json.dumps({'status':'role_activated','role':'wanderful_owner_runtime'}))
   return self.child_run(args,**kwargs)
  receipt=self.execute(activate=True,runner=runner)
  self.assertTrue(receipt['newRoleActivatedByThisFlow']);self.assertEqual(len(self.prompts),3)
  self.assertFalse(any(any(str(a).endswith('/psql') for a in args) for args,_ in self.calls))
 def test_bad_metadata_never_transfers(self):
  def runner(args,**kwargs):
   if str(m.PROOF) in args:return result(data=json.dumps({**PROOF,'waveUsage':{'requests':2,'google':17,'graphhopper':0}}))
   return self.child_run(args,**kwargs)
  with self.assertRaises(m.SafeFailure):self.execute(runner=runner)
  self.assertFalse(any('add' in args for args,_ in self.calls))
 def test_failed_add_does_not_reactivate_or_print_dsn(self):
  def runner(args,**kwargs):
   if 'add' in args:return result(1,m.owner_url(SECRET),SECRET)
   return self.child_run(args,**kwargs)
  with self.assertRaises(m.SafeFailure) as error:self.execute(runner=runner)
  self.assertIn('--store-only',str(error.exception));self.assertNotIn(SECRET,str(error.exception)+self.output.getvalue())
 def test_invalid_password_has_no_value_in_error(self):
  for invalid in ('tiny','x'*513,'abc\n'+'x'*20):
   with self.assertRaises(m.SafeFailure) as error:m.owner_url(invalid)
   self.assertNotIn(invalid,str(error.exception))
if __name__=='__main__':unittest.main()
