"""Normalize browser recording to exactly 750 frames and export review stills."""
from pathlib import Path
import subprocess,shutil,json
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parent
ff=imageio_ffmpeg.get_ffmpeg_exe()
def run(args): subprocess.run([ff,'-y',*args],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
run(['-i',str(ROOT/'recomposition.webm'),'-vf','setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration=2','-t','25','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(ROOT/'garden_film.mp4')])
shutil.copy2(ROOT/'garden_film.mp4',ROOT/'recomposition.mp4')
for time,name in [(3,'cosmos'),(12.5,'printer'),(18.5,'growth'),(24.8,'print')]:
    run(['-ss',str(time),'-i',str(ROOT/'garden_film.mp4'),'-frames:v','1',str(ROOT/f'garden_film_{name}.png')])
reader=imageio_ffmpeg.read_frames(str(ROOT/'garden_film.mp4'));metadata=next(reader);reader.close()
assert metadata['size']==(1280,720) and metadata['fps']==30 and abs(metadata['duration']-25)<.05
(ROOT/'garden_video_report.json').write_text(json.dumps({k:metadata[k] for k in ['size','fps','duration']},indent=2))
print('Verified: 25 seconds, 30 fps, 1280 x 720')
