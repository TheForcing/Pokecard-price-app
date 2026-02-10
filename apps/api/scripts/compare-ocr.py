import argparse
import os
import sys
import time

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("FLAGS_use_mkldnn", "0")
os.environ.setdefault("FLAGS_enable_mkldnn", "0")
os.environ.setdefault("PADDLE_DISABLE_ONEDNN", "1")
os.environ.setdefault("FLAGS_use_cuda", "0")
os.environ.setdefault("FLAGS_enable_pir_api", "0")
os.environ.setdefault("FLAGS_new_executor", "0")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import easyocr
from paddleocr import PaddleOCR


LANG_MAP = {
    "en": "en",
    "ko": "korean",
    "ja": "japan",
}


def run_easyocr(images, lang):
    reader = easyocr.Reader([lang], gpu=False, verbose=False)
    results = {}
    for image in images:
        start = time.perf_counter()
        lines = reader.readtext(image, detail=1, paragraph=False)
        elapsed = time.perf_counter() - start
        results[image] = (elapsed, lines)
    return results


def run_paddleocr(images, lang):
    paddle_lang = LANG_MAP.get(lang, "en")
    ocr = PaddleOCR(use_textline_orientation=False, lang=paddle_lang)
    results = {}
    for image in images:
        start = time.perf_counter()
        lines = ocr.predict(image)
        elapsed = time.perf_counter() - start
        results[image] = (elapsed, lines)
    return results


def format_easyocr(lines, limit):
    formatted = []
    for entry in lines[:limit]:
        bbox, text, score = entry
        formatted.append((text, score))
    return formatted


def format_paddle(lines, limit):
    formatted = []
    if not lines:
        return formatted
    items = lines
    if isinstance(lines, list) and len(lines) == 1 and isinstance(lines[0], list):
        items = lines[0]
    for entry in items[:limit]:
        text = None
        score = None
        if isinstance(entry, dict):
            text = entry.get("rec_text") or entry.get("text")
            score = entry.get("rec_score") or entry.get("score")
        elif isinstance(entry, (list, tuple)) and len(entry) >= 2:
            if isinstance(entry[1], (list, tuple)) and len(entry[1]) >= 2:
                text = entry[1][0]
                score = entry[1][1]
        if text is None:
            continue
        formatted.append((text, score if score is not None else 0.0))
    return formatted


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("images", nargs="+", help="Image paths to OCR")
    parser.add_argument("--lang", default="en", choices=["en", "ko", "ja"])
    parser.add_argument("--limit", type=int, default=6)
    args = parser.parse_args()

    images = [os.path.abspath(path) for path in args.images]
    print(f"Images: {images}")

    print("\n== EasyOCR ==")
    easy_results = run_easyocr(images, args.lang)
    for image, (elapsed, lines) in easy_results.items():
        print(f"{os.path.basename(image)} | {elapsed:.2f}s")
        for text, score in format_easyocr(lines, args.limit):
            print(f"  - {text} ({score:.3f})")

    print("\n== PaddleOCR ==")
    paddle_results = run_paddleocr(images, args.lang)
    for image, (elapsed, lines) in paddle_results.items():
        print(f"{os.path.basename(image)} | {elapsed:.2f}s")
        for text, score in format_paddle(lines, args.limit):
            print(f"  - {text} ({score:.3f})")


if __name__ == "__main__":
    main()
