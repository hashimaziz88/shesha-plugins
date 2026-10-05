"""Where the reconciler keeps credentials, snapshots, backups and captures. Nothing here is committed.
- credentials: $LBREC_CREDS or <skill>/.local.json  -> {"username": "...", "password": "..."} (gitignored)
- work dir:    $LBREC_WORK  or <skill>/.work          -> snapshots/, local/before, local/after, sweep/, .state/ (gitignored)"""
import os
SKILL = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CRED = os.environ.get('LBREC_CREDS') or os.path.join(SKILL, '.local.json')
WORK = os.environ.get('LBREC_WORK') or os.path.join(SKILL, '.work')
SNAPSHOTS = os.path.join(WORK, 'snapshots')
BACKUPS = os.path.join(WORK, 'local')
SWEEP = os.environ.get('LBREC_SWEEP') or os.path.join(WORK, 'sweep')
STATE = os.path.join(WORK, '.state')
for _d in (WORK, SNAPSHOTS, BACKUPS, SWEEP, STATE): os.makedirs(_d, exist_ok=True)
