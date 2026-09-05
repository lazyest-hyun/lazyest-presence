import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function publicFileIssues(file, text) {
  const issues = [];
  const add = (rule, index = 0) => issues.push({file, rule, line: text.slice(0, index).split('\n').length});
  if (/(^|\/)(work|outputs|node_modules|\.runtime)\//.test(file)
      || /(^|\/)(config\.json|state\.json|lid\.json|\.owner|operation\.lock|\.cli-m365[^/]*|\.env[^/]*)$/.test(file)
      || /\.(zip|plist|pem|key|p12|sqlite\d*)$/.test(file)) add('runtime-or-private-file');
  const patterns = [
    ['personal-absolute-path', /\/(?:Users|home)\/[a-z\d._-]+|[A-Z]:\\Users\\[^\\\s]+/gi],
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ['credential', /\b(?:ghp_[a-z\d]{30,}|github_pat_[a-z\d_]{40,}|AKIA[A-Z\d]{16}|Bearer\s+[a-z\d._-]{24,})/gi],
    ['jwt', /\beyJ[a-z\d_-]{20,}\.[a-z\d_-]{20,}\.[a-z\d_-]{20,}/gi]
  ];
  for (const [rule, pattern] of patterns) for (const match of text.matchAll(pattern)) add(rule, match.index);
  for (const match of text.matchAll(/\b[a-z\d._%+-]+@([a-z\d.-]+\.[a-z]{2,})\b/gi)) {
    const domain = match[1].toLowerCase();
    if (!['example.com', 'example.org', 'example.net'].includes(domain) && !domain.endsWith('.invalid')) add('non-example-email', match.index);
  }
  if (file.endsWith('.md')) {
    const prose = text.replace(/```[\s\S]*?```|`[^`\n]*`/g, value => value.replace(/[^\n]/g, ' '));
    for (const match of prose.matchAll(/(?<!\\)~/g)) add('unescaped-markdown-tilde', match.index);
  }
  return issues;
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const names = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
  const issues = names.flatMap(name => publicFileIssues(name, fs.readFileSync(path.join(root, name), 'utf8')));
  // Never print matched content: the failing value itself could be private.
  if (issues.length) { console.error(JSON.stringify({ok: false, issues}, null, 2)); process.exitCode = 1; }
  else console.log(JSON.stringify({ok: true, checkedFiles: names.length}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch { console.error('공개 파일 검사 실패. Git 추적 파일 목록을 확인하세요.'); process.exitCode = 1; }
}
