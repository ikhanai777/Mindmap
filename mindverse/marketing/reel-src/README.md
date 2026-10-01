# Reel generator

`reel.mjs` drives the real Mindverse app in headless Chromium. It steps the page's animation clock one video frame at a time and saves a 1080×1920 screenshot of each frame (24 fps). `music.py` synthesizes the soundtrack, and ffmpeg combines the two.

```bash
cd mindverse && npm run build && npx vite preview --port 4174 &
node marketing/reel-src/reel.mjs /tmp/reel s1 s2 s3 s4 s5 s6 s7   # frames per scene
python3 marketing/reel-src/music.py /tmp/music.wav 29.25 3.0,7.0,12.583,17.083,20.917,25.25
# number the frames in scene order (s1…s7) into one folder, then:
ffmpeg -framerate 24 -i all/%05d.jpg -i /tmp/music.wav -c:v libx264 -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -shortest -movflags +faststart mindverse-reel.mp4
```

Set `FPS=3` for a quick dry run of the scene logic.
