const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
let running = 0;
const MAX_PARALLEL = 2;

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

function findPom(dir, depth = 0) {
  if (fs.existsSync(path.join(dir, 'pom.xml'))) return dir;
  if (depth >= 2) return null;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) {
      const r = findPom(path.join(dir, f.name), depth + 1);
      if (r) return r;
    }
  }
  return null;
}

app.post('/build', upload.single('project'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });
  if (running >= MAX_PARALLEL) return res.status(429).json({ error: 'השרת עסוק, נסה שוב בעוד דקה' });

  const workDir = path.join(os.tmpdir(), 'job-' + crypto.randomUUID());
  fs.mkdirSync(workDir, { recursive: true });
  const cleanup = () => fs.rmSync(workDir, { recursive: true, force: true });

  try {
    const zip = new AdmZip(req.file.buffer);
    for (const e of zip.getEntries()) {
      const target = path.resolve(workDir, e.entryName);
      if (!target.startsWith(workDir + path.sep)) throw new Error('ZIP לא חוקי');
    }
    zip.extractAllTo(workDir, true);
  } catch (e) {
    cleanup();
    return res.status(400).json({ error: 'לא הצלחתי לפתוח את ה-ZIP' });
  }

  const pomDir = findPom(workDir);
  if (!pomDir) {
    cleanup();
    return res.status(400).json({ error: 'לא נמצא pom.xml ב-ZIP' });
  }

  running++;
  execFile('mvn', ['-B', 'package', '-DskipTests'],
    { cwd: pomDir, timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout, stderr) => {
      running--;
      const targetDir = path.join(pomDir, 'target');
      const jar = fs.existsSync(targetDir)
        ? fs.readdirSync(targetDir).find(f => f.endsWith('.jar') && !f.startsWith('original-') && !f.endsWith('-sources.jar'))
        : null;

      if (err || !jar) {
        const log = (stdout + '\n' + stderr).slice(-4000);
        cleanup();
        return res.status(422).json({ error: 'הקימפול נכשל', log });
      }
      res.download(path.join(targetDir, jar), jar, cleanup);
    });
});

app.listen(process.env.PORT || 3000, () => console.log('running'));
