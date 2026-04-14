'use strict';

/* ═══════════════════════════════════════════════════════════
   CAS — Class Attendance System · KNUST
   Full functionality: navigation, validation, access codes,
   student roster, attendance records, stats, persistence.
═══════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────
const state = {
	lecturerName: '',
	students: JSON.parse(localStorage.getItem('cas_students') || '[]'),
	attendanceRecords: JSON.parse(localStorage.getItem('cas_records') || '[]'),
	activeCodes: JSON.parse(localStorage.getItem('cas_codes') || '{}'), // { code: { course, expires } }
	sessionsCount: parseInt(localStorage.getItem('cas_sessions') || '0'),
	codeTimerInterval: null,
};

// ── Persist helpers ────────────────────────────────────────
function persist() {
	localStorage.setItem('cas_students', JSON.stringify(state.students));
	localStorage.setItem('cas_records', JSON.stringify(state.attendanceRecords));
	localStorage.setItem('cas_codes', JSON.stringify(state.activeCodes));
	localStorage.setItem('cas_sessions', String(state.sessionsCount));
}

// ── Utility ────────────────────────────────────────────────
function now() {
	return Date.now();
}

function generateCode() {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	return Array.from(
		{ length: 6 },
		() => chars[Math.floor(Math.random() * chars.length)],
	).join('');
}

function formatTime(ms) {
	const total = Math.max(0, Math.floor(ms / 1000));
	const m = String(Math.floor(total / 60)).padStart(2, '0');
	const s = String(total % 60).padStart(2, '0');
	return `${m}:${s}`;
}

function getInitials(name) {
	return name
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map((w) => w[0])
		.join('')
		.toUpperCase();
}

function courseName(code) {
	const map = {
		CE155: 'Environmental Studies',
		COE153: 'Engineering Technology',
		COE181: 'Applied Electricity',
		ENGL157: 'Communication Skills I',
		MATH151: 'Algebra',
		ME159: 'Technical Drawing',
		ME161: 'Basic Mechanics',
		AI150: 'Responsible AI',
	};
	return code ? `${code} · ${map[code] || code}` : '—';
}

function timeAgo(ts) {
	const diff = now() - ts;
	if (diff < 60000) return 'Just now';
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
	return new Date(ts).toLocaleDateString();
}

// ── Navigation ─────────────────────────────────────────────
function showSection(id) {
	document.querySelectorAll('.panel').forEach((p) => {
		p.classList.add('hidden');
		p.classList.remove('active');
	});
	const target = document.getElementById(`section-${id}`);
	if (target) {
		target.classList.remove('hidden');
		target.classList.add('active');
	}
}

// ── Toast ──────────────────────────────────────────────────
function toast(message, type = 'info', duration = 4000) {
	const icons = {
		success: 'fa-check-circle',
		error: 'fa-exclamation-circle',
		info: 'fa-info-circle',
	};
	const el = document.createElement('div');
	el.className = `toast ${type}`;
	el.innerHTML = `
    <i class="fas ${icons[type] || icons.info} toast-icon"></i>
    <span class="toast-message">${message}</span>
    <i class="fas fa-times toast-close"></i>`;
	const container = document.getElementById('toast-container');
	container.appendChild(el);
	el.querySelector('.toast-close').addEventListener('click', () =>
		dismissToast(el),
	);
	setTimeout(() => dismissToast(el), duration);
}

function dismissToast(el) {
	el.style.opacity = '0';
	el.style.transform = 'translateX(40px)';
	el.style.transition = 'all 0.3s ease';
	setTimeout(() => el.remove(), 300);
}

// ── Confirm Modal ──────────────────────────────────────────
function confirm(title, body) {
	return new Promise((resolve) => {
		const modal = document.getElementById('confirm-modal');
		document.getElementById('modal-title').textContent = title;
		document.getElementById('modal-body').textContent = body;
		modal.classList.add('active');

		const cleanup = () => modal.classList.remove('active');

		document.getElementById('modal-confirm').onclick = () => {
			cleanup();
			resolve(true);
		};
		document.getElementById('modal-cancel').onclick = () => {
			cleanup();
			resolve(false);
		};
	});
}

// ── Validation ─────────────────────────────────────────────
function getValidationRules(fieldId) {
	const EmailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const rules = {
		'student-name': { required: true, label: 'Name', minLen: 2 },
		'student-email': {
			required: true,
			label: 'Email',
			pattern: EmailRe,
			patternMsg: 'Enter a valid email',
		},
		'student-course': { required: true, label: 'Course' },
		'student-access-code': {
			required: true,
			label: 'Access code',
			minLen: 6,
			maxLen: 6,
			custom: validateCode,
		},
		'lecturer-email': {
			required: true,
			label: 'Email',
			pattern: EmailRe,
			patternMsg: 'Enter a valid email',
		},
		'lecturer-id': { required: true, label: 'Lecturer ID', minLen: 5 },
		'lecturer-password': { required: true, label: 'Password' },
		'add-student-name': { required: true, label: 'Name', minLen: 2 },
		'add-student-email': {
			required: true,
			label: 'Email',
			pattern: EmailRe,
			patternMsg: 'Enter a valid email',
		},
		'add-student-course': { required: true, label: 'Course' },
	};
	return rules[fieldId] || null;
}

function validateCode(value) {
	const upper = value.toUpperCase();
	pruneExpiredCodes();
	if (!state.activeCodes[upper]) return 'Invalid or expired access code';
	return null;
}

function validateField(input) {
	const rules = getValidationRules(input.id);
	if (!rules) return true;

	const value = input.value.trim();
	const errorEl = input.closest('.form-group')?.querySelector('.error-text');
	let msg = '';

	if (rules.required && !value) {
		msg = `${rules.label} is required`;
	} else if (value && rules.minLen && value.length < rules.minLen) {
		msg = `${rules.label} must be at least ${rules.minLen} characters`;
	} else if (value && rules.maxLen && value.length > rules.maxLen) {
		msg = `${rules.label} must be exactly ${rules.maxLen} characters`;
	} else if (value && rules.pattern && !rules.pattern.test(value)) {
		msg = rules.patternMsg || `Invalid ${rules.label}`;
	} else if (value && rules.custom) {
		msg = rules.custom(value) || '';
	}

	const valid = !msg;
	input.classList.toggle('error', !valid);
	input.classList.toggle('valid', valid && !!value);
	if (errorEl) {
		errorEl.textContent = msg;
		errorEl.classList.toggle('visible', !!msg);
	}
	return valid;
}

function validateForm(formId) {
	const form = document.getElementById(formId);
	if (!form) return false;
	const inputs = form.querySelectorAll('input, select');
	let valid = true;
	inputs.forEach((inp) => {
		if (!validateField(inp)) valid = false;
	});
	return valid;
}

// ── Button Loading State ───────────────────────────────────
function setLoading(btn, loading, text) {
	const spinner = btn.querySelector('.btn-spinner');
	const label = btn.querySelector('.btn-text');
	btn.disabled = loading;
	if (spinner) spinner.style.display = loading ? 'block' : 'none';
	if (label && text) label.innerHTML = text;
}

// ── Section: Home ──────────────────────────────────────────
function initHome() {
	document
		.getElementById('btn-goto-student')
		.addEventListener('click', () => showSection('student'));
	document
		.getElementById('btn-goto-lecturer')
		.addEventListener('click', () => showSection('lecturer-login'));
}

// ── Section: Student Attendance ────────────────────────────
function initStudent() {
	const form = document.getElementById('student-form');
	form.querySelectorAll('input, select').forEach((inp) => {
		inp.addEventListener('blur', () => validateField(inp));
		inp.addEventListener('input', () => {
			if (inp.classList.contains('error')) validateField(inp);
		});
	});

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		if (!validateForm('student-form')) {
			toast('Please fix the errors in the form.', 'error');
			return;
		}

		const btn = document.getElementById('student-submit-btn');
		setLoading(btn, true, '<i class="fa-solid fa-check-circle"></i> Marking…');

		await delay(1400);

		const name = document.getElementById('student-name').value.trim();
		const email = document.getElementById('student-email').value.trim();
		const course = document.getElementById('student-course').value;
		const code = document
			.getElementById('student-access-code')
			.value.trim()
			.toUpperCase();

		// Record attendance
		const record = {
			id: uid(),
			name,
			email,
			course,
			code,
			timestamp: now(),
			type: 'attendance',
		};
		state.attendanceRecords.unshift(record);
		persist();

		setLoading(
			btn,
			false,
			'<i class="fa-solid fa-check-circle"></i> Mark Attendance',
		);
		toast(`Attendance marked for ${name}!`, 'success');
		toast(`Course: ${courseName(course)}`, 'info', 3000);
		form.reset();
		form
			.querySelectorAll('input, select')
			.forEach((i) => i.classList.remove('valid', 'error'));

		setTimeout(() => showSection('home'), 2200);
	});
}

// ── Section: Lecturer Login ────────────────────────────────
function initLecturerLogin() {
	// Password toggle
	document.querySelector('.toggle-pw')?.addEventListener('click', function () {
		const pw = document.getElementById('lecturer-password');
		const isText = pw.type === 'text';
		pw.type = isText ? 'password' : 'text';
		this.querySelector('i').classList.toggle('fa-eye', isText);
		this.querySelector('i').classList.toggle('fa-eye-slash', !isText);
	});

	const form = document.getElementById('lecturer-login-form');
	form.querySelectorAll('input').forEach((inp) => {
		inp.addEventListener('blur', () => validateField(inp));
		inp.addEventListener('input', () => {
			if (inp.classList.contains('error')) validateField(inp);
		});
	});

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		if (!validateForm('lecturer-login-form')) {
			toast('Please fix the errors in the form.', 'error');
			return;
		}

		const btn = document.getElementById('lecturer-submit-btn');
		setLoading(
			btn,
			true,
			'<i class="fa-solid fa-right-to-bracket"></i> Signing in…',
		);

		await delay(1500);

		// Extract name from email (demo)
		const email = document.getElementById('lecturer-email').value.trim();
		state.lecturerName = email.split('@')[0].replace(/\./g, ' ');

		setLoading(
			btn,
			false,
			'<i class="fa-solid fa-right-to-bracket"></i> Sign In',
		);
		form.reset();
		form
			.querySelectorAll('input')
			.forEach((i) => i.classList.remove('valid', 'error'));

		toast('Login successful!', 'success');
		showDashboard();
	});
}

// ── Dashboard ──────────────────────────────────────────────
function showDashboard() {
	showSection('dashboard');
	document.getElementById('dashboard-lecturer-name').textContent =
		state.lecturerName ? capitalise(state.lecturerName) : 'Lecturer';
	updateStats();
	renderRecords();
}

function updateStats() {
	const enrolled = state.students.length;
	const records = state.attendanceRecords.length;
	const rate = enrolled
		? Math.min(100, Math.round((records / Math.max(enrolled, 1)) * 40))
		: 0;

	animateNum('stat-students', enrolled);
	animateNum('stat-sessions', state.sessionsCount);
	document.getElementById('stat-attendance').textContent = `${rate}%`;
}

function animateNum(id, target) {
	const el = document.getElementById(id);
	const start = parseInt(el.textContent) || 0;
	const diff = target - start;
	const duration = 600;
	const startTime = performance.now();

	function step(t) {
		const progress = Math.min((t - startTime) / duration, 1);
		const eased = 1 - Math.pow(1 - progress, 3);
		el.textContent = Math.round(start + diff * eased);
		if (progress < 1) requestAnimationFrame(step);
	}
	requestAnimationFrame(step);
}

function initDashboard() {
	// Logout
	document.getElementById('logout-btn').addEventListener('click', async () => {
		const ok = await confirm('Logout', 'Are you sure you want to log out?');
		if (ok) {
			state.lecturerName = '';
			showSection('home');
			toast('Logged out successfully.', 'info');
		}
	});

	// Tabs
	document.querySelectorAll('.tab-btn').forEach((btn) => {
		btn.addEventListener('click', () => {
			document
				.querySelectorAll('.tab-btn')
				.forEach((b) => b.classList.remove('active'));
			document.querySelectorAll('.tab-panel').forEach((p) => {
				p.classList.add('hidden');
				p.classList.remove('active');
			});
			btn.classList.add('active');
			const panel = document.getElementById(btn.dataset.tab);
			if (panel) {
				panel.classList.remove('hidden');
				panel.classList.add('active');
			}
		});
	});

	// Overview card shortcuts
	document
		.getElementById('card-goto-add')
		.addEventListener('click', () => switchTab('tab-add-student'));
	document
		.getElementById('card-goto-code')
		.addEventListener('click', () => switchTab('tab-access-code'));
	document
		.getElementById('card-goto-records')
		.addEventListener('click', () => switchTab('tab-records'));

	initAddStudent();
	initAccessCode();
	initRecords();
}

function switchTab(tabId) {
	document.querySelectorAll('.tab-btn').forEach((b) => {
		b.classList.toggle('active', b.dataset.tab === tabId);
	});
	document.querySelectorAll('.tab-panel').forEach((p) => {
		const active = p.id === tabId;
		p.classList.toggle('hidden', !active);
		p.classList.toggle('active', active);
	});
}

// ── Add Student ────────────────────────────────────────────
function initAddStudent() {
	const form = document.getElementById('add-student-form');
	form.querySelectorAll('input, select').forEach((inp) => {
		inp.addEventListener('blur', () => validateField(inp));
		inp.addEventListener('input', () => {
			if (inp.classList.contains('error')) validateField(inp);
		});
	});

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		if (!validateForm('add-student-form')) {
			toast('Please fill in all fields correctly.', 'error');
			return;
		}

		const btn = document.getElementById('add-student-submit');
		const name = document.getElementById('add-student-name').value.trim();
		const email = document.getElementById('add-student-email').value.trim();
		const course = document.getElementById('add-student-course').value;

		// Check duplicate
		if (state.students.some((s) => s.email === email && s.course === course)) {
			toast('This student is already enrolled in that course.', 'error');
			return;
		}

		setLoading(btn, true, '<i class="fa-solid fa-user-plus"></i> Adding…');
		await delay(1000);

		state.students.push({ id: uid(), name, email, course, enrolled: now() });
		persist();
		updateStats();

		setLoading(btn, false, '<i class="fa-solid fa-user-plus"></i> Add Student');
		form.reset();
		form
			.querySelectorAll('input, select')
			.forEach((i) => i.classList.remove('valid', 'error'));
		toast(`${name} added to ${course}!`, 'success');
	});
}

// ── Access Code ────────────────────────────────────────────
let codeCountdown = null;
const CODE_TTL = 5 * 60 * 1000; // 5 minutes

function pruneExpiredCodes() {
	const n = now();
	Object.keys(state.activeCodes).forEach((k) => {
		if (state.activeCodes[k].expires <= n) delete state.activeCodes[k];
	});
}

function initAccessCode() {
	document.getElementById('generate-code-btn').addEventListener('click', () => {
		const courseEl = document.getElementById('code-course');
		if (!courseEl.value) {
			toast('Please select a course first.', 'error');
			return;
		}

		pruneExpiredCodes();
		const code = generateCode();
		const expires = now() + CODE_TTL;
		state.activeCodes[code] = { course: courseEl.value, expires };
		state.sessionsCount++;
		persist();

		document.getElementById('code-value').textContent = code;
		document.getElementById('code-course-name').textContent = courseEl.value;
		document.getElementById('generated-code-box').classList.remove('hidden');

		startCodeTimer(expires);
		updateStats();
		toast(`Code "${code}" generated for ${courseEl.value}!`, 'success');
	});

	document.getElementById('copy-code-btn').addEventListener('click', () => {
		const code = document.getElementById('code-value').textContent;
		navigator.clipboard
			.writeText(code)
			.then(() => toast('Code copied to clipboard!', 'success'));
	});
}

function startCodeTimer(expires) {
	if (codeCountdown) clearInterval(codeCountdown);
	const timerEl = document.getElementById('code-timer');

	function tick() {
		const remaining = expires - now();
		if (remaining <= 0) {
			timerEl.textContent = '00:00';
			clearInterval(codeCountdown);
			document.getElementById('generated-code-box').classList.add('hidden');
			toast('Access code expired.', 'info');
			return;
		}
		timerEl.textContent = formatTime(remaining);
	}

	tick();
	codeCountdown = setInterval(tick, 1000);
}

// ── Records ────────────────────────────────────────────────
function initRecords() {
	document
		.getElementById('records-search')
		.addEventListener('input', renderRecords);
	document
		.getElementById('clear-records-btn')
		.addEventListener('click', async () => {
			const ok = await confirm(
				'Clear All Records',
				'This will permanently delete all attendance records. Continue?',
			);
			if (ok) {
				state.attendanceRecords = [];
				persist();
				renderRecords();
				updateStats();
				toast('All records cleared.', 'info');
			}
		});
}

function renderRecords() {
	const query = (
		document.getElementById('records-search')?.value || ''
	).toLowerCase();
	const list = document.getElementById('records-list');
	if (!list) return;

	const filtered = state.attendanceRecords.filter(
		(r) =>
			r.name.toLowerCase().includes(query) ||
			r.course.toLowerCase().includes(query) ||
			r.email.toLowerCase().includes(query),
	);

	if (filtered.length === 0) {
		list.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-inbox"></i>
        <p>${query ? 'No matching records found.' : 'No attendance records yet.'}</p>
      </div>`;
		return;
	}

	list.innerHTML = filtered
		.map(
			(r) => `
    <div class="record-item">
      <div class="record-avatar">${getInitials(r.name)}</div>
      <div class="record-info">
        <div class="record-name">${escHtml(r.name)}</div>
        <div class="record-meta">${escHtml(r.email)} · ${timeAgo(r.timestamp)}</div>
      </div>
      <span class="record-badge">${r.course}</span>
    </div>`,
		)
		.join('');
}

// ── Tiny helpers ───────────────────────────────────────────
function delay(ms) {
	return new Promise((r) => setTimeout(r, ms));
}
function uid() {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function capitalise(str) {
	return str.replace(/\b\w/g, (c) => c.toUpperCase());
}
function escHtml(str) {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
	initHome();
	initStudent();
	initLecturerLogin();
	initDashboard();

	// Global error handler
	window.addEventListener('error', (e) => {
		console.error('CAS Error:', e.error);
		toast('An unexpected error occurred.', 'error');
	});

	console.log(
		'%cCAS · Class Attendance System · KNUST',
		'color:#27a05a;font-weight:bold;font-size:14px;',
	);
});
