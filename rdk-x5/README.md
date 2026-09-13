# RDK X5 骰子点数识别

地瓜 RDK X5：刷官方 Ubuntu 22.04，部署现成开源骰子模型，USB / 双目摄像头实时读点数。

## 硬件现状

刷机介质是 **Micro SD**，不是直接往芯片里写系统。本机需要：

- ≥16GB Micro SD + USB 读卡器（推荐，macOS 用 `dd`）
- 或板载 USB-C Device 口进烧录模式（官方 XBurn / RDK Studio）

默认账号 `sunrise` / `sunrise`，root 是 `root` / `root`。  
有线 `192.168.127.10`，Type-C 闪连 `192.168.128.10`。

## 1. 刷 Ubuntu

镜像：官方 RDK OS **3.5.0 Desktop**（Ubuntu 22.04 ARM64）

```
https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.5.0-2026-4-9/
rdk-x5-ubuntu22-preinstalled-desktop-3.5.0-arm64.img.xz
```

本机下载目录：`~/Downloads/rdk-x5/`。下载完成后：

1. 把 SD 卡插进读卡器，接到这台 Mac
2. `bash rdk-x5/scripts/flash_ubuntu.sh`
3. 确认磁盘后输入 `FLASH`
4. 弹出 SD，插入 RDK X5，上电

## 2. 模型

未自行训练。使用 [skovy/tensorflow-dice-model](https://github.com/skovy/tensorflow-dice-model) 已发布的 TFLite：

| 文件 | 网络 | 作用 |
|---|---|---|
| `deploy/models/die_detection.tflite` | EfficientDet-Lite3 | 找骰子 |
| `deploy/models/die_classification.tflite` | ResNet-50 | 面值 1–6 |

类别顺序（Model Maker 按文件夹名排序）：`five, four, one, six, three, two`。  
另有 OpenCV 圆点计数作为第二票。

板端走 CPU TFLite，插上就能跑；不依赖再转 BPU `.bin`。

## 3. 摄像头

UVC USB 摄像头（含左右拼接的双目）直接 `cv2.VideoCapture`：

```bash
# 板端
python3 ~/dice/dice_recognizer.py --camera 0 --stereo auto --http 8080 --no-window
```

- `--stereo auto`：画面过宽时按左右目切开，默认用左目
- `--stereo left|right`：强制某一目
- 浏览器看流：`http://<板子IP>:8080/stream`

把识别程序拷到板上：

```bash
bash rdk-x5/deploy/push_to_board.sh 192.168.127.10
```
