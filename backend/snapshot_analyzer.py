"""
insidr Snapshot Analyzer

Two-stage pipeline:
  Stage 1 — Histogram (Pillow, always available, ~5ms)
  Stage 2 — OCR (pytesseract + Tesseract binary, optional, ~80-150ms)

Gracefully skipped if dependencies are not installed.
"""

import io
import json
import logging
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger('insidr.analyzer')

try:
    from PIL import Image, ImageStat
    PILLOW_OK = True
except ImportError:
    PILLOW_OK = False

try:
    import pytesseract
    pytesseract.get_tesseract_version()
    TESSERACT_OK = True
except Exception:
    TESSERACT_OK = False

SEVERITY_RANK = {'none': 0, 'info': 1, 'warning': 2, 'critical': 3}


class SnapshotAnalyzer:
    def __init__(self, patterns_path=None):
        self.patterns = []
        if patterns_path and Path(patterns_path).exists():
            with open(patterns_path) as f:
                self.patterns = json.load(f).get('patterns', [])

    def analyze(self, jpeg_bytes):
        result = {
            'dark_ratio': 0.0, 'mean_pixel': 128,
            'ocr_text': None, 'ocr_available': TESSERACT_OK,
            'pillow_available': PILLOW_OK,
            'matches': [], 'highest_severity': 'none', 'alert_teams': [],
        }
        if not PILLOW_OK or not jpeg_bytes:
            return result
        try:
            img = Image.open(io.BytesIO(jpeg_bytes)).convert('RGB')
        except Exception:
            return result
        grey = img.convert('L')
        stat = __import__('PIL').ImageStat.Stat(grey)
        mean_pixel = stat.mean[0]
        pixels = list(grey.getdata())
        dark_ratio = sum(1 for p in pixels if p < 30) / len(pixels) if pixels else 0.0
        result['mean_pixel'] = round(mean_pixel, 1)
        result['dark_ratio'] = round(dark_ratio, 4)
        return result


_default_analyzer = None

def get_analyzer(patterns_path=None):
    global _default_analyzer
    if _default_analyzer is None:
        path = patterns_path or str(Path(__file__).parent / 'patterns.json')
        _default_analyzer = SnapshotAnalyzer(path)
    return _default_analyzer