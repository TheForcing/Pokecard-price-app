import argparse
import json
import os
import sys

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import easyocr


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image", help="Path to image")
    parser.add_argument("--lang", default="en", choices=["en", "ko", "ja"])
    args = parser.parse_args()

    reader = easyocr.Reader([args.lang], gpu=False, verbose=False)
    lines = reader.readtext(args.image, detail=1, paragraph=False)
    texts = []
    scores = []
    for entry in lines:
        if len(entry) >= 3:
            text = entry[1]
            score = float(entry[2]) if entry[2] is not None else 0.0
            texts.append(text)
            scores.append(score)

    raw_text = "\n".join(texts)
    confidence = sum(scores) / len(scores) if scores else 0.0
    payload = {
        "rawText": raw_text,
        "rawLines": texts,
        "confidence": confidence,
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
