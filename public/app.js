'use strict';
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => n.append(k));
  return n;
};

const keyInput = $('#apiKey');
keyInput.value = sessionStorage.getItem('apiKey') || '';
keyInput.addEventListener('change', () => sessionStorage.setItem('apiKey', keyInput.value));

// Every call goes through here, so the "API activity" panel shows exactly what the backend did.
async function api(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (keyInput.value) headers['x-api-key'] = keyInput.value;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  const log = el('details', {}, el('summary', { textContent: `${method} ${path} → ${res.status}`, className: res.ok ? 'ok' : 'err' }),
    el('pre', { textContent: (body ? 'request: ' + JSON.stringify(body) + '\n' : '') + JSON.stringify(json, null, 2) }));
  $('#log').prepend(log);
  if (!res.ok) throw new Error(json.error?.details?.map((d) => `${d.field} ${d.message}`).join('; ') || json.error?.message || res.statusText);
  return json;
}

let view = { path: '/api/patients?limit=100', label: 'All patients' };

async function loadPatients() {
  try {
    const out = await api('GET', view.path);
    const tbody = $('#patients tbody');
    tbody.replaceChildren(...out.data.map((p) => el('tr', {},
      el('td', { textContent: p.id }), el('td', { textContent: p.name }), el('td', { textContent: p.phone }),
      el('td', { textContent: p.consultationDate }), el('td', { textContent: p.nextFollowUpDate }),
      el('td', {}, el('span', { className: `pill ${p.followUpStatus}`, textContent: p.followUpStatus })),
      el('td', {}, p.followUpStatus === 'pending'
        ? el('button', { className: 'ghost', textContent: 'Mark completed', onclick: () => complete(p.id) }) : ''))));
    $('#listMeta').textContent = `${view.label}: ${out.data.length} shown`;
  } catch (e) { $('#listMeta').textContent = e.message; }
}
async function complete(id) {
  try { await api('PATCH', `/api/patients/${id}/follow-up`, { status: 'completed' }); } catch (e) { alert(e.message); }
  loadPatients();
}

$('#addForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const data = Object.fromEntries(new FormData(ev.target));
  if (!data.notes) delete data.notes;
  const msg = $('#formMsg');
  try {
    const out = await api('POST', '/api/patients', data);
    msg.className = 'msg ok'; msg.textContent = `Added patient #${out.data.id}`;
    ev.target.reset(); loadPatients();
  } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; }
});

const setView = (path, label) => () => { view = { path, label }; loadPatients(); };
$('#btnAll').onclick = setView('/api/patients?limit=100', 'All patients');
$('#btnDue').onclick = setView('/api/patients/due-today', 'Due today');
$('#btnOverdue').onclick = setView('/api/patients/due-today?includeOverdue=true', 'Due or overdue');
$('#btnClear').onclick = () => $('#log').replaceChildren();

function draftCard(d) {
  const ta = el('textarea', { value: d.message, disabled: d.status !== 'pending_review' });
  const status = el('span', { className: `pill ${d.status}`, textContent: d.status.replace('_', ' ') });
  const btns = el('div', { className: 'btns' });
  const act = (fn) => async () => { try { await fn(); } catch (e) { alert(e.message); } loadDrafts(); };
  if (d.status === 'pending_review') {
    const who = () => prompt('Reviewer name:', sessionStorage.getItem('reviewer') || '');
    const withReviewer = (path) => async () => {
      const reviewer = who(); if (!reviewer) return;
      sessionStorage.setItem('reviewer', reviewer);
      if (ta.value !== d.message) await api('PATCH', `/api/followups/drafts/${d.id}`, { message: ta.value });
      await api("POST", `/api/followups/drafts/${d.id}/${path}`, { reviewer });
    };
    btns.append(el('button', { textContent: 'Approve', onclick: act(withReviewer('approve')) }),
      el('button', { className: 'danger', textContent: 'Reject', onclick: act(withReviewer('reject')) }));
  } else if (d.status === 'approved') {
    btns.append(el('a', { target: '_blank', rel: 'noopener noreferrer', textContent: 'Open in WhatsApp to send manually →',
      href: `https://wa.me/${d.patientPhone.slice(1)}?text=${encodeURIComponent(d.message)}` }),
      el('span', { className: 'hint', textContent: `approved by ${d.reviewedBy}` }));
  } else btns.append(el('span', { className: 'hint', textContent: `rejected by ${d.reviewedBy}` }));
  return el('div', { className: 'draft' },
    el('header', {}, el('strong', { textContent: `${d.patientName} (${d.patientPhone})` }),
      el('span', {}, status, ' ', el('code', { textContent: d.source === 'ai' ? `AI · ${d.model}` : 'MOCK (no API key)' }))),
    ta, btns);
}
async function loadDrafts() {
  try {
    const out = await api('GET', '/api/followups/drafts');
    $('#drafts').replaceChildren(...(out.data.length ? out.data.map(draftCard) : [el('p', { className: 'hint', textContent: 'No drafts yet.' })]));
  } catch (e) { $('#drafts').textContent = e.message; }
}
$('#btnGen').onclick = async () => {
  try {
    const out = await api('POST', '/api/followups/generate', {});
    $('#btnGen').textContent = `Generated ${out.meta.created} (skipped ${out.meta.skippedExisting} existing)`;
  } catch (e) { alert(e.message); }
  loadDrafts();
};

loadPatients(); loadDrafts();
