"""TEMPORARY WORKAROUND rule (Shesha 0.46 framework bug): refListStatus rendered inside a subForm throws
"Component with id … is not found" (refListStatus/index.tsx:50 calls the markup-context useComponentModel, which a
subForm does not provide). Replace it, keeping id/binding/visibility, with:
  - hidden helpers  -> a hidden textField (binding kept, nothing rendered)
  - visible tags    -> a read-only reference-list dropdown shown as a solid tag (ReadOnlyDisplayFormItem -> ReflistTag
                       uses the list item's colour, readOnlyDisplayFormItem/index.tsx:109-123)
The original component is kept verbatim under `_reconcilerOriginal` so the swap can be reversed when the core fix ships.
"""
import copy
MARK_KEY = '_reconcilerOriginal'
KEEP = ('id', 'propertyName', 'componentName', 'label', 'labelAlign', 'hideLabel', 'parentId', 'visible', 'hidden',
        'description', 'desktop', 'tablet', 'mobile', 'enableStyleOnReadonly', 'permissions', 'visiblePermissions')


def is_static_hidden(c):
    v, h = c.get('visible'), c.get('hidden')
    return v is False or h is True or (isinstance(v, dict) and v.get('_mode') == 'value' and v.get('_value') is False) \
        or (isinstance(h, dict) and h.get('_mode') == 'value' and h.get('_value') is True)


def swap(c, dropdown_version=15, textfield_version=8):
    """Return the replacement dict for refListStatus c (does not mutate c)."""
    assert c.get('type') == 'refListStatus' and c.get('referenceListId'), c.get('id')
    base = {k: copy.deepcopy(c[k]) for k in KEEP if k in c}
    base[MARK_KEY] = copy.deepcopy(c)
    if is_static_hidden(c):
        base.update({'type': 'textField', 'version': textfield_version, 'editMode': 'readOnly'})
        return base
    base.update({'type': 'dropdown', 'version': dropdown_version, 'dataSourceType': 'referenceList',
                 'referenceListId': copy.deepcopy(c['referenceListId']), 'valueFormat': 'simple', 'editMode': 'readOnly',
                 'displayStyle': 'tags', 'tagVariant': 'solid' if c.get('solidBackground', True) else 'outlined',
                 'showItemName': True, 'enableMultiSelect': False})
    return base
