# Golden Files README

This directory contains test fixtures for Arcamage development.

## File Descriptions

### JSON Samples

- `v3_standard.json` - Standard CCv3 format character card
- `v2_standard.json` - Standard CCv2 format character card  
- `xss_attack_sample.json` - Malicious input for XSS testing

### PNG Samples

- `v2_card.png` - PNG with V2 `chara` tEXt chunk
- `v3_card.png` - PNG with V3 `ccv3` tEXt chunk
- `dual_chunk.png` - PNG with both `ccv3` and `chara` chunks
- `itxt_sample.png` - PNG with iTXt chunk (international text with UTF-8)
- `ztxt_sample.png` - PNG with zTXt chunk (compressed text)
- `garbage_after_iend.png` - PNG with garbage data after IEND
- `plain_image.png` - Plain PNG without character data

## Usage

```python
from tests.conftest import GOLDEN_FILES_DIR

# Load JSON sample
with open(GOLDEN_FILES_DIR / "v3_standard.json") as f:
    v3_card = json.load(f)

# Load PNG sample
with open(GOLDEN_FILES_DIR / "v3_card.png", "rb") as f:
    png_bytes = f.read()
```

## Test Requirements

All golden files must preserve:
1. **IDAT integrity** - Pixel data must not be modified
2. **HTML preservation** - All HTML tags in greetings must be intact
3. **Unknown field passthrough** - Extra fields must survive round-trip
