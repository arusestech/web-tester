import fs from 'node:fs';
import path from 'node:path';
import { compareLine } from './compare.js';
import { triage, triageSummary } from './triage.js';

export function statusIcon(r) {
  if (r.expected) return '🔒'; // 예상된 실패(정상) — expectFail 로 "막혀야 정상"이라 선언한 항목
  return r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️' : '❌';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toUrl = (p) => String(p).split(path.sep).join('/');

const secs = (ms) => (ms === undefined || ms === null ? '' : (ms / 1000).toFixed(1));

// 분류 → 색 클래스 (보고서 태그)
const TRI_CLS = {
  '서버 버그': 'tbug', '권한/세션': 'tauth', '안전장치 차단': 'tsafe', '시나리오 오류 의심': 'tscn',
  '데이터 부족': 'tdata', '화면 깨짐 의심': 'tlay', '느림': 'tslow', '환경 노이즈 의심': 'tnoise',
  '불안정(flaky)': 'tflaky', '미분류': 'tetc',
};

// 결함 목록 CSV (엑셀에서 바로 열리도록 UTF-8 BOM). 정상 항목은 제외
function writeDefectsCsv(results, outDir, cmp) {
  const bad = results.filter((r) => r.status !== 'ok');
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const head = ['번호', '시나리오', '항목', 'URL', '결과', '분류', '증상', '재현 경로', '소요(초)', '변화', '스크린샷'];
  const rows = bad.map((r, i) => {
    const idx = results.indexOf(r);
    const chg = cmp ? ({ added: '신규 항목', worse: '악화', better: '개선', same: '' }[cmp.changes[idx]] || '') : '';
    return [i + 1, r.scenario || '', r.name, r.url || '', r.status === 'fail' ? '실패' : '주의', r.triage?.type || '',
      (r.issues || []).map((x) => x.msg).join(' / '), r.path || '', secs(r.ms), chg, r.screenshot ? toUrl(r.screenshot) : ''].map(cell).join(',');
  });
  fs.writeFileSync(path.join(outDir, 'defects.csv'), '\uFEFF' + [head.map(cell).join(','), ...rows].join('\r\n'), 'utf8');
  return bad.length;
}

// 직전 실행 대비 변화 아이콘. compare.changes[i] + 이번 상태 조합
function chgCell(chg, status) {
  if (chg === 'added') return ['✚', '신규 항목'];
  if (chg === 'worse') return status === 'fail' ? ['🆕', '신규 실패'] : ['▲', '악화'];
  if (chg === 'better') return status === 'ok' ? ['✨', '해결됨'] : ['▽', '개선'];
  if (status === 'fail') return ['➖', '이전에도 실패'];
  return ['', ''];
}

// outDir 안에 report.html / report.md / report.json 을 쓴다. 스크린샷은 outDir 기준 상대경로.
// extra: { compare(직전 실행 비교), matrix(일괄 실행 권한/역할 매트릭스) }
export function writeReport(results, outDir, scenario, extra = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const scenarioName = scenario?.name || 'scenario';
  const when = new Date();
  const expected = results.filter((r) => r.expected).length; // 예상된 실패(정상 처리) — status 는 ok 지만 따로 센다
  const ok = results.filter((r) => r.status === 'ok' && !r.expected).length;
  const warn = results.filter((r) => r.status === 'warn').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const bad = results.filter((r) => r.status !== 'ok');
  const cmp = extra.compare || null;
  const matrix = extra.matrix || null;
  // 일괄 실행: 시나리오별 개별 증적(하위 폴더의 report.html)로 연결. [{ name, dir, ok, warn, fail, total, error }]
  const batch = (extra.batch && extra.batch.length) ? extra.batch : null;
  const dirOf = batch ? Object.fromEntries(batch.filter((b) => b.dir).map((b) => [b.name, b.dir])) : {};
  for (const r of results) if (!r.triage && r.status !== 'ok') r.triage = triage(r) || undefined; // 옛 결과·일괄 합산 대비
  const tri = triageSummary(results);
  const totalMs = results.reduce((n, r) => n + (r.ms || 0), 0);
  const slowest = [...results].filter((r) => r.ms).sort((a, b) => b.ms - a.ms).slice(0, 5);
  const defects = writeDefectsCsv(results, outDir, cmp);

  // ---------- Markdown ----------
  const md = [];
  md.push(`# 메뉴 테스트 결과 — ${scenarioName} (${when.toLocaleString()})`, '');
  md.push(`- 대상: ${scenario?.baseUrl || '-'}`, `- 실행 환경: ${process.platform} / node ${process.version}`, '');
  if (cmp) {
    md.push(`- 직전 실행 대비: ${compareLine(cmp)}`, `  (기준: ${cmp.prevDir} · ${new Date(cmp.prevRanAt).toLocaleString()} — 정상 ${cmp.prevSummary.ok} / 실패 ${cmp.prevSummary.fail} / 주의 ${cmp.prevSummary.warn})`, '');
  }
  md.push(`| # | 메뉴명 | URL | 결과 |${cmp ? ' 변화 |' : ''} 분류 | 소요(초) | 증상 요약 | 증적 |`, `|---|---|---|---|${cmp ? '---|' : ''}---|---|---|---|`);
  results.forEach((r, i) => {
    const summary = r.issues.length ? r.issues.map((x) => x.msg).slice(0, 2).join('; ') : '정상';
    const [ic, label] = cmp ? chgCell(cmp.changes[i], r.status) : ['', ''];
    md.push(`| ${i + 1} | ${r.name} | ${r.url || ''} | ${statusIcon(r)} |${cmp ? ` ${ic ? `${ic} ${label}` : ''} |` : ''} ${r.triage?.type || ''} | ${secs(r.ms)} | ${summary.replace(/\|/g, '\\|').slice(0, 160)} | ${r.screenshot ? `[캡처](${toUrl(r.screenshot)})` : ''} |`);
  });
  if (cmp && (cmp.newFail.length || cmp.fixed.length)) {
    md.push('', '## 직전 실행 대비 변화');
    if (cmp.newFail.length) md.push('', '### 🆕 이번에 새로 실패', ...cmp.newFail.map((n) => `- ${n}`));
    if (cmp.fixed.length) md.push('', '### ✨ 해결됨', ...cmp.fixed.map((n) => `- ${n}`));
    if (cmp.removed.length) md.push('', `### ⏭ 이번 실행에 없던 항목 (${cmp.removed.length})`, ...cmp.removed.slice(0, 30).map((n) => `- ${n}`));
  }
  if (batch) {
    md.push('', '## 시나리오별 보고서', '', '| 시나리오 | 정상 | 주의 | 실패 | 개별 보고서 |', '|---|---|---|---|---|');
    for (const b of batch) md.push(`| ${b.name} | ${b.ok ?? ''} | ${b.warn ?? ''} | ${b.fail ?? ''} | ${b.dir ? `[report.html](${toUrl(b.dir)}/report.html)` : (b.error ? `실행 실패: ${String(b.error).split('\n')[0]}` : '')} |`);
  }
  if (matrix) {
    md.push('', '## 시나리오별 매트릭스', '', `| 메뉴 | ${matrix.scenarios.join(' | ')} |`, `|---|${matrix.scenarios.map(() => '---').join('|')}|`);
    for (const row of matrix.rows) md.push(`| ${row.name} | ${row.cells.map((c) => (!c ? '·' : c.expected ? '🔒' : c.blocked ? '🚫' : c.status === 'ok' ? '✅' : c.status === 'warn' ? '⚠️' : '❌')).join(' | ')} |`);
  }
  if (bad.length) {
    md.push('', '## 상세');
    for (const r of bad) {
      md.push('', `### ${statusIcon(r)} ${r.name}`);
      md.push(`- 재현 경로: ${r.path || r.url || '-'}`);
      if (r.step) md.push(`- 실패 단계: ${r.step}`);
      for (const i of r.issues) md.push(`- [${i.level}] ${i.msg}`);
      if (r.trace) md.push('', '```', r.trace.trim(), '```');
      if (r.screenshot) md.push(`- 스크린샷: ${toUrl(r.screenshot)}`);
    }
  }
  // 총평 — 실행 로그에도 그대로 쓰인다 (writeReport 가 summary 로 돌려줌)
  const summary = [`전체 ${results.length}개 중 정상 ${ok} / 실패 ${fail} / 주의 ${warn}${expected ? ` / 예상된 실패 ${expected}(정상 처리)` : ''}`];
  if (cmp) summary.push(`직전 실행 대비: ${compareLine(cmp)}  (기준 ${cmp.prevDir})`);
  if (tri.length) summary.push(`증상 분류(1차, 규칙 기반): ${tri.map(([t, n]) => `${t} ${n}`).join(' / ')}`);
  if (totalMs) summary.push(`총 소요 ${(totalMs / 1000).toFixed(1)}초 · 오래 걸린 화면: ${slowest.map((r) => `${r.name} ${secs(r.ms)}초`).join(', ')}`);
  if (defects) summary.push(`결함 목록: defects.csv (${defects}건)`);
  md.push('', `## 총평`, ...summary);
  if (cmp?.slower?.length) md.push('', '### 🐢 직전보다 느려진 화면', ...cmp.slower.map((s) => `- ${s.name}: ${secs(s.before)}초 → ${secs(s.after)}초`));

  // ---------- HTML ----------
  const rows = results.map((r, i) => {
    const cls = r.expected ? 'expected' : r.status; // 예상된 실패는 '정상' 필터와 분리
    const issues = r.issues.length ? `<ul>${r.issues.map((x) => `<li class="${x.level}">${esc(x.msg)}</li>`).join('')}</ul>` : '<span class="okText">정상</span>';
    const [ic, label] = cmp ? chgCell(cmp.changes[i], r.status) : ['', ''];
    return `<tr class="${cls}${ic === '🆕' ? ' newfail' : ''}" id="r${i + 1}">
  <td>${i + 1}</td><td>${esc(r.name)}</td><td class="url" title="${esc(r.url || '')}">${esc(r.url || '')}</td>
  <td class="st">${statusIcon(r)}</td>${cmp ? `<td class="chg" title="${esc(label)}">${ic}</td>` : ''}
  <td class="tri">${r.triage ? `<span class="tag ${TRI_CLS[r.triage.type] || 'tetc'}" title="${esc(r.triage.why)}">${esc(r.triage.type)}</span>` : ''}</td>
  <td class="ms">${secs(r.ms)}</td><td>${issues}</td>
  <td>${r.screenshot ? `<a href="#s${i + 1}">보기</a>` : '-'}</td></tr>`;
  }).join('\n');

  const cmpBox = cmp ? `<div class="cmp">
  <b>직전 실행 대비</b>
  <span class="c-new">🆕 신규 실패 ${cmp.newFail.length}</span>
  <span class="c-fix">✨ 해결 ${cmp.fixed.length}</span>
  <span class="c-same">➖ 그대로 실패 ${cmp.stillFail.length}</span>
  ${cmp.added.length ? `<span>✚ 신규 항목 ${cmp.added.length}</span>` : ''}
  ${cmp.removed.length ? `<span>⏭ 이번 실행 제외 ${cmp.removed.length}</span>` : ''}
  <small>기준: ${esc(cmp.prevDir)} · ${esc(new Date(cmp.prevRanAt).toLocaleString())} (정상 ${cmp.prevSummary.ok} / 실패 ${cmp.prevSummary.fail} / 주의 ${cmp.prevSummary.warn})</small>
  ${cmp.newFail.length ? `<div class="c-list"><b>🆕 이번에 새로 실패:</b> ${cmp.newFail.map((n) => esc(n)).join(' · ')}</div>` : ''}
  ${cmp.fixed.length ? `<div class="c-list"><b>✨ 해결됨:</b> ${cmp.fixed.map((n) => esc(n)).join(' · ')}</div>` : ''}
  ${cmp.slower?.length ? `<div class="c-list"><b>🐢 느려짐:</b> ${cmp.slower.map((s) => `${esc(s.name)} ${secs(s.before)}→${secs(s.after)}초`).join(' · ')}</div>` : ''}
</div>` : '';

  // 분류 집계 + 소요시간 요약 + 결함 CSV 링크
  const triBox = `<div class="cmp tribox">
  ${tri.length ? `<b>증상 분류</b><span class="muted2">규칙 기반 1차 분류 — 최종 판단은 사람이</span><div class="c-list">${tri.map(([t, n]) => `<span class="tag ${TRI_CLS[t] || 'tetc'}">${esc(t)} ${n}</span>`).join(' ')}</div>` : ''}
  ${totalMs ? `<div class="c-list"><b>소요시간</b> 총 ${(totalMs / 1000).toFixed(1)}초 · 오래 걸린 화면: ${slowest.map((r) => `${esc(r.name)} <b>${secs(r.ms)}초</b>`).join(' · ')}</div>` : ''}
  ${defects ? `<div class="c-list"><b>결함 목록</b> <a href="defects.csv">defects.csv</a> <span class="muted2">(${defects}건 · 이 보고서와 같은 폴더에 있습니다 — 엑셀로 바로 열립니다)</span></div>` : ''}
</div>`;

  const cell = (c) => {
    if (!c) return '<td class="mx none" title="이 시나리오에는 없는 항목">·</td>';
    const ic = c.expected ? '🔒' : c.blocked ? '🚫' : c.status === 'ok' ? '✅' : c.status === 'warn' ? '⚠️' : '❌';
    return `<td class="mx ${c.expected ? 'expected' : c.blocked ? 'blocked' : c.status}" title="${esc(c.msg || '정상')}">${ic}</td>`;
  };
  // 시나리오별 개별 보고서 링크 (일괄 실행에서만). 각 시나리오의 하위 폴더 report.html 로 이동
  const batchBox = batch ? `<h2>시나리오별 보고서 <small>각 시나리오의 개별 증적으로 이동</small></h2>
<table class="batcht"><thead><tr><th>시나리오</th><th>결과 (정상/주의/실패)</th><th>개별 보고서</th></tr></thead>
<tbody>${batch.map((b) => {
    const st = b.error ? '<span class="bbad">실행/읽기 실패</span>'
      : `<span class="bok">✅ ${b.ok || 0}</span> · <span class="bwarn">⚠️ ${b.warn || 0}</span> · <span class="bbad">❌ ${b.fail || 0}</span>`;
    const link = b.dir ? `<a href="${toUrl(b.dir)}/report.html" target="_blank">📄 보고서 열기</a>`
      : (b.error ? `<span class="muted2">${esc(String(b.error).split('\n')[0])}</span>` : '-');
    return `<tr class="${b.error || b.fail ? 'fail' : b.warn ? 'warn' : ''}"><td>${esc(b.name)}</td><td class="bst">${st}</td><td>${link}</td></tr>`;
  }).join('')}</tbody></table>` : '';

  const matrixBox = matrix ? `<h2>시나리오별 매트릭스 <small>행 = 항목, 열 = 시나리오(역할)</small></h2>
<div class="mxlegend">✅ 정상 · ⚠️ 주의 · ❌ 실패 · 🔒 예상된 실패(정상) · 🚫 차단(권한 없음 패턴) · · 해당 시나리오에 없음 &nbsp; <small>칸에 마우스를 올리면 증상 · 열 제목을 누르면 그 시나리오 보고서</small></div>
<div class="mxwrap"><table class="mxt"><thead><tr><th class="mxh">항목</th>${matrix.scenarios.map((s) => `<th>${dirOf[s] ? `<a href="${toUrl(dirOf[s])}/report.html" target="_blank">${esc(s)}</a>` : esc(s)}</th>`).join('')}</tr></thead>
<tbody>${matrix.rows.map((row) => `<tr><th class="mxh">${esc(row.name)}</th>${row.cells.map(cell).join('')}</tr>`).join('\n')}</tbody>
<tfoot><tr><th class="mxh">합계 (정상/주의/실패)</th>${matrix.totals.map((t) => `<th class="mxsum">${t.ok}/${t.warn}/${t.fail}</th>`).join('')}</tr></tfoot></table></div>` : '';

  const shots = results.filter((r) => r.screenshot).map((r) => {
    const i = results.indexOf(r) + 1;
    const newf = cmp && chgCell(cmp.changes[results.indexOf(r)], r.status)[0] === '🆕' ? ' newfail' : '';
    return `<section class="shot ${r.expected ? 'expected' : r.status}${newf}" id="s${i}">
  <h3>${statusIcon(r)} ${i}. ${esc(r.name)} <small>${esc(r.url || '')}</small></h3>
  ${r.path ? `<div class="meta">경로: ${esc(r.path)}</div>` : ''}
  ${r.at ? `<div class="meta">시각: ${esc(r.at)}${r.ms ? ` · 소요 ${secs(r.ms)}초` : ''}${r.triage ? ` · 분류 ${esc(r.triage.type)}` : ''}</div>` : ''}
  ${r.issues.length ? `<ul>${r.issues.map((x) => `<li class="${x.level}">${esc(x.msg)}</li>`).join('')}</ul>` : ''}
  ${r.trace ? `<pre>${esc(r.trace.trim())}</pre>` : ''}
  <a href="${toUrl(r.screenshot)}" target="_blank"><img src="${toUrl(r.screenshot)}" alt="${esc(r.name)}"></a>
</section>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>메뉴 테스트 증적 — ${esc(scenarioName)}</title>
<style>
  body{font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif;margin:24px;color:#222;background:#fafafa}
  h1{font-size:22px;margin:0 0 4px} .sub{color:#666;margin-bottom:16px}
  h2{font-size:17px;margin:24px 0 8px} h2 small{font-weight:normal;color:#888;font-size:12px}
  .sum{display:flex;gap:12px;margin:12px 0 20px}
  .sum{align-items:center;flex-wrap:wrap}
  .sum div{padding:10px 16px;border-radius:8px;background:#fff;border:1px solid #ddd;font-weight:bold}
  .sum .ok{border-color:#3a3;color:#2a7} .sum .warn{border-color:#ca3;color:#b80} .sum .fail{border-color:#d33;color:#c22}
  .sum .newfail{border-color:#c22;color:#c22;background:#fff3f3}
  .sum .f{cursor:pointer;user-select:none} .sum .f:hover{box-shadow:0 0 0 2px #cfd8e3}
  .sum .f.on{box-shadow:0 0 0 2px #36c inset;background:#eef4fc}
  .fhint{color:#999;font-size:12px;font-weight:normal}
  tr.hide,section.shot.hide{display:none}
  #nores{display:none;padding:12px;color:#888;background:#fff;border:1px dashed #ddd;border-radius:8px;margin-top:8px}
  .cmp{background:#fff;border:1px solid #ddd;border-left:4px solid #36c;border-radius:8px;padding:10px 14px;margin:0 0 18px;font-size:13px}
  .cmp b{margin-right:10px} .cmp span{display:inline-block;margin-right:12px;font-weight:bold}
  .cmp .c-new{color:#c22} .cmp .c-fix{color:#2a7} .cmp .c-same{color:#888}
  .cmp small{display:block;color:#888;font-weight:normal;margin-top:4px}
  .cmp .c-list{margin-top:6px;color:#444;font-weight:normal;line-height:1.6}
  table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}
  th,td{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left}
  th{background:#f0f0f0} tr.fail td{background:#fff3f3} tr.warn td{background:#fffbea} tr.newfail td{background:#ffe9e9} tr.expected td{background:#eef6f0}
  li.expected{color:#2a7} .sum .expected{border-color:#3a9;color:#297}
  td.st{text-align:center;font-size:16px} td.chg{text-align:center;font-size:14px}
  td.url{font-family:monospace;font-size:12px;max-width:340px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  td.ms{text-align:right;font-family:monospace;font-size:12px;color:#555;white-space:nowrap} td.tri{white-space:nowrap}
  .tag{display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;border:1px solid #ccc;background:#f4f4f4;color:#444;white-space:nowrap}
  .tbug{background:#fde8e8;border-color:#e2a0a0;color:#a11} .tauth{background:#efe6fb;border-color:#bda3e0;color:#639}
  .tsafe{background:#e8f0fd;border-color:#a3bce0;color:#249} .tscn{background:#fff3d6;border-color:#dcbb6b;color:#864}
  .tdata{background:#eef7ee;border-color:#a8caa8;color:#375} .tlay{background:#fdf0e6;border-color:#dcb08a;color:#a63}
  .tslow{background:#f0f0f0;border-color:#bbb;color:#555} .tnoise{background:#f4f4f4;border-color:#ccc;color:#777}
  .tflaky{background:#fff8cc;border-color:#d8c76a;color:#875}
  .tribox b{margin-right:8px} .muted2{color:#888;font-size:12px;font-weight:normal}
  .batcht{margin-bottom:8px} .batcht .bst{white-space:nowrap} .batcht a{color:#36c}
  .bok{color:#2a7} .bwarn{color:#b80} .bbad{color:#c22} .bbad{font-weight:bold}
  ul{margin:0;padding-left:18px} li.fail{color:#c22} li.warn{color:#b80} .okText{color:#2a7}
  .mxwrap{overflow-x:auto;border:1px solid #ddd;border-radius:6px;background:#fff}
  .mxt{width:auto;min-width:100%;border:none;font-size:12px}
  .mxt th,.mxt td{border:1px solid #e5e5e5;padding:4px 6px;white-space:nowrap}
  .mxt thead th{position:sticky;top:0;background:#f0f0f0;z-index:2}
  .mxh{position:sticky;left:0;background:#fafafa;text-align:left;max-width:320px;overflow:hidden;text-overflow:ellipsis;z-index:1}
  .mxt thead th:first-child{z-index:3}
  td.mx{text-align:center;font-size:14px;cursor:default}
  td.mx.fail{background:#fff3f3} td.mx.warn{background:#fffbea} td.mx.blocked{background:#f2f2f7} td.mx.expected{background:#eef6f0} td.mx.none{color:#ccc}
  .mxsum{text-align:center;font-size:11px;color:#555;background:#fafafa}
  .mxlegend{color:#666;font-size:12px;margin-bottom:6px}
  .shot{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;margin:16px 0}
  .shot.fail{border-color:#d33} .shot.warn{border-color:#ca3} .shot.expected{border-color:#3a9}
  .shot h3{margin:0 0 6px;font-size:15px} .shot small{color:#666;font-weight:normal;font-family:monospace;word-break:break-all}
  .meta{color:#666;font-size:12px;margin:2px 0}
  .shot img{max-width:100%;border:1px solid #ccc;margin-top:8px}
  pre{background:#222;color:#eee;padding:8px;font-size:12px;overflow:auto}
  #toTop{position:fixed;right:22px;bottom:22px;width:44px;height:44px;border-radius:50%;border:none;background:#36c;color:#fff;font-size:20px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3);display:none;z-index:8;opacity:.85} #toTop:hover{opacity:1}
</style></head><body>
<h1>메뉴 테스트 증적 — ${esc(scenarioName)}</h1>
<div class="sub">${esc(when.toLocaleString())} · 대상 ${esc(scenario?.baseUrl || '-')} · ${esc(process.platform)} / node ${esc(process.version)}</div>
<div class="sum">
  <div class="f on" data-f="all">전체 ${results.length}</div>
  <div class="f ok" data-f="ok">정상 ${ok}</div>
  <div class="f fail" data-f="fail">실패 ${fail}</div>
  <div class="f warn" data-f="warn">주의 ${warn}</div>
  ${expected ? `<div class="f expected" data-f="expected" title="expectFail 로 '막혀야 정상'이라 선언한 항목 — 실패로 세지 않음">🔒 예상된 실패 ${expected}</div>` : ''}
  ${cmp && cmp.newFail.length ? `<div class="f newfail" data-f="newfail">🆕 신규 실패 ${cmp.newFail.length}</div>` : ''}
  <span class="fhint">칸을 누르면 그 항목만 보입니다</span>
</div>
${cmpBox}
${triBox}
${batchBox}
<table id="tbl"><thead><tr><th>#</th><th>메뉴명</th><th>URL</th><th>결과</th>${cmp ? '<th title="직전 실행과 비교">변화</th>' : ''}<th title="규칙 기반 1차 분류 — 칸에 마우스를 올리면 근거">분류</th><th title="이 항목 실행에 걸린 시간">초</th><th>증상</th><th>증적</th></tr></thead>
<tbody>${rows}</tbody></table>
<div id="nores">이 조건에 해당하는 항목이 없습니다.</div>
${matrixBox}
<h2>화면 증적</h2>
${shots || '<p>스크린샷 없음</p>'}
<button id="toTop" title="맨 위로" onclick="window.scrollTo({top:0,behavior:'smooth'})">↑</button>
<script>
// 맨 위로 버튼: 아래로 내려가면 보이고, 누르면 맨 위로
(function () { var b = document.getElementById('toTop'); function u() { b.style.display = (window.scrollY || document.documentElement.scrollTop) > 300 ? 'block' : 'none'; } window.addEventListener('scroll', u); u(); })();
// 요약 칸(전체/정상/실패/주의/신규 실패)을 누르면 그 항목만 보여 준다. 표와 아래 스크린샷이 함께 걸러진다.
(function () {
  var btns = document.querySelectorAll('.sum .f');
  var rows = document.querySelectorAll('#tbl tbody tr');
  var shots = document.querySelectorAll('section.shot');
  var none = document.getElementById('nores');
  function apply(f) {
    var n = 0;
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-f') === f);
    function hit(el) { return f === 'all' || el.classList.contains(f); }
    for (var j = 0; j < rows.length; j++) { var s = hit(rows[j]); rows[j].classList.toggle('hide', !s); if (s) n++; }
    for (var k = 0; k < shots.length; k++) shots[k].classList.toggle('hide', !hit(shots[k]));
    if (none) none.style.display = n ? 'none' : 'block';
    try { history.replaceState(null, '', f === 'all' ? location.pathname : '#f=' + f); } catch (e) { /* file:// */ }
  }
  for (var b = 0; b < btns.length; b++) (function (el) { el.addEventListener('click', function () { apply(el.getAttribute('data-f')); }); })(btns[b]);
  var m = (location.hash || '').match(/f=(\\w+)/);
  if (m) apply(m[1]);
})();
</script>
</body></html>`;

  const mdPath = path.join(outDir, 'report.md');
  const jsonPath = path.join(outDir, 'report.json');
  const htmlPath = path.join(outDir, 'report.html');
  fs.writeFileSync(mdPath, md.join('\n'), 'utf8');
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify({ scenario: scenarioName, file: scenario?._file, baseUrl: scenario?.baseUrl, ranAt: when.toISOString(), platform: process.platform, node: process.version, partial: extra.partial || undefined, results, ok, warn, fail, expected, defects, totalMs, triage: Object.fromEntries(tri), compare: cmp || undefined, matrix: matrix || undefined }, null, 2), 'utf8');
  return { outDir, mdPath, jsonPath, htmlPath, csvPath: path.join(outDir, 'defects.csv'), ok, warn, fail, expected, defects, total: results.length, compare: cmp, summary, text: md.join('\n') };
}
