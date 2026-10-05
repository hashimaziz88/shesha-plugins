"""Rule (hazard H38): an entity autocomplete with no stored `sorting` lists options in database order on 0.46. 0.43 sent
`sorting=<displayPropName>` by default (phase2 Add New Lead > Province: '...&sorting=name' -> Eastern Cape ... Western Cape;
0.46: no sorting -> Limpopo, Free State, Western Cape, ...). The BA's steps list options alphabetically.
Fix: store the 0.43 default explicitly - an ascending sort on the display property, in the 0.46 `sorting` format
([{id, propertyName, sorting: 'asc', itemType: 'item'}]). Only for dataSourceType 'entitiesList' autocompletes whose
display property is a real column (not '_displayName' or a dotted path); any stored sorting is left alone. Idempotent."""
import hashlib


def apply(c, notes):
    if c.get('type') != 'autocomplete' or c.get('dataSourceType') != 'entitiesList': return 0
    if c.get('sorting'): return 0
    prop = c.get('displayPropName')
    if not isinstance(prop, str) or not prop or prop.startswith('_') or '.' in prop:
        return 0
    c['sorting'] = [{'id': hashlib.sha1(f'{c.get("id")}:sort046'.encode()).hexdigest()[:22] + '-s046', 'propertyName': prop,
                     'sorting': 'asc', 'itemType': 'item'}]
    notes.append(f'{c.get("componentName") or c.get("propertyName")}: options sorted by {prop} (0.43 default)')
    return 1
