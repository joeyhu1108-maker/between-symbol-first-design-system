#!/usr/bin/env python3
"""Live dice pip recognition for RDK X5 (USB / stereo UVC camera).

Pipeline (pretrained, no extra training):
  1. EfficientDet-Lite3 TFLite finds each die (skovy/tensorflow-dice-model)
  2. ResNet-50 TFLite classifies the face as 1-6
  3. Optional OpenCV blob count of pips as a second vote

Works on the board and on a Mac with a USB webcam.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, asdict
from typing import List, Optional, Tuple

import cv2
import numpy as np

FACE_WORDS = ["five", "four", "one", "six", "three", "two"]  # TFLite Model Maker folder order
FACE_TO_PIPS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}


def _load_interpreter(model_path: str):
    try:
        from tflite_runtime.interpreter import Interpreter
        return Interpreter(model_path=model_path)
    except ImportError:
        pass
    try:
        from ai_edge_litert.interpreter import Interpreter
        return Interpreter(model_path=model_path)
    except ImportError:
        pass
    try:
        import tensorflow as tf
        return tf.lite.Interpreter(model_path=model_path)
    except ImportError as exc:
        raise SystemExit(
            "Need tflite_runtime or tensorflow. On RDK X5: pip3 install tflite-runtime"
        ) from exc


def _resize_for_model(rgb: np.ndarray, height: int, width: int, dtype) -> np.ndarray:
    resized = cv2.resize(rgb, (width, height), interpolation=cv2.INTER_LINEAR)
    if dtype == np.float32:
        return resized.astype(np.float32)
    if dtype == np.uint8:
        return np.clip(resized, 0, 255).astype(np.uint8)
    return resized.astype(dtype)


class TfliteModel:
    def __init__(self, path: str):
        if not os.path.isfile(path):
            raise FileNotFoundError(path)
        self.interpreter = _load_interpreter(path)
        self.interpreter.allocate_tensors()
        inp = self.interpreter.get_input_details()[0]
        self.input_index = inp["index"]
        self.input_dtype = inp["dtype"]
        shape = inp["shape"]
        self.height = int(shape[1])
        self.width = int(shape[2])
        self.outputs = self.interpreter.get_output_details()

    def invoke(self, rgb: np.ndarray) -> None:
        tensor = _resize_for_model(rgb, self.height, self.width, self.input_dtype)
        self.interpreter.set_tensor(self.input_index, np.expand_dims(tensor, 0))
        self.interpreter.invoke()

    def output(self, i: int) -> np.ndarray:
        return np.squeeze(self.interpreter.get_tensor(self.outputs[i]["index"]))


@dataclass
class DieReading:
    xmin: int
    ymin: int
    xmax: int
    ymax: int
    detect_score: float
    pips: Optional[int]
    face: Optional[str]
    classify_score: float
    pip_blobs: Optional[int]


def detect_dice(model: TfliteModel, rgb: np.ndarray, threshold: float) -> List[dict]:
    h, w = rgb.shape[:2]
    model.invoke(rgb)
    scores = model.output(0)
    boxes = model.output(1)
    count = int(model.output(2))
    results = []
    for i in range(count):
        score = float(scores[i])
        if score < threshold:
            continue
        ymin, xmin, ymax, xmax = [float(v) for v in boxes[i]]
        results.append(
            {
                "score": score,
                "xmin": int(np.clip(xmin, 0, 1) * w),
                "ymin": int(np.clip(ymin, 0, 1) * h),
                "xmax": int(np.clip(xmax, 0, 1) * w),
                "ymax": int(np.clip(ymax, 0, 1) * h),
            }
        )
    return results


def classify_face(model: TfliteModel, crop_rgb: np.ndarray) -> Tuple[str, float, int]:
    if crop_rgb.size == 0:
        return "unknown", 0.0, 0
    model.invoke(crop_rgb)
    logits = model.output(0).astype(np.float32)
    idx = int(np.argmax(logits))
    score = float(logits[idx])
    # Model Maker classifiers are often already probabilities in [0, 1].
    if score > 1.5:
        exp = np.exp(logits - np.max(logits))
        score = float((exp / np.sum(exp))[idx])
    word = FACE_WORDS[idx] if 0 <= idx < len(FACE_WORDS) else "unknown"
    return word, score, FACE_TO_PIPS.get(word, 0)


def count_pip_blobs(crop_bgr: np.ndarray) -> int:
    """Count circular pips on a cropped die. Works for light-on-dark and dark-on-light."""
    if crop_bgr.size == 0:
        return 0
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    # Invert so pips are bright blobs regardless of die color.
    if float(np.mean(gray)) > 127:
        gray = cv2.bitwise_not(gray)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    params = cv2.SimpleBlobDetector_Params()
    params.filterByArea = True
    area = crop_bgr.shape[0] * crop_bgr.shape[1]
    params.minArea = max(8.0, area * 0.002)
    params.maxArea = max(params.minArea + 1.0, area * 0.12)
    params.filterByCircularity = True
    params.minCircularity = 0.55
    params.filterByConvexity = True
    params.minConvexity = 0.7
    params.filterByInertia = True
    params.minInertiaRatio = 0.4
    params.minThreshold = 50
    params.maxThreshold = 220
    detector = cv2.SimpleBlobDetector_create(params)
    keypoints = detector.detect(binary)
    n = len(keypoints)
    return n if 1 <= n <= 6 else 0


def split_stereo(frame: np.ndarray, mode: str) -> np.ndarray:
    h, w = frame.shape[:2]
    sbs = mode in ("left", "right", "sbs") or (mode == "auto" and w >= int(h * 1.7))
    if not sbs:
        return frame
    mid = w // 2
    if mode == "right":
        return frame[:, mid:]
    return frame[:, :mid]


def open_camera(source: str, width: int, height: int) -> cv2.VideoCapture:
    if source.isdigit():
        cap = cv2.VideoCapture(int(source), cv2.CAP_V4L2)
        if not cap.isOpened():
            cap = cv2.VideoCapture(int(source))
    else:
        cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise SystemExit(f"Cannot open camera: {source}")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    return cap


def draw_readings(bgr: np.ndarray, readings: List[DieReading]) -> np.ndarray:
    out = bgr.copy()
    total = 0
    for r in readings:
        color = (0, 220, 80) if r.pips else (0, 180, 255)
        cv2.rectangle(out, (r.xmin, r.ymin), (r.xmax, r.ymax), color, 2)
        label = f"{r.pips if r.pips else '?'}  {r.classify_score:.2f}"
        if r.pip_blobs:
            label += f"  blobs:{r.pip_blobs}"
        y = r.ymin - 8 if r.ymin > 24 else r.ymin + 22
        cv2.putText(out, label, (r.xmin, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        if r.pips:
            total += r.pips
    cv2.putText(
        out,
        f"dice:{len(readings)}  sum:{total}",
        (12, 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.9,
        (255, 255, 255),
        2,
    )
    return out


def parse_args() -> argparse.Namespace:
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(description="RDK X5 dice pip recognizer")
    p.add_argument("--camera", default="0", help="v4l2 index, /dev/videoN, or image/video path")
    p.add_argument("--stereo", default="auto", choices=["auto", "none", "left", "right", "sbs"])
    p.add_argument("--width", type=int, default=1280)
    p.add_argument("--height", type=int, default=720)
    p.add_argument("--detect", default=os.path.join(here, "models", "die_detection.tflite"))
    p.add_argument("--classify", default=os.path.join(here, "models", "die_classification.tflite"))
    p.add_argument("--threshold", type=float, default=0.25)
    p.add_argument("--method", default="both", choices=["model", "pips", "both"])
    p.add_argument("--no-window", action="store_true")
    p.add_argument("--http", type=int, default=0, help="optional MJPEG port, e.g. 8080")
    p.add_argument("--json", action="store_true", help="print one JSON object per frame")
    p.add_argument("--once", action="store_true", help="single image/frame then exit")
    return p.parse_args()


class MjpegServer:
    def __init__(self, port: int):
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        self.frame = None
        self.lock = threading.Lock()
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path not in ("/", "/stream", "/mjpeg"):
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.end_headers()
                try:
                    while True:
                        with outer.lock:
                            buf = outer.frame
                        if buf is None:
                            time.sleep(0.05)
                            continue
                        self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n\r\n")
                        self.wfile.write(buf)
                        self.wfile.write(b"\r\n")
                        time.sleep(0.03)
                except BrokenPipeError:
                    return

            def log_message(self, fmt, *args):
                return

        self.httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        print(f"MJPEG stream: http://0.0.0.0:{port}/stream", flush=True)

    def update(self, bgr: np.ndarray) -> None:
        ok, buf = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ok:
            return
        with self.lock:
            self.frame = buf.tobytes()


def main() -> int:
    args = parse_args()
    detector = TfliteModel(args.detect)
    classifier = TfliteModel(args.classify)
    print(
        f"detect input {detector.width}x{detector.height} {detector.input_dtype.__name__}",
        flush=True,
    )
    print(
        f"classify input {classifier.width}x{classifier.height} {classifier.input_dtype.__name__}",
        flush=True,
    )

    source = args.camera
    is_image = os.path.isfile(source) and source.lower().endswith((".jpg", ".jpeg", ".png", ".bmp"))
    cap = None
    if is_image:
        frame = cv2.imread(source)
        if frame is None:
            raise SystemExit(f"Cannot read image: {source}")
    else:
        cap = open_camera(source, args.width, args.height)

    http = MjpegServer(args.http) if args.http else None
    show = (not args.no_window) and bool(os.environ.get("DISPLAY") or sys.platform == "darwin")
    last_print = 0.0

    while True:
        if cap is not None:
            ok, frame = cap.read()
            if not ok:
                print("camera frame dropped", file=sys.stderr)
                time.sleep(0.05)
                continue
        view = split_stereo(frame, args.stereo)
        rgb = cv2.cvtColor(view, cv2.COLOR_BGR2RGB)
        boxes = detect_dice(detector, rgb, args.threshold)
        readings: List[DieReading] = []
        for box in boxes:
            pad = 8
            x1 = max(0, box["xmin"] - pad)
            y1 = max(0, box["ymin"] - pad)
            x2 = min(view.shape[1], box["xmax"] + pad)
            y2 = min(view.shape[0], box["ymax"] + pad)
            crop = view[y1:y2, x1:x2]
            crop_rgb = rgb[y1:y2, x1:x2]
            face, cscore, pips = "unknown", 0.0, 0
            blobs = None
            if args.method in ("model", "both"):
                face, cscore, pips = classify_face(classifier, crop_rgb)
            if args.method in ("pips", "both"):
                blobs = count_pip_blobs(crop)
            if args.method == "pips":
                pips = blobs or 0
                face = str(pips) if pips else None
            readings.append(
                DieReading(
                    xmin=x1,
                    ymin=y1,
                    xmax=x2,
                    ymax=y2,
                    detect_score=box["score"],
                    pips=pips or None,
                    face=face,
                    classify_score=cscore,
                    pip_blobs=blobs,
                )
            )
        overlay = draw_readings(view, readings)
        now = time.time()
        if args.json or now - last_print > 0.5:
            payload = {
                "t": now,
                "n": len(readings),
                "sum": sum(r.pips or 0 for r in readings),
                "dice": [asdict(r) for r in readings],
            }
            print(json.dumps(payload, ensure_ascii=False), flush=True)
            last_print = now
        if http:
            http.update(overlay)
        if show:
            cv2.imshow("dice", overlay)
            if cv2.waitKey(1) & 0xFF in (27, ord("q")):
                break
        if args.once or is_image:
            out_path = os.path.splitext(source)[0] + "_dice.jpg" if is_image else "dice_once.jpg"
            cv2.imwrite(out_path, overlay)
            print(f"wrote {out_path}", flush=True)
            break

    if cap is not None:
        cap.release()
    cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
