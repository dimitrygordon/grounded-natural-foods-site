/**
 * Grounded Natural Foods — auth management functions.
 * These run on Google's servers, never in a browser, which is what makes
 * role claims trustworthy: nothing here can be faked from client code.
 *
 * Usernames are mapped to synthetic emails (username@groundedmarket.com)
 * because Firebase Auth is email-based; staff never see or use the email.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();

const EMAIL_DOMAIN = 'groundedmarket.com';
const toEmail = (username) => `${username.trim().toLowerCase().replace(/\s+/g, '')}@${EMAIL_DOMAIN}`;

function requireMaster(request){
  if (!request.auth || request.auth.token.role !== 'master') {
    throw new HttpsError('permission-denied', 'Only the master account can manage employee logins.');
  }
}

// Create a Firebase Auth login for a new employee.
// Called by the app right after master adds the employee's Firestore profile.
exports.createEmployeeAuth = onCall(async (request) => {
  requireMaster(request);
  const { username, password, employeeId } = request.data || {};
  if (!username || !password || !employeeId) throw new HttpsError('invalid-argument', 'username, password, and employeeId are required.');
  if (password.length < 6) throw new HttpsError('invalid-argument', 'Password must be at least 6 characters (Firebase requirement).');
  const user = await admin.auth().createUser({ email: toEmail(username), password });
  await admin.auth().setCustomUserClaims(user.uid, { role: 'employee', employeeId });
  await admin.firestore().collection('employees').doc(employeeId).set({ authUid: user.uid }, { merge: true });
  return { uid: user.uid };
});

// Update an employee's username and/or password, or enable/disable login.
exports.updateEmployeeAuth = onCall(async (request) => {
  requireMaster(request);
  const { employeeId, username, password, disabled } = request.data || {};
  if (!employeeId) throw new HttpsError('invalid-argument', 'employeeId is required.');
  const snap = await admin.firestore().collection('employees').doc(employeeId).get();
  const uid = snap.exists ? snap.data().authUid : null;
  if (!uid) throw new HttpsError('not-found', 'No auth account found for that employee — try Save again after re-adding them.');
  const update = {};
  if (username) update.email = toEmail(username);
  if (password) {
    if (password.length < 6) throw new HttpsError('invalid-argument', 'Password must be at least 6 characters.');
    update.password = password;
  }
  if (typeof disabled === 'boolean') update.disabled = disabled;
  await admin.auth().updateUser(uid, update);
  return { ok: true };
});

// Delete an employee's login entirely (called when master deletes them).
exports.deleteEmployeeAuth = onCall(async (request) => {
  requireMaster(request);
  const { employeeId } = request.data || {};
  if (!employeeId) throw new HttpsError('invalid-argument', 'employeeId is required.');
  const snap = await admin.firestore().collection('employees').doc(employeeId).get();
  const uid = snap.exists ? snap.data().authUid : null;
  if (uid) await admin.auth().deleteUser(uid).catch(() => {});
  return { ok: true };
});

const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
// weekKey is the Monday of that week as YYYY-MM-DD; dayKey is one of ALL_DAYS.
// Pure calendar-date arithmetic (no time-of-day), so UTC is fine here.
function dateForDay(weekKey, dayKey) {
  const idx = ALL_DAYS.indexOf(dayKey);
  const [y, m, d] = weekKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + idx);
  return date.toISOString().slice(0, 10);
}

// An employee claims an open shift on a first-come-first-served basis. This
// has to run server-side (not a direct client write) because it touches two
// collections atomically — marking the open shift taken AND creating the
// employee's real scheduleShifts doc — and has to validate against their
// existing schedule and time-off requests, which only trusted server code
// can be relied on to check correctly and without a race between two
// employees claiming the same shift at once.
exports.claimOpenShift = onCall(async (request) => {
  if (!request.auth || request.auth.token.role !== 'employee') {
    throw new HttpsError('permission-denied', 'Only an employee account can claim an open shift.');
  }
  const employeeId = request.auth.token.employeeId;
  const { openShiftId } = request.data || {};
  if (!openShiftId) throw new HttpsError('invalid-argument', 'openShiftId is required.');
  const db = admin.firestore();
  const shiftRef = db.collection('openShifts').doc(openShiftId);
  return db.runTransaction(async (tx) => {
    const shiftSnap = await tx.get(shiftRef);
    if (!shiftSnap.exists) throw new HttpsError('not-found', "That open shift isn't available anymore.");
    const shift = shiftSnap.data();
    if (shift.claimedBy) throw new HttpsError('failed-precondition', 'Someone already picked up this shift.');
    const scheduleId = `${shift.weekKey}__${employeeId}__${shift.dayKey}`;
    const scheduleRef = db.collection('scheduleShifts').doc(scheduleId);
    const existingShiftSnap = await tx.get(scheduleRef);
    if (existingShiftSnap.exists) {
      throw new HttpsError('failed-precondition', "You're already scheduled that day — you can't pick up an overlapping shift.");
    }
    const dateISO = dateForDay(shift.weekKey, shift.dayKey);
    const timeOffSnap = await db.collection('timeOffRequests').where('employeeId', '==', employeeId).get();
    const blockingTimeOff = timeOffSnap.docs.some((d) => {
      const r = d.data();
      if (r.status === 'denied') return false;
      const start = r.startDate || r.date;
      const end = r.endDate || r.date || r.startDate;
      return start <= dateISO && dateISO <= end;
    });
    if (blockingTimeOff) {
      throw new HttpsError('failed-precondition', "You have time off requested that day — you can't pick up a shift then.");
    }
    tx.update(shiftRef, { claimedBy: employeeId, claimedAt: new Date().toISOString() });
    tx.set(scheduleRef, { start: shift.start, end: shift.end, notes: shift.notes || '' });
    return { ok: true };
  });
});

// A customer edits their own order's items (add/remove/change qty or note)
// — but never an item already marked done, and never by marking something
// done themselves. Firestore security rules can't reliably express "this
// specific array element, matched by ID, must be unchanged," so that check
// runs here in real code instead, inside a transaction so it can't race
// against staff marking an item done at the same moment.
exports.updateMyOrderItems = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please log in to edit your order.');
  const uid = request.auth.uid;
  const { orderId, items } = request.data || {};
  if (!orderId || !Array.isArray(items)) {
    throw new HttpsError('invalid-argument', 'orderId and items are required.');
  }
  const db = admin.firestore();
  const orderRef = db.collection('orders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const order = snap.data();
    if (order.customerId !== uid) throw new HttpsError('permission-denied', "That's not your order.");
    const oldItems = order.items || [];
    for (const oldItem of oldItems) {
      if (!oldItem.done) continue;
      const match = items.find((i) => i.lineId === oldItem.lineId);
      if (!match || JSON.stringify(match) !== JSON.stringify(oldItem)) {
        throw new HttpsError('failed-precondition', "An item that's already been completed can't be changed or removed.");
      }
    }
    for (const item of items) {
      if (item.done) {
        const wasAlreadyDone = oldItems.some((o) => o.lineId === item.lineId && o.done);
        if (!wasAlreadyDone) throw new HttpsError('failed-precondition', 'Invalid item state.');
      }
    }
    const status = items.length && items.every((i) => i.done) ? 'completed' : 'incomplete';
    tx.update(orderRef, { items, status });
    return { ok: true };
  });
});
