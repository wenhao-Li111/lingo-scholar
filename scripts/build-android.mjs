/** Dependency-free Android build. JDK 17 + Android SDK platform/build-tools 35 required.
 * Signing material stays outside the source distribution; never print passwords. */
import { mkdirSync, mkdtempSync, cpSync, existsSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = process.env.ANDROID_HOME;
const javaHome = process.env.JAVA_HOME;
if (!sdk || !javaHome) throw new Error('Set ANDROID_HOME and JAVA_HOME (JDK 17).');
const java = name => path.join(javaHome, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
const bt = path.join(sdk, 'build-tools', '35.0.0');
const binary = name => path.join(bt, name + (process.platform === 'win32' ? '.exe' : ''));
// aapt2 on Windows cannot reliably open Unicode source paths. Build in a fresh
// temporary staging directory and copy only deliverables back to the project.
const out = mkdtempSync(path.join(os.tmpdir(), 'lingo-android-'));
const platform = path.join(out, 'android.jar');
copyFileSync(path.join(sdk, 'platforms', 'android-35', 'android.jar'), platform);
const source = path.join(out, 'source');
cpSync(path.join(root, 'apps/android'), source, { recursive: true });
const destination = path.join(root, 'dist/android');
mkdirSync(destination, { recursive: true });
const classes = path.join(out, 'classes');
mkdirSync(classes, { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, { cwd: out, encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.stderr || result.stdout || result.error}`);
  if (result.stdout) process.stdout.write(result.stdout);
}
const unsigned = path.join(out, 'unsigned.apk');
run(binary('aapt2'), ['compile', '--dir', path.join(source, 'res'), '-o', path.join(out, 'resources.zip')]);
run(binary('aapt2'), ['link', '-o', unsigned, '-I', platform, '--manifest', path.join(source, 'AndroidManifest.xml'), path.join(out, 'resources.zip')]);
run(java('javac'), ['-encoding', 'UTF-8', '--release', '8', '-classpath', platform, '-d', classes, path.join(source, 'src/io/github/wenhao_li111/lingoscholar/MainActivity.java')]);
run(java('jar'), ['cf', path.join(out, 'classes.jar'), '-C', classes, '.']);
run(java('java'), ['-cp', path.join(bt, 'lib/d8.jar'), 'com.android.tools.r8.D8', '--release', '--min-api', '26', '--lib', platform, '--output', out, path.join(out, 'classes.jar')]);
run(java('jar'), ['uf', unsigned, '-C', out, 'classes.dex']);
const aligned = path.join(out, 'aligned.apk');
run(binary('zipalign'), ['-f', '4', unsigned, aligned]);
if (process.argv.includes('--unsigned')) {
  copyFileSync(aligned, path.join(destination, 'lingo-scholar-unsigned.apk'));
  console.log('Unsigned build complete; not installable until signed.');
} else {
  const keydir = path.resolve(process.env.LINGO_ANDROID_KEY_DIR || path.join(root, 'data/deploy-private/android-signing'));
  mkdirSync(keydir, { recursive: true, mode: 0o700 });
  const key = path.join(keydir, 'release.p12');
  const password = path.join(keydir, 'password.txt');
  if (!existsSync(key)) {
    // Refuse to overwrite an existing password from a partially completed key generation.
    if (!existsSync(password)) writeFileSync(password, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    run(java('keytool'), ['-genkeypair', '-keystore', key, '-storetype', 'PKCS12', '-storepass:file', password,
      '-alias', 'lingo-release', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Lingo Scholar Android, O=Lingo Scholar, C=CN']);
  }
  const apk = path.join(out, 'lingo-scholar-1.0.0.apk');
  run(java('java'), ['-jar', path.join(bt, 'lib/apksigner.jar'), 'sign', '--ks', key, '--ks-pass', `file:${password}`, '--ks-key-alias', 'lingo-release', '--out', apk, aligned]);
  run(java('java'), ['-jar', path.join(bt, 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', apk]);
  const hash = createHash('sha256').update(readFileSync(apk)).digest('hex');
  copyFileSync(apk, path.join(destination, 'lingo-scholar-1.0.0.apk'));
  writeFileSync(path.join(destination, 'SHA256SUMS.txt'), `${hash}  lingo-scholar-1.0.0.apk\n`);
  console.log(`Signed APK: ${path.join(destination, 'lingo-scholar-1.0.0.apk')}\nSHA-256: ${hash}`);
}
